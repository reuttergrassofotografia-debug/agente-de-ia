# Monorepo Setup + Shared Packages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the monorepo scaffold and implement the 4 shared TypeScript packages (`db`, `queue`, `llm`, `evolution`) that all apps depend on.

**Architecture:** npm workspaces monorepo. Each package in `packages/` compiles to ESM independently and has its own Vitest suite. `packages/llm` is the only package that imports from another (`packages/db`) — to load agent configuration at runtime. No other cross-package imports.

**Tech Stack:** Node.js 20 LTS, TypeScript 5.4, npm workspaces, Vitest 1.x, @supabase/supabase-js 2.x, bullmq 5.x, ioredis 5.x, ai 3.x (Vercel AI SDK), @ai-sdk/openai

## Global Constraints
- Node.js ≥ 20.0.0
- TypeScript `strict: true`, `noUncheckedIndexedAccess: true`
- All packages: `"type": "module"` in package.json (ESM only)
- Named exports only — no default exports anywhere
- Import paths inside packages use `.js` extension (ESM NodeNext resolution)
- No `dotenv` in packages — only apps load env vars
- Test runner: Vitest 1.x with `environment: 'node'`
- No `any` types — use `unknown` where type is unclear, narrow before use

---

### Task 1: Monorepo Scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.base.json`
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Create root `package.json`**

```json
{
  "name": "agente-de-ia",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "workspaces": ["packages/*", "apps/*"],
  "scripts": {
    "dev:api": "npm -w apps/api run dev",
    "dev:worker": "npm -w apps/worker run dev",
    "dev:dashboard": "npm -w apps/dashboard run dev",
    "test": "npm --workspaces run test --if-present",
    "build": "npm --workspaces run build --if-present",
    "typecheck": "npm --workspaces run typecheck --if-present"
  },
  "engines": { "node": ">=20.0.0" }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2022"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "esModuleInterop": false,
    "skipLibCheck": true
  }
}
```

- [ ] **Step 3: Create `docker-compose.yml`**

```yaml
version: '3.9'
services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes
volumes:
  redis_data:
```

- [ ] **Step 4: Create `.env.example`**

```
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
REDIS_URL=redis://localhost:6379
EVOLUTION_API_URL=https://your-evolution-instance.com
EVOLUTION_API_KEY=your-global-api-key
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
PORT=3000
```

- [ ] **Step 5: Create `.gitignore`**

```
node_modules/
dist/
.env
.env.local
.DS_Store
*.tsbuildinfo
.next/
```

- [ ] **Step 6: Create directory structure**

```bash
mkdir -p packages/db/src/__tests__
mkdir -p packages/queue/src/__tests__
mkdir -p packages/llm/src/__tests__
mkdir -p packages/evolution/src/__tests__
mkdir -p apps/api/src
mkdir -p apps/worker/src
```

- [ ] **Step 7: Initialize git and commit**

```bash
git init
git add .
git commit -m "chore: initialize monorepo scaffold"
```

---

### Task 2: packages/db — Supabase Client, Types & Queries

