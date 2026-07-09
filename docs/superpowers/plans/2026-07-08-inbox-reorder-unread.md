# Inbox: Reordenação em Tempo Real + Indicador de Não Lida Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o Inbox do CRM reordenar a lista de conversas instantaneamente (via Supabase Realtime) quando chega mensagem nova, e mostrar um indicador de não lida (nome em negrito + bolinha verde com contador) até a conversa ser aberta.

**Architecture:** Nova coluna `conversations.unread_count` incrementada atomicamente por uma função Postgres (`increment_unread_count`), chamada pelo webhook só no branch de mensagem recebida (nunca em `fromMe`). O CRM abre um canal Supabase Realtime (`postgres_changes` em `conversations`) que dispara o `refreshConversas()` já existente; o polling de 5s vira fallback de 20s. Abrir uma conversa zera o contador local imediatamente e persiste via server action.

**Tech Stack:** TypeScript, Supabase (Postgres + Realtime), Fastify, Next.js App Router (Client Components), Vitest (só no backend).

## Global Constraints

- Migration criada mas **não executada automaticamente** — só o arquivo `.sql` é gerado; o usuário roda manualmente no SQL Editor do Supabase.
- Nenhuma tarefa faz `git push` — só commits locais.
- `meu-crm` não tem framework de teste — verificação é `npx tsc --noEmit`, `npm run lint`, `npm run build`. Baseline conhecido (confirmado antes desta rodada): 1 erro pré-existente de tsc (`app/dashboard/funil/actions.ts(22)` TS2394) e 6 problemas de lint (1 erro `react-hooks/set-state-in-effect` em `inbox-panel.tsx:116` + 5 warnings de `<img>`) — nenhum deles é regressão sua, e nenhum bloqueia `npm run build` (build passa mesmo com o erro de lint).
- `agente-de-ia` tem vitest por workspace — TDD obrigatório lá. Baseline atual: 46 testes passando no monorepo (`npm test`), 19 em `apps/api`.
- Leitura é global/compartilhada (não por usuário) — decidido explicitamente no spec, não implementar escopo por vendedor.
- Só mensagens **recebidas** (`role: 'user'`) incrementam o contador; `fromMe` nunca incrementa.

---

### Task 1: Backend — schema, RPC atômica e incremento no webhook

**Repo:** `C:\Users\rgrasso\agente de ia` (branch `master`)

**Files:**
- Create: `supabase/migrations/20260707_conversations_unread_count.sql`
- Modify: `packages/db/src/types.ts` (`Conversation` + `Database.public.Functions`)
- Modify: `apps/api/src/routes/webhook.ts`
- Modify: `apps/api/src/__tests__/webhook.test.ts`

**Interfaces:**
- Produces: coluna `conversations.unread_count` (integer, default 0) e função Postgres `increment_unread_count(conv_id uuid)` — consumidos pelo CRM via Supabase direto (repo separado).
- Produces: `Database['public']['Functions']['increment_unread_count']` — tipagem usada só dentro deste repo para `db.rpc(...)` ter autocomplete/checagem de tipo.

- [ ] **Step 1: Escrever a migration**

Crie `supabase/migrations/20260707_conversations_unread_count.sql`:

```sql
-- Adds an unread-message counter to conversations, incremented atomically by
-- increment_unread_count() so concurrent webhook deliveries (e.g. a burst of
-- group messages) never lose an increment to a read-then-write race in JS.
alter table conversations add column if not exists unread_count integer not null default 0;

create or replace function increment_unread_count(conv_id uuid)
returns void as $$
  update conversations set unread_count = unread_count + 1 where id = conv_id;
$$ language sql;
```

- [ ] **Step 2: Atualizar `packages/db/src/types.ts`**

Troque a interface `Conversation`:

```ts
export interface Conversation {
  id: string
  contact_id: string
  instance_id: string
  agent_id: string | null
  status: ConversationStatus
  last_message_at: string | null
  agent_triggered: boolean
  created_at: string
}
```

por:

```ts
export interface Conversation {
  id: string
  contact_id: string
  instance_id: string
  agent_id: string | null
  status: ConversationStatus
  last_message_at: string | null
  agent_triggered: boolean
  unread_count: number
  created_at: string
}
```

