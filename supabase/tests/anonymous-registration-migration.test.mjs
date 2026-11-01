import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/202610310005_account_free_gmail_registration.sql',
  'utf8',
);

describe('account-free registration migration', () => {
  it('normalizes and uniquely constrains Gmail addresses', () => {
    expect(migration).toMatch(/lower\(btrim\(gmail_address\)\)/i);
    expect(migration).toMatch(/create unique index if not exists contest_registrations_gmail_normalized_uidx/i);
    expect(migration).toMatch(/split_part\(split_part\(gmail_address, '@', 1\), '\+', 1\)/i);
    expect(migration).toMatch(/replace\(split_part[\s\S]*gmail_address[\s\S]*'\.', ''\)/i);
    expect(migration).toMatch(/v_gmail text := pg_catalog\.lower\(pg_catalog\.btrim\(coalesce\(p_gmail, ''\)\)\)/i);
    expect(migration).toContain("v_gmail !~ '^[a-z0-9]+([.][a-z0-9]+)*([+][a-z0-9]+([.-][a-z0-9]+)*)?@gmail[.]com$'");
  });

  it('targets only the Gmail canonicalization index and rejects malformed Gmail local parts', () => {
    const canonicalization = "lower(replace(split_part(split_part(gmail_address, '@', 1), '+', 1), '.', '') || '@gmail.com')";
    expect(migration.split(canonicalization)).toHaveLength(3);
    expect(migration).toMatch(/on conflict\s*\(\s*\(lower\(replace\(split_part\(split_part\(gmail_address, '@', 1\), '\+', 1\), '\.', ''\) \|\| '@gmail\.com'\)\)\s*\)\s*where gmail_address is not null\s*do nothing/i);
    expect(migration).not.toMatch(/on conflict\s+do nothing/i);
    const strictGmail = "'^[a-z0-9]+([.][a-z0-9]+)*([+][a-z0-9]+([.-][a-z0-9]+)*)?@gmail[.]com$'";
    expect(migration.split(strictGmail)).toHaveLength(4);
    expect(migration).toMatch(/char_length\(pg_catalog\.split_part\(v_gmail, '@', 1\)\) > 64/i);
  });

  it('uses database time for the exact IST campaign window', () => {
    expect(migration).toContain('2026-11-02 12:00:00+05:30');
    expect(migration).toContain('2026-11-04 18:00:00+05:30');
    expect(migration).toMatch(/pg_catalog\.clock_timestamp\(\)/i);
  });

  it('requires explicit consent and returns no Gmail address', () => {
    expect(migration).toMatch(/p_confirm is distinct from true/i);
    expect(migration).toMatch(/registration_confirmation_required/i);
    const register = migration.slice(migration.indexOf('create or replace function public.contest_register('));
    expect(register).not.toMatch(/auth\.uid\(\)|email_confirmed_at|raw_app_meta_data/i);
    expect(register).not.toMatch(/'gmail_address'|'email'|'gmail'/i);
  });

  it('keeps direct participant reads denied and allows only RPC-based registration', () => {
    expect(migration).toMatch(/alter table public\.contest_registrations enable row level security/i);
    expect(migration).toMatch(/revoke all on public\.contest_registrations from public, anon, authenticated/i);
    expect(migration).toMatch(/grant execute on function public\.contest_register\(text, text, boolean\) to anon/i);
  });

  it('does not choose winners and disables old admin/draw RPC access', () => {
    expect(migration).not.toMatch(/random\(\)|gen_random_bytes|insert into public\.contest_draw_winners/i);
    expect(migration).toMatch(/admin_draw_contest_winners\(\)/i);
    expect(migration).toMatch(/revoke all on function %s from public, anon, authenticated/i);
    expect(migration).not.toMatch(/\bdrop\s+(table|function)\b/i);
  });
});