**Files:**
- Create: `packages/db/package.json`
- Create: `packages/db/tsconfig.json`
- Create: `packages/db/vitest.config.ts`
- Create: `packages/db/src/types.ts`
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/queries/instances.ts`
- Create: `packages/db/src/queries/agents.ts`
- Create: `packages/db/src/queries/contacts.ts`
- Create: `packages/db/src/queries/conversations.ts`
- Create: `packages/db/src/queries/messages.ts`
- Create: `packages/db/src/index.ts`
- Test: `packages/db/src/__tests__/queries.test.ts`

**Interfaces:**
- Produces:
  - `createSupabaseClient(): SupabaseClient<Database>` — call once per app at startup
  - Types: `Instance`, `Agent`, `Contact`, `Conversation`, `Message`, `JobFailure`, `MessageInsert`, `JobFailureInsert`, `BusinessHours`, `InstanceStatus`, `MessageStatus`, `MessageRole`, `ConversationStatus`, `Database`
  - `getInstanceByName(db, evolutionInstanceName: string): Promise<Instance | null>`
  - `updateInstanceStatus(db, instanceId: string, status: InstanceStatus): Promise<void>`
  - `getAgentByInstanceId(db, instanceId: string): Promise<Agent | null>`
  - `getOrCreateContact(db, instanceId: string, phone: string, name?: string): Promise<Contact>`
  - `getOrCreateConversation(db, contactId: string, instanceId: string, agentId: string): Promise<Conversation>`
  - `createMessage(db, data: MessageInsert): Promise<Message>`
  - `updateMessageStatus(db, messageId: string, status: MessageStatus, error?: string): Promise<void>`
  - `getConversationMessages(db, conversationId: string): Promise<Message[]>`
  - `createJobFailure(db, data: JobFailureInsert): Promise<void>`

- [ ] **Step 1: Create `packages/db/package.json`**

```json
{
  "name": "@agente/db",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.43.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `packages/db/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src"],
  "exclude": ["src/__tests__"]
}
```

- [ ] **Step 3: Create `packages/db/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node' } })
```

- [ ] **Step 4: Write failing tests**

Create `packages/db/src/__tests__/queries.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Instance, Agent, Message } from '../types.js'

function makeChain(overrides: Record<string, unknown> = {}) {
  const chain: Record<string, unknown> = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: null, error: null }),
    insert: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    upsert: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    ...overrides,
  }
  return chain
}

function makeDb(chain: Record<string, unknown>): SupabaseClient<Database> {
  return { from: vi.fn().mockReturnValue(chain) } as unknown as SupabaseClient<Database>
}

describe('getInstanceByName', () => {
  it('returns instance when found', async () => {
    const { getInstanceByName } = await import('../queries/instances.js')
    const instance: Instance = {
      id: 'inst-1', name: 'Test', evolution_instance_name: 'test',
      webhook_secret: 'sec', status: 'connected', created_at: '2026-01-01T00:00:00Z',
    }
    const chain = makeChain({ single: vi.fn().mockResolvedValue({ data: instance, error: null }) })
    const result = await getInstanceByName(makeDb(chain), 'test')
    expect(result).toEqual(instance)
  })

  it('returns null when not found', async () => {
    const { getInstanceByName } = await import('../queries/instances.js')
    const chain = makeChain({ single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }) })
    const result = await getInstanceByName(makeDb(chain), 'missing')
    expect(result).toBeNull()
  })
})

describe('getAgentByInstanceId', () => {
  it('returns active agent', async () => {
    const { getAgentByInstanceId } = await import('../queries/agents.js')
    const agent: Agent = {
      id: 'agent-1', instance_id: 'inst-1', name: 'Bot', model: 'gpt-4o',
      system_prompt: 'You are helpful.', temperature: 0.7, tools: [],
      is_active: true, business_hours: null, off_hours_message: null,
      typing_delay_ms: 1000, daily_message_limit: null, created_at: '2026-01-01T00:00:00Z',
    }
    const chain = makeChain({ single: vi.fn().mockResolvedValue({ data: agent, error: null }) })
    const result = await getAgentByInstanceId(makeDb(chain), 'inst-1')
    expect(result).toEqual(agent)
  })

  it('returns null when no active agent', async () => {
    const { getAgentByInstanceId } = await import('../queries/agents.js')
    const chain = makeChain({ single: vi.fn().mockResolvedValue({ data: null, error: { code: 'PGRST116' } }) })
    const result = await getAgentByInstanceId(makeDb(chain), 'inst-1')
    expect(result).toBeNull()
  })
})

describe('createMessage', () => {
  it('inserts message and returns it', async () => {
    const { createMessage } = await import('../queries/messages.js')
    const created: Message = {
      id: 'msg-1', conversation_id: 'conv-1', role: 'user', content: 'Hello',
      status: 'pending', error: null, evolution_message_id: 'ev-1', created_at: '2026-01-01T00:00:00Z',
    }
    const chain = {
      insert: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: created, error: null }),
    }
    const result = await createMessage(makeDb(chain), {
      conversation_id: 'conv-1', role: 'user', content: 'Hello', evolution_message_id: 'ev-1',
    })
    expect(result).toEqual(created)
  })
})

describe('updateMessageStatus', () => {
  it('updates status field', async () => {
    const { updateMessageStatus } = await import('../queries/messages.js')
    const chain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    }
    await expect(updateMessageStatus(makeDb(chain), 'msg-1', 'delivered')).resolves.toBeUndefined()
    expect(chain.update).toHaveBeenCalledWith({ status: 'delivered' })
  })

  it('includes error field when provided', async () => {
    const { updateMessageStatus } = await import('../queries/messages.js')
    const chain = {
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    }
    await updateMessageStatus(makeDb(chain), 'msg-1', 'failed', 'LLM timeout')
    expect(chain.update).toHaveBeenCalledWith({ status: 'failed', error: 'LLM timeout' })
  })
})
```

- [ ] **Step 5: Run test — verify it fails**

```bash
cd packages/db && npm install && npm test
```

Expected: FAIL — `../queries/instances.js` not found

- [ ] **Step 6: Create `packages/db/src/types.ts`**

```typescript
export type InstanceStatus = 'connected' | 'disconnected' | 'qr_code'
export type MessageStatus = 'pending' | 'processing' | 'delivered' | 'failed' | 'skipped'
export type MessageRole = 'user' | 'assistant' | 'tool'
export type ConversationStatus = 'active' | 'closed'

export type BusinessHours = {
  [day in 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun']?: [string, string]
}

export interface Instance {
  id: string
  name: string
  evolution_instance_name: string
  webhook_secret: string
  status: InstanceStatus
  created_at: string
}

export interface Agent {
  id: string
  instance_id: string
  name: string
  model: string
  system_prompt: string
  temperature: number
  tools: string[]
  is_active: boolean
  business_hours: BusinessHours | null
  off_hours_message: string | null
  typing_delay_ms: number
  daily_message_limit: number | null
  created_at: string
}

export interface Contact {
  id: string
  instance_id: string
  phone: string
  name: string | null
  created_at: string
}

export interface Conversation {
  id: string
  contact_id: string
  instance_id: string
  agent_id: string | null
  status: ConversationStatus
  last_message_at: string | null
  created_at: string
}

export interface Message {
  id: string
  conversation_id: string
  role: MessageRole
  content: string
  status: MessageStatus
  error: string | null
  evolution_message_id: string | null
  created_at: string
}

export interface JobFailure {
  id: string
  message_id: string
  error: string
  attempts: number
  failed_at: string
}

export type MessageInsert = {
  conversation_id: string
  role: MessageRole
  content: string
  status?: MessageStatus
  evolution_message_id?: string
}

export type JobFailureInsert = {
  message_id: string
  error: string
  attempts: number
}

export interface Database {
  public: {
    Tables: {
      instances: {
        Row: Instance
        Insert: Omit<Instance, 'id' | 'created_at'>
        Update: Partial<Omit<Instance, 'id' | 'created_at'>>
      }
      agents: {
        Row: Agent
        Insert: Omit<Agent, 'id' | 'created_at'>
        Update: Partial<Omit<Agent, 'id' | 'created_at'>>
      }
      contacts: {
        Row: Contact
        Insert: Omit<Contact, 'id' | 'created_at'>
        Update: Partial<Omit<Contact, 'id' | 'created_at'>>
      }
      conversations: {
        Row: Conversation
        Insert: Omit<Conversation, 'id' | 'created_at'>
        Update: Partial<Omit<Conversation, 'id' | 'created_at'>>
      }
      messages: {
        Row: Message
        Insert: Omit<Message, 'id' | 'created_at'>
        Update: Partial<Omit<Message, 'id' | 'created_at'>>
      }
      job_failures: {
        Row: JobFailure
        Insert: Omit<JobFailure, 'id'>
        Update: Partial<Omit<JobFailure, 'id'>>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
```

- [ ] **Step 7: Create `packages/db/src/client.ts`**

```typescript
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types.js'

export function createSupabaseClient(): SupabaseClient<Database> {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  return createClient<Database>(url, key)
}
```

- [ ] **Step 8: Create `packages/db/src/queries/instances.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Instance, InstanceStatus } from '../types.js'

export async function getInstanceByName(
  db: SupabaseClient<Database>,
  evolutionInstanceName: string,
): Promise<Instance | null> {
  const { data, error } = await db
    .from('instances')
    .select('*')
    .eq('evolution_instance_name', evolutionInstanceName)
    .single()
  if (error) return null
  return data
}

export async function updateInstanceStatus(
  db: SupabaseClient<Database>,
  instanceId: string,
  status: InstanceStatus,
): Promise<void> {
  const { error } = await db.from('instances').update({ status }).eq('id', instanceId)
  if (error) throw new Error(`updateInstanceStatus failed: ${error.message}`)
}
```

- [ ] **Step 9: Create `packages/db/src/queries/agents.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Agent } from '../types.js'

export async function getAgentByInstanceId(
  db: SupabaseClient<Database>,
  instanceId: string,
): Promise<Agent | null> {
  const { data, error } = await db
    .from('agents')
    .select('*')
    .eq('instance_id', instanceId)
    .eq('is_active', true)
    .single()
  if (error) return null
  return data
}
```

- [ ] **Step 10: Create `packages/db/src/queries/contacts.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Contact } from '../types.js'

export async function getOrCreateContact(
  db: SupabaseClient<Database>,
  instanceId: string,
  phone: string,
  name?: string,
): Promise<Contact> {
  const { data, error } = await db
    .from('contacts')
    .upsert(
      { instance_id: instanceId, phone, name: name ?? null },
      { onConflict: 'instance_id,phone' },
    )
    .select('*')
    .single()
  if (error || !data) throw new Error(`getOrCreateContact failed: ${error?.message}`)
  return data
}
```

- [ ] **Step 11: Create `packages/db/src/queries/conversations.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Conversation } from '../types.js'

export async function getOrCreateConversation(
  db: SupabaseClient<Database>,
  contactId: string,
  instanceId: string,
  agentId: string,
): Promise<Conversation> {
  const { data: existing } = await db
    .from('conversations')
    .select('*')
    .eq('contact_id', contactId)
    .eq('instance_id', instanceId)
    .eq('status', 'active')
    .single()
  if (existing) return existing

  const { data, error } = await db
    .from('conversations')
    .insert({ contact_id: contactId, instance_id: instanceId, agent_id: agentId, status: 'active' })
    .select('*')
    .single()
  if (error || !data) throw new Error(`getOrCreateConversation failed: ${error?.message}`)
  return data
}
```

- [ ] **Step 12: Create `packages/db/src/queries/messages.ts`**

```typescript
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Message, MessageInsert, MessageStatus, JobFailureInsert } from '../types.js'

export async function createMessage(
  db: SupabaseClient<Database>,
  data: MessageInsert,
): Promise<Message> {
  const { data: created, error } = await db
    .from('messages')
    .insert({ ...data, status: data.status ?? 'pending' })
    .select('*')
    .single()
  if (error || !created) throw new Error(`createMessage failed: ${error?.message}`)
  return created
}

export async function updateMessageStatus(
  db: SupabaseClient<Database>,
  messageId: string,
  status: MessageStatus,
  errorMsg?: string,
): Promise<void> {
  const payload: Record<string, unknown> = { status }
  if (errorMsg !== undefined) payload['error'] = errorMsg
  const { error } = await db.from('messages').update(payload).eq('id', messageId)
  if (error) throw new Error(`updateMessageStatus failed: ${error.message}`)
}

export async function getConversationMessages(
  db: SupabaseClient<Database>,
  conversationId: string,
): Promise<Message[]> {
  const { data, error } = await db
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(`getConversationMessages failed: ${error.message}`)
  return data ?? []
}

export async function createJobFailure(
  db: SupabaseClient<Database>,
  data: JobFailureInsert,
): Promise<void> {
  const { error } = await db.from('job_failures').insert(data)
  if (error) throw new Error(`createJobFailure failed: ${error.message}`)
}
```

- [ ] **Step 13: Create `packages/db/src/index.ts`**

```typescript
export { createSupabaseClient } from './client.js'
export type {
  Database, Instance, Agent, Contact, Conversation, Message, JobFailure,
  MessageInsert, JobFailureInsert, BusinessHours,
  InstanceStatus, MessageStatus, MessageRole, ConversationStatus,
} from './types.js'
export { getInstanceByName, updateInstanceStatus } from './queries/instances.js'
export { getAgentByInstanceId } from './queries/agents.js'
export { getOrCreateContact } from './queries/contacts.js'
export { getOrCreateConversation } from './queries/conversations.js'
export { createMessage, updateMessageStatus, getConversationMessages, createJobFailure } from './queries/messages.js'
```

- [ ] **Step 14: Run tests — verify they pass**

```bash
cd packages/db && npm test
```

Expected: PASS — 6 tests passing

- [ ] **Step 15: Typecheck**

```bash
cd packages/db && npm run typecheck
```

Expected: no errors

- [ ] **Step 16: Commit**

```bash
git add packages/db
git commit -m "feat(db): add Supabase client, types, and query functions"
```

---

### Task 3: packages/queue — BullMQ Definitions & Producer

**Files:**
- Create: `packages/queue/package.json`
- Create: `packages/queue/tsconfig.json`
- Create: `packages/queue/vitest.config.ts`
- Create: `packages/queue/src/types.ts`
- Create: `packages/queue/src/connection.ts`
- Create: `packages/queue/src/producer.ts`
- Create: `packages/queue/src/index.ts`
- Test: `packages/queue/src/__tests__/producer.test.ts`

**Interfaces:**
- Produces:
  - `MESSAGE_QUEUE_NAME = 'messages'`
  - `MessageJob: { instanceId, contactId, messageId, conversationId, evolutionInstanceName, contactPhone }`
  - `createRedisConnection(url: string): IORedis`
  - `createMessageQueue(connection: IORedis): Queue<MessageJob>`
  - `enqueueMessage(queue: Queue<MessageJob>, data: MessageJob): Promise<string>` — returns job id

- [ ] **Step 1: Create `packages/queue/package.json`**

```json
{
  "name": "@agente/queue",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "bullmq": "^5.7.0",
    "ioredis": "^5.3.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `packages/queue/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src"],
  "exclude": ["src/__tests__"]
}
```

- [ ] **Step 3: Create `packages/queue/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node' } })
```

- [ ] **Step 4: Write failing test**

Create `packages/queue/src/__tests__/producer.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import type { Queue } from 'bullmq'
import type { MessageJob } from '../types.js'

