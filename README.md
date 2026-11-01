# Parivartan 2K26 — Bihar Special Litti Chokha Fest

Mobile-first React, TypeScript, Vite and Supabase campaign site. The original Bihar-inspired design, menu art, food photos, story, location and footer remain in the public page. Contest entry uses a name and Gmail address; the website does not sign participants into accounts.

## Local setup

```powershell
npm install
Copy-Item .env.example .env.local
# Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env.local
npm run dev
```

Run checks with `npm test` and `npm run build`.

Only the Supabase URL and public anon/publishable key belong in Vite variables. Never place service-role keys or other secrets in frontend environment variables.

## Registration behavior

Registration opens as soon as the immediate-opening migration is applied and deployed, and closes 4 November 2026, 6:00 PM IST. The client fetches campaign time from `contest_get_status()` for the display countdown. PostgreSQL independently enforces the closing timestamp.

Participants enter a display name and Gmail address, then confirm submission. The RPC trims and lowercases the saved Gmail address. The database unique index also canonicalizes Gmail dot and plus aliases to prevent those common variations from creating additional entries. Direct table reads are revoked; the public browser calls only the status and registration RPCs.

**Email ownership is not verified.** Because the requested flow has no account login or verification step, the server cannot know whether a participant owns the entered Gmail address or prevent the same person entering a different Gmail account. Participants must enter their own address; the organizer should account for this limitation during manual selection.

## Database migration review

The account-free registration migration is `supabase/migrations/202610310005_account_free_gmail_registration.sql`. It retains Auth users and existing registration/winner records, adds a private Gmail field, backfills eligible prior Auth registrations, creates the normalized unique index, and replaces the registration/status RPCs. The immediate-opening migration is `supabase/migrations/202611010006_open_registrations_immediately.sql`; apply it after 005 to remove the old opening boundary while preserving the close deadline. It also revokes access to prior Auth-based registration and admin/draw RPCs without dropping their tables or records.

Do not blindly apply historical migration files in a batch. The repository does not establish which migrations are already applied in the live NANO project. First compare Supabase migration history and actual objects. The forward migration handles prior functions conditionally, but assumes any existing `contest_registrations` table follows the checked-in schema. It has not been executed against Supabase from this workspace.

The old spin/coupon cleanup is a separate destructive migration (`supabase/migrations/202610310003_retire_lucky_spin_and_coupons.sql`). It was authorized previously, but must still be checked against the live schema and dependencies before manual application. This project does not reset Supabase or execute SQL remotely.

## Private manual export

After registration closes, run this owner-only query in Supabase SQL Editor and export the result as CSV. It reads only actual rows in the registration table. Full Gmail addresses must not be published.

```sql
select display_name, gmail_address, registered_at
from public.contest_registrations
where gmail_address is not null
order by registered_at, id;
```

## WhatsApp and sponsor

`src/campaignConfig.ts` keeps the WhatsApp group URL blank and sponsor disabled until real details are supplied. Joining WhatsApp is optional and never registers a participant. Sponsor promotion stays hidden until explicitly configured.
