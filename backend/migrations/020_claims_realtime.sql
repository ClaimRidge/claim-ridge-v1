-- 020_claims_realtime.sql
-- Realtime change feed for claims.
--
-- The provider/doctor portals subscribe to `claims` via Supabase Realtime
-- (postgres_changes) so new submissions and payer decisions are pushed to the
-- notification bell within a moment, instead of relying on the 30s poll. RLS
-- still governs which rows each subscriber receives (provider → their org,
-- doctor → their own), so this exposes nothing new — it only streams rows the
-- client could already read.
--
-- pre_auth_requests is intentionally NOT added: it has no browser RLS read
-- policy (the sender pages go through the backend), so it can't be streamed to
-- the anon/auth client and stays on the polling path.

-- Add claims to the realtime publication (idempotent).
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'claims'
  ) then
    alter publication supabase_realtime add table public.claims;
  end if;
end
$$;

-- UPDATE/DELETE events carry the full pre-change row so Realtime can evaluate
-- RLS on both the old and new row versions (without this, an UPDATE that moves
-- a row in/out of a subscriber's scope may not be delivered correctly).
alter table public.claims replica identity full;
