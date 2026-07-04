# Edição de Contato + Nota Interna Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir editar o nome de um contato do Inbox (sincronizado com o Cliente correspondente por telefone) e registrar uma nota interna por contato, sem que o nome editado manualmente seja sobrescrito pelo próximo `pushName` recebido do WhatsApp.

**Architecture:** Duas colunas novas em `contacts` (`notes`, `name_edited_by_user`) num schema Supabase compartilhado por dois repositórios independentes. O repo `agente-de-ia` (backend Fastify + BullMQ) ganha a migration e um ajuste em `getOrCreateContact` para respeitar nomes editados manualmente. O repo `meu-crm` (Next.js) ganha uma server action e um diálogo de edição no cabeçalho da conversa do Inbox.

**Tech Stack:** TypeScript, Supabase (Postgres), Fastify, Next.js App Router, Vitest (só no backend — o CRM não tem framework de teste configurado).

## Global Constraints

- Migration segue o padrão `supabase/migrations/YYYYMMDD_descricao.sql` do repo `agente-de-ia`, com `add column if not exists` (ver `20260630_contacts_profile_picture.sql` e `20260704_contacts_is_group.sql` para o estilo).
- A migration **não é executada automaticamente** — só o arquivo `.sql` é criado; o usuário roda manualmente no SQL Editor do Supabase antes do deploy do backend novo.
- Nenhuma tarefa faz `git push` — só commits locais.
- Nenhum teste automatizado novo no repo `meu-crm` (sem framework configurado) — verificação ali é `npx tsc --noEmit`, `npm run lint`, `npm run build`, mais leitura/trace manual do fluxo.

---

### Task 1: Backend — migration + nome não sobrescrito após edição manual

**Repo:** `C:\Users\rgrasso\agente de ia` (branch `master`)

**Files:**
- Create: `supabase/migrations/20260704_contacts_notes.sql`
- Modify: `packages/db/src/types.ts:37-44` (interface `Contact`) e `packages/db/src/types.ts:136-141` (bloco `contacts` do `Database`)
- Modify: `packages/db/src/queries/contacts.ts:19-32` (`getOrCreateContact`)
- Test: `packages/db/src/__tests__/queries.test.ts`

**Interfaces:**
- Produces: `Contact.notes: string | null`, `Contact.name_edited_by_user: boolean` — usados pelo Task 2 (CRM) apenas como colunas de tabela via Supabase, não como import de tipo (repos são independentes, sem package compartilhado entre eles).
- Produces: `getOrCreateContact(db, instanceId, phone, name?, isGroup?)` mantém a mesma assinatura — só muda o comportamento interno.

- [ ] **Step 1: Escrever a migration**

Crie `supabase/migrations/20260704_contacts_notes.sql`:

```sql
-- Adds internal notes and a flag marking when a contact's name was set
-- manually via the CRM. Once set, getOrCreateContact stops overwriting the
-- name with the WhatsApp pushName on incoming messages.
alter table contacts add column if not exists notes text;
alter table contacts add column if not exists name_edited_by_user boolean not null default false;
```

- [ ] **Step 2: Atualizar os tipos em `packages/db/src/types.ts`**

Troque a interface `Contact` (linhas 37-44):

```ts
export interface Contact {
  id: string
  instance_id: string
  phone: string
  name: string | null
  profile_picture_url: string | null
  is_group: boolean
  created_at: string
```

por:

```ts
export interface Contact {
  id: string
  instance_id: string
  phone: string
  name: string | null
  profile_picture_url: string | null
  is_group: boolean
  notes: string | null
  name_edited_by_user: boolean
  created_at: string
```

Troque o bloco `contacts` dentro de `Database` (linhas 136-141):

```ts
      contacts: {
        Row: { [K in keyof Contact]: Contact[K] }
        Insert: Omit<Contact, 'id' | 'created_at' | 'profile_picture_url' | 'is_group'> & { profile_picture_url?: string | null; is_group?: boolean }
        Update: Partial<Omit<Contact, 'id' | 'created_at'>>
        Relationships: Relationship[]
      }
```

por:

```ts
      contacts: {
        Row: { [K in keyof Contact]: Contact[K] }
        Insert: Omit<Contact, 'id' | 'created_at' | 'profile_picture_url' | 'is_group' | 'notes' | 'name_edited_by_user'> & { profile_picture_url?: string | null; is_group?: boolean; notes?: string | null; name_edited_by_user?: boolean }
        Update: Partial<Omit<Contact, 'id' | 'created_at'>>
        Relationships: Relationship[]
      }
```

- [ ] **Step 3: Escrever os testes que falham para `getOrCreateContact`**

Em `packages/db/src/__tests__/queries.test.ts`, troque a linha de import do topo:

```ts
import type { Database, Instance, Agent, Message } from '../types.js'
```

por:

