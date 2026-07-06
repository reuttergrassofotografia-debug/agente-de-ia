# Inbox: Mídia Real, Remetente em Grupo e Correção de Hidratação Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o bug de hidratação que trava os cliques no Inbox, guardar e exibir mídia de verdade (áudio/imagem/documento) recebida e enviada via Supabase Storage, e mostrar quem mandou cada mensagem dentro de conversas de grupo.

**Architecture:** Bucket privado `whatsapp-media` no Supabase Storage, acessado só com a service role key. Mídia recebida é buscada da Evolution API (`getBase64FromMediaMessage`) e enviada é reaproveitada do base64 que o navegador já tem — em ambos os casos, best-effort (falha não derruba o fluxo principal). O bug de hidratação é corrigido movendo cálculo de tempo relativo pro client-side via `useEffect`.

**Tech Stack:** TypeScript, Supabase (Postgres + Storage), Fastify, Next.js App Router, Vitest (só no backend).

## Global Constraints

- Migration criada mas **não executada automaticamente** — só o arquivo `.sql` é gerado; o usuário roda manualmente no SQL Editor do Supabase.
- Nenhuma tarefa faz `git push` — só commits locais.
- `meu-crm` não tem framework de teste — verificação é `npx tsc --noEmit`, `npm run lint`, `npm run build`. Baseline conhecido: 1 erro pré-existente `app/dashboard/funil/actions.ts(22)` TS2394, e ~5 problemas de lint pré-existentes — nenhum deles é regressão sua.
- `agente-de-ia` tem vitest por workspace — TDD obrigatório lá.
- Bucket `whatsapp-media` é privado — toda leitura/escrita usa a service role key; exibição na tela usa signed URL de 1h gerada a cada busca de mensagens, nunca uma URL fixa salva no banco.

---

### Task 1: Backend — schema, storage bucket, remetente de grupo e mídia recebida

**Repo:** `C:\Users\rgrasso\agente de ia` (branch `master`)

**Files:**
- Create: `supabase/migrations/20260705_messages_media_and_sender.sql`
- Create: `apps/api/src/lib/fetch-and-store-media.ts`
- Test: `apps/api/src/__tests__/fetch-and-store-media.test.ts`
- Modify: `apps/api/src/schemas/webhook.ts` (adiciona `participant`)
- Modify: `apps/api/src/routes/webhook.ts` (captura remetente de grupo + chama fetch de mídia)
- Modify: `apps/api/src/__tests__/webhook.test.ts` (novos testes)
- Modify: `packages/db/src/types.ts` (`Message` interface + `Database.messages`)

**Interfaces:**
- Produces: `fetchAndStoreMedia(db: SupabaseClient<Database>, evolutionInstanceName: string, evolutionMessageId: string, messageDbId: string): Promise<void>` — usado só dentro deste repo (webhook.ts), não é consumido pelo CRM.
- Produces: colunas `messages.media_path`, `messages.media_mimetype`, `messages.sender_phone`, `messages.sender_name` (todas `text`, nullable) — consumidas pelo CRM via Supabase direto (repo separado, sem import de tipo compartilhado).

- [ ] **Step 1: Escrever a migration**

Crie `supabase/migrations/20260705_messages_media_and_sender.sql`:

```sql
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
```

- [ ] **Step 2: Atualizar `packages/db/src/types.ts`**

Troque a interface `Message` (linhas 60-69):

```ts
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
```

por:

```ts
export interface Message {
  id: string
  conversation_id: string
  role: MessageRole
  content: string
  status: MessageStatus
  error: string | null
  evolution_message_id: string | null
  media_path: string | null
  media_mimetype: string | null
  sender_phone: string | null
  sender_name: string | null
  created_at: string
}
```

Troque o bloco `messages` dentro de `Database` (linhas 150-155):

```ts
      messages: {
        Row: { [K in keyof Message]: Message[K] }
        Insert: { conversation_id: string; role: MessageRole; content: string; status?: MessageStatus; error?: string | null; evolution_message_id?: string | null }
        Update: Partial<Omit<Message, 'id' | 'created_at'>>
        Relationships: Relationship[]
      }
```

por:

```ts
      messages: {
        Row: { [K in keyof Message]: Message[K] }
        Insert: { conversation_id: string; role: MessageRole; content: string; status?: MessageStatus; error?: string | null; evolution_message_id?: string | null; media_path?: string | null; media_mimetype?: string | null; sender_phone?: string | null; sender_name?: string | null }
        Update: Partial<Omit<Message, 'id' | 'created_at'>>
        Relationships: Relationship[]
      }
```

- [ ] **Step 3: Adicionar `participant` ao schema do webhook**

Em `apps/api/src/schemas/webhook.ts`, troque:

```ts
export const WebhookPayloadSchema = z.object({
  event: z.string(),
  instance: z.string(),
  apikey: z.string().optional(),
  data: z.object({
    key: z.object({
      remoteJid: z.string(),
      fromMe: z.boolean(),
      id: z.string(),
    }),
    message: z.record(z.unknown()).optional(),
    pushName: z.string().optional(),
  }),
})
```

por:

```ts
export const WebhookPayloadSchema = z.object({
  event: z.string(),
  instance: z.string(),
  apikey: z.string().optional(),
  data: z.object({
    key: z.object({
      remoteJid: z.string(),
      fromMe: z.boolean(),
      id: z.string(),
      participant: z.string().optional(),
    }),
    message: z.record(z.unknown()).optional(),
    pushName: z.string().optional(),
  }),
})
```

- [ ] **Step 4: Escrever os testes que falham para `fetchAndStoreMedia`**

