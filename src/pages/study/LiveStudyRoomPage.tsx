import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import type { PomodoroState, StudyGoal } from '@shared/types';
import { useLiveStudyRoom } from '@/lib/studyRealtime';
import { useStudentProfile } from '@/lib/studentSession';
import { useToast } from '@/lib/toast';
import { StudyNavbar } from '@/components/study/StudyNavbar';

export function LiveStudyRoomPage() {
  const { roomId = '' } = useParams<{ roomId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { profile } = useStudentProfile();

  const {
    detail,
    loading,
    error,
    connected,
    isRoomClosed,
    closedReason,
    isMember,
    isHost,
    isFull,
    join,
    leave,
    setPresenceStatus,
    updateCollab,
    postMessage,
  } = useLiveStudyRoom(roomId);

  const [activeTab, setActiveTab] = useState<'pomodoro' | 'notes' | 'goals' | 'chat'>('pomodoro');
  const [chatInput, setChatInput] = useState('');
  const [notesInput, setNotesInput] = useState('');
  const [prevNotes, setPrevNotes] = useState<string | null>(null);
  const [goalInput, setGoalInput] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const autoJoinAttemptRef = useRef<string | null>(null);

  // Live seconds ticker for room expiry countdown
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const expiryMs = detail?.room.expiresAt ? new Date(detail.room.expiresAt).getTime() : 0;
  const remainingExpirySeconds = expiryMs > 0 ? Math.max(0, Math.floor((expiryMs - nowMs) / 1000)) : 3600;
  const isExpiringSoon = remainingExpirySeconds > 0 && remainingExpirySeconds <= 300;
  const isRoomExpired = detail !== null && expiryMs > 0 && remainingExpirySeconds <= 0;

  const formatCountdown = (secs: number) => {
    const hours = Math.floor(secs / 3600);
    const minutes = Math.floor((secs % 3600) / 60);
    const seconds = secs % 60;
    if (hours > 0) {
      return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  // Sync shared notes when collab updates from another member
  useEffect(() => {
    if (detail?.collab?.sharedNotes !== undefined && detail.collab.sharedNotes !== prevNotes) {
      setPrevNotes(detail.collab.sharedNotes);
      setNotesInput(detail.collab.sharedNotes);
    }
  }, [detail?.collab?.sharedNotes, prevNotes]);

  // Attempt automatic join if not already member and not full
  useEffect(() => {
    const attemptKey = `${roomId}:${profile.id}`;
    if (
      !loading &&
      detail &&
      !isMember &&
      !isFull &&
      !isRoomClosed &&
      !isRoomExpired &&
      autoJoinAttemptRef.current !== attemptKey
    ) {
      autoJoinAttemptRef.current = attemptKey;
      join()
        .then(() => {
          toast.push(`Joined study room: "${detail.room.name}"`, 'success');
        })
        .catch((err) => {
          toast.push(err instanceof Error ? err.message : 'Room may be full or unavailable.', 'error');
        });
    }
  }, [roomId, profile.id, loading, detail, isMember, isFull, isRoomClosed, isRoomExpired, join, toast]);

  // Handle Manual Leave
  const handleLeave = async () => {
    setLeaving(true);
    try {
      await leave();
      toast.push('You have left the study room.', 'info');
      navigate('/rooms');
    } catch {
      navigate('/rooms');
    } finally {
      setLeaving(false);
    }
  };

  // Handle Post Message
  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    const msg = chatInput.trim();
    setChatInput('');
    try {
      await postMessage(msg, 'message');
    } catch (err: unknown) {
      toast.push(err instanceof Error ? err.message : 'Message failed', 'error');
    }
  };

  // Handle Quick Reaction
  const handleQuickReaction = async (emoji: string, label: string) => {
    try {
      await postMessage(`${emoji} ${label}`, 'status');
    } catch {
      // ignore
    }
  };

  // Handle Notes Save / Broadcast
  const handleSaveNotes = async () => {
    try {
      await updateCollab({ sharedNotes: notesInput });
      toast.push('Shared notes synced with all participants!', 'success');
    } catch (err: unknown) {
      toast.push(err instanceof Error ? err.message : 'Sync failed', 'error');
    }
  };

  // Handle Add Goal
  const handleAddGoal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goalInput.trim() || !detail) return;
    const newGoal: StudyGoal = {
      id: 'g_' + Math.random().toString(36).substring(2, 9),
      text: goalInput.trim(),
      completed: false,
      authorName: profile.name,
    };
    const nextGoals = [...detail.collab.studyGoals, newGoal];
    setGoalInput('');
    try {
      await updateCollab({ studyGoals: nextGoals });
    } catch (err: unknown) {
      toast.push(err instanceof Error ? err.message : 'Goal update failed', 'error');
    }
  };

  // Handle Toggle Goal
  const handleToggleGoal = async (goalId: string) => {
    if (!detail) return;
    const nextGoals = detail.collab.studyGoals.map((g) =>
      g.id === goalId ? { ...g, completed: !g.completed } : g,
    );
    try {
      await updateCollab({ studyGoals: nextGoals });
    } catch (err: unknown) {
      toast.push(err instanceof Error ? err.message : 'Goal toggle failed', 'error');
    }
  };

  // Handle Delete Goal
  const handleDeleteGoal = async (goalId: string) => {
    if (!detail) return;
    const nextGoals = detail.collab.studyGoals.filter((g) => g.id !== goalId);
    try {
      await updateCollab({ studyGoals: nextGoals });
    } catch (err: unknown) {
      toast.push(err instanceof Error ? err.message : 'Goal delete failed', 'error');
    }
  };

  // Pomodoro Controls
  const pomodoro = detail?.collab.pomodoroState || {
    status: 'idle',
    mode: 'focus',
    remainingSeconds: 1500,
    durationSeconds: 1500,
    cycle: 1,
    updatedAt: '',
  };

  const [currentTime, setCurrentTime] = useState(() => 0);
  useEffect(() => {
    if (pomodoro.status !== 'running') return;
    const interval = setInterval(() => setCurrentTime((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, [pomodoro.status]);

  const localRemaining = (() => {
    if (pomodoro.status !== 'running' || !pomodoro.updatedAt) {
      return pomodoro.remainingSeconds;
    }
    return Math.max(0, pomodoro.remainingSeconds - currentTime);
  })();

  const handlePomodoroAction = async (action: 'start' | 'pause' | 'reset' | 'mode', newMode?: 'focus' | 'shortBreak' | 'longBreak') => {
    let nextStatus = pomodoro.status;
    let nextRemaining = localRemaining;
    let nextDuration = pomodoro.durationSeconds;
    let nextMode = pomodoro.mode;

    if (action === 'start') {
      nextStatus = 'running';
    } else if (action === 'pause') {
      nextStatus = 'paused';
    } else if (action === 'reset') {
      nextStatus = 'idle';
      nextRemaining = nextDuration;
    } else if (action === 'mode' && newMode) {
      nextMode = newMode;
      nextDuration = newMode === 'focus' ? 1500 : newMode === 'shortBreak' ? 300 : 900;
      nextRemaining = nextDuration;
      nextStatus = 'idle';
    }

    const updatedState: PomodoroState = {
      ...pomodoro,
      status: nextStatus,
      mode: nextMode,
      durationSeconds: nextDuration,
      remainingSeconds: nextRemaining,
      updatedAt: new Date().toISOString(),
    };

    try {
      await updateCollab({ pomodoroState: updatedState });
      if (action === 'start') {
        postMessage(`⏱️ Started the group Pomodoro timer (${nextMode === 'focus' ? '25m Focus' : 'Break'})`, 'status');
      }
    } catch {
      // ignore
    }
  };

  const formatTimer = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // --------------------------------------------------------------------------
  // CLOSED ROOM STATE MODAL
  // --------------------------------------------------------------------------
  if (isRoomClosed || isRoomExpired) {
    const reasonText =
      closedReason ||
      (isRoomExpired
        ? 'This study room reached its scheduled expiry countdown (00:00) and closed automatically.'
        : 'This room automatically closed because its last participant left.');

    return (
      <div className="min-h-screen bg-paper text-ink flex flex-col font-sans">
        <StudyNavbar />
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-sm border border-sand bg-surface p-8 text-center shadow-lg animate-in fade-in duration-200">
            <div className="text-4xl mb-3">{isRoomExpired ? '⏰' : '🚪'}</div>
            <h2 className="font-serif text-2xl font-medium text-forest">
              {isRoomExpired ? 'Room Expiry Countdown Ended' : 'Study Room Closed'}
            </h2>
            <p className="text-xs text-muted mt-2 leading-relaxed">
              {reasonText}
            </p>
            <div className="mt-4 rounded-sm bg-sand/30 p-3 text-xs text-ink/80 text-left">
              <span className="font-semibold block text-forest mb-0.5">Room Lifecycle Policy:</span>
              Study rooms are temporary collaborative spaces that automatically self-close when their scheduled countdown expires or when the last member departs.
            </div>
            <div className="mt-6 flex flex-col sm:flex-row gap-2.5 justify-center">
              <Link
                to="/rooms"
                className="rounded-sm bg-forest px-5 py-2 text-xs font-semibold text-paper hover:bg-forest-deep transition-colors"
              >
                Find Another Room
              </Link>
              <Link
                to="/"
                className="rounded-sm border border-sand px-4 py-2 text-xs font-semibold text-ink hover:bg-forest/5 transition-colors"
              >
                Back to Home
              </Link>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // LOADING STATE
  // --------------------------------------------------------------------------
  if (loading && !detail) {
    return (
      <div className="min-h-screen bg-paper text-ink flex flex-col font-sans">
        <StudyNavbar />
        <main className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <div className="h-8 w-8 mx-auto border-2 border-forest border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-xs text-muted font-medium">Connecting to live study room...</p>
          </div>
        </main>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // ERROR STATE
  // --------------------------------------------------------------------------
  if (error && !detail) {
    return (
      <div className="min-h-screen bg-paper text-ink flex flex-col font-sans">
        <StudyNavbar />
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md w-full rounded-sm border border-sand bg-surface p-8 text-center shadow-md">
            <div className="text-3xl mb-3">⚠️</div>
            <h2 className="font-serif text-xl font-medium text-forest">Could not load room</h2>
            <p className="text-xs text-muted mt-2">{error}</p>
            <Link
              to="/rooms"
              className="mt-5 inline-block rounded-sm bg-forest px-4 py-2 text-xs font-semibold text-paper"
            >
              Return to Discovery
            </Link>
          </div>
        </main>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="min-h-screen bg-paper text-ink flex flex-col font-sans">
        <StudyNavbar />
        <main className="flex-1 flex items-center justify-center p-4">
          <div className="text-center">
            <div className="h-8 w-8 mx-auto border-2 border-forest border-t-transparent rounded-full animate-spin mb-3" />
            <p className="text-xs text-muted font-medium">Entering live study room...</p>
          </div>
        </main>
      </div>
    );
  }

  const room = detail.room;
  const members = detail.members;
  const currentParticipants = members.length;
  const maxParticipants = room.maxParticipants;
  const spotsLeft = maxParticipants - currentParticipants;
  const percentFilled = Math.min(100, Math.round((currentParticipants / maxParticipants) * 100));

  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col font-sans">
      <StudyNavbar />

      {/* Room Top Header Bar */}
      <div className="sticky top-16 z-30 border-b border-sand bg-surface/95 backdrop-blur-xs px-4 sm:px-6 lg:px-8 py-3.5 shadow-2xs">
        <div className="mx-auto max-w-7xl flex flex-col md:flex-row md:items-center justify-between gap-3">
          {/* Room Title & Badges */}
          <div className="flex items-center gap-3">
            <Link
              to="/rooms"
              className="rounded-sm border border-sand p-1.5 text-muted hover:text-forest hover:bg-forest/5 transition-colors"
              title="Return to Discovery"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 12H5M12 19l-7-7 7-7" />
              </svg>
            </Link>

            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-serif text-lg sm:text-xl font-medium text-forest line-clamp-1">
                  {room.name}
                </h1>
                <span className="rounded-xs bg-forest/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-forest">
                  {room.subject}
                </span>
                {isHost && (
                  <span className="rounded-xs bg-amber-100 text-amber-800 px-1.5 py-0.5 text-[10px] font-bold">
                    Host
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted mt-0.5">
                <span>Hosted by <strong className="text-ink font-medium">{room.hostName}</strong></span>
                <span>•</span>
                <span className="uppercase tracking-wider">{room.studyMode}</span>
              </div>
            </div>
          </div>

          {/* Right Status Indicators & Leave Action */}
          <div className="flex items-center gap-2.5 self-end md:self-auto flex-wrap justify-end">
            {/* Room Expiry Countdown Pill */}
            <div
              id="live-room-expiry-badge"
              className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-bold font-mono transition-all ${
                isExpiringSoon
                  ? 'bg-rose-100 text-rose-800 border border-rose-300 animate-pulse'
                  : 'bg-sand/30 text-ink border border-sand'
              }`}
              title="Room automatically closes when this countdown reaches 00:00"
            >
              <span className="text-xs">⏳</span>
              <span>{formatCountdown(remainingExpirySeconds)}</span>
              <span className="font-sans text-[10px] uppercase font-semibold text-muted ml-0.5 hidden sm:inline">
                Left
              </span>
            </div>

            {/* Live Participant Count Pill */}
            <div
              id="live-member-count-badge"
              className={`flex items-center gap-1.5 rounded-sm px-2.5 py-1 text-xs font-bold font-mono transition-colors ${
                isFull
                  ? 'bg-rose-100 text-rose-800 border border-rose-200'
                  : spotsLeft === 1
                    ? 'bg-amber-100 text-amber-800 border border-amber-200'
                    : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  isFull ? 'bg-rose-500' : 'bg-emerald-500 animate-pulse'
                }`}
              />
              <span>{currentParticipants} / {maxParticipants}</span>
              <span className="font-sans text-[10px] uppercase font-semibold text-muted ml-0.5">
                {isFull ? 'Full' : 'Members'}
              </span>
            </div>

            {/* Connection Signal */}
            <div
              className={`flex items-center gap-1 text-[11px] font-medium px-2 py-1 rounded-sm ${
                connected ? 'text-emerald-700 bg-emerald-50' : 'text-amber-700 bg-amber-50'
              }`}
              title={connected ? 'Real-time stream connected' : 'Reconnecting stream...'}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span className="hidden sm:inline">{connected ? 'Live' : 'Syncing'}</span>
            </div>

            {/* Leave Room Button */}
            <button
              type="button"
              id="btn-leave-room"
              onClick={() => setConfirmLeaveOpen(true)}
              disabled={leaving}
              className="rounded-sm border border-terra/40 bg-surface px-3 py-1.5 text-xs font-semibold text-terra hover:bg-terra hover:text-white transition-colors"
            >
              Leave Room
            </button>
          </div>
        </div>
      </div>

      {/* Expiring Soon Alert Banner */}
      {isExpiringSoon && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-xs text-amber-900 font-medium animate-pulse flex items-center justify-center gap-2">
          <span>⚠️</span>
          <span>
            <strong>Room Expiry Countdown:</strong> This study room will expire and automatically close in{' '}
            <span className="font-mono font-bold text-rose-700">{formatCountdown(remainingExpirySeconds)}</span>. Please wrap up and copy any important notes!
          </span>
        </div>
      )}

      {/* Full Room Alert Banner */}
      {isFull && (
        <div className="bg-rose-50 border-b border-rose-200 px-4 py-2 text-center text-xs text-rose-800 font-medium">
          🔒 This room has reached its maximum configured capacity ({maxParticipants}/{maxParticipants}). New participants are currently locked from joining until a spot opens.
        </div>
      )}

      {/* Main Study Workspace Grid */}
      <main className="flex-1 mx-auto max-w-7xl w-full px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left & Center: Collaborative Space (2 Cols on lg) */}
          <div className="lg:col-span-2 flex flex-col space-y-4">
            {/* Tool Tabs */}
            <div className="flex items-center justify-between border-b border-sand bg-surface px-2 pt-2 rounded-t-sm">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  id="tab-pomodoro"
                  onClick={() => setActiveTab('pomodoro')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors ${
                    activeTab === 'pomodoro'
                      ? 'border-forest text-forest'
                      : 'border-transparent text-muted hover:text-forest'
                  }`}
                >
                  <span>⏱️</span>
                  <span>Pomodoro Timer</span>
                </button>

                <button
                  type="button"
                  id="tab-notes"
                  onClick={() => setActiveTab('notes')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors ${
                    activeTab === 'notes'
                      ? 'border-forest text-forest'
                      : 'border-transparent text-muted hover:text-forest'
                  }`}
                >
                  <span>📝</span>
                  <span>Shared Scratchpad</span>
                </button>

                <button
                  type="button"
                  id="tab-goals"
                  onClick={() => setActiveTab('goals')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors ${
                    activeTab === 'goals'
                      ? 'border-forest text-forest'
                      : 'border-transparent text-muted hover:text-forest'
                  }`}
                >
                  <span>🎯</span>
                  <span>Session Goals</span>
                </button>

                <button
                  type="button"
                  id="tab-chat"
                  onClick={() => setActiveTab('chat')}
                  className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold border-b-2 transition-colors ${
                    activeTab === 'chat'
                      ? 'border-forest text-forest'
                      : 'border-transparent text-muted hover:text-forest'
                  }`}
                >
                  <span>💬</span>
                  <span>Live Discussion</span>
                </button>
              </div>

              <span className="text-[10px] text-muted hidden sm:inline pr-2">
                Real-time Sync Active
              </span>
            </div>

            {/* TAB 1: SYNCHRONIZED POMODORO FOCUS TIMER */}
            {activeTab === 'pomodoro' && (
              <div className="rounded-b-sm border border-t-0 border-sand bg-surface p-6 sm:p-8 text-center flex flex-col items-center justify-center">
                {/* Mode Selector */}
                <div className="inline-flex rounded-sm border border-sand bg-paper/60 p-0.5 mb-6">
                  <button
                    type="button"
                    onClick={() => handlePomodoroAction('mode', 'focus')}
                    className={`px-3 py-1 text-xs font-semibold rounded-xs transition-colors ${
                      pomodoro.mode === 'focus' ? 'bg-forest text-paper shadow-2xs' : 'text-muted hover:text-forest'
                    }`}
                  >
                    25m Focus Sprint
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePomodoroAction('mode', 'shortBreak')}
                    className={`px-3 py-1 text-xs font-semibold rounded-xs transition-colors ${
                      pomodoro.mode === 'shortBreak'
                        ? 'bg-emerald-700 text-white shadow-2xs'
                        : 'text-muted hover:text-forest'
                    }`}
                  >
                    5m Short Break
                  </button>
                  <button
                    type="button"
                    onClick={() => handlePomodoroAction('mode', 'longBreak')}
                    className={`px-3 py-1 text-xs font-semibold rounded-xs transition-colors ${
                      pomodoro.mode === 'longBreak'
                        ? 'bg-blue-700 text-white shadow-2xs'
                        : 'text-muted hover:text-forest'
                    }`}
                  >
                    15m Long Break
                  </button>
                </div>

                {/* Big Timer Countdown Display */}
                <div className="relative my-4 flex items-center justify-center">
                  <div className="h-56 w-56 rounded-full border-4 border-sand/70 flex flex-col items-center justify-center bg-paper/40 shadow-inner">
                    <span className="font-mono text-5xl sm:text-6xl font-bold tracking-tight text-forest">
                      {formatTimer(localRemaining)}
                    </span>
                    <span className="text-xs uppercase tracking-widest text-muted mt-2 font-semibold">
                      {pomodoro.status === 'running'
                        ? 'Session in Progress'
                        : pomodoro.status === 'paused'
                          ? 'Timer Paused'
                          : 'Ready to Start'}
                    </span>
                  </div>
                </div>

                {/* Timer Controls (Start / Pause / Reset) */}
                <div className="flex items-center justify-center gap-3 mt-4">
                  {pomodoro.status === 'running' ? (
                    <button
                      type="button"
                      id="btn-pomodoro-pause"
                      onClick={() => handlePomodoroAction('pause')}
                      className="rounded-sm bg-terra px-6 py-2.5 text-xs font-semibold text-white shadow-xs hover:bg-[#b9694c] transition-colors"
                    >
                      ⏸ Pause Timer
                    </button>
                  ) : (
                    <button
                      type="button"
                      id="btn-pomodoro-start"
                      onClick={() => handlePomodoroAction('start')}
                      className="rounded-sm bg-forest px-8 py-2.5 text-xs font-semibold text-paper shadow-xs hover:bg-forest-deep transition-colors"
                    >
                      ▶ Start Focus Block
                    </button>
                  )}

                  <button
                    type="button"
                    id="btn-pomodoro-reset"
                    onClick={() => handlePomodoroAction('reset')}
                    className="rounded-sm border border-sand bg-surface px-4 py-2.5 text-xs font-semibold text-muted hover:text-forest hover:bg-forest/5 transition-colors"
                  >
                    Reset
                  </button>
                </div>

                <p className="text-[11px] text-muted mt-4">
                  All participants in this study room see the exact same synchronized countdown.
                </p>
              </div>
            )}

            {/* TAB 2: SHARED COLLABORATIVE SCRATCHPAD */}
            {activeTab === 'notes' && (
              <div className="rounded-b-sm border border-t-0 border-sand bg-surface p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-forest">
                      Shared Collaborative Notes
                    </h3>
                    <p className="text-[11px] text-muted">
                      Equations, problem statements, reference links & group takeaways.
                    </p>
                  </div>
                  <button
                    type="button"
                    id="btn-sync-notes"
                    onClick={handleSaveNotes}
                    className="inline-flex items-center gap-1.5 rounded-sm bg-forest px-3 py-1.5 text-xs font-semibold text-paper shadow-2xs hover:bg-forest-deep transition-colors"
                  >
                    <span>💾</span>
                    <span>Save & Broadcast</span>
                  </button>
                </div>

                <textarea
                  id="textarea-shared-notes"
                  value={notesInput}
                  onChange={(e) => setNotesInput(e.target.value)}
                  placeholder="Type group notes here... (e.g. key formula: E = mc^2, page 142 problem 4 approach)"
                  rows={12}
                  className="w-full rounded-sm border border-sand bg-paper/40 p-3.5 font-mono text-xs sm:text-sm text-ink placeholder:text-muted/60 focus:border-forest focus:outline-none focus:ring-1 focus:ring-forest resize-y"
                />

                <div className="flex items-center justify-between text-[11px] text-muted mt-2">
                  <span>Press "Save & Broadcast" to sync edits with all connected members.</span>
                  <span>{notesInput.length} characters</span>
                </div>
              </div>
            )}

            {/* TAB 3: SESSION GOALS CHECKLIST */}
            {activeTab === 'goals' && (
              <div className="rounded-b-sm border border-t-0 border-sand bg-surface p-5">
                <div className="mb-4">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-forest">
                    Group Study Goals
                  </h3>
                  <p className="text-[11px] text-muted">
                    Track tasks and problem sets you want to complete during this session.
                  </p>
                </div>

                {/* Add Goal Form */}
                <form onSubmit={handleAddGoal} className="flex gap-2 mb-4">
                  <input
                    type="text"
                    id="input-goal-text"
                    value={goalInput}
                    onChange={(e) => setGoalInput(e.target.value)}
                    placeholder="Add a goal (e.g. Complete exercises 1 to 5)..."
                    maxLength={100}
                    className="flex-1 rounded-sm border border-sand bg-surface px-3 py-2 text-xs text-ink placeholder:text-muted/60 focus:border-forest focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-sm bg-forest px-4 py-2 text-xs font-semibold text-paper hover:bg-forest-deep transition-colors shrink-0"
                  >
                    + Add Goal
                  </button>
                </form>

                {/* Goals List */}
                <div className="space-y-2">
                  {detail.collab.studyGoals.length === 0 ? (
                    <div className="text-center py-8 text-xs text-muted border border-dashed border-sand rounded-sm">
                      No goals added yet. Add your study objectives above!
                    </div>
                  ) : (
                    detail.collab.studyGoals.map((goal) => (
                      <div
                        key={goal.id}
                        className={`flex items-center justify-between p-2.5 rounded-sm border transition-colors ${
                          goal.completed ? 'bg-forest/5 border-sand/60' : 'bg-surface border-sand'
                        }`}
                      >
                        <label className="flex items-center gap-2.5 cursor-pointer flex-1 mr-2">
                          <input
                            type="checkbox"
                            checked={goal.completed}
                            onChange={() => handleToggleGoal(goal.id)}
                            className="h-4 w-4 rounded-xs border-sand text-forest accent-forest"
                          />
                          <span
                            className={`text-xs ${
                              goal.completed ? 'line-through text-muted' : 'text-ink font-medium'
                            }`}
                          >
                            {goal.text}
                          </span>
                        </label>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-[10px] text-muted/70 bg-sand/30 px-1.5 py-0.5 rounded-xs">
                            {goal.authorName}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleDeleteGoal(goal.id)}
                            className="text-muted hover:text-terra text-xs p-1"
                            title="Delete goal"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: LIVE DISCUSSION & REACTION FEED */}
            {activeTab === 'chat' && (
              <div className="rounded-b-sm border border-t-0 border-sand bg-surface p-5 flex flex-col h-[460px]">
                {/* Quick Reaction Bar */}
                <div className="flex items-center gap-1.5 pb-3 border-b border-sand overflow-x-auto">
                  <span className="text-[10px] font-semibold text-muted uppercase mr-1">Quick:</span>
                  <button
                    type="button"
                    onClick={() => handleQuickReaction('✋', 'Raised Hand')}
                    className="px-2 py-1 rounded-sm border border-sand bg-paper text-xs hover:border-forest"
                  >
                    ✋ Hand
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickReaction('🧠', 'In The Zone')}
                    className="px-2 py-1 rounded-sm border border-sand bg-paper text-xs hover:border-forest"
                  >
                    🧠 Focusing
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickReaction('☕', 'Quick Break')}
                    className="px-2 py-1 rounded-sm border border-sand bg-paper text-xs hover:border-forest"
                  >
                    ☕ Coffee
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickReaction('💡', 'Found Answer')}
                    className="px-2 py-1 rounded-sm border border-sand bg-paper text-xs hover:border-forest"
                  >
                    💡 Eureka!
                  </button>
                  <button
                    type="button"
                    onClick={() => handleQuickReaction('❓', 'Need Help')}
                    className="px-2 py-1 rounded-sm border border-sand bg-paper text-xs hover:border-forest"
                  >
                    ❓ Question
                  </button>
                </div>

                {/* Event & Message Stream */}
                <div className="flex-1 overflow-y-auto py-3 space-y-2.5">
                  {detail.recentEvents.map((evt) => {
                    const isMe = evt.userId === profile.id;

                    if (evt.eventType === 'join' || evt.eventType === 'leave' || evt.eventType === 'system') {
                      return (
                        <div key={evt.id} className="text-center my-1.5">
                          <span className="inline-block rounded-full bg-sand/40 px-2.5 py-0.5 text-[10px] text-muted">
                            {evt.content}
                          </span>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={evt.id}
                        className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                      >
                        <div className="flex items-baseline gap-1.5 mb-0.5">
                          <span className="text-[10px] font-semibold text-forest">
                            {isMe ? 'You' : evt.userName}
                          </span>
                          <span className="text-[9px] text-muted/60">
                            {new Date(evt.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                        <div
                          className={`rounded-sm px-3 py-1.5 text-xs max-w-[85%] ${
                            isMe ? 'bg-forest text-paper' : 'bg-paper text-ink border border-sand'
                          }`}
                        >
                          {evt.content}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Chat Input */}
                <form onSubmit={handleSendMessage} className="pt-3 border-t border-sand flex gap-2">
                  <input
                    type="text"
                    id="input-chat-message"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Send a study question or note to group..."
                    className="flex-1 rounded-sm border border-sand bg-surface px-3 py-2 text-xs text-ink placeholder:text-muted/60 focus:border-forest focus:outline-none"
                  />
                  <button
                    type="submit"
                    className="rounded-sm bg-forest px-4 py-2 text-xs font-semibold text-paper hover:bg-forest-deep transition-colors"
                  >
                    Send
                  </button>
                </form>
              </div>
            )}
          </div>

          {/* Right Panel: Live Participant Roster & Capacity Meter */}
          <div className="space-y-4">
            {/* Live Participant Roster Card */}
            <div className="rounded-sm border border-sand bg-surface p-5 shadow-2xs">
              <div className="flex items-center justify-between pb-3 border-b border-sand">
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  <h3 className="font-serif text-base font-medium text-forest">
                    Live Participants
                  </h3>
                </div>
                <span className="font-mono text-xs font-bold text-forest">
                  {currentParticipants} / {maxParticipants}
                </span>
              </div>

              {/* Capacity Progress Bar */}
              <div className="mt-3">
                <div className="w-full bg-sand/60 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-300 ${
                      isFull ? 'bg-rose-500' : percentFilled >= 80 ? 'bg-amber-500' : 'bg-forest'
                    }`}
                    style={{ width: `${percentFilled}%` }}
                  />
                </div>
                <div className="flex justify-between text-[10px] text-muted mt-1">
                  <span>{spotsLeft} spots available</span>
                  <span>Max limit: {maxParticipants}</span>
                </div>
              </div>

              {/* Participant List */}
              <div className="mt-4 space-y-2 max-h-72 overflow-y-auto pr-1">
                {members.map((member) => {
                  const isCurrent = member.userId === profile.id;

                  return (
                    <div
                      key={member.userId}
                      className={`flex items-center justify-between p-2 rounded-sm border transition-colors ${
                        isCurrent ? 'border-forest/40 bg-forest/5' : 'border-sand/60 bg-surface'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <span
                          className="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-white shadow-2xs"
                          style={{ backgroundColor: member.userAvatar || '#243D32' }}
                        >
                          {member.userName.charAt(0).toUpperCase()}
                        </span>
                        <div>
                          <div className="text-xs font-semibold text-forest flex items-center gap-1.5">
                            <span>{member.userName}</span>
                            {isCurrent && <span className="text-[10px] text-muted font-normal">(You)</span>}
                            {member.isHost && (
                              <span className="text-[10px] text-amber-700 bg-amber-100 px-1 rounded-xs font-bold">
                                Host
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-muted">
                            Joined {new Date(member.joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </div>
                        </div>
                      </div>

                      {/* Presence Status Badge */}
                      <span
                        className={`rounded-xs px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                          member.status === 'focusing'
                            ? 'bg-purple-100 text-purple-800'
                            : member.status === 'break'
                              ? 'bg-blue-100 text-blue-800'
                              : 'bg-emerald-100 text-emerald-800'
                        }`}
                      >
                        {member.status}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Set My Presence Status */}
              <div className="mt-4 pt-3 border-t border-sand">
                <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">
                  Update My Study Status:
                </label>
                <div className="grid grid-cols-3 gap-1.5 text-center">
                  <button
                    type="button"
                    onClick={() => setPresenceStatus('active')}
                    className="p-1.5 text-[11px] font-medium rounded-sm border border-sand hover:bg-forest/5 text-forest"
                  >
                    Active
                  </button>
                  <button
                    type="button"
                    onClick={() => setPresenceStatus('focusing')}
                    className="p-1.5 text-[11px] font-medium rounded-sm border border-sand hover:bg-forest/5 text-purple-800"
                  >
                    Focusing
                  </button>
                  <button
                    type="button"
                    onClick={() => setPresenceStatus('break')}
                    className="p-1.5 text-[11px] font-medium rounded-sm border border-sand hover:bg-forest/5 text-blue-800"
                  >
                    On Break
                  </button>
                </div>
              </div>
            </div>

            {/* Room Details Card */}
            <div className="rounded-sm border border-sand bg-surface p-5 shadow-2xs text-xs space-y-2.5">
              <h4 className="font-serif text-sm font-medium text-forest border-b border-sand pb-2">
                Room Information
              </h4>
              <div className="flex justify-between text-muted">
                <span>Subject:</span>
                <span className="font-semibold text-ink">{room.subject}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Study Mode:</span>
                <span className="font-semibold text-ink capitalize">{room.studyMode}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Visibility:</span>
                <span className="font-semibold text-ink capitalize">{room.visibility}</span>
              </div>
              <div className="flex justify-between text-muted">
                <span>Created:</span>
                <span className="font-semibold text-ink">
                  {new Date(room.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <div className="pt-2 border-t border-sand text-[11px] text-muted leading-relaxed">
                ℹ️ This study room automatically terminates when the last student leaves.
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Confirm Leave Modal */}
      {confirmLeaveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
          <div className="max-w-sm w-full rounded-sm border border-sand bg-surface p-6 shadow-xl animate-in fade-in zoom-in-95 duration-150">
            <h3 className="font-serif text-lg font-medium text-forest">Leave Study Room?</h3>
            <p className="text-xs text-muted mt-2 leading-relaxed">
              Are you sure you want to exit "{room.name}"?
              {currentParticipants === 1 && (
                <span className="block text-terra font-semibold mt-1">
                  Warning: You are the last participant. Exiting will automatically close this study room.
                </span>
              )}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setConfirmLeaveOpen(false)}
                className="rounded-sm border border-sand px-3 py-1.5 text-xs font-semibold text-ink hover:bg-forest/5"
              >
                Stay in Room
              </button>
              <button
                type="button"
                onClick={handleLeave}
                disabled={leaving}
                className="rounded-sm bg-terra px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#b9694c]"
              >
                {leaving ? 'Leaving...' : 'Confirm Leave'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
