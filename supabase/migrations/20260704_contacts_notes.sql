-- Adds internal notes and a flag marking when a contact's name was set
-- manually via the CRM. Once set, getOrCreateContact stops overwriting the
-- name with the WhatsApp pushName on incoming messages.
alter table contacts add column if not exists notes text;
alter table contacts add column if not exists name_edited_by_user boolean not null default false;
