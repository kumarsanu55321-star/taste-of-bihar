import { useEffect, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { contestSchedule } from '../campaignConfig';
import { getContestStatus, type ContestStatus } from '../contestApi';

type CampaignState = 'loading' | 'open' | 'closed' | 'error';

function getState(status: ContestStatus, now: number): CampaignState {
  if (now >= contestSchedule.end.getTime() || status.registration_state === 'closed' || status.registration_deadline_passed) return 'closed';
  return status.registration_state === 'open' ? 'open' : 'error';
}

function formatCountdown(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(remainingSeconds).padStart(2, '0')}s`;
}

/** Compact hero display driven by the campaign server clock and fixed IST schedule. */
export function ContestHeroStatus() {
  const [status, setStatus] = useState<ContestStatus | null>(null);
  const [serverClock, setServerClock] = useState<{ epochMs: number; monotonicMs: number } | null>(null);
  const [error, setError] = useState('');
  const [, setPulse] = useState(0);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const startedAt = performance.now();
        const nextStatus = await getContestStatus();
        const receivedAt = performance.now();
        const serverEpoch = Date.parse(nextStatus.server_time);
        if (!Number.isFinite(serverEpoch)) throw new Error('Campaign time is unavailable.');
        if (!active) return;
        setStatus(nextStatus);
        setServerClock({ epochMs: serverEpoch + (receivedAt - startedAt) / 2, monotonicMs: receivedAt });
        setError('');
      } catch (statusError) {
        if (!active) return;
        setError(statusError instanceof Error ? statusError.message : 'Campaign status is unavailable.');
      }
    };
    void refresh();
    const refreshTimer = window.setInterval(() => { void refresh(); }, 15_000);
    const clockTimer = window.setInterval(() => setPulse((value) => value + 1), 1_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.clearInterval(refreshTimer);
      window.clearInterval(clockTimer);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  const now = serverClock ? serverClock.epochMs + performance.now() - serverClock.monotonicMs : null;
  const state: CampaignState = error ? 'error' : !status || now === null ? 'loading' : getState(status, now);
  const target = state === 'open' ? contestSchedule.end.getTime() : null;
  const countdown = target !== null && now !== null ? formatCountdown(target - now) : null;
  const message = state === 'open' ? 'Registrations are now open!'
      : state === 'closed' ? 'Registrations are now closed.'
        : state === 'error' ? error || 'Registration status is temporarily unavailable. Please refresh.' : 'Checking campaign status…';

  return <div className={`hero-campaign-status hero-campaign-status-${state}`} role="status" aria-live="polite">
    <Clock3 size={18} aria-hidden="true" />
    <span>{message}{countdown && <small>Closes in <strong>{countdown}</strong> IST</small>}</span>
  </div>;
}
