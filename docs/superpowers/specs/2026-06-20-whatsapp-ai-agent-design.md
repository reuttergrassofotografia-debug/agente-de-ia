# WhatsApp AI Agent Platform — Design Spec

**Date:** 2026-06-20  
**Status:** Approved  
**Scope:** Plataforma completa — backend core (API + worker) + dashboard web

---

## 1. Visão Geral

Sistema de agentes de IA conectados ao WhatsApp via Evolution API. Cada instância do Evolution API tem um agente configurável (model, system prompt, ferramentas, horários de atendimento). Mensagens recebidas são enfileiradas via BullMQ, processadas por um worker que chama um LLM (Vercel AI SDK) e responde de volta pelo Evolution API. Um dashboard Next.js oferece inbox, gestão de agentes, gestão de instâncias (incluindo QR Code) e configurações de atendimento.

---

## 2. Arquitetura

**Abordagem:** Monolito modular em monorepo (npm workspaces). API e worker são processos Node.js separados que compartilham packages internos. Dashboard é uma aplicação Next.js no mesmo repositório.

### Estrutura do Repositório

```
agente-de-ia/
├── apps/
│   ├── api/          # Fastify — recebe webhooks da Evolution API
│   ├── worker/       # BullMQ consumer — processa mensagens com LLM
│   └── dashboard/    # Next.js App Router — interface de gestão
├── packages/
│   ├── db/           # Supabase client + tipos gerados
│   ├── queue/        # Definições BullMQ (job types, producer, conexão Redis)
│   ├── llm/          # Wrapper Vercel AI SDK — lógica de agente e tool calling
│   └── evolution/    # Cliente HTTP para Evolution API (tipado)
├── docker-compose.yml  # Redis local para desenvolvimento
├── package.json        # Workspace root
└── tsconfig.base.json
```

**Regra de dependência:** `apps/*` importam `packages/*`. Packages não se importam entre si, exceto `packages/llm` que pode importar `packages/db` para carregar configuração do agente.

---

## 3. Fluxo de Dados

```
WhatsApp User
     │
     ▼
Evolution API
     │  POST /webhook
     │  Header: apikey: <secret>
     ▼
apps/api (Fastify)
     │  1. Valida apikey (401 se inválida)
     │  2. Valida payload com Zod (400 se malformado)
     │  3. Idempotência: ignora se evolution_message_id já existe
     │  4. Persiste mensagem no Supabase (status: pending)
     │  5. Enfileira job no BullMQ via packages/queue
     ▼
Redis (BullMQ queue: "messages")
     ▼
apps/worker (BullMQ consumer)
     │  1. Recebe job { instanceId, contactId, messageId }
     │  2. Carrega config do agente (packages/db, por instanceId)
     │  3. Verifica horário de atendimento → skipa se fora do horário
     │  4. Carrega histórico completo da conversa (packages/db, por contactId)
     │  5. Chama packages/llm → AI SDK (generateText com tool calling)
     │     └─ loop de tool calling: até 5 iterações
     │  6. Envia resposta via packages/evolution → Evolution API
     │  7. Persiste resposta no Supabase (status: delivered)
     ▼
Evolution API → WhatsApp User
```

---

## 4. Schema de Dados (Supabase / PostgreSQL)

```sql
-- Instâncias do Evolution API
instances (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                    text NOT NULL,
  evolution_instance_name text NOT NULL UNIQUE,
  webhook_secret          text NOT NULL,
  status                  text NOT NULL DEFAULT 'disconnected',
    -- CHECK status IN ('connected', 'disconnected', 'qr_code')
  created_at              timestamptz NOT NULL DEFAULT now()
)

-- Agentes de IA (um por instância)
agents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id         uuid NOT NULL REFERENCES instances(id),
  name                text NOT NULL,
  model               text NOT NULL,       -- ex: gpt-4o, claude-sonnet-4-6
  system_prompt       text NOT NULL,
  temperature         numeric NOT NULL DEFAULT 0.7,
  tools               jsonb NOT NULL DEFAULT '[]',
  is_active           boolean NOT NULL DEFAULT true,
  -- configurações de atendimento
  business_hours      jsonb,               -- { mon: ["09:00","18:00"], ... } | null = 24h
  off_hours_message   text,
  typing_delay_ms     integer NOT NULL DEFAULT 1000,
  daily_message_limit integer,             -- null = sem limite
  created_at          timestamptz NOT NULL DEFAULT now()
)

-- Contatos (quem manda mensagem)
contacts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id uuid NOT NULL REFERENCES instances(id),
  phone       text NOT NULL,
  name        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(instance_id, phone)
)

-- Conversas
conversations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      uuid NOT NULL REFERENCES contacts(id),
  instance_id     uuid NOT NULL REFERENCES instances(id),
  agent_id        uuid REFERENCES agents(id),
  status          text NOT NULL DEFAULT 'active',
    -- CHECK status IN ('active', 'closed')
  last_message_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
)

-- Mensagens
messages (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id      uuid NOT NULL REFERENCES conversations(id),
  role                 text NOT NULL,
    -- CHECK role IN ('user', 'assistant', 'tool')
  content              text NOT NULL,
  status               text NOT NULL DEFAULT 'pending',
    -- CHECK status IN ('pending', 'processing', 'delivered', 'failed', 'skipped')
  error                text,
  evolution_message_id text UNIQUE,        -- idempotência
  created_at           timestamptz NOT NULL DEFAULT now()
)

-- Falhas de jobs (dead letter)
job_failures (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id uuid NOT NULL REFERENCES messages(id),
  error      text NOT NULL,
  attempts   integer NOT NULL,
  failed_at  timestamptz NOT NULL DEFAULT now()
)
```