```ts
import type { Database, Instance, Agent, Message, Contact } from '../types.js'
```

Adicione este bloco no final do arquivo (depois de `describe('updateMessageStatus', ...)`):

```ts
describe('getOrCreateContact', () => {
  it('does not overwrite name when name_edited_by_user is true', async () => {
    const { getOrCreateContact } = await import('../queries/contacts.js')
    const existing: Contact = {
      id: 'contact-1', instance_id: 'inst-1', phone: '5511999998888',
      name: 'Nome Editado Manualmente', profile_picture_url: null, is_group: false,
      notes: null, name_edited_by_user: true, created_at: '2026-01-01T00:00:00Z',
    }
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
      update: vi.fn().mockReturnThis(),
      single: vi.fn(),
    }
    const result = await getOrCreateContact(makeDb(chain), 'inst-1', '5511999998888', 'PushName Novo')
    expect(result).toEqual(existing)
    expect(chain.update).not.toHaveBeenCalled()
  })

  it('overwrites name from pushName when name_edited_by_user is false', async () => {
    const { getOrCreateContact } = await import('../queries/contacts.js')
    const existing: Contact = {
      id: 'contact-1', instance_id: 'inst-1', phone: '5511999998888',
      name: 'Nome Antigo', profile_picture_url: null, is_group: false,
      notes: null, name_edited_by_user: false, created_at: '2026-01-01T00:00:00Z',
    }
    const updated: Contact = { ...existing, name: 'PushName Novo' }
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: existing, error: null }),
      update: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: updated, error: null }),
    }
    const result = await getOrCreateContact(makeDb(chain), 'inst-1', '5511999998888', 'PushName Novo')
    expect(result).toEqual(updated)
    expect(chain.update).toHaveBeenCalledWith({ name: 'PushName Novo' })
  })
})
```

- [ ] **Step 4: Rodar os testes e confirmar que falham**

Run: `npm run test --workspace=packages/db`
Expected: FAIL — o primeiro teste novo falha porque `getOrCreateContact` hoje sempre chama `update` quando `name !== existing.name`, então `chain.update` É chamado (o teste espera que não seja).

- [ ] **Step 5: Implementar a checagem de `name_edited_by_user`**

Em `packages/db/src/queries/contacts.ts`, troque:

```ts
  if (existing) {
    // Always update name when caller has one — name is only passed for fromMe:false messages
    // so it is always the real contact display name, never the business owner's name
    if (name && name !== existing.name) {
```

por:

```ts
  if (existing) {
    // Always update name when caller has one — name is only passed for fromMe:false messages
    // so it is always the real contact display name, never the business owner's name.
    // Skip when the CRM user has manually set a name — a manual edit must stick even
    // after a new message arrives with a different pushName.
    if (name && name !== existing.name && !existing.name_edited_by_user) {
```

(o resto da função não muda)

- [ ] **Step 6: Rodar os testes e confirmar que passam**

Run: `npm run test --workspace=packages/db`
Expected: PASS — todos os testes do arquivo, incluindo os dois novos.

- [ ] **Step 7: Typecheck do workspace**

Run: `npm run typecheck --workspace=packages/db`
Expected: sem erros. Se `packages/db/dist` estiver stale (erro em outro workspace que importa `@agente/db`), rode `npm run build --workspace=packages/db` primeiro.

- [ ] **Step 8: Rodar a suíte completa do monorepo**

Run: `npm test`
Expected: todos os testes passando (o baseline no início desta tarefa já estava com 37 testes passando — não pode haver regressão).

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/20260704_contacts_notes.sql packages/db/src/types.ts packages/db/src/queries/contacts.ts packages/db/src/__tests__/queries.test.ts
git commit -m "feat(db): add contact notes and lock name after manual edit"
```

---

### Task 2: CRM — server action para editar nome e nota do contato

**Repo:** `C:\Users\rgrasso\claude teste\meu-crm` (branch `main`)

**Depends on:** Task 1 (a coluna `notes` e `name_edited_by_user` precisam existir no schema para os campos fazerem sentido — mas o código deste Task compila e roda independente de a migration já ter sido aplicada em produção, porque o cliente Supabase usado aqui (`createAdminClient()`) não é tipado com um `Database` generic).

**Files:**
- Modify: `lib/types.ts:80-88` (`Contato`) e `lib/types.ts:90-101` (`Conversa.contacts`)
- Modify: `app/dashboard/inbox/actions.ts:10-25` (select de `getConversacoes`) e novo export no final do arquivo

**Interfaces:**
- Produces: `updateContactDetails(contactId: string, phone: string, name: string, notes: string | null): Promise<void>` — usado pelo Task 3.
- Produces: `Conversa.contacts` passa a incluir `notes: string | null` — usado pelo Task 3 para pré-preencher o diálogo.

- [ ] **Step 1: Adicionar `notes` aos tipos**

Em `lib/types.ts`, troque:

```ts
export interface Contato {
  id: string
  instance_id: string
  phone: string
  name: string | null
  profile_picture_url: string | null
  is_group: boolean
  created_at: string
}
```

por:

```ts
export interface Contato {
  id: string
  instance_id: string
  phone: string
  name: string | null
  profile_picture_url: string | null
  is_group: boolean
  notes: string | null
  created_at: string
}
```

E troque a linha do campo `contacts` dentro de `Conversa`:

```ts
  contacts: { phone: string; name: string | null; profile_picture_url: string | null; is_group: boolean } | null