const JOB_DATA: MessageJob = {
  instanceId: 'inst-1',
  contactId: 'contact-1',
  messageId: 'msg-1',
  conversationId: 'conv-1',
  evolutionInstanceName: 'test-instance',
  contactPhone: '5511999999999',
}

describe('enqueueMessage', () => {
  it('adds job to queue with retry config and returns job id', async () => {
    const { enqueueMessage } = await import('../producer.js')
    const mockAdd = vi.fn().mockResolvedValue({ id: 'job-123' })
    const mockQueue = { add: mockAdd } as unknown as Queue<MessageJob>

    const jobId = await enqueueMessage(mockQueue, JOB_DATA)

    expect(mockAdd).toHaveBeenCalledWith(
      'process-message',
      JOB_DATA,
      expect.objectContaining({ attempts: 4 }),
    )
    expect(jobId).toBe('job-123')
  })

  it('throws if queue returns no job id', async () => {
    const { enqueueMessage } = await import('../producer.js')
    const mockQueue = { add: vi.fn().mockResolvedValue({ id: undefined }) } as unknown as Queue<MessageJob>
    await expect(enqueueMessage(mockQueue, JOB_DATA)).rejects.toThrow('BullMQ did not return a job id')
  })
})
```

- [ ] **Step 5: Run test — verify it fails**

```bash
cd packages/queue && npm install && npm test
```

Expected: FAIL — `../producer.js` not found

- [ ] **Step 6: Create `packages/queue/src/types.ts`**

```typescript
export const MESSAGE_QUEUE_NAME = 'messages' as const

