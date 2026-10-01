-- Safe first-look query. Run in Supabase Studio -> SQL Editor.
-- Tells us how much real send history exists before writing analysis queries
-- against actual column names. No assumptions about columns.

select c.relname                                    as table_name,
       to_char(c.reltuples::bigint, 'FM999,999,999') as approx_rows,
       c.relrowsecurity                              as rls_enabled,
       pg_size_pretty(pg_total_relation_size(c.oid)) as size
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relkind = 'r'
order by c.reltuples desc;

-- If reltuples looks stale (all zeros), run ANALYZE; first, then re-run.