Troque:

```ts
    Views: { [K in never]: never }
    Functions: { [K in never]: never }
    Enums: { [K in never]: never }
  }
}
```

por:

```ts
    Views: { [K in never]: never }
    Functions: {
      increment_unread_count: {
        Args: { conv_id: string }
        Returns: void
      }
    }
    Enums: { [K in never]: never }
  }
}
```

- [ ] **Step 3: Escrever os testes que falham para o incremento no webhook**

Em `apps/api/src/__tests__/webhook.test.ts`, troque `makeMockDb`:

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
  const rpc = vi.fn(async () => ({ data: null, error: null }))
  return { db: { from, storage, rpc } as unknown as SupabaseClient<Database>, messagesUpsert, messagesUpdate, update, upload, rpc, state }
}
```

Adicione estes testes no final do arquivo, antes do `})` final de `describe('POST /webhook', ...)` (depois do teste `'fetches and stores media for non-text messages'`):

```ts

  it('increments unread_count when a message is received from the contact', async () => {
    const { app, rpc } = await buildApp()
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload: VALID_PAYLOAD,
    })
    expect(res.statusCode).toBe(200)
    expect(rpc).toHaveBeenCalledWith('increment_unread_count', { conv_id: 'conv-1' })
  })

  it('does not increment unread_count for fromMe messages', async () => {
    const { app, rpc } = await buildApp()
    const payload = { ...VALID_PAYLOAD, data: { ...VALID_PAYLOAD.data, key: { ...VALID_PAYLOAD.data.key, fromMe: true } } }
    const res = await app.inject({
      method: 'POST', url: '/webhook',
      headers: { apikey: 'correct-secret' },
      payload,
    })
    expect(res.statusCode).toBe(200)
    expect(rpc).not.toHaveBeenCalled()
  })
```

- [ ] **Step 4: Rodar os testes e confirmar que falham**

Run: `npm run test --workspace=apps/api`
Expected: FAIL — o primeiro teste novo falha porque `webhook.ts` ainda não chama `db.rpc('increment_unread_count', ...)`.

- [ ] **Step 5: Ligar o incremento no webhook**

Em `apps/api/src/routes/webhook.ts`, troque:

```ts
    // If ignoreDuplicates skipped the insert (message already exists), don't re-enqueue
    if (!upserted) return reply.status(200).send({ ok: true, skipped: 'duplicate' })

    await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)

    // Fire-and-forget: fetchAndStoreMedia never throws (it has its own internal try/catch), and
    // the webhook must respond quickly regardless of how long the media download/upload takes —
    // waiting here risks Evolution API treating a slow response as a timeout and retrying delivery.
    if (!isText) void fetchAndStoreMedia(db, payload.instance, payload.data.key.id, upserted.id)
```

por:

```ts
    // If ignoreDuplicates skipped the insert (message already exists), don't re-enqueue
    if (!upserted) return reply.status(200).send({ ok: true, skipped: 'duplicate' })

    await db.from('conversations').update({ last_message_at: new Date().toISOString() }).eq('id', conversation.id)

    // Atomic increment (Postgres function) — a plain read-then-write in JS would lose
    // increments if two messages (e.g. a group burst) arrive nearly simultaneously.
    // Fast and synchronous, unlike the media fetch below: no need to fire-and-forget it.
    await db.rpc('increment_unread_count', { conv_id: conversation.id })

    // Fire-and-forget: fetchAndStoreMedia never throws (it has its own internal try/catch), and
    // the webhook must respond quickly regardless of how long the media download/upload takes —
    // waiting here risks Evolution API treating a slow response as a timeout and retrying delivery.
    if (!isText) void fetchAndStoreMedia(db, payload.instance, payload.data.key.id, upserted.id)
```

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `npm run test --workspace=apps/api`
Expected: PASS — todos os testes do arquivo, incluindo os 2 novos (17 testes no arquivo, 21 no workspace `apps/api`).

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck --workspace=apps/api && npm run typecheck --workspace=packages/db`
Expected: sem erros. Se `packages/db/dist` estiver stale, rode `npm run build --workspace=packages/db` primeiro.

