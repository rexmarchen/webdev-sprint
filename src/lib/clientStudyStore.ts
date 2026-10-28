import type {
  StudyRoom,
  StudyRoomMember,
  StudyRoomCollab,
  StudyRoomEvent,
  StudyRoomDetailView,
  StudyMode,
  RoomStreamMessage,
} from '@shared/types';

const STORAGE_KEY = 'study_rooms_client_store_v1';
const broadcast = typeof window !== 'undefined' && 'BroadcastChannel' in window
  ? new BroadcastChannel('study_rooms_realtime')
  : null;

interface StoreData {
  rooms: Record<string, StudyRoom>;
  members: Record<string, StudyRoomMember[]>;
  collab: Record<string, StudyRoomCollab>;
  events: Record<string, StudyRoomEvent[]>;
}

const DEFAULT_ROOMS: StudyRoom[] = [
  {
    id: 'room_calc3',
    name: 'Calculus III & Linear Algebra Sprint',
    subject: 'Mathematics',
    description: 'Working through multivariate optimization and eigenvector problems. 25-minute Pomodoro focus blocks.',
    hostId: 'host_aarav',
    hostName: 'Aarav Sharma',
    maxParticipants: 5,
    currentParticipants: 1,
    visibility: 'public',
    status: 'active',
    studyMode: 'pomodoro',
    durationMinutes: 60,
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    closedAt: null,
    closedReason: null,
  },
  {
    id: 'room_orgo2',
    name: 'Organic Chemistry II — Reaction Mechanisms',
    subject: 'Chemistry',
    description: 'Aldol condensations, Michael additions, and Robinson annulation practice.',
    hostId: 'host_rohan',
    hostName: 'Rohan Verma',
    maxParticipants: 4,
    currentParticipants: 1,
    visibility: 'public',
    status: 'active',
    studyMode: 'pomodoro',
    durationMinutes: 60,
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    closedAt: null,
    closedReason: null,
  },
  {
    id: 'room_os_dist',
    name: 'Operating Systems & Distributed Systems',
    subject: 'Computer Science',
    description: 'Kernel concurrency, mutex lock primitives, and Raft consensus algorithms discussion & silent cram.',
    hostId: 'host_meera',
    hostName: 'Meera Patel',
    maxParticipants: 6,
    currentParticipants: 1,
    visibility: 'public',
    status: 'active',
    studyMode: 'focus',
    durationMinutes: 60,
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    closedAt: null,
    closedReason: null,
  },
  {
    id: 'room_biochem',
    name: 'Biochemistry & Molecular Genetics',
    subject: 'Biology',
    description: 'DNA replication fork enzymes, CRISPR-Cas9 mechanism, and PCR design.',
    hostId: 'host_kabir',
    hostName: 'Kabir Das',
    maxParticipants: 4,
    currentParticipants: 1,
    visibility: 'public',
    status: 'active',
    studyMode: 'cram',
    durationMinutes: 60,
    expiresAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    closedAt: null,
    closedReason: null,
  },
];

function loadStore(): StoreData {
  if (typeof window === 'undefined') {
    return { rooms: {}, members: {}, collab: {}, events: {} };
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }

  // Seed default
  const rooms: Record<string, StudyRoom> = {};
  const members: Record<string, StudyRoomMember[]> = {};
  const collab: Record<string, StudyRoomCollab> = {};
  const events: Record<string, StudyRoomEvent[]> = {};

  for (const r of DEFAULT_ROOMS) {
    rooms[r.id] = r;
    members[r.id] = [
      {
        roomId: r.id,
        userId: r.hostId,
        userName: r.hostName,
        userAvatar: null,
        isHost: true,
        joinedAt: r.createdAt,
        lastHeartbeat: r.createdAt,
        status: 'active',
      },
    ];
    collab[r.id] = {
      roomId: r.id,
      pomodoroState: {
        status: 'idle',
        mode: 'focus',
        remainingSeconds: 1500,
        durationSeconds: 1500,
        cycle: 1,
        updatedAt: '',
      },
      sharedNotes: '',
      studyGoals: [],
      updatedAt: r.createdAt,
    };
    events[r.id] = [
      {
        id: 1,
        roomId: r.id,
        userId: r.hostId,
        userName: r.hostName,
        eventType: 'system',
        content: `Room created by ${r.hostName}`,
        createdAt: r.createdAt,
      },
    ];
  }

  const initial: StoreData = { rooms, members, collab, events };
  saveStore(initial);
  return initial;
}

function saveStore(data: StoreData) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore
  }
}

function notify(msg: RoomStreamMessage) {
  if (broadcast) {
    try {
      broadcast.postMessage(msg);
    } catch {
      // ignore
    }
  }
}

