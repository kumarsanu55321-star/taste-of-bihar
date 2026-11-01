import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/202610310004_enforce_fixed_registration_window.sql', 'utf8');
const registrationBody = migration.slice(migration.indexOf('function public.contest_register'), migration.indexOf('$$;', migration.indexOf('function public.contest_register')));

describe('fixed registration window migration contract', () => {
  it('uses the exact Asia/Kolkata campaign boundaries in database time checks', () => {
    expect(migration).toContain("'server_time', campaign_clock.value");
    expect(migration).toContain("'2026-11-02 12:00:00+05:30'::timestamptz");
    expect(migration).toContain("'2026-11-04 18:00:00+05:30'::timestamptz");
    expect(registrationBody).toContain('contest_registration_not_started');
    expect(registrationBody).toContain('contest_registration_closed');
  });

  it('retains verified Google Gmail and explicit confirmation checks', () => {
    expect(registrationBody).toContain('p_confirm is distinct from true');
    expect(registrationBody).toContain('email_confirmed_at is null');
    expect(registrationBody).toContain('@gmail[.]com');
    expect(registrationBody).toContain("'provider', '')) = 'google'");
  });

  it('makes concurrent duplicate calls return the caller own existing registration', () => {
    expect(registrationBody).toMatch(/on conflict \(participant_id\) do nothing/i);
    expect(registrationBody).toContain("'already_registered', true");
  });

  it('does not contain destructive table drops or CASCADE', () => {
    expect(migration).not.toMatch(/\bdrop\s+(table|function|policy|trigger)\b/i);
    expect(migration).not.toMatch(/\bcascade\b/i);
  });
});
