-- WhatsApp AI Agent Platform — schema inicial
-- Rodar no SQL Editor do Supabase

create table if not exists instances (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  evolution_instance_name text not null unique,
  webhook_secret          text not null,
  status                  text not null default 'disconnected'
                          check (status in ('connected', 'disconnected', 'qr_code')),
  created_at              timestamptz not null default now()
);

create table if not exists agents (
  id                  uuid primary key default gen_random_uuid(),
  instance_id         uuid not null references instances(id),
  name                text not null,
  model               text not null,
  system_prompt       text not null,
  temperature         numeric not null default 0.7,
  tools               jsonb not null default '[]',
  is_active           boolean not null default true,
  business_hours      jsonb,
  off_hours_message   text,
  typing_delay_ms     integer not null default 1000,
  daily_message_limit integer,
  created_at          timestamptz not null default now()
);

create table if not exists contacts (
  id          uuid primary key default gen_random_uuid(),
  instance_id uuid not null references instances(id),
  phone       text not null,
  name        text,
  created_at  timestamptz not null default now(),
  unique(instance_id, phone)
);

create table if not exists conversations (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid not null references contacts(id),
  instance_id     uuid not null references instances(id),
  agent_id        uuid references agents(id),
  status          text not null default 'active'
                  check (status in ('active', 'closed')),
  last_message_at timestamptz,
  created_at      timestamptz not null default now()
);

create table if not exists messages (
  id                   uuid primary key default gen_random_uuid(),
  conversation_id      uuid not null references conversations(id),
  role                 text not null
                       check (role in ('user', 'assistant', 'tool')),
  content              text not null,
  status               text not null default 'pending'
                       check (status in ('pending', 'processing', 'delivered', 'failed', 'skipped')),
  error                text,
  evolution_message_id text unique,
  created_at           timestamptz not null default now()
);

create table if not exists job_failures (
  id         uuid primary key default gen_random_uuid(),
  message_id uuid not null references messages(id),
  error      text not null,
  attempts   integer not null,
  failed_at  timestamptz not null default now()
);
