import type { ApiErrorShape } from '@shared/types';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: Record<string, string>;

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

const CSRF_HEADER = { 'X-Requested-With': 'pahadi-roots' };

// Same-origin `/api` is the supported default. A split deployment may set
// VITE_API_BASE_URL at build time, but must also configure ALLOWED_ORIGINS,
// SESSION_COOKIE_SAMESITE=none and HTTPS on the API (see docs/ENVIRONMENT.md).
const configuredBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
const API_BASE = configuredBase ? configuredBase.replace(/\/+$/, '') : '/api';

type ApiOptions = Omit<RequestInit, 'body'> & { body?: unknown };

/**
 * The SPA talks only to the real API. There is deliberately no localStorage
 * session fallback and no static catalogue fallback: when the API is down we
 * surface an error instead of inventing a signed-in user or stale products.
 */
export async function api<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const { body, headers, ...rest } = options;
  const isForm = body instanceof FormData;
  let response: Response;

  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: 'include',
      ...rest,
      headers: {
        ...CSRF_HEADER,
        ...(isForm || body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(headers as Record<string, string> | undefined),
      },
      body: isForm ? body : body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (path.startsWith('/study/')) {
      const fallback = handleClientStudy<T>(path, options);
      if (fallback !== null) return fallback;
    }
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection and try again.');
  }

  const contentType = response.headers.get('content-type') || '';
  const text = await response.text();
  let parsed: unknown = null;
  if (text && contentType.includes('application/json')) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok || parsed === null) {
    // If backend is 404 or unmounted (e.g. static Vercel deployment), fall back to clientStudyStore
    if (path.startsWith('/study/') && (response.status === 404 || parsed === null)) {
      const fallback = handleClientStudy<T>(path, options);
      if (fallback !== null) return fallback;
    }

    const shape = parsed as Partial<ApiErrorShape> | null;
    const error = shape?.error;
    throw new ApiError(
      response.status,
      error?.code ?? (parsed === null ? 'invalid_response' : 'request_failed'),
      error?.message ??
        (parsed === null
          ? 'The server returned an unexpected response. If this site is hosted statically, the API is not deployed here.'
          : `The request failed (${response.status}).`),
      error?.fields ?? {},
    );
  }

  return parsed as T;
}

import { clientStudyStore } from './clientStudyStore';

function handleClientStudy<T>(path: string, options: ApiOptions): T | null {
  // GET /study/rooms
  if (path.startsWith('/study/rooms') && (!options.method || options.method === 'GET')) {
    const url = new URL(path, 'http://localhost');
    const subject = url.searchParams.get('subject') || undefined;
    const search = url.searchParams.get('search') || undefined;
    const availability = url.searchParams.get('availability') || undefined;
    return clientStudyStore.listRooms({ subject, search, availability }) as unknown as T;
  }
  // POST /study/rooms
  if (path === '/study/rooms' && options.method === 'POST') {
    return clientStudyStore.createRoom(options.body as any) as unknown as T;
  }
  // POST /study/rooms/:id/join
  const joinMatch = path.match(/^\/study\/rooms\/([^/]+)\/join$/);
  if (joinMatch && options.method === 'POST') {
    const roomId = joinMatch[1];
    // If room not in store yet, load its detail first (auto-provision once), then join
    try {
      return clientStudyStore.joinRoom(roomId, (options.body as any) || {}) as unknown as T;
    } catch (e: any) {
      if (e.message === 'ROOM_FULL') throw new ApiError(409, 'room_full', 'This study room has reached its maximum capacity.');
      if (e.message === 'ROOM_CLOSED') throw new ApiError(410, 'room_closed', 'This study room is no longer active.');
      if (e.message === 'ROOM_NOT_FOUND') {
        // Auto-provision then join — preserves any existing expiresAt via getRoomDetail
        clientStudyStore.getRoomDetail(roomId);
        try {
          return clientStudyStore.joinRoom(roomId, (options.body as any) || {}) as unknown as T;
        } catch (e2: any) {
          if (e2.message === 'ROOM_FULL') throw new ApiError(409, 'room_full', 'This study room has reached its maximum capacity.');
          if (e2.message === 'ROOM_CLOSED') throw new ApiError(410, 'room_closed', 'This study room is no longer active.');
        }
      }
      throw new ApiError(404, 'room_not_found', 'Room not found.');
    }
  }
  // POST /study/rooms/:id/leave
  const leaveMatch = path.match(/^\/study\/rooms\/([^/]+)\/leave$/);
  if (leaveMatch && options.method === 'POST') {
    return clientStudyStore.leaveRoom(leaveMatch[1], (options.body as any)?.userId || '') as unknown as T;
  }
  // GET /study/rooms/:id
  const getMatch = path.match(/^\/study\/rooms\/([^/]+)$/);
  if (getMatch && (!options.method || options.method === 'GET')) {
    const detail = clientStudyStore.getRoomDetail(getMatch[1]);
    if (!detail) throw new ApiError(404, 'room_not_found', 'Study room not found or has been closed.');
    return detail as unknown as T;
  }
  // POST /study/rooms/:id/collab
  const collabMatch = path.match(/^\/study\/rooms\/([^/]+)\/collab$/);
  if (collabMatch && options.method === 'POST') {
    return clientStudyStore.updateCollab(collabMatch[1], options.body as any) as unknown as T;
  }
  // POST /study/rooms/:id/event
  // Keep the browser-only fallback aligned with the real API route.  Static
  // deployments still cannot share this state between devices, but messages
  // should work in the same browser instead of failing with a 404.
  const eventMatch = path.match(/^\/study\/rooms\/([^/]+)\/event$/);
  if (eventMatch && options.method === 'POST') {
    return clientStudyStore.addEvent(eventMatch[1], options.body as any) as unknown as T;
  }
  // POST /study/rooms/:id/heartbeat
  if (path.includes('/heartbeat')) {
    return { success: true } as unknown as T;
  }
  return null;
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

export function errorFields(error: unknown): Record<string, string> {
  return error instanceof ApiError ? error.fields : {};
}
