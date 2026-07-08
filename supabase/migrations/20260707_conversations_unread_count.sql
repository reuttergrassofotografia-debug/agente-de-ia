-- Adds an unread-message counter to conversations, incremented atomically by
-- increment_unread_count() so concurrent webhook deliveries (e.g. a burst of
-- group messages) never lose an increment to a read-then-write race in JS.
alter table conversations add column if not exists unread_count integer not null default 0;

create or replace function increment_unread_count(conv_id uuid)
returns void as $$
  update conversations set unread_count = unread_count + 1 where id = conv_id;
$$ language sql;