export const clientStudyStore = {
  subscribe(callback: (msg: RoomStreamMessage) => void) {
    if (!broadcast) return () => {};
    const handler = (e: MessageEvent) => {
      if (e.data) callback(e.data);
    };
    broadcast.addEventListener('message', handler);
    return () => broadcast.removeEventListener('message', handler);
  },

  listRooms(params: { subject?: string; search?: string; availability?: string } = {}): { rooms: StudyRoom[] } {
    const store = loadStore();
    const now = Date.now();
    let list = Object.values(store.rooms);

    // Auto-expire or close empty
    for (const room of list) {
      if (room.status === 'active' && new Date(room.expiresAt).getTime() <= now) {
        room.status = 'closed';
        room.closedReason = 'Scheduled countdown timer expired';
        room.closedAt = new Date().toISOString();
      }
    }
    saveStore(store);

    list = list.filter((r) => r.status === 'active');

    if (params.subject && params.subject !== 'All') {
      list = list.filter((r) => r.subject.toLowerCase() === params.subject!.toLowerCase());
    }
    if (params.search) {
      const q = params.search.toLowerCase();
      list = list.filter((r) => r.name.toLowerCase().includes(q) || r.subject.toLowerCase().includes(q));
    }
    if (params.availability === 'available') {
      list = list.filter((r) => r.currentParticipants < r.maxParticipants);
    } else if (params.availability === 'full') {
      list = list.filter((r) => r.currentParticipants >= r.maxParticipants);
    }

    return { rooms: list };
  },

  getRoomDetail(roomId: string): StudyRoomDetailView | null {
    const store = loadStore();
    let room = store.rooms[roomId];

    if (!room) {
      // Auto-provision room detail ONLY for direct shared links from another device.
      // This should never overwrite an existing room's expiresAt.
      const now = new Date().toISOString();
      const provisionedDuration = 60; // minutes
      room = {
        id: roomId,
        name: 'Collaborative Study Circle',
        subject: 'General Study',
        description: 'Live shared virtual study room session.',
        hostId: 'host_student',
        hostName: 'Study Partner',
        maxParticipants: 5,
        currentParticipants: 1,
        visibility: 'public',
        status: 'active',
        studyMode: 'pomodoro',
        durationMinutes: provisionedDuration,
        // Use expiresAt only for brand-new provisioned rooms — never overwrites existing rooms
        expiresAt: new Date(Date.now() + provisionedDuration * 60_000).toISOString(),
        createdAt: now,
        updatedAt: now,
        closedAt: null,
        closedReason: null,
      };
      store.rooms[roomId] = room;
      store.members[roomId] = [
        {
          roomId,
          userId: room.hostId,
          userName: room.hostName,
          userAvatar: null,
          isHost: true,
          joinedAt: now,
          lastHeartbeat: now,
          status: 'active',
        },
      ];
      store.collab[roomId] = {
        roomId,
        pomodoroState: { status: 'idle', mode: 'focus', remainingSeconds: 1500, durationSeconds: 1500, cycle: 1, updatedAt: '' },
        sharedNotes: '',
        studyGoals: [],
        updatedAt: now,
      };
      store.events[roomId] = [
        {
          id: Date.now(),
          roomId,
          userId: room.hostId,
          userName: room.hostName,
          eventType: 'system',
          content: 'Study room opened and ready for collaborative focus',
          createdAt: now,
        },
      ];
      saveStore(store);
    }

    const members = store.members[roomId] || [];
    const collab = store.collab[roomId] || {
      roomId,
      pomodoroState: { status: 'idle', mode: 'focus', remainingSeconds: 1500, durationSeconds: 1500, cycle: 1, updatedAt: '' },
      sharedNotes: '',
      studyGoals: [],
      updatedAt: new Date().toISOString(),
    };
    const events = store.events[roomId] || [];

    return { room, members, collab, recentEvents: events };
  },

  createRoom(input: {
    name: string;
    subject: string;
    description?: string;
    maxParticipants: number;
    durationMinutes?: number;
    visibility?: 'public' | 'unlisted';
    studyMode?: StudyMode;
    userId?: string;
    userName?: string;
    userAvatar?: string | null;
  }): StudyRoomDetailView {
    const store = loadStore();
    const id = 'room_' + Math.random().toString(36).substring(2, 10);
    const now = new Date().toISOString();
    const duration = input.durationMinutes || 60;
    const expiresAt = new Date(Date.now() + duration * 60_000).toISOString();
    const hostId = input.userId || 'guest_' + Math.random().toString(36).substring(2, 8);
    const hostName = input.userName || 'Study Partner';

    const room: StudyRoom = {
      id,
      name: input.name.trim(),
      subject: input.subject.trim(),
      description: input.description?.trim() || null,
      hostId,
      hostName,
      maxParticipants: input.maxParticipants,
      currentParticipants: 1,
      visibility: input.visibility || 'public',
      status: 'active',
      studyMode: input.studyMode || 'pomodoro',
      durationMinutes: duration,
      expiresAt,
      createdAt: now,
      updatedAt: now,
      closedAt: null,
      closedReason: null,
    };

    const member: StudyRoomMember = {
      roomId: id,
      userId: hostId,
      userName: hostName,
      userAvatar: input.userAvatar || null,
      isHost: true,
      joinedAt: now,
      lastHeartbeat: now,
      status: 'active',
    };

    const collab: StudyRoomCollab = {
      roomId: id,
      pomodoroState: {
        status: 'idle',
        mode: 'focus',
        remainingSeconds: 1500,
        durationSeconds: 1500,
        cycle: 1,
        updatedAt: '',
      },
      sharedNotes: '',
      studyGoals: [],
      updatedAt: now,
    };

    const event: StudyRoomEvent = {
      id: Date.now(),
      roomId: id,
      userId: hostId,
      userName: hostName,
      eventType: 'system',
      content: `Room created by ${hostName} with ${duration}-minute countdown`,
      createdAt: now,
    };

    store.rooms[id] = room;
    store.members[id] = [member];
    store.collab[id] = collab;
    store.events[id] = [event];
    saveStore(store);

    notify({ type: 'room_update', room, timestamp: now });

    return { room, members: [member], collab, recentEvents: [event] };
  },

  joinRoom(roomId: string, user: { userId?: string; userName?: string; userAvatar?: string | null }): StudyRoomDetailView {
    const store = loadStore();
    const room = store.rooms[roomId];
    if (!room) throw new Error('ROOM_NOT_FOUND');
    if (room.status !== 'active') throw new Error('ROOM_CLOSED');

    const members = store.members[roomId] || [];
    const userId = user.userId || 'guest_' + Math.random().toString(36).substring(2, 8);
    const userName = user.userName || 'Student';

    const existing = members.find((m) => m.userId === userId);
    const now = new Date().toISOString();

    if (!existing) {
      if (members.length >= room.maxParticipants) {
        throw new Error('ROOM_FULL');
      }

      const newMember: StudyRoomMember = {
        roomId,
        userId,
        userName,
        userAvatar: user.userAvatar || null,
        isHost: false,
        joinedAt: now,
        lastHeartbeat: now,
        status: 'active',
      };
      members.push(newMember);
      room.currentParticipants = members.length;
      room.updatedAt = now;

      const event: StudyRoomEvent = {
        id: Date.now(),
        roomId,
        userId,
        userName,
        eventType: 'join',
        content: `${userName} joined the study room`,
        createdAt: now,
      };
      if (!store.events[roomId]) store.events[roomId] = [];
      store.events[roomId].push(event);

      saveStore(store);
      notify({ type: 'member_joined', roomId, room, member: newMember, timestamp: now });
    }

    return this.getRoomDetail(roomId)!;
  },

  leaveRoom(roomId: string, userId: string): { success: boolean; closed?: boolean } {
    const store = loadStore();
    const room = store.rooms[roomId];
    if (!room) return { success: false };

    let members = store.members[roomId] || [];
    const leaving = members.find((m) => m.userId === userId);
    members = members.filter((m) => m.userId !== userId);
    store.members[roomId] = members;
    room.currentParticipants = members.length;
    const now = new Date().toISOString();

    if (members.length === 0) {
      room.status = 'closed';
      room.closedReason = 'All participants have left';
      room.closedAt = now;
      saveStore(store);
      notify({ type: 'room_closed', roomId, reason: 'All participants have left', timestamp: now });
      return { success: true, closed: true };
    }

    if (leaving && !members.some((m) => m.isHost)) {
      members[0].isHost = true;
    }

    saveStore(store);
    notify({ type: 'member_left', roomId, userId, room, timestamp: now });
    return { success: true };
  },

  updateCollab(roomId: string, patch: Partial<StudyRoomCollab>): StudyRoomCollab {
    const store = loadStore();
    const current = store.collab[roomId] || {
      roomId,
      pomodoroState: { status: 'idle', mode: 'focus', remainingSeconds: 1500, durationSeconds: 1500, cycle: 1, updatedAt: '' },
      sharedNotes: '',
      studyGoals: [],
      updatedAt: new Date().toISOString(),
    };
    const updated = { ...current, ...patch, updatedAt: new Date().toISOString() };
    store.collab[roomId] = updated;
    saveStore(store);
    notify({ type: 'collab_update', roomId, collab: updated, timestamp: updated.updatedAt });
    return updated;
  },

  addEvent(roomId: string, event: Omit<StudyRoomEvent, 'id' | 'createdAt' | 'roomId'>): StudyRoomEvent {
    const store = loadStore();
    const now = new Date().toISOString();
    const fullEvent: StudyRoomEvent = {
      ...event,
      id: Date.now(),
      roomId,
      createdAt: now,
    };
    if (!store.events[roomId]) store.events[roomId] = [];
    store.events[roomId].push(fullEvent);
    saveStore(store);
    notify({ type: 'new_event', roomId, event: fullEvent, timestamp: now });
    return fullEvent;
  },
};
