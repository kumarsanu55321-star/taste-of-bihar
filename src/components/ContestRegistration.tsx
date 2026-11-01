import { useEffect, useState, type FormEvent } from 'react';
import { AlertCircle, ArrowRight, ArrowUpRight, CheckCircle2, Clock3, Gift, Mail, MessageCircle, Sparkles, UserRound, X } from 'lucide-react';
import { contestRegister, getContestStatus, type ContestStatus } from '../contestApi';
import { contestSchedule, whatsappGroupInviteUrl } from '../campaignConfig';

type RegistrationAvailability = 'loading' | 'open' | 'closed' | 'error';
function getAvailability(status: ContestStatus, serverNow: number): RegistrationAvailability {
  if (serverNow >= contestSchedule.end.getTime() || status.registration_state === 'closed' || status.registration_deadline_passed) return 'closed';
  return status.registration_state === 'open' ? 'open' : 'error';
}

function formatCountdown(milliseconds: number) {
  const secondsLeft = Math.max(0, Math.floor(milliseconds / 1000));
  const days = Math.floor(secondsLeft / 86_400);
  const hours = Math.floor((secondsLeft % 86_400) / 3_600);
  const minutes = Math.floor((secondsLeft % 3_600) / 60);
  const seconds = secondsLeft % 60;
  return `${days}d ${String(hours).padStart(2, '0')}h ${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
}

function normalizeGmail(value: string) {
  return value.trim().toLowerCase();
}

function isGmailAddress(value: string) {
  return /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@gmail\.com$/.test(normalizeGmail(value));
}

export function ContestRegistration() {
  const [availability, setAvailability] = useState<RegistrationAvailability>('loading');
  const [availabilityError, setAvailabilityError] = useState('');
  const [contestStatus, setContestStatus] = useState<ContestStatus | null>(null);
  const [serverClock, setServerClock] = useState<{ epochMs: number; monotonicMs: number } | null>(null);
  const [, setClockPulse] = useState(0);
  const [displayName, setDisplayName] = useState('');
  const [gmail, setGmail] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [registrationLoading, setRegistrationLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!successOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSuccessOpen(false);
    };
    document.addEventListener('keydown', closeOnEscape);
    return () => document.removeEventListener('keydown', closeOnEscape);
  }, [successOpen]);

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const requestStarted = performance.now();
        const status = await getContestStatus();
        const responseReceived = performance.now();
        if (!active) return;
        const serverEpoch = Date.parse(status.server_time);
        if (!Number.isFinite(serverEpoch)) throw new Error('The campaign server clock is unavailable.');
        const roundTripMs = responseReceived - requestStarted;
        const estimatedServerAtReceive = serverEpoch + roundTripMs / 2;
        setContestStatus(status);
        setServerClock({ epochMs: estimatedServerAtReceive, monotonicMs: responseReceived });
        setAvailability(getAvailability(status, estimatedServerAtReceive));
        setAvailabilityError('');
      } catch (statusError) {
        if (!active) return;
        setAvailability('error');
        setAvailabilityError(statusError instanceof Error ? statusError.message : 'Could not load contest status.');
      }
    };
    void refresh();
    const interval = window.setInterval(() => { void refresh(); }, 15_000);
    const pulse = window.setInterval(() => setClockPulse((value) => value + 1), 1_000);
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    return () => { active = false; window.clearInterval(interval); window.clearInterval(pulse); window.removeEventListener('focus', onFocus); };
  }, []);

  const estimatedServerNow = serverClock ? serverClock.epochMs + performance.now() - serverClock.monotonicMs : null;
  const liveAvailability = availability === 'error' ? 'error'
    : !contestStatus || estimatedServerNow === null ? 'loading'
      : getAvailability(contestStatus, estimatedServerNow);
  const countdownTarget = liveAvailability === 'open' ? contestSchedule.end.getTime() : null;
  const countdown = countdownTarget !== null && estimatedServerNow !== null
    ? formatCountdown(countdownTarget - estimatedServerNow) : null;

  const submitRegistration = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (liveAvailability !== 'open') return;
    if (!isGmailAddress(gmail)) {
      setError('Enter a Gmail address ending in @gmail.com. Email ownership is not verified.');
      return;
    }
    if (!confirmed) {
      setError('Please confirm your registration before continuing.');
      return;
    }

    setRegistrationLoading(true);
    try {
      const requestStarted = performance.now();
      const freshStatus = await getContestStatus();
      const responseReceived = performance.now();
      const freshServerEpoch = Date.parse(freshStatus.server_time);
      if (!Number.isFinite(freshServerEpoch)) throw new Error('The campaign server clock is unavailable. Please try again.');
      const freshServerAtReceive = freshServerEpoch + (responseReceived - requestStarted) / 2;
      const freshAvailability = getAvailability(freshStatus, freshServerAtReceive);
      setContestStatus(freshStatus);
      setServerClock({ epochMs: freshServerAtReceive, monotonicMs: responseReceived });
      setAvailability(freshAvailability);
      if (freshAvailability !== 'open') throw new Error(freshAvailability === 'closed' ? 'Registrations are now closed.' : 'Registration status is temporarily unavailable. Please refresh and try again.');

      // The public RPC deliberately returns the same success shape for new
      // and duplicate entries to prevent Gmail-address enumeration.
      await contestRegister(displayName, normalizeGmail(gmail), true);
      setSubmitted(true);
      setSuccessOpen(true);
      setGmail('');
      setConfirmed(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Registration could not be completed. Please try again.');
    } finally {
      setRegistrationLoading(false);
    }
  };

  const availabilityText = liveAvailability === 'loading' ? 'Checking registration status…'
    : liveAvailability === 'closed' ? 'Registrations are now closed. Join our WhatsApp group to find out who wins!'
        : liveAvailability === 'error' ? availabilityError || 'Registration status is temporarily unavailable.'
          : 'Registrations are now open!';

  return <div className="contest-registration-card" id="contest-registration">
    <div className="contest-prize-mark"><Gift size={25} /><span>LUCKY<br />DRAW</span></div>
    <div className="contest-card-copy"><span className="section-eyebrow">ONE ENTRY PER GMAIL ADDRESS</span><h3>Enter the lucky draw</h3><p>Take part for a chance to enjoy a complimentary dish from our stall.</p></div>
    <div className={`contest-window contest-window-${liveAvailability}`} role="status"><Clock3 size={17} /><span>{availabilityText}{countdown && <small className="contest-countdown" aria-live="off">Closes in <strong>{countdown}</strong> <span>IST</span></small>}</span></div>

    {error && <p className="contest-feedback contest-feedback-error" role="alert"><AlertCircle size={18} /> {error}</p>}

    {!submitted && <form className="contest-entry-form" onSubmit={(event) => void submitRegistration(event)}>
      <label className="contest-entry-field"><span><UserRound size={16} /> Your name</span><input autoComplete="name" maxLength={40} minLength={1} name="displayName" placeholder="Enter your name" required value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label>
      <label className="contest-entry-field"><span><Mail size={16} /> Gmail address</span><input autoCapitalize="none" autoComplete="email" inputMode="email" maxLength={254} name="gmail" placeholder="you@gmail.com" required spellCheck={false} type="text" value={gmail} onChange={(event) => setGmail(event.target.value)} /></label>
      <label className="contest-confirm-check"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> <span>I confirm</span></label>
      <button type="submit" className="button button-red" disabled={registrationLoading || liveAvailability !== 'open' || !confirmed}>{registrationLoading ? <><span className="auth-spinner" aria-hidden="true" /> Registering…</> : liveAvailability === 'closed' ? 'REGISTRATION CLOSED' : liveAvailability === 'error' ? 'REGISTRATION UNAVAILABLE' : liveAvailability === 'loading' ? 'CHECKING…' : 'REGISTER NOW'} <ArrowRight size={17} /></button>
    </form>}

    {successOpen && <div className="registration-success-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSuccessOpen(false); }}>
      <section className="registration-success-dialog" role="dialog" aria-modal="true" aria-labelledby="registration-success-title" aria-describedby="registration-success-message">
        <button className="registration-success-close" type="button" onClick={() => setSuccessOpen(false)} aria-label="Close registration success message"><X size={19} /></button>
        <div className="registration-success-emblem" aria-hidden="true"><CheckCircle2 size={30} /><Sparkles size={16} /></div>
        <div className="registration-success-heading"><MessageCircle size={21} aria-hidden="true" /><h2 id="registration-success-title">Registration Successful!</h2></div>
        <p className="registration-success-confirmation">You're officially registered for the Parivartan 2K26 Lucky Draw!</p>
        <p id="registration-success-message">Want to know who wins? Join our official WhatsApp group. We'll announce all five lucky winners there after registrations close.</p>
        <div className="registration-success-actions">
          <a className="button button-green" href={whatsappGroupInviteUrl} target="_blank" rel="noopener noreferrer">JOIN WHATSAPP GROUP <ArrowUpRight size={16} /></a>
          <button className="button button-paper" type="button" onClick={() => setSuccessOpen(false)}>CONTINUE TO WEBSITE <ArrowRight size={16} /></button>
        </div>
      </section>
    </div>}
  </div>;
}
