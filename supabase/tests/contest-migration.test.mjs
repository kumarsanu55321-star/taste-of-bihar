import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/202610310002_contest_registration_and_draw.sql',
  'utf8',
);
const cleanup = readFileSync(
  'supabase/migrations/202610310003_retire_lucky_spin_and_coupons.sql',
  'utf8',
);
const legacyMigrations = [
  'supabase/migrations/202610290001_google_spin.sql',
  'supabase/migrations/202610300001_roles_winners_sponsor_redemption.sql',
  'supabase/migrations/202610300002_admin_allowlist_normalization.sql',
  'supabase/migrations/202610300003_admin_google_identity_check.sql',
].map((path) => readFileSync(path, 'utf8')).join('\n');

const functionBody = (name) => {
  const start = migration.indexOf(`function public.${name}`);
  expect(start, `missing function ${name}`).toBeGreaterThanOrEqual(0);
  const end = migration.indexOf('$$;', start);
  expect(end, `unterminated function ${name}`).toBeGreaterThan(start);
  return migration.slice(start, end);
};

describe('contest migration security contract', () => {
  it('allows only the configured admin email in the existing allowlist', () => {
    expect(migration).toMatch(/delete from public\.campaign_admin_allowlist\s+where email <> 'littichokha2k26\.45@gmail\.com'/i);
    expect(migration).toMatch(/insert into public\.campaign_admin_allowlist\(email\)\s+values \('littichokha2k26\.45@gmail\.com'\)/i);
    expect(functionBody('admin_get_contest_dashboard')).toMatch(/public\.is_campaign_admin\(\)/);
  });

  it('requires explicit confirmation and a Gmail Google identity to register', () => {
    const body = functionBody('contest_register');
    expect(body).toMatch(/p_confirm is distinct from true/);
    expect(body).toMatch(/gmail\[\.\]com/);
    expect(body).toMatch(/raw_app_meta_data/);
    expect(migration).toMatch(/participant_id uuid not null unique/i);
  });

  it('serializes registration and prevents registration after closure', () => {
    const body = functionBody('contest_register');
    expect(body).toMatch(/where singleton for update/i);
    expect(body).toMatch(/v_state <> 'open'/i);
    expect(body).toMatch(/participant_id = \(select auth\.uid\(\)\)/i);
  });

  it('makes registration closure final and the draw one-time', () => {
    const closeBody = functionBody('admin_set_contest_registration_open');
    expect(closeBody).toMatch(/contest_registration_cannot_reopen/);
    const drawBody = functionBody('admin_draw_contest_winners');
    expect(drawBody).toMatch(/where singleton for update/i);
    expect(drawBody).toMatch(/contest_draw_already_completed/);
    expect(drawBody).toMatch(/at_least_five_registrations_required/);
    expect(drawBody).toMatch(/extensions\.gen_random_bytes\(32\)/);
    expect(drawBody).toMatch(/limit 5/i);
    expect(drawBody).toMatch(/if v_position <> 5 then/i);
    expect(migration).toMatch(/registration_id bigint not null unique/i);
    expect(migration).toMatch(/selected_by uuid not null/i);
    expect(migration).toMatch(/selected_at timestamptz not null/i);
  });

  it('returns public winner names and positions without emails or account identifiers', () => {
    const body = functionBody('contest_get_winners');
    expect(body).toMatch(/returns table\(display_name text, position smallint\)/i);
    expect(body).toMatch(/select r\.display_name, w\.position/i);
    const publicColumns = body.match(/returns table\(([^)]*)\)/i)?.[1] ?? '';
    expect(publicColumns).not.toMatch(/email|uuid|participant_id|registration_id|selected_by/i);
  });

  it('hides sponsor fields publicly until the partnership is confirmed', () => {
    const publicBody = functionBody('contest_get_status');
    expect(publicBody).toMatch(/case when s\.sponsor_confirmed then jsonb_build_object/i);
    for (const field of ['name', 'image_url', 'website', 'description', 'offer_message', 'terms']) {
      expect(migration).toContain(`'${field}'`);
    }
    expect(functionBody('admin_update_contest_sponsor')).toMatch(/confirmed_partnership_requires_all_sponsor_details/);
  });

  it('returns full participant Gmail only from the admin-guarded listing RPC', () => {
    const body = functionBody('admin_list_contest_registrations');
    expect(body).toMatch(/public\.is_campaign_admin\(\)/);
    expect(body).toMatch(/join auth\.users u on u\.id = r\.participant_id/i);
    expect(body).toMatch(/u\.email::text/i);
    expect(body).toMatch(/u\.email ilike/i);
    expect(migration).toMatch(/revoke all on function public\.admin_list_contest_registrations\(text, integer, integer\) from public, anon/i);
    expect(migration).toMatch(/grant execute on function public\.admin_list_contest_registrations\(text, integer, integer\) to authenticated/i);
    const publicColumns = functionBody('contest_get_winners').match(/returns table\(([^)]*)\)/i)?.[1] ?? '';
    expect(publicColumns).not.toMatch(/email/i);
  });

  it('keeps winner names private until an admin publishes the completed draw', () => {
    expect(migration).toMatch(/published_at timestamptz/i);
    expect(functionBody('contest_get_winners')).toMatch(/d\.published_at is not null/i);
    const publish = functionBody('admin_publish_contest_winners');
    expect(publish).toMatch(/public\.is_campaign_admin\(\)/);
    expect(publish).toMatch(/set published_at = coalesce\(published_at, clock_timestamp\(\)\)/i);
    expect(publish).toMatch(/contest_draw_not_completed/);
  });

  it('tracks plate collection with admin-only, repeat-safe collection recording', () => {
    expect(migration).toMatch(/collected boolean not null default false/i);
    expect(migration).toMatch(/collected_at timestamptz/i);
    expect(functionBody('admin_get_contest_dashboard')).toMatch(/'collected', w\.collected/i);
    expect(functionBody('admin_get_contest_dashboard')).toMatch(/'collected_at', w\.collected_at/i);
    const collect = functionBody('admin_mark_winner_collected');
    expect(collect).toMatch(/public\.is_campaign_admin\(\)/);
    expect(collect).toMatch(/coalesce\(collected_at, clock_timestamp\(\)\)/i);
    expect(collect).toMatch(/contest_winner_not_found/);
  });

  it('enforces a configurable database-time registration deadline', () => {
    expect(migration).toMatch(/registration_deadline timestamptz/i);
    expect(functionBody('contest_register')).toMatch(/clock_timestamp\(\) >= v_deadline/i);
    const config = functionBody('admin_set_contest_registration_deadline');
    expect(config).toMatch(/public\.is_campaign_admin\(\)/);
    expect(config).toMatch(/set registration_deadline = p_deadline/i);
    expect(config).toMatch(/contest_registration_already_closed/);
  });

  it('reports effective public closure at the deadline but preserves admin formal-close status', () => {
    const publicStatus = functionBody('contest_get_status');
    expect(publicStatus).toMatch(/registration_state = 'open'/i);
    expect(publicStatus).toMatch(/clock_timestamp\(\) >= s\.registration_deadline/i);
    expect(publicStatus).toMatch(/then 'closed'/i);
    expect(publicStatus).toMatch(/'registration_deadline_passed'/i);

    const adminDashboard = functionBody('admin_get_contest_dashboard');
    expect(adminDashboard).toMatch(/'registration_state', v_settings\.registration_state/i);
    expect(adminDashboard).toMatch(/'registration_deadline_expired'/i);
    expect(adminDashboard).toMatch(/clock_timestamp\(\) >= v_settings\.registration_deadline/i);

    const closeRegistration = functionBody('admin_set_contest_registration_open');
    expect(closeRegistration).toMatch(/if v_state = 'open' then[\s\S]*registration_state = 'closed'/i);
    expect(functionBody('admin_draw_contest_winners')).toMatch(/if v_state <> 'closed' then/i);
  });

  it('requires verified Google Gmail identity and serializes registration against closing/drawing', () => {
    const register = functionBody('contest_register');
    expect(register).toMatch(/email_confirmed_at is null/i);
    expect(register).toMatch(/gmail\[\.\]com/);
    expect(register).toMatch(/raw_app_meta_data/);
    expect(register).toMatch(/where singleton for update/i);
    expect(migration).toMatch(/participant_id uuid not null unique/i);
    expect(functionBody('admin_set_contest_registration_open')).toMatch(/where singleton for update/i);
    const draw = functionBody('admin_draw_contest_winners');
    expect(draw).toMatch(/where singleton for update/i);
    expect(draw).toMatch(/contest_draw_already_completed/);
    expect(migration).toMatch(/singleton boolean primary key default true check \(singleton\)/i);
  });

  it('does not drop legacy spin/coupon objects in this additive stage', () => {
    const sql = migration.replace(/--.*$/gm, '');
    expect(sql).not.toMatch(/\bdrop\s+(table|trigger|policy)\b/i);
    expect(sql).not.toMatch(/\bdrop\s+function\s+if\s+exists\s+public\.(?:owner_|spin_|get_my_spin|admin_get_dashboard|admin_update_sponsor|admin_set_campaign|is_restaurant_owner|get_public_winners|get_campaign_public_settings)/i);
  });

  it('limits authorized cleanup to legacy spin/coupon objects and retains contest/Auth/admin access', () => {
    for (const table of [
      'redemption_audit', 'campaign_admin_audit', 'restaurant_owner_allowlist',
      'spin_attempts', 'reward_coupons', 'spin_results', 'campaign_control',
    ]) {
      expect(cleanup).toMatch(new RegExp(`drop table if exists public\\.${table}`, 'i'));
    }
    expect(cleanup).toMatch(/participants can read their spin/);
    expect(cleanup).toMatch(/participants can read their coupons/);
    for (const retained of [
      'auth.users', 'campaign_admin_allowlist', 'is_campaign_admin',
      'contest_settings', 'contest_registrations', 'contest_draws', 'contest_draw_winners',
    ]) {
      expect(cleanup).not.toMatch(new RegExp(`drop (?:table|function) if exists public\\.${retained}`, 'i'));
      expect(cleanup).not.toMatch(new RegExp(`drop table if exists ${retained}`, 'i'));
    }
    expect(cleanup).not.toMatch(/\bdrop\s+(?:table|function|trigger|policy)\b[^;]*\bcascade\b/i);
  });

  it('matches every cleanup DROP FUNCTION signature to a legacy function definition', () => {
    const drops = [...cleanup.matchAll(/drop function if exists public\.([a-z_]+)\(([^)]*)\);/gi)];
    expect(drops).toHaveLength(12);
    for (const [, name, argumentTypes] of drops) {
      const typeList = argumentTypes.trim();
      const declarationPattern = new RegExp(
        `create or replace function public\\.${name}\\s*\\(([^)]*)\\)`,
        'i',
      );
      const declaration = legacyMigrations.match(declarationPattern)?.[1];
      expect(declaration, `missing legacy definition for ${name}`).toBeDefined();
      const declaredTypes = declaration
        .split(',')
        .map((argument) => argument.trim().split(/\s+/).slice(1).join(' ').toLowerCase())
        .join(', ');
      expect(declaredTypes, `signature mismatch for ${name}`).toBe(typeList.toLowerCase());
    }
  });
});
