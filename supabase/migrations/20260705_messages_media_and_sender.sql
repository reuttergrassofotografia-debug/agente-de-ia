-- Adds media storage tracking and group-message sender attribution to messages.
alter table messages add column if not exists media_path text;
alter table messages add column if not exists media_mimetype text;
alter table messages add column if not exists sender_phone text;
alter table messages add column if not exists sender_name text;

-- Private bucket for WhatsApp media (photos, audio, documents). Only ever
-- accessed with the service role key (webhook, worker, CRM server actions) —
-- never the anon key — so no storage.objects RLS policy is needed.
insert into storage.buckets (id, name, public)
values ('whatsapp-media', 'whatsapp-media', false)
on conflict (id) do nothing;