- [ ] **Step 8: Rodar a suíte completa do monorepo**

Run: `npm test`
Expected: todos os testes passando — baseline era 46, deve sobrar 48 (46 + 2 novos), sem regressão.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260707_conversations_unread_count.sql packages/db/src/types.ts apps/api/src/routes/webhook.ts apps/api/src/__tests__/webhook.test.ts
git commit -m "feat(webhook): atomically increment unread_count on incoming messages"
```

---

### Task 2: CRM — tipo `Conversa.unread_count` e server action `marcarComoLida`

**Repo:** `C:\Users\rgrasso\claude teste\meu-crm` (branch `main`)

**Files:**
- Modify: `lib/types.ts`
- Modify: `app/dashboard/inbox/actions.ts`

**Interfaces:**
- Produces: `Conversa.unread_count: number` — consumido pelas Tasks 3 e 4.
- Produces: `marcarComoLida(conversationId: string): Promise<void>` — consumido pela Task 4.
- Não depende da Task 1 ter rodado no banco: `createAdminClient()` não é tipado com um `Database` genérico (cliente Supabase plano), então nenhuma checagem de tipo trava por causa da migration ainda não ter sido aplicada. `getConversacoes` já faz `.select('*, ...)` em `conversations`, então `unread_count` volta automaticamente assim que a coluna existir — não precisa mexer no `.select()`.

- [ ] **Step 1: Adicionar `unread_count` em `Conversa`**

Em `lib/types.ts`, troque:

```ts
export interface Conversa {
  id: string
  contact_id: string
  instance_id: string
  agent_id: string | null
  status: 'active' | 'closed' | 'paused'
  last_message_at: string | null
  created_at: string
  contacts: { phone: string; name: string | null; profile_picture_url: string | null; is_group: boolean; notes: string | null } | null
  instances: { name: string; evolution_instance_name: string } | null
  agents: { name: string } | null
}
```

por:

```ts
export interface Conversa {
  id: string
  contact_id: string
  instance_id: string
  agent_id: string | null
  status: 'active' | 'closed' | 'paused'
  last_message_at: string | null
  unread_count: number
  created_at: string
  contacts: { phone: string; name: string | null; profile_picture_url: string | null; is_group: boolean; notes: string | null } | null
  instances: { name: string; evolution_instance_name: string } | null
  agents: { name: string } | null
}
```

- [ ] **Step 2: Adicionar a server action `marcarComoLida`**

Em `app/dashboard/inbox/actions.ts`, troque:

```ts
export async function resumeConversa(conversationId: string) {
  const supabase = createAdminClient()
  await supabase.from('conversations').update({ status: 'active' }).eq('id', conversationId)
}
```

por:

```ts
export async function resumeConversa(conversationId: string) {
  const supabase = createAdminClient()
  await supabase.from('conversations').update({ status: 'active' }).eq('id', conversationId)
}

export async function marcarComoLida(conversationId: string) {
  const supabase = createAdminClient()
  await supabase.from('conversations').update({ unread_count: 0 }).eq('id', conversationId)
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: mesmo erro pré-existente conhecido (`app/dashboard/funil/actions.ts(22)` TS2394) e nenhum erro novo.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: mesma contagem do baseline (6 problemas: 1 erro + 5 warnings), nenhum novo.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: sucesso.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts app/dashboard/inbox/actions.ts
git commit -m "feat(inbox): add unread_count type and marcarComoLida server action"
```

---

### Task 3: CRM — indicador visual de não lida na lista

**Repo:** `C:\Users\rgrasso\claude teste\meu-crm` (branch `main`)

**Depends on:** Task 2 (mesmo repo, roda depois pra evitar conflito de working tree — usa `Conversa.unread_count`).

**Files:**
- Modify: `components/inbox/conversa-lista.tsx`

**Interfaces:**
- Consumes: `Conversa.unread_count` (Task 2).

- [ ] **Step 1: Nome em negrito + bolinha de contador quando há não lidas**

Em `components/inbox/conversa-lista.tsx`, troque:

```tsx
      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <p className={cn('text-sm font-semibold truncate', isSelected ? 'text-blue-900' : 'text-gray-900')}>
            {contactName}
          </p>
          <span className="text-xs text-gray-400 shrink-0">{timeLabel}</span>
        </div>
        <div className="flex items-center gap-1.5">
```

por:

```tsx
      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <p className={cn(
            'text-sm truncate',
            c.unread_count > 0 ? 'font-bold' : 'font-semibold',
            isSelected ? 'text-blue-900' : 'text-gray-900'
          )}>
            {contactName}
          </p>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs text-gray-400">{timeLabel}</span>
            {c.unread_count > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center">
                {c.unread_count > 99 ? '99+' : c.unread_count}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: mesmo erro pré-existente conhecido e nenhum erro novo.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: mesma contagem do baseline.

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: sucesso.

- [ ] **Step 5: Commit**

```bash
git add components/inbox/conversa-lista.tsx
git commit -m "feat(inbox): show bold name and unread badge in conversation list"
```

---

### Task 4: CRM — Realtime, reordenação instantânea e marcar como lida

**Repo:** `C:\Users\rgrasso\claude teste\meu-crm` (branch `main`)

**Depends on:** Task 2 (usa `marcarComoLida`). Sequencial no mesmo repo — roda depois da Task 3 pra evitar conflito de working tree, mas não depende logicamente dela.

**Files:**
- Modify: `components/inbox/inbox-panel.tsx`

**Interfaces:**
- Consumes: `marcarComoLida(conversationId: string): Promise<void>` (Task 2); `createClient()` de `@/lib/supabase/client` (já existe no repo, usado em `components/dashboard/notificacoes-bell.tsx` com o mesmo padrão `channel().on('postgres_changes', ...).subscribe()` / `removeChannel`).

- [ ] **Step 1: Importar `marcarComoLida` e o client Supabase do navegador**

Em `components/inbox/inbox-panel.tsx`, troque:

```tsx
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Conversa, Mensagem } from '@/lib/types'
import { getMensagens, getConversacoes, pauseConversa, resumeConversa } from '@/app/dashboard/inbox/actions'
import { ConversaLista } from './conversa-lista'
import { MensagemThread } from './mensagem-thread'
```

por:

```tsx
'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Conversa, Mensagem } from '@/lib/types'
import { getMensagens, getConversacoes, pauseConversa, resumeConversa, marcarComoLida } from '@/app/dashboard/inbox/actions'
import { createClient } from '@/lib/supabase/client'
import { ConversaLista } from './conversa-lista'
import { MensagemThread } from './mensagem-thread'
```

- [ ] **Step 2: Adicionar um ref espelhando `selectedId`**

Troque:

```tsx
  const nextOffsetRef = useRef(initialNextOffset)
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (!initialPhone) return null
    return initialConversas.find(c => c.contacts?.phone === initialPhone)?.id ?? null
  })
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [loading, setLoading] = useState(false)
```

por:

```tsx
  const nextOffsetRef = useRef(initialNextOffset)
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    if (!initialPhone) return null
    return initialConversas.find(c => c.contacts?.phone === initialPhone)?.id ?? null
  })
  // Espelha selectedId para o listener do Realtime, registrado uma única vez
  // (deps vazio) e que não pode depender de state fechado no momento do subscribe.
  const selectedIdRef = useRef(selectedId)
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])
  const [mensagens, setMensagens] = useState<Mensagem[]>([])
  const [loading, setLoading] = useState(false)
