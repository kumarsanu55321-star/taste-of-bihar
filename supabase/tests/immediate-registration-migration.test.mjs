import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/202611010006_open_registrations_immediately.sql', 'utf8');
const statusStart = migration.indexOf('create or replace function public.contest_get_status()');
const statusEnd = migration.indexOf('$function$;', statusStart);
const registerStart = migration.indexOf('create or replace function public.contest_register(');
const registerEnd = migration.indexOf('$function$;', registerStart);
const statusBody = migration.slice(statusStart, statusEnd);
const registerBody = migration.slice(registerStart, registerEnd);

describe('immediate-opening migration contract', () => {
  it('reports registration open until the exact IST closing instant', () => {
    expect(statusBody).toContain("when campaign_clock.current_time < '2026-11-04 18:00:00+05:30'::timestamptz then 'open'");
    expect(statusBody).toContain("else 'closed'");
    expect(statusBody).toContain("'registration_deadline', '2026-11-04 18:00:00+05:30'::timestamptz");
    expect(statusBody).not.toContain('2026-11-02');
  });

  it('keeps the SQL registration RPC protected and rejects writes at or after close', () => {
    expect(registerBody).toMatch(/security definer/i);
    expect(registerBody).toMatch(/set search_path = ''/i);
    expect(registerBody).toContain("v_now >= '2026-11-04 18:00:00+05:30'::timestamptz");
    expect(registerBody).toContain('contest_registration_closed');
    expect(registerBody).not.toContain('contest_registration_not_started');
    expect(registerBody).not.toContain('2026-11-02');
  });

  it('preserves confirmation, validation, canonical Gmail duplicate prevention, and public RPC grants', () => {
    expect(registerBody).toContain('registration_confirmation_required');
    expect(registerBody).toContain('invalid_display_name');
    expect(registerBody).toContain('invalid_gmail');
    expect(registerBody).toContain('lower(replace(split_part(split_part(gmail_address,');
    expect(registerBody).toContain('where gmail_address is not null');
    expect(registerBody).toContain('do nothing');
    expect(migration).toMatch(/grant execute on function public\.contest_get_status\(\) to anon/i);
    expect(migration).toMatch(/grant execute on function public\.contest_register\(text, text, boolean\) to anon/i);
  });
});