```

por:

```ts
  contacts: { phone: string; name: string | null; profile_picture_url: string | null; is_group: boolean; notes: string | null } | null
```

- [ ] **Step 2: Incluir `notes` no select de `getConversacoes`**

Em `app/dashboard/inbox/actions.ts`, troque:

```ts
    .select('*, contacts!inner(phone, name, profile_picture_url, is_group), instances(name, evolution_instance_name), agents(name)')
```

por:

```ts
    .select('*, contacts!inner(phone, name, profile_picture_url, is_group, notes), instances(name, evolution_instance_name), agents(name)')
```

- [ ] **Step 3: Adicionar a server action `updateContactDetails`**

No final de `app/dashboard/inbox/actions.ts`, adicione:

```ts
export async function updateContactDetails(
  contactId: string,
  phone: string,
  name: string,
  notes: string | null,
) {
  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('Nome não pode ser vazio')

  const supabase = createAdminClient()

  await supabase
    .from('contacts')
    .update({ name: trimmedName, notes, name_edited_by_user: true })
    .eq('id', contactId)

  // Só atualiza o Cliente do funil se já existir um vinculado a este telefone —
  // edição de nome no Inbox nunca cria Cliente novo (isso é papel do botão "Funil").
  // update() sem match simplesmente não afeta nenhuma linha, sem erro.
  await supabase
    .from('clientes')
    .update({ nome: trimmedName })
    .eq('telefone', phone)

  revalidatePath('/dashboard/inbox')
}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: mesmo erro pré-existente já conhecido (`app/dashboard/funil/actions.ts(22)` TS2394) e nenhum erro novo.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: mesma contagem de problemas do baseline (1 erro `react-hooks/set-state-in-effect` pré-existente + warnings de `no-img-element`/`no-unused-vars` pré-existentes), nenhum novo.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts app/dashboard/inbox/actions.ts
git commit -m "feat(inbox): add updateContactDetails server action"
```

---

### Task 3: CRM — diálogo de edição no cabeçalho da conversa

**Repo:** `C:\Users\rgrasso\claude teste\meu-crm` (branch `main`)

**Depends on:** Task 2 (usa `updateContactDetails` e o campo `notes` em `Conversa.contacts`).

**Files:**
- Create: `components/inbox/editar-contato-dialog.tsx`
- Modify: `components/inbox/mensagem-thread.tsx` (import, header, props)
- Modify: `components/inbox/inbox-panel.tsx` (estado local + prop nova)

**Interfaces:**
- Consumes: `updateContactDetails` de `@/app/dashboard/inbox/actions` (Task 2); `Dialog`/`DialogContent`/`DialogHeader`/`DialogTitle`/`DialogTrigger` de `@/components/ui/dialog`; `Input`/`Label` de `@/components/ui/input` e `@/components/ui/label`.
- Produces: componente `EditarContatoDialog` com props `{ contactId: string; phone: string; currentName: string; currentNotes: string | null; onSaved: (name: string, notes: string | null) => void }`.

- [ ] **Step 1: Criar o componente `EditarContatoDialog`**

Crie `components/inbox/editar-contato-dialog.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { Pencil } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { updateContactDetails } from '@/app/dashboard/inbox/actions'

interface Props {
  contactId: string
  phone: string
  currentName: string
  currentNotes: string | null
  onSaved: (name: string, notes: string | null) => void
}