export interface MessageJob {
  instanceId: string
  contactId: string
  messageId: string
  conversationId: string
  evolutionInstanceName: string
  contactPhone: string
}
```

- [ ] **Step 7: Create `packages/queue/src/connection.ts`**

```typescript
import { Redis } from 'ioredis'

export function createRedisConnection(url: string): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  })
}
```

- [ ] **Step 8: Create `packages/queue/src/producer.ts`**

```typescript
import { Queue } from 'bullmq'
import type { Redis } from 'ioredis'
import { MESSAGE_QUEUE_NAME, type MessageJob } from './types.js'

export function createMessageQueue(connection: Redis): Queue<MessageJob> {
  return new Queue<MessageJob>(MESSAGE_QUEUE_NAME, { connection })
}

export async function enqueueMessage(
  queue: Queue<MessageJob>,
  data: MessageJob,
): Promise<string> {
  const job = await queue.add('process-message', data, {
    attempts: 4,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  })
  if (!job.id) throw new Error('BullMQ did not return a job id')
  return job.id
}
```

- [ ] **Step 9: Create `packages/queue/src/index.ts`**

```typescript
export { MESSAGE_QUEUE_NAME, type MessageJob } from './types.js'
export { createRedisConnection } from './connection.js'
export { createMessageQueue, enqueueMessage } from './producer.js'
```

- [ ] **Step 10: Run tests — verify they pass**

```bash
cd packages/queue && npm test
```

Expected: PASS — 2 tests passing

- [ ] **Step 11: Typecheck**

```bash
cd packages/queue && npm run typecheck
```

Expected: no errors

- [ ] **Step 12: Commit**

```bash
git add packages/queue
git commit -m "feat(queue): add BullMQ types, connection factory, and producer"
```

---

### Task 4: packages/evolution — Evolution API HTTP Client

**Files:**
- Create: `packages/evolution/package.json`
- Create: `packages/evolution/tsconfig.json`
- Create: `packages/evolution/vitest.config.ts`
- Create: `packages/evolution/src/types.ts`
- Create: `packages/evolution/src/client.ts`
- Create: `packages/evolution/src/index.ts`
- Test: `packages/evolution/src/__tests__/client.test.ts`

**Interfaces:**
- Produces:
  - `WebhookPayload: { event, instance, data: { key: { remoteJid, fromMe, id }, message: { conversation?, extendedTextMessage? }, pushName? } }`
  - `EvolutionClient` class:
    - `constructor(baseUrl: string, apiKey: string)`
    - `sendText(instanceName: string, to: string, text: string): Promise<void>`
    - `getQrCode(instanceName: string): Promise<{ base64: string; status: string }>`
    - `getConnectionState(instanceName: string): Promise<'open' | 'close' | 'connecting'>`
    - `createInstance(instanceName: string, webhookUrl: string, webhookSecret: string): Promise<void>`
    - `deleteInstance(instanceName: string): Promise<void>`
  - `extractMessageText(payload: WebhookPayload): string | null` — returns message text or null if not a text message

- [ ] **Step 1: Create `packages/evolution/package.json`**

```json
{
  "name": "@agente/evolution",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `packages/evolution/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src"],
  "exclude": ["src/__tests__"]
}
```

- [ ] **Step 3: Create `packages/evolution/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node' } })
```

- [ ] **Step 4: Write failing tests**

Create `packages/evolution/src/__tests__/client.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('EvolutionClient.sendText', () => {
  beforeEach(() => { mockFetch.mockReset() })

  it('POSTs to correct endpoint with apikey header', async () => {
    const { EvolutionClient } = await import('../client.js')
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) })

    const client = new EvolutionClient('https://api.example.com', 'global-key')
    await client.sendText('my-instance', '5511999999999', 'Hello!')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/message/sendText/my-instance',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ apikey: 'global-key' }),
        body: JSON.stringify({ number: '5511999999999', text: 'Hello!' }),
      }),
    )
  })

  it('throws on non-ok response', async () => {
    const { EvolutionClient } = await import('../client.js')
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'Internal error' })

    const client = new EvolutionClient('https://api.example.com', 'key')
    await expect(client.sendText('inst', '123', 'hi')).rejects.toThrow('Evolution API error 500')
  })
})

describe('extractMessageText', () => {
  it('extracts conversation text', async () => {
    const { extractMessageText } = await import('../client.js')
    const payload = {
      event: 'messages.upsert', instance: 'inst',
      data: {
        key: { remoteJid: '5511@s.whatsapp.net', fromMe: false, id: 'ID1' },
        message: { conversation: 'Hello there' },
        pushName: 'User',
      },
    }
    expect(extractMessageText(payload)).toBe('Hello there')
  })

  it('extracts extendedTextMessage text', async () => {
    const { extractMessageText } = await import('../client.js')
    const payload = {
      event: 'messages.upsert', instance: 'inst',
      data: {
        key: { remoteJid: '5511@s.whatsapp.net', fromMe: false, id: 'ID2' },
        message: { extendedTextMessage: { text: 'Extended hello' } },
        pushName: 'User',
      },
    }
    expect(extractMessageText(payload)).toBe('Extended hello')
  })

  it('returns null for non-text messages', async () => {
    const { extractMessageText } = await import('../client.js')
    const payload = {
      event: 'messages.upsert', instance: 'inst',
      data: {
        key: { remoteJid: '5511@s.whatsapp.net', fromMe: false, id: 'ID3' },
        message: {},
        pushName: 'User',
      },
    }
    expect(extractMessageText(payload)).toBeNull()
  })
})
```

- [ ] **Step 5: Run test — verify it fails**

```bash
cd packages/evolution && npm install && npm test
```

Expected: FAIL — `../client.js` not found

- [ ] **Step 6: Create `packages/evolution/src/types.ts`**

```typescript
export interface WebhookPayload {
  event: string
  instance: string
  data: {
    key: {
      remoteJid: string
      fromMe: boolean
      id: string
    }
    message: {
      conversation?: string
      extendedTextMessage?: { text: string }
    }
    pushName?: string
  }
}

export interface QrCodeResponse {
  base64: string
  code: string
  status: string
}

export interface ConnectionStateResponse {
  instance: {
    state: 'open' | 'close' | 'connecting'
  }
}
```

- [ ] **Step 7: Create `packages/evolution/src/client.ts`**

```typescript
import type { WebhookPayload, QrCodeResponse, ConnectionStateResponse } from './types.js'

export { type WebhookPayload }

export class EvolutionClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${path}`
    const res = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        apikey: this.apiKey,
        ...options.headers,
      },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Evolution API error ${res.status}: ${body}`)
    }
    return res.json() as Promise<T>
  }

  async sendText(instanceName: string, to: string, text: string): Promise<void> {
    await this.request(`/message/sendText/${instanceName}`, {
      method: 'POST',
      body: JSON.stringify({ number: to, text }),
    })
  }

  async getQrCode(instanceName: string): Promise<{ base64: string; status: string }> {
    const data = await this.request<QrCodeResponse>(`/instance/connect/${instanceName}`)
    return { base64: data.base64, status: data.status }
  }

  async getConnectionState(instanceName: string): Promise<'open' | 'close' | 'connecting'> {
    const data = await this.request<ConnectionStateResponse>(`/instance/connectionState/${instanceName}`)
    return data.instance.state
  }

  async createInstance(instanceName: string, webhookUrl: string, webhookSecret: string): Promise<void> {
    await this.request('/instance/create', {
      method: 'POST',
      body: JSON.stringify({
        instanceName,
        webhook: {
          enabled: true,
          url: webhookUrl,
          webhookByEvents: false,
          webhookBase64: false,
          events: ['MESSAGES_UPSERT'],
          headers: { apikey: webhookSecret },
        },
      }),
    })
  }

  async deleteInstance(instanceName: string): Promise<void> {
    await this.request(`/instance/delete/${instanceName}`, { method: 'DELETE' })
  }
}

export function extractMessageText(payload: WebhookPayload): string | null {
  const msg = payload.data.message
  return msg.conversation ?? msg.extendedTextMessage?.text ?? null
}
```