```

- [ ] **Step 3: Polling vira fallback (20s) e adicionar o canal Realtime**

Troque:

```tsx
  // Poll conversation list every 5s
  useEffect(() => {
    const interval = setInterval(refreshConversas, 5000)
    return () => clearInterval(interval)
  }, [refreshConversas])
```

por:

```tsx
  // Fallback de polling — o Realtime abaixo cobre a atualização em tempo real;
  // isso só existe para corrigir a lista se o websocket cair sem avisar.
  useEffect(() => {
    const interval = setInterval(refreshConversas, 20000)
    return () => clearInterval(interval)
  }, [refreshConversas])

  // Realtime: qualquer INSERT (conversa nova) ou UPDATE (nova mensagem, status,
  // unread_count etc.) em `conversations` dispara um refresh imediato da lista,
  // sem esperar o polling de fallback. Sem filtro por instância — a Inbox já
  // mostra todas.
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('inbox-conversas')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'conversations' }, () => {
        refreshConversas()
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, (payload) => {
        refreshConversas()
        // Conversa já aberta recebendo mensagem nova: o unread_count sobe no banco
        // (o webhook já incrementou) e o refresh acima traria ele de volta pra tela —
        // zera de novo aqui, na sequência, pra nunca aparecer visualmente na conversa aberta.
        const updatedId = (payload.new as { id?: string } | null)?.id
        if (updatedId && updatedId === selectedIdRef.current) {
          void marcarComoLida(updatedId)
        }
      })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [refreshConversas])
