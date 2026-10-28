import { useEffect, useState, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  MemberPresenceStatus,
  PomodoroState,
  RoomStreamMessage,
  StudyGoal,
  StudyRoom,
  StudyRoomCollab,
  StudyRoomDetailView,
  StudyRoomEvent,
} from '@shared/types';
import { api } from './api';
import { useStudentProfile } from './studentSession';
import { clientStudyStore } from './clientStudyStore';

// Base API URL
const configuredBase = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim();
const API_BASE = configuredBase ? configuredBase.replace(/\/+$/, '') : '/api';

/**
 * Hook for live real-time room discovery with zero server polling
 */
export function useStudyRoomsDiscovery(options: {
  subject?: string;
  search?: string;
  availability?: 'all' | 'available' | 'full';
} = {}) {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);

  const queryKey = useMemo(
    () => ['study-rooms', options.subject || 'All', options.search || '', options.availability || 'all'],
    [options.subject, options.search, options.availability],
  );

  const roomsQuery = useQuery({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (options.subject && options.subject !== 'All') params.set('subject', options.subject);
      if (options.search) params.set('search', options.search);
      if (options.availability && options.availability !== 'all') params.set('availability', options.availability);

      const query = params.toString() ? `?${params.toString()}` : '';
      const data = await api<{ rooms: StudyRoom[] }>(`/study/rooms${query}`);
      return data.rooms || [];
    },
    staleTime: 60_000,
  });

  // Connect to SSE stream for live real-time discovery updates
  useEffect(() => {
    let es: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
      try {
        es = new EventSource(`${API_BASE}/study/stream`);

        es.onopen = () => {
          setConnected(true);
        };

        es.onmessage = (event) => {
          try {
            const msg: RoomStreamMessage = JSON.parse(event.data);
            if (msg.type === 'room_update' && msg.room) {
              queryClient.setQueryData<StudyRoom[]>(queryKey, (prev) => {
                const list = prev || [];
                const updatedRoom = msg.room!;
                const index = list.findIndex((r) => r.id === updatedRoom.id);
                if (index >= 0) {
                  const next = [...list];
                  next[index] = updatedRoom;
                  return next;
                }
                return [updatedRoom, ...list];
              });
            } else if (msg.type === 'room_closed' && msg.roomId) {
              queryClient.setQueryData<StudyRoom[]>(queryKey, (prev) =>
                (prev || []).filter((r) => r.id !== msg.roomId),
              );
            } else if (msg.type === 'room_list_update') {
              queryClient.invalidateQueries({ queryKey: ['study-rooms'] });
            }
          } catch {
            // ignore heartbeat/comment
          }
        };

        es.onerror = () => {
          setConnected(false);
          es?.close();
          reconnectTimeout = setTimeout(connect, 4000);
        };
      } catch {
        setConnected(false);
      }
    };

    connect();

    const unsubClient = clientStudyStore.subscribe((msg) => {
      if (msg.type === 'room_update' && msg.room) {
        queryClient.setQueryData<StudyRoom[]>(queryKey, (prev) => {
          const list = prev || [];
          const updatedRoom = msg.room!;
          const index = list.findIndex((r) => r.id === updatedRoom.id);
          if (index >= 0) {
            const next = [...list];
            next[index] = updatedRoom;
            return next;
          }
          return [updatedRoom, ...list];
        });
      } else if (msg.type === 'room_closed' && msg.roomId) {
        queryClient.setQueryData<StudyRoom[]>(queryKey, (prev) =>
          (prev || []).filter((r) => r.id !== msg.roomId),
        );
      }
    });

    return () => {
      clearTimeout(reconnectTimeout);
      es?.close();
      unsubClient();
    };
  }, [queryClient, queryKey]);

  return {
    rooms: roomsQuery.data || [],
    loading: roomsQuery.isLoading,
    error: roomsQuery.error instanceof Error ? roomsQuery.error.message : null,
    connected,
    refetch: roomsQuery.refetch,
  };
}

/**
 * Hook for live interactive study room session
 */
