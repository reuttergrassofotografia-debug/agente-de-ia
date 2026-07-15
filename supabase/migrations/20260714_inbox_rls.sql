-- Enables RLS on the Inbox tables (contacts, conversations, messages,
-- scheduled_messages), which previously had none — meaning the CRM's
-- per-vendedor restriction (built across a companion feature's server
-- actions) only lived in application code, and was bypassable by any
-- authenticated browser client querying these tables directly (e.g. via
-- devtools). SELECT-only policies here: every read/write to these tables
-- from both this repo's webhook/worker and the CRM's server actions
-- already goes through the service-role key, which bypasses RLS entirely
-- — so this only closes the direct-browser-access hole and correctly
-- scopes what the Inbox's Realtime subscription (which does use the
-- authenticated/anon client) delivers to each vendedor. No existing
-- legitimate code path is affected.

alter table contacts enable row level security;
alter table conversations enable row level security;
alter table messages enable row level security;
alter table scheduled_messages enable row level security;

-- ---- CONTACTS ----
create policy "contacts_vendedor" on contacts
for select using (
  (select perfil from profiles where id = auth.uid()) = 'vendedor'
  and (responsavel_id = auth.uid() or responsavel_id is null)
);

create policy "contacts_admin_gerente" on contacts
for select using (
  (select perfil from profiles where id = auth.uid()) in ('admin', 'gerente')
);

-- ---- CONVERSATIONS ----
create policy "conversations_vendedor" on conversations
for select using (
  (select perfil from profiles where id = auth.uid()) = 'vendedor'
  and exists (
    select 1 from contacts c
    where c.id = conversations.contact_id
      and (c.responsavel_id = auth.uid() or c.responsavel_id is null)
  )
);

create policy "conversations_admin_gerente" on conversations
for select using (
  (select perfil from profiles where id = auth.uid()) in ('admin', 'gerente')
);

-- ---- MESSAGES ----
create policy "messages_vendedor" on messages
for select using (
  (select perfil from profiles where id = auth.uid()) = 'vendedor'
  and exists (
    select 1 from conversations conv
    join contacts c on c.id = conv.contact_id
    where conv.id = messages.conversation_id
      and (c.responsavel_id = auth.uid() or c.responsavel_id is null)
  )
);

create policy "messages_admin_gerente" on messages
for select using (
  (select perfil from profiles where id = auth.uid()) in ('admin', 'gerente')
);

-- ---- SCHEDULED_MESSAGES ----
create policy "scheduled_messages_vendedor" on scheduled_messages
for select using (
  (select perfil from profiles where id = auth.uid()) = 'vendedor'
  and exists (
    select 1 from conversations conv
    join contacts c on c.id = conv.contact_id
    where conv.id = scheduled_messages.conversation_id
      and (c.responsavel_id = auth.uid() or c.responsavel_id is null)
  )
);

create policy "scheduled_messages_admin_gerente" on scheduled_messages
for select using (
  (select perfil from profiles where id = auth.uid()) in ('admin', 'gerente')
);