```

- [ ] **Step 4: Zerar o badge ao abrir a conversa (otimista + persistido)**

Troque:

```tsx
  function updateLocalContact(conversaId: string, name: string, notes: string | null) {
    setConversas(prev => prev.map(c =>
      c.id === conversaId && c.contacts
        ? { ...c, contacts: { ...c.contacts, name, notes } }
        : c
    ))
  }
```

por:

```tsx
  function updateLocalContact(conversaId: string, name: string, notes: string | null) {
    setConversas(prev => prev.map(c =>
      c.id === conversaId && c.contacts
        ? { ...c, contacts: { ...c.contacts, name, notes } }
        : c
    ))
  }

  // Zera o badge na hora (sem esperar o próximo evento/poll) e persiste no banco
  // em paralelo — mesmo padrão otimista de updateLocalStatus.
  function handleSelect(id: string) {
    setSelectedId(id)
    setMensagens([])
    setConversas(prev => prev.map(c => c.id === id ? { ...c, unread_count: 0 } : c))
    void marcarComoLida(id)
  }
```

- [ ] **Step 5: Usar `handleSelect` no lugar do `onSelect` inline**

Troque:

```tsx
        onSelect={(id) => {
          setSelectedId(id)
          setMensagens([])
        }}
```

por:

```tsx
        onSelect={handleSelect}
```

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: mesmo erro pré-existente conhecido e nenhum erro novo.

- [ ] **Step 7: Lint**

Run: `npm run lint`
Expected: mesma contagem do baseline (6 problemas — o erro pré-existente é neste mesmo arquivo, `inbox-panel.tsx:116`, mas em outro `useEffect`; não deve virar 2 erros. Se o novo `useEffect` do Step 2 disparar o mesmo `react-hooks/set-state-in-effect`, ele está fazendo apenas uma atribuição de ref — refs não passam por `setState`, então não deve disparar a regra. Se disparar mesmo assim, é regressão sua: ajuste antes de prosseguir).

- [ ] **Step 8: Build**

Run: `npm run build`
Expected: sucesso.

- [ ] **Step 9: Verificação manual (se houver navegador disponível)**

1. Abra o Inbox em duas abas do navegador. Envie uma mensagem de um número de teste para o WhatsApp conectado.
2. Confirme que a conversa sobe para o topo da lista em ambas as abas quase instantaneamente (sem esperar 20s).
3. Confirme que o nome fica em negrito e aparece a bolinha verde com o contador na aba onde a conversa não foi aberta.
4. Abra a conversa em uma das abas — confirme que o badge some imediatamente nessa aba, e (após o próximo refresh) também na outra aba.
5. Com a conversa já aberta numa aba, envie outra mensagem do mesmo contato — confirme que o badge não pisca/aparece nessa aba (fica sempre zerado).
6. Repita rapidamente com uma conversa de grupo (mensagem de um participante) — mesmo comportamento.

Se não houver navegador disponível, pule este step e reporte explicitamente que não foi feito. Se o Realtime não disparar (ex: RLS bloqueando o evento para a anon key), o fallback de 20s ainda deve reordenar a lista — nesse caso, reporte como observação em vez de bloquear a task, mas avise o usuário.

- [ ] **Step 10: Commit**

```bash
git add components/inbox/inbox-panel.tsx
git commit -m "feat(inbox): reorder conversations via Realtime and clear unread on open"
```
