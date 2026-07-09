-- Adds an unread-message counter to conversations, incremented atomically by
-- increment_unread_count() so concurrent webhook deliveries (e.g. a burst of
-- group messages) never lose an increment to a read-then-write race in JS.
alter table conversations add column if not exists unread_count integer not null default 0;

create or replace function increment_unread_count(conv_id uuid)
returns void as $$
  update conversations set unread_count = unread_count + 1 where id = conv_id;
$$ language sql;

-- Required for the CRM's Supabase Realtime subscription (postgres_changes on
-- conversations) to receive INSERT/UPDATE events at all — without this,
-- the Inbox silently falls back to the 20s poll with no error surfaced.
-- Guarded because `alter publication ... add table` errors if the table is
-- already a member (e.g. if the project publication already covers it).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table conversations;
  end if;
end $$;