- [ ] **Step 8: Create `packages/evolution/src/index.ts`**

```typescript
export { EvolutionClient, extractMessageText } from './client.js'
export type { WebhookPayload, QrCodeResponse, ConnectionStateResponse } from './types.js'
```

- [ ] **Step 9: Run tests — verify they pass**

```bash
cd packages/evolution && npm test
```

Expected: PASS — 4 tests passing

- [ ] **Step 10: Typecheck**

```bash
cd packages/evolution && npm run typecheck
```

Expected: no errors

- [ ] **Step 11: Commit**

```bash
git add packages/evolution
git commit -m "feat(evolution): add Evolution API client and webhook payload types"
```

---

### Task 5: packages/llm — Vercel AI SDK Agent Runner

**Files:**
- Create: `packages/llm/package.json`
- Create: `packages/llm/tsconfig.json`
- Create: `packages/llm/vitest.config.ts`
- Create: `packages/llm/src/types.ts`
- Create: `packages/llm/src/tools.ts`
- Create: `packages/llm/src/agent.ts`
- Create: `packages/llm/src/index.ts`
- Test: `packages/llm/src/__tests__/agent.test.ts`

**Interfaces:**
- Consumes: `Agent` from `@agente/db`
- Produces:
  - `RunAgentInput: { agentConfig: Agent, history: CoreMessage[], userMessage: string }`
  - `RunAgentOutput: { text: string }`
  - `runAgent(input: RunAgentInput): Promise<RunAgentOutput>`
  - `TOOL_REGISTRY: Record<string, CoreTool>` — built-in tools by name
  - `resolveModel(modelId: string): LanguageModel` — maps model string to AI SDK provider