Crie `apps/api/src/__tests__/fetch-and-store-media.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@agente/db'

function makeMockDb(uploadError: unknown = null) {
  const upload = vi.fn(async () => ({ error: uploadError }))
  const storageFrom = vi.fn(() => ({ upload }))
  const update = vi.fn(() => ({ eq: vi.fn(async () => ({ error: null })) }))
  const from = vi.fn((table: string) => (table === 'messages' ? { update } : {}))
  const db = { storage: { from: storageFrom }, from } as unknown as SupabaseClient<Database>
  return { db, upload, storageFrom, update, from }
}

describe('fetchAndStoreMedia', () => {
  beforeEach(() => {
    process.env['EVOLUTION_API_URL'] = 'https://evo.test'
    process.env['EVOLUTION_API_KEY'] = 'test-key'
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('downloads media, uploads it, and records the path on the message', async () => {
    const { fetchAndStoreMedia } = await import('../lib/fetch-and-store-media.js')
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ base64: Buffer.from('fake-audio').toString('base64'), mimetype: 'audio/ogg' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    const { db, upload, update, storageFrom } = makeMockDb()

    await fetchAndStoreMedia(db, 'test-instance', 'ev-msg-1', 'msg-db-1')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://evo.test/chat/getBase64FromMediaMessage/test-instance',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ message: { key: { id: 'ev-msg-1' } } }),
      }),
    )
    expect(storageFrom).toHaveBeenCalledWith('whatsapp-media')
    expect(upload).toHaveBeenCalledWith('msg-db-1', expect.any(Buffer), { contentType: 'audio/ogg' })
    expect(update).toHaveBeenCalledWith({ media_path: 'msg-db-1', media_mimetype: 'audio/ogg' })
  })

  it('does nothing when the Evolution API request fails', async () => {
    const { fetchAndStoreMedia } = await import('../lib/fetch-and-store-media.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    const { db, upload, update } = makeMockDb()

    await fetchAndStoreMedia(db, 'test-instance', 'ev-msg-1', 'msg-db-1')

    expect(upload).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
  })

  it('does not update the message when the storage upload fails', async () => {
    const { fetchAndStoreMedia } = await import('../lib/fetch-and-store-media.js')
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ base64: Buffer.from('x').toString('base64'), mimetype: 'image/jpeg' }),
    })))
    const { db, update } = makeMockDb(new Error('bucket full'))

    await fetchAndStoreMedia(db, 'test-instance', 'ev-msg-1', 'msg-db-1')

    expect(update).not.toHaveBeenCalled()
  })

  it('never throws even if fetch itself rejects', async () => {
    const { fetchAndStoreMedia } = await import('../lib/fetch-and-store-media.js')
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    const { db } = makeMockDb()

    await expect(fetchAndStoreMedia(db, 'test-instance', 'ev-msg-1', 'msg-db-1')).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 5: Rodar os testes e confirmar que falham**

Run: `npm run test --workspace=apps/api`
Expected: FAIL — `apps/api/src/lib/fetch-and-store-media.ts` ainda não existe, o `import` falha.

- [ ] **Step 6: Implementar `fetchAndStoreMedia`**

Crie `apps/api/src/lib/fetch-and-store-media.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@agente/db'