export function useLiveStudyRoom(roomId: string) {
  const queryClient = useQueryClient();
  // Use the same identity as creation and rendering. Falling back to the
  // local guest identity here caused signed-in hosts to repeatedly "join"
  // their own room because the membership check used a different user id.
  const { profile } = useStudentProfile();
  const [connected, setConnected] = useState(false);
  const [isRoomClosed, setIsRoomClosed] = useState(false);
  const [closedReason, setClosedReason] = useState<string | null>(null);

  const roomQuery = useQuery({
    queryKey: ['study-room', roomId],
    queryFn: async () => {
      const data = await api<StudyRoomDetailView>(`/study/rooms/${roomId}`);
      return data;
    },
    enabled: Boolean(roomId),
    staleTime: 60_000,
    retry: 1,
  });

  const detail = roomQuery.data || null;

  // Connect to In-Room Real-time SSE Stream
  useEffect(() => {
    if (!roomId) return;
    let es: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
      try {
        const studentId = encodeURIComponent(profile.id);
        es = new EventSource(`${API_BASE}/study/rooms/${roomId}/stream?userId=${studentId}`);

        es.onopen = () => {
          setConnected(true);
        };

        es.onmessage = (event) => {
          try {
            const msg: RoomStreamMessage = JSON.parse(event.data);

            if (msg.type === 'member_joined') {
              queryClient.setQueryData<StudyRoomDetailView>(['study-room', roomId], (prev) => {
                if (!prev) return prev;
                const newMember = msg.member;
                const updatedRoom = msg.room || prev.room;
                const existing = prev.members.some((m) => m.userId === newMember?.userId);
                const nextMembers = existing
                  ? prev.members.map((m) => (m.userId === newMember?.userId ? newMember! : m))
                  : newMember
                    ? [...prev.members, newMember]
                    : prev.members;

                return {
                  ...prev,
                  room: updatedRoom,
                  members: nextMembers,
                };
              });
            } else if (msg.type === 'member_left') {
              queryClient.setQueryData<StudyRoomDetailView>(['study-room', roomId], (prev) => {
                if (!prev) return prev;
                const leavingId = msg.userId;
                const nextMembers = prev.members.filter((m) => m.userId !== leavingId);
                const updatedRoom = msg.room || {
                  ...prev.room,
                  currentParticipants: nextMembers.length,
                };
                return {
                  ...prev,
                  room: updatedRoom,
                  members: nextMembers,
                };
              });
            } else if (msg.type === 'member_status' && msg.member) {
              queryClient.setQueryData<StudyRoomDetailView>(['study-room', roomId], (prev) => {
                if (!prev) return prev;
                return {
                  ...prev,
                  members: prev.members.map((m) => (m.userId === msg.member!.userId ? msg.member! : m)),
                };
              });
            } else if (msg.type === 'collab_update' && msg.collab) {
              queryClient.setQueryData<StudyRoomDetailView>(['study-room', roomId], (prev) =>
                prev ? { ...prev, collab: msg.collab! } : prev,
              );
            } else if (msg.type === 'new_event' && msg.event) {
              queryClient.setQueryData<StudyRoomDetailView>(['study-room', roomId], (prev) => {
                if (!prev) return prev;
                const exists = prev.recentEvents.some((e) => e.id === msg.event!.id);
                if (exists) return prev;
                return {
                  ...prev,
                  recentEvents: [...prev.recentEvents, msg.event!],
                };
              });
            } else if (msg.type === 'room_closed') {
              setIsRoomClosed(true);
              setClosedReason(msg.reason || 'All participants left the room.');
              queryClient.setQueryData<StudyRoomDetailView>(['study-room', roomId], (prev) =>
                prev ? { ...prev, room: { ...prev.room, status: 'closed' } } : prev,
              );
            }
          } catch {
            // ignore non-json pings
          }
        };

        es.onerror = () => {
          setConnected(false);
          es?.close();
          reconnectTimeout = setTimeout(connect, 3000);
        };
      } catch {
        setConnected(false);
      }
    };

    connect();

    const unsubClient = clientStudyStore.subscribe((msg) => {
      if (msg.roomId && msg.roomId !== roomId) return;
      if (msg.type === 'member_joined' && msg.member) {
        queryClient.setQueryData<StudyRoomDetailView>(['study-room', roomId], (prev) => {
          if (!prev) return prev;
          const newMember = msg.member!;
          const updatedRoom = msg.room || prev.room;
          const existing = prev.members.some((m) => m.userId === newMember.userId);
          const nextMembers = existing
            ? prev.members.map((m) => (m.userId === newMember.userId ? newMember : m))
            : [...prev.members, newMember];
          return { ...prev, room: updatedRoom, members: nextMembers };
        });
      } else if (msg.type === 'member_left' && msg.userId) {
        queryClient.setQueryData<StudyRoomDetailView>(['study-room', roomId], (prev) => {
          if (!prev) return prev;
          const nextMembers = prev.members.filter((m) => m.userId !== msg.userId);
          const updatedRoom = msg.room || { ...prev.room, currentParticipants: nextMembers.length };
          return { ...prev, room: updatedRoom, members: nextMembers };
        });
      } else if (msg.type === 'collab_update' && msg.collab) {
        queryClient.setQueryData<StudyRoomDetailView>(['study-room', roomId], (prev) =>
          prev ? { ...prev, collab: msg.collab! } : prev,
        );
      } else if (msg.type === 'new_event' && msg.event) {
        queryClient.setQueryData<StudyRoomDetailView>(['study-room', roomId], (prev) => {
          if (!prev) return prev;
          if (prev.recentEvents.some((e) => e.id === msg.event!.id)) return prev;
          return { ...prev, recentEvents: [...prev.recentEvents, msg.event!] };
        });
      } else if (msg.type === 'room_closed') {
        setIsRoomClosed(true);
        setClosedReason(msg.reason || 'All participants left the room.');
        queryClient.setQueryData<StudyRoomDetailView>(['study-room', roomId], (prev) =>
          prev ? { ...prev, room: { ...prev.room, status: 'closed' } } : prev,
        );
      }
    });

    return () => {
      clearTimeout(reconnectTimeout);
      es?.close();
      unsubClient();
    };
  }, [roomId, profile.id, queryClient]);

  // Periodic heartbeat every 10 seconds
  useEffect(() => {
    if (!roomId || isRoomClosed) return;

    const interval = setInterval(async () => {
      try {
        await api(`/study/rooms/${roomId}/heartbeat`, {
          method: 'POST',
          body: {
            userId: profile.id,
            userName: profile.name,
          },
        });
      } catch {
        // ignore network jitter
      }
    }, 10_000);

    return () => clearInterval(interval);
  }, [roomId, isRoomClosed, profile.id, profile.name]);

  // Automatic leave beacon on window close/tab close
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (!roomId || isRoomClosed) return;
      try {
        const payload = JSON.stringify({
          userId: profile.id,
          userName: profile.name,
          reason: 'Tab closed or navigated away',
        });
        navigator.sendBeacon(`${API_BASE}/study/rooms/${roomId}/leave`, payload);
      } catch {
        // fallback
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [roomId, isRoomClosed, profile.id, profile.name]);

  // Join Room method
  const join = useCallback(async () => {
    const result = await api<StudyRoomDetailView>(`/study/rooms/${roomId}/join`, {
      method: 'POST',
      body: {
        userId: profile.id,
        userName: profile.name,
        userAvatar: profile.avatarColor,
      },
    });
    queryClient.setQueryData(['study-room', roomId], result);
    return result;
  }, [roomId, profile.id, profile.name, profile.avatarColor, queryClient]);

  // Leave Room method
  const leave = useCallback(async () => {
    try {
      await api<{ closed: boolean; remaining: number }>(`/study/rooms/${roomId}/leave`, {
        method: 'POST',
        body: {
          userId: profile.id,
          userName: profile.name,
          reason: 'User clicked Leave Room',
        },
      });
    } catch {
      // ignore
    }
  }, [roomId, profile.id, profile.name]);

  // Update presence status (e.g. focusing, break, active)
  const setPresenceStatus = useCallback(
    async (status: MemberPresenceStatus) => {
      try {
        await api(`/study/rooms/${roomId}/heartbeat`, {
          method: 'POST',
          body: {
            userId: profile.id,
            userName: profile.name,
            status,
          },
        });
        queryClient.setQueryData<StudyRoomDetailView>(['study-room', roomId], (prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            members: prev.members.map((m) =>
              m.userId === profile.id ? { ...m, status } : m,
            ),
          };
        });
      } catch {
        // ignore
      }
    },
    [roomId, profile.id, profile.name, queryClient],
  );

  // Update collaborative tools (Pomodoro, shared notes, study goals)
  const updateCollab = useCallback(
    async (updates: {
      pomodoroState?: PomodoroState;
      sharedNotes?: string;
      studyGoals?: StudyGoal[];
    }) => {
      const res = await api<{ collab: StudyRoomCollab }>(`/study/rooms/${roomId}/collab`, {
        method: 'POST',
        body: {
          userId: profile.id,
          userName: profile.name,
          ...updates,
        },
      });
      queryClient.setQueryData<StudyRoomDetailView>(['study-room', roomId], (prev) =>
        prev ? { ...prev, collab: res.collab } : prev,
      );
      return res.collab;
    },
    [roomId, profile.id, profile.name, queryClient],
  );

  // Post chat / status message
  const postMessage = useCallback(
    async (content: string, eventType: 'message' | 'collab' | 'status' = 'message') => {
      const res = await api<{ event: StudyRoomEvent }>(`/study/rooms/${roomId}/event`, {
        method: 'POST',
        body: {
          userId: profile.id,
          userName: profile.name,
          content,
          eventType,
        },
      });
      queryClient.setQueryData<StudyRoomDetailView>(['study-room', roomId], (prev) => {
        if (!prev) return prev;
        const exists = prev.recentEvents.some((e) => e.id === res.event.id);
        if (exists) return prev;
        return {
          ...prev,
          recentEvents: [...prev.recentEvents, res.event],
        };
      });
      return res.event;
    },
    [roomId, profile.id, profile.name, queryClient],
  );

  const isMember = detail?.members.some((m) => m.userId === profile.id) ?? false;
  const isHost = detail?.room.hostId === profile.id;
  const isFull = (detail?.room.currentParticipants ?? 0) >= (detail?.room.maxParticipants ?? 5);

  const effectiveClosed = isRoomClosed || detail?.room.status === 'closed' || detail?.room.status === 'archived';
  const effectiveReason = closedReason || detail?.room.closedReason || (effectiveClosed ? 'Room is no longer active.' : null);

  return {
    detail,
    loading: roomQuery.isLoading,
    error: roomQuery.error instanceof Error ? roomQuery.error.message : null,
    connected,
    isRoomClosed: effectiveClosed,
    closedReason: effectiveReason,
    isMember,
    isHost,
    isFull,
    join,
    leave,
    setPresenceStatus,
    updateCollab,
    postMessage,
    refetch: roomQuery.refetch,
  };
}
