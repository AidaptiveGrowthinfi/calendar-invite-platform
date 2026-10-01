-- Extraction queries for the Bulk-Calendar-Invites v1 Supabase database.
-- Run in Supabase Studio -> SQL Editor. Save each result next to this file
-- using the filename in the comment above the query.
--
-- Closes W18: send-critical RPC definitions exist only inside Supabase and are
-- not in version control.

-- ===========================================================================
-- 1. FUNCTION BODIES  ->  save as 01-functions.sql   ** HIGHEST PRIORITY **
-- Recovers lock_recipients_for_batch_v2, complete_email_batch_v2,
-- cleanup_failed_batch, get_campaigns_with_stats.
-- ===========================================================================
select string_agg(pg_get_functiondef(p.oid), E';\n\n' order by p.proname) || ';'
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prokind = 'f';

-- ===========================================================================
-- 2. TABLE COLUMNS  ->  save as 02-columns.tsv
-- ===========================================================================
select table_name, ordinal_position, column_name, data_type,
       is_nullable, column_default
from information_schema.columns
where table_schema = 'public'
order by table_name, ordinal_position;

-- ===========================================================================
-- 3. CONSTRAINTS  ->  save as 03-constraints.tsv
-- Primary keys, foreign keys, unique and check constraints. These encode the
-- concurrency guarantees the send engine depends on.
-- ===========================================================================
select conrelid::regclass::text as table_name,
       conname,
       pg_get_constraintdef(oid) as definition
from pg_constraint
where connamespace = 'public'::regnamespace
order by conrelid::regclass::text, conname;

-- ===========================================================================
-- 4. INDEXES  ->  save as 04-indexes.tsv
-- ===========================================================================
select tablename, indexname, indexdef
from pg_indexes
where schemaname = 'public'
order by tablename, indexname;

-- ===========================================================================
-- 5. ROW LEVEL SECURITY STATE  ->  save as 05-rls.tsv
-- Evidence for W21. Expect relrowsecurity = false on most or all tables,
-- because v1 connects with the service role key which bypasses RLS entirely.
-- ===========================================================================
select c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind = 'r'
order by c.relname;

select schemaname, tablename, policyname, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

-- ===========================================================================
-- 6. ENUM TYPES  ->  save as 06-enums.tsv
-- Recipient status, campaign status, account status vocabularies.
-- ===========================================================================
select t.typname, string_agg(e.enumlabel, ', ' order by e.enumsortorder)
from pg_type t
join pg_enum e on e.enumtypid = t.oid
join pg_namespace n on n.oid = t.typnamespace
where n.nspname = 'public'
group by t.typname
order by t.typname;

-- ===========================================================================
-- 7. TRIGGERS  ->  save as 07-triggers.tsv
-- ===========================================================================
select c.relname as table_name, tg.tgname,
       pg_get_triggerdef(tg.oid) as definition
from pg_trigger tg
join pg_class c on c.oid = tg.tgrelid
where not tg.tgisinternal
  and c.relnamespace = 'public'::regnamespace
order by c.relname, tg.tgname;