export function EditarContatoDialog({ contactId, phone, currentName, currentNotes, onSaved }: Props) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(currentName)
  const [notes, setNotes] = useState(currentNotes ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleOpen(v: boolean) {
    setOpen(v)
    if (v) {
      setName(currentName)
      setNotes(currentNotes ?? '')
      setError(null)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Nome não pode ser vazio')
      return
    }
    startTransition(async () => {
      try {
        const finalNotes = notes.trim() || null
        await updateContactDetails(contactId, phone, trimmed, finalNotes)
        onSaved(trimmed, finalNotes)
        setOpen(false)
      } catch {
        setError('Não foi possível salvar. Tente novamente.')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger
        render={
          <button
            title="Editar contato"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0"
          />
        }
      >
        <Pencil className="size-3.5" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar contato</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="econtato-nome">Nome</Label>
            <Input id="econtato-nome" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="econtato-notas">Nota interna</Label>
            <textarea
              id="econtato-notas"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              rows={4}
              placeholder="Visível só para a equipe"
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 text-sm rounded-lg border hover:bg-gray-50">Cancelar</button>
            <button type="submit" disabled={isPending} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
              {isPending ? 'Salvando...' : 'Salvar'}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Ligar o diálogo no cabeçalho de `mensagem-thread.tsx`**

Adicione o import no topo do arquivo (junto aos outros imports de componentes do Inbox):

```ts
import { EditarContatoDialog } from './editar-contato-dialog'
```

Troque a assinatura de `Props` (adicione o campo novo):

```ts
interface Props {
  conversa: Conversa | null
  mensagens: Mensagem[]
  loading: boolean
  onPause: () => Promise<void>
  onResume: () => Promise<void>
  onMessageSent: () => void
}
```

por:

```ts
interface Props {
  conversa: Conversa | null
  mensagens: Mensagem[]
  loading: boolean
  onPause: () => Promise<void>
  onResume: () => Promise<void>
  onMessageSent: () => void
  onContactUpdated: (conversaId: string, name: string, notes: string | null) => void
}
```

Troque a linha da função do componente:

```ts
export function MensagemThread({ conversa, mensagens, loading, onPause, onResume, onMessageSent }: Props) {
```

por:

```ts
export function MensagemThread({ conversa, mensagens, loading, onPause, onResume, onMessageSent, onContactUpdated }: Props) {
```

No header, troque o bloco do nome (dentro de `<div className="flex-1 min-w-0">`):

```tsx
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-gray-900 text-sm leading-tight">{displayName}</p>
```

por:

```tsx
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1">
            <p className="font-semibold text-gray-900 text-sm leading-tight truncate">{displayName}</p>
            <EditarContatoDialog
              contactId={conversa.contact_id}
              phone={phone}
              currentName={contactName}
              currentNotes={conversa.contacts?.notes ?? null}
              onSaved={(name, notes) => onContactUpdated(conversa.id, name, notes)}
            />
          </div>
```

(o restante do bloco, a partir de `<div className="flex items-center gap-2 mt-0.5">`, continua igual e fica dentro do mesmo `<div className="flex-1 min-w-0">` pai)

- [ ] **Step 3: Atualizar estado local em `inbox-panel.tsx`**

Adicione esta função depois de `updateLocalStatus`:

```ts
  function updateLocalContact(conversaId: string, name: string, notes: string | null) {
    setConversas(prev => prev.map(c =>
      c.id === conversaId && c.contacts
        ? { ...c, contacts: { ...c.contacts, name, notes } }
        : c
    ))
  }
```

Troque a chamada de `<MensagemThread .../>`:

```tsx
      <MensagemThread
        conversa={selectedConversa}
        mensagens={mensagens}
        loading={loading}
        onPause={handlePause}
        onResume={handleResume}
        onMessageSent={() => selectedId && loadMessages(selectedId)}
      />
```

por:

```tsx
      <MensagemThread
        conversa={selectedConversa}
        mensagens={mensagens}
        loading={loading}
        onPause={handlePause}
        onResume={handleResume}
        onMessageSent={() => selectedId && loadMessages(selectedId)}
        onContactUpdated={updateLocalContact}
      />
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: mesmo erro pré-existente já conhecido (`app/dashboard/funil/actions.ts(22)` TS2394) e nenhum erro novo.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: mesma contagem de problemas do baseline, nenhum novo introduzido pelos arquivos desta tarefa.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: build conclui sem erro.

- [ ] **Step 7: Verificação manual do fluxo (se houver ambiente para rodar `npm run dev`)**

Abra o Inbox, selecione uma conversa, clique no lápis ao lado do nome no cabeçalho:
1. Digite um nome novo e uma nota, salve — confirme que o nome muda no cabeçalho E na lista de conversas à esquerda, sem precisar recarregar a página.
2. Reabra o diálogo do mesmo contato — confirme que Nome e Nota aparecem pré-preenchidos com o que foi salvo.
3. Tente salvar com o campo Nome vazio — confirme que aparece a mensagem de erro e o diálogo não fecha.
4. Repita o passo 1 numa conversa da aba "Grupos" — confirme que o diálogo abre e salva normalmente (o componente não faz nenhuma distinção entre contato individual e grupo).
Se não houver navegador disponível no ambiente de execução, pule este step e reporte explicitamente que a verificação em navegador não foi feita — não afirme que o fluxo funciona sem tê-lo observado.

- [ ] **Step 8: Commit**

```bash
git add components/inbox/editar-contato-dialog.tsx components/inbox/mensagem-thread.tsx components/inbox/inbox-panel.tsx
git commit -m "feat(inbox): add contact edit dialog for name and internal notes"
```