- [ ] **Step 1: Create `packages/llm/package.json`**

```json
{
  "name": "@agente/llm",
  "version": "0.0.1",
  "type": "module",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@agente/db": "*",
    "ai": "^3.2.0",
    "@ai-sdk/openai": "^0.0.36",
    "@ai-sdk/anthropic": "^0.0.23"
  },
  "devDependencies": {
    "typescript": "^5.4.0",
    "vitest": "^1.6.0"
  }
}
```

- [ ] **Step 2: Create `packages/llm/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist", "rootDir": "./src" },
  "include": ["src"],
  "exclude": ["src/__tests__"]
}
```

- [ ] **Step 3: Create `packages/llm/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node' } })
```

- [ ] **Step 4: Write failing test**

Create `packages/llm/src/__tests__/agent.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest'
import type { Agent } from '@agente/db'

vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({ text: 'Hello, how can I help?' }),
}))

vi.mock('../tools.js', () => ({
  TOOL_REGISTRY: {},
  resolveModel: vi.fn().mockReturnValue({ modelId: 'gpt-4o' }),
}))

const MOCK_AGENT: Agent = {
  id: 'agent-1', instance_id: 'inst-1', name: 'Bot', model: 'gpt-4o',
  system_prompt: 'You are a helpful assistant.', temperature: 0.7, tools: [],
  is_active: true, business_hours: null, off_hours_message: null,
  typing_delay_ms: 0, daily_message_limit: null, created_at: '2026-01-01T00:00:00Z',
}

describe('runAgent', () => {
  it('calls generateText with system prompt and history', async () => {
    const { runAgent } = await import('../agent.js')
    const { generateText } = await import('ai')

    const result = await runAgent({
      agentConfig: MOCK_AGENT,
      history: [{ role: 'user', content: 'Previous message' }],
      userMessage: 'New message',
    })

    expect(generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: 'You are a helpful assistant.',
        messages: expect.arrayContaining([
          { role: 'user', content: 'Previous message' },
          { role: 'user', content: 'New message' },
        ]),
        maxSteps: 5,
      }),
    )
    expect(result.text).toBe('Hello, how can I help?')
  })
})
```