// Best-effort: downloads a non-text message's media from the Evolution API and stores it in
// the `whatsapp-media` Supabase Storage bucket, then records the path on the message row.
// Never throws — a media fetch/upload failure must not affect the rest of webhook processing;
// the text placeholder already saved on the message row is enough to not lose the message.
export async function fetchAndStoreMedia(
  db: SupabaseClient<Database>,
  evolutionInstanceName: string,
  evolutionMessageId: string,
  messageDbId: string,
): Promise<void> {
  try {
    const evoUrl = process.env['EVOLUTION_API_URL']!
    const evoKey = process.env['EVOLUTION_API_KEY']!
    const r = await fetch(`${evoUrl}/chat/getBase64FromMediaMessage/${evolutionInstanceName}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: evoKey },
      body: JSON.stringify({ message: { key: { id: evolutionMessageId } } }),
    })
    if (!r.ok) return
    const data = await r.json() as { base64?: string; mimetype?: string }
    if (!data.base64 || !data.mimetype) return
    const buffer = Buffer.from(data.base64, 'base64')
    const path = messageDbId
    const { error: uploadError } = await db.storage
      .from('whatsapp-media')
      .upload(path, buffer, { contentType: data.mimetype })
    if (uploadError) return
    await db.from('messages').update({ media_path: path, media_mimetype: data.mimetype }).eq('id', messageDbId)
  } catch { /* media is best-effort */ }
}
```

- [ ] **Step 7: Rodar os testes e confirmar que passam**

Run: `npm run test --workspace=apps/api`
Expected: PASS — os 4 testes novos.

- [ ] **Step 8: Ligar `fetchAndStoreMedia` e o remetente de grupo no webhook**

Em `apps/api/src/routes/webhook.ts`, adicione o import no topo:

```ts
import { fetchAndStoreMedia } from '../lib/fetch-and-store-media.js'
```

Troque:

```ts
    // For fromMe messages, pushName is the user's own WhatsApp name — never use it as the contact name.
    // In groups, pushName is the participant who sent the message, not the group name — never use it either.
    const contactName = payload.data.key.fromMe || isGroup ? undefined : payload.data.pushName
    const contact = await getOrCreateContact(db, instance.id, phone, contactName, isGroup)
```

por (adiciona a extração de remetente logo abaixo, sem mudar as linhas de `contactName`/`contact`):

```ts
    // For fromMe messages, pushName is the user's own WhatsApp name — never use it as the contact name.
    // In groups, pushName is the participant who sent the message, not the group name — never use it either.
    const contactName = payload.data.key.fromMe || isGroup ? undefined : payload.data.pushName
    const contact = await getOrCreateContact(db, instance.id, phone, contactName, isGroup)

    // Group message sender attribution — pushName here is correctly the participant's name
    // (message-level identity), not the contact-level name that was intentionally skipped above.
    const senderPhone = isGroup ? payload.data.key.participant?.split('@')[0] ?? null : null
    const senderName = isGroup ? payload.data.pushName ?? null : null
```

Troque o upsert de mensagem recebida:

```ts
    // Use upsert to handle duplicate webhook deliveries from Evolution API
    const { data: upserted } = await db.from('messages').upsert({
      conversation_id: conversation.id,
      role: 'user',
      content,
      evolution_message_id: payload.data.key.id,
      status: 'pending',
    }, { onConflict: 'evolution_message_id', ignoreDuplicates: true })
      .select('id')
      .maybeSingle()

    // If ignoreDuplicates skipped the insert (message already exists), don't re-enqueue
    if (!upserted) return reply.status(200).send({ ok: true, skipped: 'duplicate' })

    await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)

    // CRITICAL: never enqueue group messages for the LLM — the AI must not auto-reply in groups
    if (isGroup) return reply.status(200).send({ ok: true, groupSaved: true })

    // Only enqueue text messages for LLM processing — agent can't process audio/images
    if (!isText) return reply.status(200).send({ ok: true, mediaSaved: true })
```

por:

```ts
    // Use upsert to handle duplicate webhook deliveries from Evolution API
    const { data: upserted } = await db.from('messages').upsert({
      conversation_id: conversation.id,
      role: 'user',
      content,
      evolution_message_id: payload.data.key.id,
      status: 'pending',
      sender_phone: senderPhone,
      sender_name: senderName,
    }, { onConflict: 'evolution_message_id', ignoreDuplicates: true })
      .select('id')
      .maybeSingle()

    // If ignoreDuplicates skipped the insert (message already exists), don't re-enqueue
    if (!upserted) return reply.status(200).send({ ok: true, skipped: 'duplicate' })

    await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)

    // Best-effort — never blocks the response, media fetch failures leave the text placeholder in place
    if (!isText) await fetchAndStoreMedia(db, payload.instance, payload.data.key.id, upserted.id)

    // CRITICAL: never enqueue group messages for the LLM — the AI must not auto-reply in groups
    if (isGroup) return reply.status(200).send({ ok: true, groupSaved: true })

    // Only enqueue text messages for LLM processing — agent can't process audio/images
    if (!isText) return reply.status(200).send({ ok: true, mediaSaved: true })
```

- [ ] **Step 9: Escrever os testes que falham para os novos comportamentos do webhook**

Em `apps/api/src/__tests__/webhook.test.ts`, troque `makeMockDb` (linhas 76-87):

```ts
function makeMockDb() {
  const state = { upsertedId: 'msg-1' as string | null }
  const messagesUpsert = vi.fn(() => ({
    select: () => ({
      maybeSingle: async () => ({ data: state.upsertedId ? { id: state.upsertedId } : null, error: null }),
    }),
    then: (resolve: (v: { data: null; error: null }) => void) => resolve({ data: null, error: null }),
  }))
  const update = vi.fn(() => ({ eq: async () => ({ data: null, error: null }) }))
  const from = vi.fn((table: string) => (table === 'messages' ? { upsert: messagesUpsert } : { update }))
  return { db: { from } as unknown as SupabaseClient<Database>, messagesUpsert, update, state }
}
```

por:

```ts
function makeMockDb() {
  const state = { upsertedId: 'msg-1' as string | null }
  const messagesUpsert = vi.fn(() => ({
    select: () => ({
      maybeSingle: async () => ({ data: state.upsertedId ? { id: state.upsertedId } : null, error: null }),
    }),
    then: (resolve: (v: { data: null; error: null }) => void) => resolve({ data: null, error: null }),
  }))
  const messagesUpdate = vi.fn(() => ({ eq: async () => ({ data: null, error: null }) }))
  const update = vi.fn(() => ({ eq: async () => ({ data: null, error: null }) }))
  const from = vi.fn((table: string) => (table === 'messages' ? { upsert: messagesUpsert, update: messagesUpdate } : { update }))
  const upload = vi.fn(async () => ({ error: null }))
  const storage = { from: vi.fn(() => ({ upload })) }
  return { db: { from, storage } as unknown as SupabaseClient<Database>, messagesUpsert, messagesUpdate, update, upload, state }
}
```

Adicione estes testes no final do arquivo (antes do `})` final de `describe('POST /webhook', ...)`, depois do teste `'fetches the group name from the Evolution API when the group contact has no name'`):

```ts

  it('captures sender phone and name for group messages', async () => {
    mockGetOrCreateContact.mockResolvedValue(GROUP_CONTACT)
    const payload = {
      ...GROUP_PAYLOAD,
      data: { ...GROUP_PAYLOAD.data, key: { ...GROUP_PAYLOAD.data.key, participant: '5511988887777@s.whatsapp.net' } },
    }
    const { app, messagesUpsert } = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload,
    })
    expect(res.statusCode).toBe(200)
    expect(messagesUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ sender_phone: '5511988887777', sender_name: 'Some Participant' }),
      expect.anything(),
    )
  })

  it('does not set sender_phone/sender_name for individual (non-group) messages', async () => {
    const { app, messagesUpsert } = await buildApp()
    await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload: VALID_PAYLOAD,
    })
    expect(messagesUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ sender_phone: null, sender_name: null }),
      expect.anything(),
    )
  })

  it('fetches and stores media for non-text messages', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (typeof url === 'string' && url.includes('getBase64FromMediaMessage')) {
        return { ok: true, json: async () => ({ base64: Buffer.from('fake').toString('base64'), mimetype: 'audio/ogg' }) }
      }
      return { ok: false }
    })
    vi.stubGlobal('fetch', fetchMock)
    const payload = { ...VALID_PAYLOAD, data: { ...VALID_PAYLOAD.data, message: { audioMessage: {} } } }
    const { app, upload, messagesUpdate } = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload,
    })
    expect(res.statusCode).toBe(200)
    expect(upload).toHaveBeenCalledWith('msg-1', expect.any(Buffer), { contentType: 'audio/ogg' })
    expect(messagesUpdate).toHaveBeenCalledWith({ media_path: 'msg-1', media_mimetype: 'audio/ogg' })
  })
```

- [ ] **Step 10: Rodar os testes e confirmar que passam**

Run: `npm run test --workspace=apps/api`
Expected: PASS — todos os testes do arquivo, incluindo os 3 novos.

- [ ] **Step 11: Typecheck e build do workspace**

Run: `npm run typecheck --workspace=apps/api && npm run typecheck --workspace=packages/db`
Expected: sem erros. Se `packages/db/dist` estiver stale, rode `npm run build --workspace=packages/db` primeiro.

- [ ] **Step 12: Rodar a suíte completa do monorepo**

Run: `npm test`
Expected: todos os testes passando (baseline no início desta tarefa: 39 testes — não pode haver regressão; devem sobrar 39 + 7 novos = 46).

- [ ] **Step 13: Commit**

```bash
git add supabase/migrations/20260705_messages_media_and_sender.sql packages/db/src/types.ts apps/api/src/schemas/webhook.ts apps/api/src/routes/webhook.ts apps/api/src/lib/fetch-and-store-media.ts apps/api/src/__tests__/fetch-and-store-media.test.ts apps/api/src/__tests__/webhook.test.ts
git commit -m "feat(webhook): store received media in Supabase Storage and capture group message sender"
```

---

### Task 2: CRM — corrigir bug de hidratação (React error #418)

**Repo:** `C:\Users\rgrasso\claude teste\meu-crm` (branch `main`)

**Files:**
- Modify: `components/inbox/conversa-lista.tsx`
- Modify: `components/inbox/mensagem-thread.tsx:14-16` (só a função `formatTime`)

**Interfaces:**
- Produces: `ConversaItem` (componente novo dentro de `conversa-lista.tsx`, não exportado, só usado internamente) — não é consumido por outras tasks.
- Não depende de nenhuma outra task; pode rodar em paralelo com a Task 1.

- [ ] **Step 1: Trocar o cálculo de tempo relativo por um hook seguro pra hidratação**

Em `components/inbox/conversa-lista.tsx`, troque:

```ts
import { Conversa } from '@/lib/types'
import { MessageSquare, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPhone } from '@/lib/format'
import { useState } from 'react'

function formatTime(dateStr: string | null) {
  if (!dateStr) return ''
  const d = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  const hours = Math.floor(diff / 3600000)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'agora'
  if (mins < 60) return `${mins}min`
  if (hours < 24) return `${hours}h`
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })
}
```

por:

```ts
import { Conversa } from '@/lib/types'
import { MessageSquare, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPhone } from '@/lib/format'
import { useEffect, useState } from 'react'

// "há Xmin"/"Xh" depende da hora atual — calculá-lo durante o render (que o
// Next.js roda no servidor) quase nunca bate com o valor calculado no
// navegador no momento da hidratação, causando o React error #418 (mismatch
// de hidratação), que por sua vez pode desalinhar o DOM real dos handlers de
// clique da página inteira. Por isso o valor é sempre '' na primeira
// renderização (idêntica em servidor e cliente) e só é calculado de verdade
// depois de montado, dentro de um useEffect.
function useRelativeTime(dateStr: string | null): string {
  const [label, setLabel] = useState('')
  useEffect(() => {
    function compute() {
      if (!dateStr) { setLabel(''); return }
      const d = new Date(dateStr)
      const diff = Date.now() - d.getTime()
      const hours = Math.floor(diff / 3600000)
      const mins = Math.floor(diff / 60000)
      if (mins < 1) setLabel('agora')
      else if (mins < 60) setLabel(`${mins}min`)
      else if (hours < 24) setLabel(`${hours}h`)
      else setLabel(d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }))
    }
    compute()
    const id = setInterval(compute, 30000)
    return () => clearInterval(id)
  }, [dateStr])
  return label
}
```

- [ ] **Step 2: Extrair o item da lista num componente próprio, usando o hook**

Logo antes de `export function ConversaLista(...)`, adicione:

```tsx
function ConversaItem({ c, isSelected, onSelect }: {
  c: Conversa
  isSelected: boolean
  onSelect: (id: string) => void
}) {
  const contactName = c.contacts?.name || formatPhone(c.contacts?.phone ?? '') || 'Desconhecido'
  const isPaused = c.status === 'paused'
  const color = avatarColor(c.id)
  const timeLabel = useRelativeTime(c.last_message_at)

  return (
    <button
      onClick={() => onSelect(c.id)}
      className={cn(
        'w-full text-left px-4 py-3 border-b border-gray-100 flex gap-3 items-center transition-colors',
        isSelected
          ? 'bg-blue-50 border-l-2 border-l-blue-600'
          : 'hover:bg-gray-50'
      )}
    >
      {/* Avatar */}
      {c.contacts?.profile_picture_url ? (
        <img
          src={c.contacts.profile_picture_url}
          alt={contactName}
          className="size-10 rounded-full object-cover shrink-0 shadow-sm"
          onError={e => {
            const t = e.currentTarget
            t.style.display = 'none'
            if (t.nextElementSibling) (t.nextElementSibling as HTMLElement).style.display = 'flex'
          }}
        />
      ) : null}
      <div
        className={`size-10 rounded-full bg-gradient-to-br ${color} items-center justify-center shrink-0 text-xs font-bold text-white shadow-sm`}
        style={{ display: c.contacts?.profile_picture_url ? 'none' : 'flex' }}
      >
        {getInitials(contactName)}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <p className={cn('text-sm font-semibold truncate', isSelected ? 'text-blue-900' : 'text-gray-900')}>
            {contactName}
          </p>
          <span className="text-xs text-gray-400 shrink-0">{timeLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
          {c.instances?.name && (
            <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium shrink-0">
              {c.instances.name}
            </span>
          )}
          {isPaused && (
            <span className="text-xs bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-full font-medium shrink-0">
              ⏸ Pausado
            </span>
          )}
          {!isPaused && c.status === 'active' && (
            <span className="flex items-center gap-1 text-xs text-emerald-600 shrink-0">
              <span className="size-1.5 rounded-full bg-emerald-500 inline-block" />
              ativo
            </span>
          )}
        </div>
      </div>
    </button>
  )
}
```

- [ ] **Step 3: Trocar o `.map()` inline pelo componente novo**

Troque:

```tsx
          <>
          {filtered.map(c => {
            const contactName = c.contacts?.name || formatPhone(c.contacts?.phone ?? '') || 'Desconhecido'
            const isPaused = c.status === 'paused'
            const isSelected = selectedId === c.id
            const color = avatarColor(c.id)
            return (
              <button
                key={c.id}
                onClick={() => onSelect(c.id)}
                className={cn(
                  'w-full text-left px-4 py-3 border-b border-gray-100 flex gap-3 items-center transition-colors',
                  isSelected
                    ? 'bg-blue-50 border-l-2 border-l-blue-600'
                    : 'hover:bg-gray-50'
                )}
              >
                {/* Avatar */}
                {c.contacts?.profile_picture_url ? (
                  <img
                    src={c.contacts.profile_picture_url}
                    alt={contactName}
                    className="size-10 rounded-full object-cover shrink-0 shadow-sm"
                    onError={e => {
                      const t = e.currentTarget
                      t.style.display = 'none'
                      if (t.nextElementSibling) (t.nextElementSibling as HTMLElement).style.display = 'flex'
                    }}
                  />
                ) : null}
                <div
                  className={`size-10 rounded-full bg-gradient-to-br ${color} items-center justify-center shrink-0 text-xs font-bold text-white shadow-sm`}
                  style={{ display: c.contacts?.profile_picture_url ? 'none' : 'flex' }}
                >
                  {getInitials(contactName)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <p className={cn('text-sm font-semibold truncate', isSelected ? 'text-blue-900' : 'text-gray-900')}>
                      {contactName}
                    </p>
                    <span className="text-xs text-gray-400 shrink-0">{formatTime(c.last_message_at)}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {c.instances?.name && (
                      <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium shrink-0">
                        {c.instances.name}
                      </span>
                    )}
                    {isPaused && (
                      <span className="text-xs bg-yellow-50 text-yellow-700 px-2 py-0.5 rounded-full font-medium shrink-0">
                        ⏸ Pausado
                      </span>
                    )}
                    {!isPaused && c.status === 'active' && (
                      <span className="flex items-center gap-1 text-xs text-emerald-600 shrink-0">
                        <span className="size-1.5 rounded-full bg-emerald-500 inline-block" />
                        ativo
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
```

por:

```tsx
          <>
          {filtered.map(c => (
            <ConversaItem key={c.id} c={c} isSelected={selectedId === c.id} onSelect={onSelect} />
          ))}
```

(o `</>` de fechamento logo abaixo, e o `{hasMore && !search && (...)}` que vem depois, continuam exatamente iguais — só o corpo do `.map()` muda)

- [ ] **Step 4: Fixar o fuso horário do horário absoluto das mensagens**

Em `components/inbox/mensagem-thread.tsx`, troque:

```ts
function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
```

por:

```ts
function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: mesmo erro pré-existente conhecido (`app/dashboard/funil/actions.ts(22)` TS2394) e nenhum erro novo.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: mesma contagem de problemas do baseline, nenhum novo.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: build conclui sem erro.

- [ ] **Step 8: Verificação manual (se houver navegador disponível)**

Abra o Console do navegador (F12) no Inbox, deixe a página aberta por 1-2 minutos com o polling rodando, e confirme que o **React error #418 não aparece mais**. Se não houver navegador disponível no ambiente de execução, pule este step e reporte explicitamente que não foi feito.

- [ ] **Step 9: Commit**

```bash
git add components/inbox/conversa-lista.tsx components/inbox/mensagem-thread.tsx
git commit -m "fix(inbox): compute relative time client-side to stop React hydration mismatch"
```

---

### Task 3: CRM — armazenar mídia enviada e servir signed URLs

**Repo:** `C:\Users\rgrasso\claude teste\meu-crm` (branch `main`)

**Depends on:** Task 2 (mesmo repo, roda depois pra evitar conflito de working tree). Não depende logicamente da Task 2, mas como estão no mesmo repositório precisam ser sequenciais.

**Files:**
- Modify: `lib/types.ts` (`Mensagem`)
- Modify: `app/dashboard/inbox/actions.ts` (`getMensagens`, `sendMediaMessage`, `sendAudioMessage`)
- Modify: `components/inbox/compose-panel.tsx:100-103` (passa o mimetype pro `sendAudioMessage`)

**Interfaces:**
- Consumes: nada de outra task neste repo diretamente — compila independente da Task 1 já ter rodado (o cliente admin do Supabase não é tipado com `Database` genérico, então `media_path`/`media_mimetype` em `.insert()`/`.update()` não geram erro de tipo mesmo antes da migration existir no banco).
- Produces: `sendAudioMessage(conversationId: string, instanceName: string, phone: string, audioBase64: string, mimetype: string): Promise<void>` — assinatura nova (ganhou o parâmetro `mimetype`), usada pela Task 4 e por `compose-panel.tsx` (já ajustado nesta task).
- Produces: `Mensagem.media_url: string | null`, `Mensagem.sender_phone: string | null`, `Mensagem.sender_name: string | null` — consumidos pela Task 4.

- [ ] **Step 1: Adicionar os campos novos em `Mensagem`**

Em `lib/types.ts`, troque:

```ts
export interface Mensagem {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  status: 'pending' | 'processing' | 'delivered' | 'failed' | 'skipped'
  error: string | null
  evolution_message_id: string | null
  created_at: string
}
```

por:

```ts
export interface Mensagem {
  id: string
  conversation_id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  status: 'pending' | 'processing' | 'delivered' | 'failed' | 'skipped'
  error: string | null
  evolution_message_id: string | null
  media_path: string | null
  media_mimetype: string | null
  // media_url não existe na tabela — é gerado on-the-fly por getMensagens (signed URL de 1h)
  media_url: string | null
  sender_phone: string | null
  sender_name: string | null
  created_at: string
}
```

- [ ] **Step 2: Gerar signed URLs em `getMensagens`**

Em `app/dashboard/inbox/actions.ts`, troque:

```ts
export async function getMensagens(conversationId: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  return data ?? []
}
```

por:

```ts
export async function getMensagens(conversationId: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  const mensagens = data ?? []

  // media_path aponta pro bucket privado whatsapp-media — gera uma signed URL de
  // curta duração (1h) a cada busca em vez de guardar uma URL fixa, que expiraria.
  return Promise.all(mensagens.map(async (m) => {
    if (!m.media_path) return { ...m, media_url: null }
    const { data: signed } = await supabase.storage.from('whatsapp-media').createSignedUrl(m.media_path, 3600)
    return { ...m, media_url: signed?.signedUrl ?? null }
  }))
}
```

- [ ] **Step 3: Upload de mídia enviada em `sendMediaMessage`**

Troque:

```ts
export async function sendMediaMessage(
  conversationId: string,
  instanceName: string,
  phone: string,
  mediaBase64: string,
  mimetype: string,
  caption: string,
) {
  const supabase = createAdminClient()
  const mediatype = mimetype.startsWith('image/') ? 'image' : mimetype.startsWith('video/') ? 'video' : 'document'
  const evoRes = await evoFetch(`/message/sendMedia/${instanceName}`, { number: phone, mediatype, mimetype, caption, media: mediaBase64 })
  const prefix = mediatype === 'image' ? '[Imagem]' : mediatype === 'video' ? '[Vídeo]' : '[Documento]'
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    role: 'assistant',
    content: caption ? `${prefix} ${caption}` : prefix,
    status: 'delivered',
    evolution_message_id: evoRes?.key?.id ?? null,
  })
}
```

por:

```ts
export async function sendMediaMessage(
  conversationId: string,
  instanceName: string,
  phone: string,
  mediaBase64: string,
  mimetype: string,
  caption: string,
) {
  const supabase = createAdminClient()
  const mediatype = mimetype.startsWith('image/') ? 'image' : mimetype.startsWith('video/') ? 'video' : 'document'
  const evoRes = await evoFetch(`/message/sendMedia/${instanceName}`, { number: phone, mediatype, mimetype, caption, media: mediaBase64 })
  const prefix = mediatype === 'image' ? '[Imagem]' : mediatype === 'video' ? '[Vídeo]' : '[Documento]'

  // Best-effort: já temos o base64 aqui, upload direto pro Storage sem precisar
  // buscar de volta na Evolution API. Se falhar, a mensagem ainda é salva sem
  // mídia — o envio via WhatsApp já aconteceu de qualquer forma.
  let mediaPath: string | null = null
  try {
    mediaPath = crypto.randomUUID()
    const { error } = await supabase.storage
      .from('whatsapp-media')
      .upload(mediaPath, Buffer.from(mediaBase64, 'base64'), { contentType: mimetype })
    if (error) mediaPath = null
  } catch {
    mediaPath = null
  }

  await supabase.from('messages').insert({
    conversation_id: conversationId,
    role: 'assistant',
    content: caption ? `${prefix} ${caption}` : prefix,
    status: 'delivered',
    evolution_message_id: evoRes?.key?.id ?? null,
    media_path: mediaPath,
    media_mimetype: mediaPath ? mimetype : null,
  })
}
```

- [ ] **Step 4: Upload de áudio enviado em `sendAudioMessage`**

Troque:

```ts
export async function sendAudioMessage(
  conversationId: string,
  instanceName: string,
  phone: string,
  audioBase64: string,
) {
  const supabase = createAdminClient()
  const evoRes = await evoFetch(`/message/sendWhatsAppAudio/${instanceName}`, { number: phone, audio: audioBase64, encoding: true })
  await supabase.from('messages').insert({
    conversation_id: conversationId,
    role: 'assistant',
    content: '[Áudio]',
    status: 'delivered',
    evolution_message_id: evoRes?.key?.id ?? null,
  })
}
```

por:

```ts
export async function sendAudioMessage(
  conversationId: string,
  instanceName: string,
  phone: string,
  audioBase64: string,
  mimetype: string,
) {
  const supabase = createAdminClient()
  const evoRes = await evoFetch(`/message/sendWhatsAppAudio/${instanceName}`, { number: phone, audio: audioBase64, encoding: true })

  // Best-effort, mesma lógica do sendMediaMessage: upload do áudio que já temos em
  // memória em vez de buscar de volta na Evolution API. mimetype vem do próprio
  // navegador (MediaRecorder), não é o que a Evolution API reencoda internamente.
  let mediaPath: string | null = null
  try {
    mediaPath = crypto.randomUUID()
    const { error } = await supabase.storage
      .from('whatsapp-media')
      .upload(mediaPath, Buffer.from(audioBase64, 'base64'), { contentType: mimetype })
    if (error) mediaPath = null
  } catch {
    mediaPath = null
  }

  await supabase.from('messages').insert({
    conversation_id: conversationId,
    role: 'assistant',
    content: '[Áudio]',
    status: 'delivered',
    evolution_message_id: evoRes?.key?.id ?? null,
    media_path: mediaPath,
    media_mimetype: mediaPath ? mimetype : null,
  })
}
```

- [ ] **Step 5: Atualizar a chamada em `compose-panel.tsx`**

Em `components/inbox/compose-panel.tsx`, troque:

```ts
        } else if (mode === 'audio' && audioBlob) {
          const base64 = await blobToBase64(audioBlob)
          await sendAudioMessage(conversationId, instanceName, phone, base64)
          reset()
```

por:

```ts
        } else if (mode === 'audio' && audioBlob) {
          const base64 = await blobToBase64(audioBlob)
          await sendAudioMessage(conversationId, instanceName, phone, base64, audioBlob.type)
          reset()
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: mesmo erro pré-existente conhecido e nenhum erro novo.

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: mesma contagem de problemas do baseline.

- [ ] **Step 8: Build**

Run: `npm run build`
Expected: sucesso.

- [ ] **Step 9: Commit**

```bash
git add lib/types.ts app/dashboard/inbox/actions.ts components/inbox/compose-panel.tsx
git commit -m "feat(inbox): upload sent media to Supabase Storage and serve signed URLs"
```

---

### Task 4: CRM — exibir mídia real e remetente de grupo na tela

**Repo:** `C:\Users\rgrasso\claude teste\meu-crm` (branch `main`)

**Depends on:** Task 3 (usa `media_url`, `sender_phone`, `sender_name` do tipo `Mensagem`). Sequencial no mesmo repo.

**Files:**
- Modify: `components/inbox/mensagem-thread.tsx`

**Interfaces:**
- Consumes: `Mensagem.media_url`, `Mensagem.sender_phone`, `Mensagem.sender_name` (Task 3); `Conversa.contacts.is_group` (já existente); `formatPhone` de `@/lib/format` (já importado no arquivo).

- [ ] **Step 1: Renderizar mídia de verdade e rótulo de remetente em grupo**

Troque o bloco inteiro do `.map()` de mensagens:

```tsx
        {visibleMessages.map((msg, idx) => {
          const isAssistant = msg.role === 'assistant'
          const c = msg.content ?? ''
          const isAudio = c === '[Áudio]'
          const isImage = c === '[Imagem]' || c.startsWith('[Imagem] ')
          const isVideo = c === '[Vídeo]' || c.startsWith('[Vídeo] ')
          const isDocument = c === '[Documento]' || c.startsWith('[Documento] ')
          const isSticker = c === '[Sticker]'
          const prevMsg = visibleMessages[idx - 1]
          const showAvatar = !prevMsg || prevMsg.role !== msg.role

          const bubbleBase = isAssistant
            ? 'bg-[#1e3a5f] text-white rounded-tr-sm shadow-sm'
            : 'bg-white text-gray-800 rounded-tl-sm shadow-sm border border-gray-100'

          return (
            <div key={msg.id} className={`flex gap-2 ${isAssistant ? 'flex-row-reverse' : 'flex-row'} ${showAvatar ? 'mt-3' : 'mt-0.5'}`}>
              {showAvatar ? (
                <div className={`size-7 rounded-full flex items-center justify-center shrink-0 self-end ${
                  isAssistant ? 'bg-violet-100' : 'bg-white border border-gray-200 shadow-sm'
                }`}>
                  {isAssistant ? <Bot className="size-3.5 text-violet-600" /> : <User className="size-3.5 text-gray-500" />}
                </div>
              ) : (
                <div className="size-7 shrink-0" />
              )}

              <div className={`max-w-[68%] flex flex-col gap-0.5 ${isAssistant ? 'items-end' : 'items-start'}`}>
                {isAudio ? (
                  <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl ${bubbleBase}`}>
                    <div className={`size-8 rounded-full flex items-center justify-center shrink-0 ${isAssistant ? 'bg-white/20' : 'bg-blue-600'}`}>
                      <svg className="size-4 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                    </div>
                    <div className="flex-1">
                      <div className={`h-1 rounded-full ${isAssistant ? 'bg-white/30' : 'bg-gray-200'} w-24 mb-1`} />
                      <span className={`text-xs ${isAssistant ? 'text-white/60' : 'text-gray-400'}`}>Áudio</span>
                    </div>
                  </div>
                ) : isImage ? (
                  <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-2xl ${bubbleBase}`}>
                    <ImageIcon className={`size-5 shrink-0 ${isAssistant ? 'text-white/80' : 'text-blue-500'}`} />
                    <span className="text-sm">{c.startsWith('[Imagem] ') ? c.slice('[Imagem] '.length) : 'Imagem'}</span>
                  </div>
                ) : isVideo ? (
                  <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-2xl ${bubbleBase}`}>
                    <Video className={`size-5 shrink-0 ${isAssistant ? 'text-white/80' : 'text-purple-500'}`} />
                    <span className="text-sm">{c.startsWith('[Vídeo] ') ? c.slice('[Vídeo] '.length) : 'Vídeo'}</span>
                  </div>
                ) : isDocument ? (
                  <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-2xl ${bubbleBase}`}>
                    <FileText className={`size-5 shrink-0 ${isAssistant ? 'text-white/80' : 'text-amber-500'}`} />
                    <span className="text-sm">{c.startsWith('[Documento] ') ? c.slice('[Documento] '.length) : 'Documento'}</span>
                  </div>
                ) : isSticker ? (
                  <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-2xl ${bubbleBase}`}>
                    <Smile className={`size-5 shrink-0 ${isAssistant ? 'text-white/80' : 'text-yellow-500'}`} />
                    <span className="text-sm">Sticker</span>
                  </div>
                ) : (
                  <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${bubbleBase}`}>
                    {msg.content}
                  </div>
                )}
                <span className="text-[10px] text-gray-400 px-1">{formatTime(msg.created_at)}</span>
              </div>
            </div>
          )
        })}
```

por:

```tsx
        {visibleMessages.map((msg, idx) => {
          const isAssistant = msg.role === 'assistant'
          const c = msg.content ?? ''
          const isAudio = c === '[Áudio]'
          const isImage = c === '[Imagem]' || c.startsWith('[Imagem] ')
          const isVideo = c === '[Vídeo]' || c.startsWith('[Vídeo] ')
          const isDocument = c === '[Documento]' || c.startsWith('[Documento] ')
          const isSticker = c === '[Sticker]'
          const prevMsg = visibleMessages[idx - 1]
          const showAvatar = !prevMsg || prevMsg.role !== msg.role
          const showSender = conversa.contacts?.is_group && !isAssistant

          const bubbleBase = isAssistant
            ? 'bg-[#1e3a5f] text-white rounded-tr-sm shadow-sm'
            : 'bg-white text-gray-800 rounded-tl-sm shadow-sm border border-gray-100'

          return (
            <div key={msg.id} className={`flex gap-2 ${isAssistant ? 'flex-row-reverse' : 'flex-row'} ${showAvatar ? 'mt-3' : 'mt-0.5'}`}>
              {showAvatar ? (
                <div className={`size-7 rounded-full flex items-center justify-center shrink-0 self-end ${
                  isAssistant ? 'bg-violet-100' : 'bg-white border border-gray-200 shadow-sm'
                }`}>
                  {isAssistant ? <Bot className="size-3.5 text-violet-600" /> : <User className="size-3.5 text-gray-500" />}
                </div>
              ) : (
                <div className="size-7 shrink-0" />
              )}

              <div className={`max-w-[68%] flex flex-col gap-0.5 ${isAssistant ? 'items-end' : 'items-start'}`}>
                {showSender && (
                  <span className="text-[10px] font-medium text-gray-500 px-1">
                    {msg.sender_name || (msg.sender_phone ? formatPhone(msg.sender_phone) : 'Desconhecido')}
                  </span>
                )}
                {isAudio ? (
                  msg.media_url ? (
                    <audio controls src={msg.media_url} className="max-w-[240px]" />
                  ) : (
                    <div className={`flex items-center gap-3 px-4 py-3 rounded-2xl ${bubbleBase}`}>
                      <div className={`size-8 rounded-full flex items-center justify-center shrink-0 ${isAssistant ? 'bg-white/20' : 'bg-blue-600'}`}>
                        <svg className="size-4 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                      </div>
                      <div className="flex-1">
                        <div className={`h-1 rounded-full ${isAssistant ? 'bg-white/30' : 'bg-gray-200'} w-24 mb-1`} />
                        <span className={`text-xs ${isAssistant ? 'text-white/60' : 'text-gray-400'}`}>Áudio indisponível</span>
                      </div>
                    </div>
                  )
                ) : isImage ? (
                  msg.media_url ? (
                    <img
                      src={msg.media_url}
                      alt={c.startsWith('[Imagem] ') ? c.slice('[Imagem] '.length) : 'Imagem'}
                      className="max-w-[240px] rounded-2xl"
                    />
                  ) : (
                    <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-2xl ${bubbleBase}`}>
                      <ImageIcon className={`size-5 shrink-0 ${isAssistant ? 'text-white/80' : 'text-blue-500'}`} />
                      <span className="text-sm">{c.startsWith('[Imagem] ') ? c.slice('[Imagem] '.length) : 'Imagem'}</span>
                    </div>
                  )
                ) : isVideo ? (
                  <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-2xl ${bubbleBase}`}>
                    <Video className={`size-5 shrink-0 ${isAssistant ? 'text-white/80' : 'text-purple-500'}`} />
                    {msg.media_url ? (
                      <a href={msg.media_url} target="_blank" rel="noreferrer" className="text-sm underline">
                        {c.startsWith('[Vídeo] ') ? c.slice('[Vídeo] '.length) : 'Vídeo'}
                      </a>
                    ) : (
                      <span className="text-sm">{c.startsWith('[Vídeo] ') ? c.slice('[Vídeo] '.length) : 'Vídeo'}</span>
                    )}
                  </div>
                ) : isDocument ? (
                  <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-2xl ${bubbleBase}`}>
                    <FileText className={`size-5 shrink-0 ${isAssistant ? 'text-white/80' : 'text-amber-500'}`} />
                    {msg.media_url ? (
                      <a href={msg.media_url} download target="_blank" rel="noreferrer" className="text-sm underline">
                        {c.startsWith('[Documento] ') ? c.slice('[Documento] '.length) : 'Documento'}
                      </a>
                    ) : (
                      <span className="text-sm">{c.startsWith('[Documento] ') ? c.slice('[Documento] '.length) : 'Documento'}</span>
                    )}
                  </div>
                ) : isSticker ? (
                  <div className={`flex items-center gap-2.5 px-4 py-2.5 rounded-2xl ${bubbleBase}`}>
                    <Smile className={`size-5 shrink-0 ${isAssistant ? 'text-white/80' : 'text-yellow-500'}`} />
                    <span className="text-sm">Sticker</span>
                  </div>
                ) : (
                  <div className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${bubbleBase}`}>
                    {msg.content}
                  </div>
                )}
                <span className="text-[10px] text-gray-400 px-1">{formatTime(msg.created_at)}</span>
              </div>
            </div>
          )
        })}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: mesmo erro pré-existente conhecido e nenhum erro novo.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: mesma contagem de problemas do baseline.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: sucesso.

- [ ] **Step 5: Verificação manual (se houver navegador disponível)**

1. Numa conversa individual com áudio recebido depois do deploy: confirme que aparece um player de áudio tocável (não o placeholder estático).
2. Numa conversa de grupo: confirme que mensagens recebidas mostram um rótulo com nome/telefone do remetente acima da bolha; mensagens enviadas pela empresa (`assistant`) não mostram rótulo.
3. Mensagens antigas (de antes desta mudança, sem `media_path`): confirme que ainda mostram o placeholder de texto, sem quebrar a tela.
Se não houver navegador disponível, pule este step e reporte explicitamente que não foi feito.

- [ ] **Step 6: Commit**

```bash
git add components/inbox/mensagem-thread.tsx
git commit -m "feat(inbox): render real media playback and group sender labels"
```