---

## 5. Error Handling & Retry

### Worker (BullMQ)

| Tentativa | Delay antes do retry |
|-----------|----------------------|
| 1 → 2     | 5 segundos           |
| 2 → 3     | 30 segundos          |
| 3 → 4     | 2 minutos            |
| 4 (falha) | Dead letter queue    |

Ao entrar na dead letter queue:
- Persiste registro em `job_failures`
- Atualiza `messages.status = 'failed'`
- Emite log estruturado JSON com `{ messageId, instanceId, contactId, error, attempts }`

### Casos Específicos

| Caso | Comportamento |
|------|---------------|
| Rate limit LLM | Retry com backoff (AI SDK lança erro identificável) |
| Evolution API indisponível | Retry normal |
| Webhook duplicado | Ignorado via `evolution_message_id` UNIQUE |
| Agente inativo | Job descartado sem retry, `status = 'skipped'` |
| Fora do horário de atendimento | Job descartado, envia `off_hours_message`, `status = 'skipped'` |
| Tool calling infinito | Limite de 5 iterações no AI SDK (`maxSteps: 5`) |

### API (Fastify)

| Caso | Resposta |
|------|----------|
| apikey inválida | 401 — job não enfileirado |
| Payload malformado | 400 com detalhes do erro Zod |
| Falha ao enfileirar (Redis down) | 500 — Evolution API reenviará o webhook |

---

## 6. Dashboard (apps/dashboard)

**Stack:** Next.js 14 App Router + Tailwind CSS + shadcn/ui

### Áreas Funcionais

#### 6.1 Inbox
- Lista de conversas ordenadas por `last_message_at` DESC
- Colunas: contato, instância, agente, status, última mensagem, timestamp
- Filtros: por instância, por status (ativa/falha), por agente
- Clique abre histórico completo da conversa com mensagens do usuário e respostas do agente
- Indicador visual para conversas com mensagens `failed`

#### 6.2 Gestão de Agentes
- Listagem de agentes com status ativo/inativo
- Criação/edição com:
  - Nome do agente
  - Instância vinculada (select)
  - Modelo LLM (select: modelos suportados pelo AI SDK)
  - System prompt (textarea com contador de tokens estimado)
  - Temperatura (slider 0–2)
  - Ferramentas habilitadas (checklist configurável)
  - Configurações de atendimento (ver 6.4)
- Toggle rápido ativo/inativo na listagem

#### 6.3 Gestão de Instâncias (Evolution API)
- Listagem de instâncias com status em tempo real (polling a cada 5s)
- Por instância:
  - Status badge: connected / disconnected / qr_code
  - Botão "Conectar" → abre modal com QR Code (polling até conectar ou timeout de 60s)
  - Botão "Desconectar"
  - Webhook URL configurada (copiável)
  - Webhook secret (mascarado, com botão de revelar)
- Criação de nova instância (nome + criação na Evolution API via `packages/evolution`)

#### 6.4 Configurações de Atendimento (por agente)
- Horários por dia da semana (toggle on/off + faixa horária por dia)
- Mensagem enviada fora do horário
- Delay de digitação antes de responder (slider em ms, simula humanização)
- Limite de mensagens por contato por dia (campo numérico, vazio = sem limite)
- Flag para pausar agente sem desconectar instância

---

## 7. Stack Completa

| Camada | Tecnologia |
|--------|------------|
| Runtime | Node.js 20 LTS + TypeScript |
| API | Fastify + @fastify/cors + zod |
| Filas | BullMQ + ioredis |
| LLM | Vercel AI SDK (`ai` package) |
| Banco | Supabase (PostgreSQL) + supabase-js |
| Dashboard | Next.js 14 App Router + Tailwind CSS + shadcn/ui |
| Evolution API | Cliente HTTP customizado (fetch nativo + tipos TypeScript) |
| Validação | Zod (API + dashboard forms) |
| Dev local | Docker Compose (Redis), tsx (watch mode) |
| Deploy | Vercel (dashboard + api), Railway ou Render (worker) |

---

## 8. Autenticação no Webhook

A Evolution API envia um header `apikey: <secret>` em cada requisição webhook. O Fastify valida esse header contra o `webhook_secret` da instância correspondente (buscado no Supabase pelo `evolution_instance_name` presente no payload). Requests com header ausente ou inválido retornam 401 imediatamente sem processar o payload.

---

## 9. O que está fora do escopo deste spec

- Autenticação de usuários no dashboard (assumido como acesso interno/restrito por URL)
- Multi-tenancy (múltiplos clientes/workspaces)
- Cobrança / billing
- Envio proativo de mensagens (outbound campaigns)
- Integração com outros canais além de WhatsApp

Esses itens podem ser specs separados no futuro.