- [ ] **Step 5: Run test — verify it fails**

```bash
cd packages/llm && npm install && npm test
```

Expected: FAIL — `../agent.js` not found

- [ ] **Step 6: Create `packages/llm/src/types.ts`**

```typescript
import type { CoreMessage } from 'ai'
import type { Agent } from '@agente/db'

export type { CoreMessage }

export interface RunAgentInput {
  agentConfig: Agent
  history: CoreMessage[]
  userMessage: string
}

export interface RunAgentOutput {
  text: string
}
```

- [ ] **Step 7: Create `packages/llm/src/tools.ts`**

```typescript
import { openai } from '@ai-sdk/openai'
import { anthropic } from '@ai-sdk/anthropic'
import type { LanguageModel, CoreTool } from 'ai'
import { tool } from 'ai'
import { z } from 'zod'

export function resolveModel(modelId: string): LanguageModel {
  if (modelId.startsWith('gpt-') || modelId.startsWith('o1') || modelId.startsWith('o3')) {
    return openai(modelId)
  }
  if (modelId.startsWith('claude-')) {
    return anthropic(modelId)
  }
  throw new Error(`Unsupported model: ${modelId}. Add provider mapping in packages/llm/src/tools.ts`)
}

export const TOOL_REGISTRY: Record<string, CoreTool> = {
  get_current_time: tool({
    description: 'Returns the current date and time in ISO 8601 format.',
    parameters: z.object({}),
    execute: async () => ({ datetime: new Date().toISOString() }),
  }),
}
```

