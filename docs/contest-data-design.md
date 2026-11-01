# Account-free contest registration

## Current contract

- No participant sign-in, password, phone/OTP, or email verification flow is present in the website.
- Registration consists of display name and Gmail text input plus explicit consent.
- Gmail is trimmed and lowercased. A unique expression index canonicalizes Gmail dot and plus aliases and prevents those variants from creating extra entries.
- The browser calls public `contest_get_status()` and `contest_register(text, text, boolean)` RPCs using only the Supabase anon key.
- PostgreSQL independently validates the input, explicit confirmation, and the close deadline of 2026-11-04 18:00 Asia/Kolkata. Registration opens immediately once migration `202611010006_open_registrations_immediately.sql` is applied.
- Table reads are revoked from public, anon and authenticated roles. The organizer exports actual rows through the project owner's SQL Editor.
- There is no automatic winner selection. The organizer manually selects five entries after registration closes and announces them in the configured WhatsApp group.

## Important limitation

Without account login or email verification, the system cannot establish that an entrant owns the submitted Gmail address or prevent the same person from entering a different Gmail account. Alias normalization blocks dot and plus variations only; it does not establish one entry per real person. The open anonymous RPC has no IP-based abuse limit; consider adding a trusted Edge Function/CAPTCHA and abuse controls before a high-traffic launch.

## Migration notes

`supabase/migrations/202610310005_account_free_gmail_registration.sql` is an additive forward migration draft. It preserves old Auth accounts and registration/winner data, makes legacy participant IDs nullable, backfills valid historic Google Gmail values, adds a private Gmail field and normalized unique index, replaces status and registration RPCs, and revokes client execution of the previous Auth/admin/draw endpoints. It does not drop tables or functions. Apply `supabase/migrations/202611010006_open_registrations_immediately.sql` next to open registration immediately while retaining server-side enforcement of the fixed close deadline.

The checked-in historical migrations include a destructive legacy spin/coupon cleanup (`202610310003_retire_lucky_spin_and_coupons.sql`). No SQL was executed from this workspace and the live Supabase migration history/schema could not be inspected. Verify the actual objects, dependencies and applied migration history before running any SQL. The SQL tests inspect migration contracts; they do not execute PostgreSQL or prove live RLS behavior.

## Manual export

Run as the project owner in Supabase SQL Editor after registration closes:

```sql
select display_name, gmail_address, registered_at
from public.contest_registrations
where gmail_address is not null
order by registered_at, id;
```

Keep exported addresses private. They must not be returned by public RPCs or shown in the website.