- [ ] **Step 8: Create `packages/llm/src/agent.ts`**

```typescript
import { generateText } from 'ai'
import type { RunAgentInput, RunAgentOutput } from './types.js'
import { resolveModel, TOOL_REGISTRY } from './tools.js'

export async function runAgent({ agentConfig, history, userMessage }: RunAgentInput): Promise<RunAgentOutput> {
  const model = resolveModel(agentConfig.model)

  const enabledTools = agentConfig.tools.reduce<Record<string, (typeof TOOL_REGISTRY)[string]>>(
    (acc, name) => {
      const t = TOOL_REGISTRY[name]
      if (t) acc[name] = t
      return acc
    },
    {},
  )

  const messages = [
    ...history,
    { role: 'user' as const, content: userMessage },
  ]

  const { text } = await generateText({
    model,
    system: agentConfig.systemPrompt,
    messages,
    temperature: agentConfig.temperature,
    maxSteps: 5,
    tools: Object.keys(enabledTools).length > 0 ? enabledTools : undefined,
  })

  return { text }
}
```

Wait — `agentConfig.systemPrompt` should be `agentConfig.system_prompt` (snake_case from DB). Let me fix that.

- [ ] **Step 8 (corrected): Create `packages/llm/src/agent.ts`**

```typescript
import { generateText } from 'ai'
import type { RunAgentInput, RunAgentOutput } from './types.js'
import { resolveModel, TOOL_REGISTRY } from './tools.js'

export async function runAgent({ agentConfig, history, userMessage }: RunAgentInput): Promise<RunAgentOutput> {
  const model = resolveModel(agentConfig.model)

  const enabledTools = agentConfig.tools.reduce<Record<string, (typeof TOOL_REGISTRY)[string]>>(
    (acc, name) => {
      const t = TOOL_REGISTRY[name]
      if (t) acc[name] = t
      return acc
    },
    {},
  )

  const messages = [
    ...history,
    { role: 'user' as const, content: userMessage },
  ]

  const { text } = await generateText({
    model,
    system: agentConfig.system_prompt,
    messages,
    temperature: agentConfig.temperature,
    maxSteps: 5,
    ...(Object.keys(enabledTools).length > 0 && { tools: enabledTools }),
  })

  return { text }
}
```

- [ ] **Step 9: Create `packages/llm/src/index.ts`**

```typescript
export { runAgent } from './agent.js'
export { resolveModel, TOOL_REGISTRY } from './tools.js'
export type { RunAgentInput, RunAgentOutput, CoreMessage } from './types.js'
```

- [ ] **Step 10: Run tests — verify they pass**

```bash
cd packages/llm && npm test
```

Expected: PASS — 1 test passing

- [ ] **Step 11: Typecheck**

```bash
cd packages/llm && npm run typecheck
```

Expected: no errors

- [ ] **Step 12: Commit**

```bash
git add packages/llm
git commit -m "feat(llm): add Vercel AI SDK agent runner with tool calling support"
```

---

### Task 6: Install all workspace dependencies and verify full build

- [ ] **Step 1: Install all dependencies from root**

```bash
npm install
```

Expected: all packages installed, no peer dependency errors

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: PASS — all tests across packages/db, packages/queue, packages/llm, packages/evolution

- [ ] **Step 3: Run full typecheck**

```bash
npm run typecheck
```

Expected: no errors in any package

- [ ] **Step 4: Final commit**

```bash
git add .
git commit -m "chore: verify full monorepo build and tests pass"
```
