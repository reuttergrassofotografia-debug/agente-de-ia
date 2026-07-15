# CRM: Controle de Acesso por Vendedor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restringir de verdade quem vê o quê no Funil, Clientes e Inbox por vendedor — hoje a leitura é global pra todo mundo, só a escrita já era restrita (e nem isso distinguia gerente de vendedor). Gerente passa a enxergar o time inteiro, igual admin; só vendedor fica restrito ao que é seu.

**Architecture:** `negocios.responsavel_id` e `clientes.user_id` já existem — só falta aplicar o filtro na leitura e ampliar a checagem de escrita existente (`perfil !== 'admin'` vira `perfil === 'vendedor'`, já que agora gerente também tem acesso total). O Inbox não tinha nenhum conceito de dono — ganha uma coluna nova (`contacts.responsavel_id`, migration em `agente-de-ia`), atribuída automaticamente pro vendedor que primeiro responde uma conversa, com reatribuição manual por admin/gerente. De quebra, corrige um bug preexistente: o botão "Funil" do Inbox cria Cliente/Negócio sem dono nenhum.

**Tech Stack:** TypeScript, Next.js App Router (Server Actions + Server Components), Supabase (Postgres), PostgREST embeds aninhados (`contacts!inner(..., responsavel:responsavel_id(id, nome))`).

## Global Constraints

- Nenhuma task faz `git push` — só commits locais.
- `meu-crm` não tem framework de teste — verificação é `npx tsc --noEmit`, `npm run lint`, `npm run build`. Baseline conhecido (confirmado antes desta rodada): 1 erro pré-existente de tsc (`app/dashboard/funil/actions.ts(22)` TS2394) e 6 problemas de lint (1 erro `react-hooks/set-state-in-effect` em `components/inbox/inbox-panel.tsx` + 5 warnings de `<img>`) — nenhum deles é regressão sua.
- `agente-de-ia` tem vitest por workspace. A Task 1 (schema + tipos) não introduz nenhuma lógica nova nesse repo — não precisa de teste novo, só confirmar que a suíte completa (baseline: 48 testes) continua passando.
- **Regra de acesso, válida em todo o plano:** `admin` e `gerente` sempre veem/gerenciam tudo; só `perfil === 'vendedor'` é restrito ao que é seu. Em nenhum lugar deste plano a checagem deve ser `perfil !== 'admin'` — isso deixaria gerente restrito também, o que é o comportamento antigo que estamos corrigindo.
- Migration criada mas **não executada automaticamente** — só o arquivo `.sql` é gerado; o usuário roda manualmente no SQL Editor do Supabase.
- Nenhuma tabela além de `contacts`, `conversations` (leitura), `negocios` e `clientes` é tocada.

---

### Task 1: Backend — migration e tipos (`contacts.responsavel_id`)

**Repo:** `C:\Users\rgrasso\agente de ia` (branch `master`)

**Files:**
- Create: `supabase/migrations/20260712_contacts_responsavel.sql`
- Modify: `packages/db/src/types.ts`

**Interfaces:**
- Produces: coluna `contacts.responsavel_id` (uuid, nullable, FK pra `profiles(id)`) — consumida pelo CRM via Supabase direto (repo separado).
- Produces: `Contact.responsavel_id: string | null` e `Database.public.Tables.contacts.Insert` com `responsavel_id` opcional — usado só dentro deste repo, não é consumido pelo CRM (que usa um client Supabase sem o `Database` genérico).

- [ ] **Step 1: Escrever a migration**

Crie `supabase/migrations/20260712_contacts_responsavel.sql`:

```sql
-- Adds explicit salesperson ownership to WhatsApp contacts, so the CRM inbox
-- can be restricted per-vendedor. Nullable: a contact with no owner yet is
-- still visible to admin/gerente, just not to any vendedor until assigned
-- (automatically, on first reply sent via the CRM, or manually by admin/gerente).
alter table contacts add column if not exists responsavel_id uuid references profiles(id);
```

- [ ] **Step 2: Atualizar `packages/db/src/types.ts`**

Troque a interface `Contact`:

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
}
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
  responsavel_id: string | null
  created_at: string
}
```

Troque o bloco `contacts` dentro de `Database`:

```ts
      contacts: {
        Row: { [K in keyof Contact]: Contact[K] }
        Insert: Omit<Contact, 'id' | 'created_at' | 'profile_picture_url' | 'is_group' | 'notes' | 'name_edited_by_user'> & { profile_picture_url?: string | null; is_group?: boolean; notes?: string | null; name_edited_by_user?: boolean }
        Update: Partial<Omit<Contact, 'id' | 'created_at'>>
        Relationships: Relationship[]
      }
```

por:

```ts
      contacts: {
        Row: { [K in keyof Contact]: Contact[K] }
        Insert: Omit<Contact, 'id' | 'created_at' | 'profile_picture_url' | 'is_group' | 'notes' | 'name_edited_by_user' | 'responsavel_id'> & { profile_picture_url?: string | null; is_group?: boolean; notes?: string | null; name_edited_by_user?: boolean; responsavel_id?: string | null }
        Update: Partial<Omit<Contact, 'id' | 'created_at'>>
        Relationships: Relationship[]
      }
```

- [ ] **Step 3: Typecheck e build do workspace**

Run: `npm run typecheck --workspace=apps/api && npm run typecheck --workspace=packages/db`
Expected: sem erros. Se `packages/db/dist` estiver stale, rode `npm run build --workspace=packages/db` primeiro.

- [ ] **Step 4: Rodar a suíte completa do monorepo (regressão)**

Run: `npm test`
Expected: todos os 48 testes continuam passando — nenhum teste novo é esperado nesta task (nenhuma lógica nova foi adicionada, só schema e tipos).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260712_contacts_responsavel.sql packages/db/src/types.ts
git commit -m "feat(db): add contacts.responsavel_id for per-vendor inbox ownership"
```

---

### Task 2: CRM — tipos (`Conversa.contacts` ganha `responsavel_id`/`responsavel`)

**Repo:** `C:\Users\rgrasso\claude teste\meu-crm` (branch `main`)

**Files:**
- Modify: `lib/types.ts`

**Interfaces:**
- Produces: `Contato.responsavel_id: string | null`; `Conversa.contacts.responsavel_id: string | null` e `Conversa.contacts.responsavel: { id: string; nome: string | null } | null` — consumidos pelas Tasks 4 e 5.
- Não depende da Task 1 ter rodado no banco: o cliente admin do Supabase usado no CRM não é tipado com um `Database` genérico, então nenhuma checagem de tipo trava por causa da migration ainda não ter sido aplicada.

- [ ] **Step 1: Adicionar `responsavel_id` em `Contato`**

Em `lib/types.ts`, troque:

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
  responsavel_id: string | null
  created_at: string
}
```

- [ ] **Step 2: Adicionar `responsavel_id`/`responsavel` no `contacts` embutido de `Conversa`**

Troque:

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
  contacts: { phone: string; name: string | null; profile_picture_url: string | null; is_group: boolean; notes: string | null; responsavel_id: string | null; responsavel: { id: string; nome: string | null } | null } | null
  instances: { name: string; evolution_instance_name: string } | null
  agents: { name: string } | null
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
git add lib/types.ts
git commit -m "feat(inbox): add responsavel fields to Conversa/Contato types"
```

---

### Task 3: CRM — Funil e Clientes: leitura restrita, escrita ampliada pra gerente

**Repo:** `C:\Users\rgrasso\claude teste\meu-crm` (branch `main`)

**Depends on:** Task 2 (mesmo repo, roda depois pra evitar conflito de working tree). Não depende logicamente dela — `negocios.responsavel_id`/`clientes.user_id` já existem, essa task não toca `contacts`.

**Files:**
- Modify: `app/dashboard/funil/page.tsx`
- Modify: `app/dashboard/funil/actions.ts`
- Modify: `app/dashboard/clientes/page.tsx`
- Modify: `app/dashboard/clientes/actions.ts`

**Interfaces:**
- Não produz nem consome nada de outra task — mudança autocontida em `negocios`/`clientes`, tabelas que já tinham `responsavel_id`/`user_id`.

- [ ] **Step 1: Funil — restringir a leitura e ampliar a checagem de escrita**

Em `app/dashboard/funil/page.tsx`, troque o arquivo inteiro:

```tsx
import { createClient } from '@/lib/supabase/server'
import { KanbanBoard } from '@/components/funil/kanban-board'
import { Negocio, Cliente } from '@/lib/types'

export default async function FunilPage() {
  const supabase = await createClient()

  const [{ data: negocios }, { data: clientes }] = await Promise.all([
    supabase
      .from('negocios')
      .select('*, cliente:cliente_id(nome, telefone), responsavel:responsavel_id(nome)')
      .order('created_at', { ascending: false }),
    supabase
      .from('clientes')
      .select('id, nome, empresa, email, telefone, status, user_id, created_at, updated_at')
      .order('nome'),
  ])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Funil de Vendas</h2>
        <p className="text-gray-500 text-sm mt-1">
          Arraste os cards entre as colunas para atualizar o status dos negócios
        </p>
      </div>
      <KanbanBoard
        negocios={(negocios as Negocio[]) ?? []}
        clientes={(clientes as Cliente[]) ?? []}
      />
    </div>
  )
}
```

por:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { KanbanBoard } from '@/components/funil/kanban-board'
import { Negocio, Cliente } from '@/lib/types'

export default async function FunilPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: meuPerfil } = await supabase.from('profiles').select('perfil').eq('id', user.id).single()
  const souVendedor = (meuPerfil?.perfil ?? 'vendedor') === 'vendedor'

  let negociosQuery = supabase
    .from('negocios')
    .select('*, cliente:cliente_id(nome, telefone), responsavel:responsavel_id(nome)')
    .order('created_at', { ascending: false })
  if (souVendedor) negociosQuery = negociosQuery.eq('responsavel_id', user.id)

  let clientesQuery = supabase
    .from('clientes')
    .select('id, nome, empresa, email, telefone, status, user_id, created_at, updated_at')
    .order('nome')
  if (souVendedor) clientesQuery = clientesQuery.eq('user_id', user.id)

  const [{ data: negocios }, { data: clientes }] = await Promise.all([negociosQuery, clientesQuery])

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Funil de Vendas</h2>
        <p className="text-gray-500 text-sm mt-1">
          Arraste os cards entre as colunas para atualizar o status dos negócios
        </p>
      </div>
      <KanbanBoard
        negocios={(negocios as Negocio[]) ?? []}
        clientes={(clientes as Cliente[]) ?? []}
      />
    </div>
  )
}
```

(A lista de `clientes` desta página alimenta o dropdown de "vincular a um cliente existente" ao criar negócio — filtrar ela também impede o vendedor de vincular um negócio a um cliente que não é dele.)

- [ ] **Step 2: Funil actions — ampliar a checagem de escrita pra gerente**

Em `app/dashboard/funil/actions.ts`, troque:

```ts
  const perfil = await getPerfil(supabase, user.id)

  let query = supabase
    .from('negocios')
    .update({
      etapa: novaEtapa,
      motivo_encerramento: novaEtapa === 'encerrado' ? motivo : null,
    }, { count: 'exact' })
    .eq('id', id)

  if (perfil !== 'admin') {
    query = query.eq('responsavel_id', user.id)
  }
```

por:

```ts
  const perfil = await getPerfil(supabase, user.id)

  let query = supabase
    .from('negocios')
    .update({
      etapa: novaEtapa,
      motivo_encerramento: novaEtapa === 'encerrado' ? motivo : null,
    }, { count: 'exact' })
    .eq('id', id)

  if (perfil === 'vendedor') {
    query = query.eq('responsavel_id', user.id)
  }
```

Troque:

```ts
export async function atualizarNegocio(id: string, formData: FormData) {
  const { supabase, user } = await getAuthUser()
  const perfil = await getPerfil(supabase, user.id)
  const isAdmin = perfil === 'admin'

  const { titulo, valor, motivo_encerramento, cliente_id } =
    parseNegocioFields(formData, false)

  let query = supabase
    .from('negocios')
    .update({ titulo, valor, motivo_encerramento, cliente_id }, { count: 'exact' })
    .eq('id', id)

  if (!isAdmin) query = query.eq('responsavel_id', user.id)
```

por:

```ts
export async function atualizarNegocio(id: string, formData: FormData) {
  const { supabase, user } = await getAuthUser()
  const perfil = await getPerfil(supabase, user.id)
  const souVendedor = perfil === 'vendedor'

  const { titulo, valor, motivo_encerramento, cliente_id } =
    parseNegocioFields(formData, false)

  let query = supabase
    .from('negocios')
    .update({ titulo, valor, motivo_encerramento, cliente_id }, { count: 'exact' })
    .eq('id', id)

  if (souVendedor) query = query.eq('responsavel_id', user.id)
```

Troque:

```ts
export async function excluirNegocio(id: string) {
  const { supabase, user } = await getAuthUser()
  const perfil = await getPerfil(supabase, user.id)
  const isAdmin = perfil === 'admin'

  let query = supabase.from('negocios').delete({ count: 'exact' }).eq('id', id)
  if (!isAdmin) query = query.eq('responsavel_id', user.id)
```

por:

```ts
export async function excluirNegocio(id: string) {
  const { supabase, user } = await getAuthUser()
  const perfil = await getPerfil(supabase, user.id)
  const souVendedor = perfil === 'vendedor'

  let query = supabase.from('negocios').delete({ count: 'exact' }).eq('id', id)
  if (souVendedor) query = query.eq('responsavel_id', user.id)
```

- [ ] **Step 3: Clientes — restringir a leitura**

Em `app/dashboard/clientes/page.tsx`, troque:

```tsx
import { createClient } from '@/lib/supabase/server'
import { ClientesTable } from '@/components/clientes/clientes-table'
import { Cliente } from '@/lib/types'

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const supabase = await createClient()

  let query = supabase
    .from('clientes')
    .select('*')
    .order('created_at', { ascending: false })

  if (q) {
```

por:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { ClientesTable } from '@/components/clientes/clientes-table'
import { Cliente } from '@/lib/types'

export default async function ClientesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: meuPerfil } = await supabase.from('profiles').select('perfil').eq('id', user.id).single()
  const souVendedor = (meuPerfil?.perfil ?? 'vendedor') === 'vendedor'

  let query = supabase
    .from('clientes')
    .select('*')
    .order('created_at', { ascending: false })

  if (souVendedor) query = query.eq('user_id', user.id)

  if (q) {
```

(o restante do arquivo — o bloco de sanitização da busca `q` e o `return` — continua exatamente igual.)

- [ ] **Step 4: Clientes actions — ampliar a checagem de escrita pra gerente**

Em `app/dashboard/clientes/actions.ts`, troque:

```ts
export async function editarCliente(id: string, formData: FormData) {
  const { supabase, user } = await getAuthUser()
  const perfil = await getPerfil(supabase, user.id)
  const isAdmin = perfil === 'admin'

  const statusRaw = formData.get('status') as string
  const status: Status = STATUS_VALIDOS.includes(statusRaw as Status) ? (statusRaw as Status) : 'lead'

  let query = supabase.from('clientes').update({
    nome: (formData.get('nome') as string).trim(),
    empresa: (formData.get('empresa') as string)?.trim() || null,
    email: (formData.get('email') as string)?.trim() || null,
    telefone: (formData.get('telefone') as string)?.trim() || null,
    status,
  }, { count: 'exact' }).eq('id', id)

  if (!isAdmin) query = query.eq('user_id', user.id)
```

por:

```ts
export async function editarCliente(id: string, formData: FormData) {
  const { supabase, user } = await getAuthUser()
  const perfil = await getPerfil(supabase, user.id)
  const souVendedor = perfil === 'vendedor'

  const statusRaw = formData.get('status') as string
  const status: Status = STATUS_VALIDOS.includes(statusRaw as Status) ? (statusRaw as Status) : 'lead'

  let query = supabase.from('clientes').update({
    nome: (formData.get('nome') as string).trim(),
    empresa: (formData.get('empresa') as string)?.trim() || null,
    email: (formData.get('email') as string)?.trim() || null,
    telefone: (formData.get('telefone') as string)?.trim() || null,
    status,
  }, { count: 'exact' }).eq('id', id)

  if (souVendedor) query = query.eq('user_id', user.id)
```

Troque:

```ts
export async function excluirCliente(id: string) {
  const { supabase, user } = await getAuthUser()
  const perfil = await getPerfil(supabase, user.id)
  const isAdmin = perfil === 'admin'

  let query = supabase.from('clientes').delete({ count: 'exact' }).eq('id', id)
  if (!isAdmin) query = query.eq('user_id', user.id)
```

por:

```ts
export async function excluirCliente(id: string) {
  const { supabase, user } = await getAuthUser()
  const perfil = await getPerfil(supabase, user.id)
  const souVendedor = perfil === 'vendedor'

  let query = supabase.from('clientes').delete({ count: 'exact' }).eq('id', id)
  if (souVendedor) query = query.eq('user_id', user.id)
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: mesmo erro pré-existente conhecido e nenhum erro novo.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: mesma contagem do baseline.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: sucesso.

- [ ] **Step 8: Commit**

```bash
git add app/dashboard/funil/page.tsx app/dashboard/funil/actions.ts app/dashboard/clientes/page.tsx app/dashboard/clientes/actions.ts
git commit -m "feat(funil,clientes): restrict read access and widen write access for gerente"
```

---

### Task 4: CRM — Inbox backend: leitura restrita, atribuição automática, reatribuição, corrige `adicionarAoFunil`

**Repo:** `C:\Users\rgrasso\claude teste\meu-crm` (branch `main`)

**Depends on:** Task 2 (`Conversa.contacts.responsavel_id`/`responsavel`), Task 3 (mesmo repo, roda depois pra evitar conflito de working tree — não depende logicamente dela).

**Files:**
- Modify: `app/dashboard/inbox/actions.ts`

**Interfaces:**
- Produces: `reatribuirConversa(contactId: string, novoResponsavelId: string | null): Promise<void>` — lança erro se falhar (mesmo padrão de `sendTextMessage` etc., que também lançam em vez de retornar `{erro}`). Consumido pela Task 5.
- `getConversacoes` ganha filtro por `responsavel_id` quando vendedor — assinatura de retorno não muda, `Conversa.contacts` já carrega `responsavel_id`/`responsavel` (Task 2), então nenhuma outra task/arquivo que já consome `getConversacoes` precisa mudar.

- [ ] **Step 1: Importar o client autenticado (sessão) ao lado do admin**

Em `app/dashboard/inbox/actions.ts`, troque:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
```

por:

```ts
'use server'
import { revalidatePath } from 'next/cache'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
```

- [ ] **Step 2: `getConversacoes` — restringir por vendedor**

Troque:

```ts
export async function getConversacoes(opts?: { offset?: number; limit?: number; onlyGroups?: boolean }) {
  const offset = opts?.offset ?? 0
  const limit = Math.max(opts?.limit ?? CONVERSAS_PAGE_SIZE, 1)
  const onlyGroups = opts?.onlyGroups ?? false
  const supabase = createAdminClient()
  // Filtro por aba (contatos vs grupos) feito no servidor: `contacts!inner` +
  // `.eq()` na coluna do join é suportado pelo PostgREST e mantém a paginação
  // por range correta — filtrar em memória quebraria hasMore/offset (uma página
  // inteira poderia vir "vazia" após o filtro). O !inner exclui conversas sem
  // contato, o que é ok: contact_id é obrigatório no schema.
  const { data, error } = await supabase
    .from('conversations')
    .select('*, contacts!inner(phone, name, profile_picture_url, is_group, notes), instances(name, evolution_instance_name), agents(name)')
    .eq('contacts.is_group', onlyGroups)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (error) console.error('getConversacoes failed:', error.message)
```

por:

```ts
export async function getConversacoes(opts?: { offset?: number; limit?: number; onlyGroups?: boolean }) {
  const offset = opts?.offset ?? 0
  const limit = Math.max(opts?.limit ?? CONVERSAS_PAGE_SIZE, 1)
  const onlyGroups = opts?.onlyGroups ?? false
  const supabase = createAdminClient()

  // Vendedor só vê conversas de contatos atribuídos a ele; admin/gerente veem tudo.
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  let souVendedor = false
  if (user) {
    const { data: meuPerfil } = await authClient.from('profiles').select('perfil').eq('id', user.id).single()
    souVendedor = (meuPerfil?.perfil ?? 'vendedor') === 'vendedor'
  }

  // Filtro por aba (contatos vs grupos) feito no servidor: `contacts!inner` +
  // `.eq()` na coluna do join é suportado pelo PostgREST e mantém a paginação
  // por range correta — filtrar em memória quebraria hasMore/offset (uma página
  // inteira poderia vir "vazia" após o filtro). O !inner exclui conversas sem
  // contato, o que é ok: contact_id é obrigatório no schema.
  let query = supabase
    .from('conversations')
    .select('*, contacts!inner(phone, name, profile_picture_url, is_group, notes, responsavel_id, responsavel:responsavel_id(id, nome)), instances(name, evolution_instance_name), agents(name)')
    .eq('contacts.is_group', onlyGroups)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .range(offset, offset + limit - 1)

  if (souVendedor && user) query = query.eq('contacts.responsavel_id', user.id)

  const { data, error } = await query

  if (error) console.error('getConversacoes failed:', error.message)
```

(o resto da função — dedupe por telefone e o `return` — continua exatamente igual.)

- [ ] **Step 3: Adicionar o helper de atribuição automática**

Logo antes de `export async function sendTextMessage(...)`, adicione:

```ts
// Atribuição automática: a primeira mensagem enviada pelo CRM numa conversa cujo
// contato ainda não tem dono torna quem enviou o responsável. Não sobrescreve um
// dono já existente (.is('responsavel_id', null)) — reatribuir é ação separada,
// só de admin/gerente (reatribuirConversa).
async function atribuirResponsavelSeNecessario(conversationId: string) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return

  const admin = createAdminClient()
  const { data: conversa } = await admin.from('conversations').select('contact_id').eq('id', conversationId).single()
  if (!conversa?.contact_id) return

  await admin.from('contacts').update({ responsavel_id: user.id }).eq('id', conversa.contact_id).is('responsavel_id', null)
}
```

- [ ] **Step 4: Ligar a atribuição automática nas três funções de envio**

Troque:

```ts
export async function sendTextMessage(
  conversationId: string,
  instanceName: string,
  phone: string,
  content: string,
) {
  const supabase = createAdminClient()
  const evoRes = await evoFetch(`/message/sendText/${instanceName}`, { number: phone, text: content })
  await supabase.from('messages').insert({
```

por:

```ts
export async function sendTextMessage(
  conversationId: string,
  instanceName: string,
  phone: string,
  content: string,
) {
  const supabase = createAdminClient()
  const evoRes = await evoFetch(`/message/sendText/${instanceName}`, { number: phone, text: content })
  await atribuirResponsavelSeNecessario(conversationId)
  await supabase.from('messages').insert({
```

Troque:

```ts
  const supabase = createAdminClient()
  const mediatype = mimetype.startsWith('image/') ? 'image' : mimetype.startsWith('video/') ? 'video' : 'document'
  const evoRes = await evoFetch(`/message/sendMedia/${instanceName}`, { number: phone, mediatype, mimetype, caption, media: mediaBase64 })
  const prefix = mediatype === 'image' ? '[Imagem]' : mediatype === 'video' ? '[Vídeo]' : '[Documento]'

  // Best-effort: já temos o base64 aqui, upload direto pro Storage sem precisar
```

por:

```ts
  const supabase = createAdminClient()
  const mediatype = mimetype.startsWith('image/') ? 'image' : mimetype.startsWith('video/') ? 'video' : 'document'
  const evoRes = await evoFetch(`/message/sendMedia/${instanceName}`, { number: phone, mediatype, mimetype, caption, media: mediaBase64 })
  await atribuirResponsavelSeNecessario(conversationId)
  const prefix = mediatype === 'image' ? '[Imagem]' : mediatype === 'video' ? '[Vídeo]' : '[Documento]'

  // Best-effort: já temos o base64 aqui, upload direto pro Storage sem precisar
```

Troque:

```ts
  const supabase = createAdminClient()
  const evoRes = await evoFetch(`/message/sendWhatsAppAudio/${instanceName}`, { number: phone, audio: audioBase64, encoding: true })

  // Best-effort, mesma lógica do sendMediaMessage: upload do áudio que já temos em
```

por:

```ts
  const supabase = createAdminClient()
  const evoRes = await evoFetch(`/message/sendWhatsAppAudio/${instanceName}`, { number: phone, audio: audioBase64, encoding: true })
  await atribuirResponsavelSeNecessario(conversationId)

  // Best-effort, mesma lógica do sendMediaMessage: upload do áudio que já temos em
```

- [ ] **Step 5: Corrigir `adicionarAoFunil` pra gravar o dono**

Troque:

```ts
export async function adicionarAoFunil(
  phone: string,
  contactName: string,
  titulo: string,
  valor: number,
  etapa: string,
) {
  const supabase = createAdminClient()
  const ETAPAS = ['lead', 'proposta', 'negociacao', 'fechado', 'encerrado'] as const
  const etapaValida = ETAPAS.includes(etapa as typeof ETAPAS[number]) ? etapa : 'lead'

  // Find or create client by phone
  const { data: existing } = await supabase
    .from('clientes')
    .select('id')
    .eq('telefone', phone)
    .maybeSingle()

  let clienteId = existing?.id ?? null
  if (!existing) {
    const { data: novo } = await supabase
      .from('clientes')
      .insert({ nome: contactName, telefone: phone, status: 'lead' })
      .select('id')
      .single()
    clienteId = novo?.id ?? null
  }

  await supabase.from('negocios').insert({
    titulo,
    valor,
    etapa: etapaValida,
    cliente_id: clienteId,
    motivo_encerramento: null,
  })

  revalidatePath('/dashboard/funil')
  revalidatePath('/dashboard/clientes')
}
```

por:

```ts
export async function adicionarAoFunil(
  phone: string,
  contactName: string,
  titulo: string,
  valor: number,
  etapa: string,
) {
  // Bug corrigido aqui: antes, negócios/clientes criados por este botão (a partir
  // do Inbox) nunca tinham dono — esta função usava só o client admin, sem sessão,
  // e não sabia quem estava logado. Agora busca o usuário autenticado e grava
  // user_id/responsavel_id, igual ao que criarNegocio (Funil) já fazia.
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

  const supabase = createAdminClient()
  const ETAPAS = ['lead', 'proposta', 'negociacao', 'fechado', 'encerrado'] as const
  const etapaValida = ETAPAS.includes(etapa as typeof ETAPAS[number]) ? etapa : 'lead'

  // Find or create client by phone
  const { data: existing } = await supabase
    .from('clientes')
    .select('id')
    .eq('telefone', phone)
    .maybeSingle()

  let clienteId = existing?.id ?? null
  if (!existing) {
    const { data: novo } = await supabase
      .from('clientes')
      .insert({ nome: contactName, telefone: phone, status: 'lead', user_id: user?.id ?? null })
      .select('id')
      .single()
    clienteId = novo?.id ?? null
  }

  await supabase.from('negocios').insert({
    titulo,
    valor,
    etapa: etapaValida,
    cliente_id: clienteId,
    motivo_encerramento: null,
    responsavel_id: user?.id ?? null,
  })

  revalidatePath('/dashboard/funil')
  revalidatePath('/dashboard/clientes')
}
```

- [ ] **Step 6: Adicionar `reatribuirConversa`**

No final do arquivo, adicione:

```ts

export async function reatribuirConversa(contactId: string, novoResponsavelId: string | null) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) throw new Error('Não autenticado')

  const { data: meuPerfil } = await authClient.from('profiles').select('perfil').eq('id', user.id).single()
  if ((meuPerfil?.perfil ?? 'vendedor') === 'vendedor') throw new Error('Apenas admin ou gerente podem reatribuir conversas')

  const admin = createAdminClient()
  const { error } = await admin.from('contacts').update({ responsavel_id: novoResponsavelId }).eq('id', contactId)
  if (error) throw new Error('Falha ao reatribuir: ' + error.message)

  revalidatePath('/dashboard/inbox')
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: mesmo erro pré-existente conhecido e nenhum erro novo.

- [ ] **Step 8: Lint**

Run: `npm run lint`
Expected: mesma contagem do baseline.

- [ ] **Step 9: Build**

Run: `npm run build`
Expected: sucesso.

- [ ] **Step 10: Commit**

```bash
git add app/dashboard/inbox/actions.ts
git commit -m "feat(inbox): restrict conversations by vendedor and auto-assign ownership on first reply"
```

---

### Task 5: CRM — Inbox UI: reatribuir conversa no cabeçalho

**Repo:** `C:\Users\rgrasso\claude teste\meu-crm` (branch `main`)

**Depends on:** Task 2 (`Conversa.contacts.responsavel_id`/`responsavel`), Task 4 (`reatribuirConversa`). Sequencial no mesmo repo — roda depois pra evitar conflito de working tree.

**Files:**
- Modify: `app/dashboard/inbox/page.tsx`
- Modify: `components/inbox/inbox-panel.tsx`
- Modify: `components/inbox/mensagem-thread.tsx`

**Interfaces:**
- Consumes: `reatribuirConversa(contactId, novoResponsavelId)` (Task 4); `getProfilesParaFiltro(): Promise<{ id: string; nome: string | null }[]>` — já existe em `lib/supabase/queries.ts` (usada hoje em Relatórios), reaproveitada sem alterações.

- [ ] **Step 1: `InboxPage` busca o perfil do usuário e a lista de vendedores**

Em `app/dashboard/inbox/page.tsx`, troque o arquivo inteiro:

```tsx
import { getConversacoes } from './actions'
import { InboxPanel } from '@/components/inbox/inbox-panel'

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string }>
}) {
  const { phone } = await searchParams
  const { conversas, hasMore, nextOffset } = await getConversacoes()
  return (
    <InboxPanel
      conversas={conversas}
      initialHasMore={hasMore}
      initialNextOffset={nextOffset}
      initialPhone={phone}
    />
  )
}
```

por:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProfilesParaFiltro } from '@/lib/supabase/queries'
import { getConversacoes } from './actions'
import { InboxPanel } from '@/components/inbox/inbox-panel'

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string }>
}) {
  const { phone } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: meuPerfilRow } = await supabase.from('profiles').select('perfil').eq('id', user.id).single()
  const meuPerfil = meuPerfilRow?.perfil ?? 'vendedor'

  const [{ conversas, hasMore, nextOffset }, profiles] = await Promise.all([
    getConversacoes(),
    getProfilesParaFiltro(),
  ])

  return (
    <InboxPanel
      conversas={conversas}
      initialHasMore={hasMore}
      initialNextOffset={nextOffset}
      initialPhone={phone}
      meuPerfil={meuPerfil}
      profiles={profiles}
    />
  )
}
```

- [ ] **Step 2: `InboxPanel` repassa `meuPerfil`/`profiles` pra `MensagemThread`**

Em `components/inbox/inbox-panel.tsx`, troque:

```tsx
export function InboxPanel({ conversas: initialConversas, initialHasMore, initialNextOffset, initialPhone }: {
  conversas: Conversa[]
  initialHasMore: boolean
  initialNextOffset: number
  initialPhone?: string
}) {
```

por:

```tsx
export function InboxPanel({ conversas: initialConversas, initialHasMore, initialNextOffset, initialPhone, meuPerfil, profiles }: {
  conversas: Conversa[]
  initialHasMore: boolean
  initialNextOffset: number
  initialPhone?: string
  meuPerfil: 'admin' | 'gerente' | 'vendedor'
  profiles: { id: string; nome: string | null }[]
}) {
```

Troque:

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
        meuPerfil={meuPerfil}
        profiles={profiles}
      />
```

- [ ] **Step 3: `MensagemThread` — dialog de reatribuir + mostrar no cabeçalho**

Em `components/inbox/mensagem-thread.tsx`, troque a interface `Props`:

```tsx
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

por:

```tsx
interface Props {
  conversa: Conversa | null
  mensagens: Mensagem[]
  loading: boolean
  onPause: () => Promise<void>
  onResume: () => Promise<void>
  onMessageSent: () => void
  onContactUpdated: (conversaId: string, name: string, notes: string | null) => void
  meuPerfil: 'admin' | 'gerente' | 'vendedor'
  profiles: { id: string; nome: string | null }[]
}
```

Troque o import de `adicionarAoFunil`:

```tsx
import { adicionarAoFunil } from '@/app/dashboard/inbox/actions'
```

por:

```tsx
import { adicionarAoFunil, reatribuirConversa } from '@/app/dashboard/inbox/actions'
```

Logo depois do fim do componente `FunilDialog` (antes de `export function MensagemThread(...)`), adicione:

```tsx

function ReatribuirDialog({ contactId, currentResponsavelId, currentResponsavelNome, profiles }: {
  contactId: string
  currentResponsavelId: string | null
  currentResponsavelNome: string | null
  profiles: { id: string; nome: string | null }[]
}) {
  const [open, setOpen] = useState(false)
  const [responsavelId, setResponsavelId] = useState(currentResponsavelId ?? '')
  const [isPending, startTransition] = useTransition()
  const [erro, setErro] = useState<string | null>(null)

  function handleOpen(v: boolean) {
    setOpen(v)
    if (v) { setResponsavelId(currentResponsavelId ?? ''); setErro(null) }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      try {
        await reatribuirConversa(contactId, responsavelId || null)
        setOpen(false)
      } catch {
        setErro('Não foi possível reatribuir. Tente novamente.')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger
        render={
          <button
            title="Reatribuir vendedor"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700 hover:bg-blue-100 border border-blue-200 transition-colors"
          />
        }
      >
        <User className="size-3.5" />
        {currentResponsavelNome ?? 'Sem dono'}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Reatribuir conversa</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="rresponsavel">Vendedor responsável</Label>
            <select
              id="rresponsavel"
              value={responsavelId}
              onChange={e => setResponsavelId(e.target.value)}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="">Sem dono</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>{p.nome ?? 'Sem nome'}</option>
              ))}
            </select>
          </div>
          {erro && <p className="text-sm text-red-600">{erro}</p>}
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

Troque a assinatura de `MensagemThread`:

```tsx
export function MensagemThread({ conversa, mensagens, loading, onPause, onResume, onMessageSent, onContactUpdated }: Props) {
```

por:

```tsx
export function MensagemThread({ conversa, mensagens, loading, onPause, onResume, onMessageSent, onContactUpdated, meuPerfil, profiles }: Props) {
```

Troque:

```tsx
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="size-4 animate-spin text-gray-400" />}
          {phone && <FunilDialog phone={phone} contactName={contactName} />}
```

por:

```tsx
        <div className="flex items-center gap-2">
          {loading && <Loader2 className="size-4 animate-spin text-gray-400" />}
          {meuPerfil !== 'vendedor' && (
            <ReatribuirDialog
              contactId={conversa.contact_id}
              currentResponsavelId={conversa.contacts?.responsavel_id ?? null}
              currentResponsavelNome={conversa.contacts?.responsavel?.nome ?? null}
              profiles={profiles}
            />
          )}
          {phone && <FunilDialog phone={phone} contactName={contactName} />}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: mesmo erro pré-existente conhecido e nenhum erro novo.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: mesma contagem do baseline.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: sucesso.

- [ ] **Step 7: Verificação manual (se houver navegador disponível)**

1. Logado como vendedor: confirme que o Funil, Clientes e Inbox só mostram o que é seu (negócios/clientes com `responsavel_id`/`user_id` igual ao seu; conversas de contatos atribuídos a você — e conversas com contato sem dono nenhum, se houver, não devem aparecer).
2. Logado como gerente: confirme que vê tudo, igual admin, nas três telas.
3. Envie uma mensagem de uma conversa cujo contato ainda não tem dono — confirme que `responsavel_id` do contato passa a ser o seu (visível no dialog de reatribuir, se você for admin/gerente; ou simplesmente que a conversa passa a aparecer pra você se for vendedor).
4. Como admin/gerente, abra o dialog "Reatribuir" numa conversa e troque o vendedor — confirme que a conversa passa a aparecer pro novo vendedor e some da lista do antigo (se ele for vendedor).
5. Use o botão "Funil" numa conversa nova — confirme que o negócio/cliente criado já vem com `responsavel_id`/`user_id` preenchido (era o bug do Achado 3).
6. Como vendedor, confirme que o dialog "Reatribuir" não aparece no cabeçalho da conversa.

Se não houver navegador disponível, pule este step e reporte explicitamente que não foi feito.

- [ ] **Step 8: Commit**

```bash
git add app/dashboard/inbox/page.tsx components/inbox/inbox-panel.tsx components/inbox/mensagem-thread.tsx
git commit -m "feat(inbox): add UI to reassign conversation ownership"
```

---

### Task 6: CRM — Inbox: vendedor vê e reivindica conversas sem dono; ações individuais passam a checar dono

**Repo:** `C:\Users\rgrasso\claude teste\meu-crm` (branch `main`)

**Depends on:** Tasks 4-5 (mesmo arquivo). Adicionada após a revisão final de branch da Task 5 encontrar três problemas: (1) só a listagem tinha checagem de dono — `getMensagens`, `pauseConversa`, `resumeConversa`, `marcarComoLida` e as três funções de envio não checavam nada, um vendedor que soubesse o `conversationId` de outro conseguia agir na conversa direto, sem passar pela tela; (2) o filtro da listagem escondia conversas sem dono de vendedor, então só admin/gerente conseguiam ver (e "reivindicar" sem querer) uma conversa nova; (3) confirmado com o usuário: vendedor deve ver conversas sem dono também, pra poder puxar — uma vez que ele responde, ela vira dele.

**Files:**
- Modify: `app/dashboard/inbox/actions.ts`

**Interfaces:**
- Produces: `podeAcessarConversa(conversationId: string): Promise<boolean>` — helper interno, não exportado, usado só dentro deste arquivo.
- Não muda a assinatura pública de nenhuma função existente (`getMensagens`, `pauseConversa`, `resumeConversa`, `marcarComoLida`, `sendTextMessage`, `sendMediaMessage`, `sendAudioMessage` continuam com os mesmos parâmetros).

- [ ] **Step 1: `getConversacoes` — vendedor vê o que é seu E o que não tem dono ainda**

Troque:

```ts
  if (souVendedor && user) query = query.eq('contacts.responsavel_id', user.id)
```

por:

```ts
  // Vendedor vê tanto o que já é seu quanto conversas sem dono ainda — é assim
  // que ele "puxa" um lead novo (responder uma delas torna ele o dono, via
  // atribuirResponsavelSeNecessario). Uma vez atribuída a outro vendedor, ela
  // some da lista dos demais.
  if (souVendedor && user) query = query.or(`responsavel_id.eq.${user.id},responsavel_id.is.null`, { foreignTable: 'contacts' })
```

- [ ] **Step 2: Adicionar o helper `podeAcessarConversa`**

Logo depois do fim de `getConversacoes` (antes de `export async function getMensagens`), adicione:

```ts

// Retorna true se o usuário logado pode agir nesta conversa: admin/gerente sempre
// podem; vendedor só se for o dono do contato dela, ou se ela ainda não tiver dono
// nenhum — mesma regra "pode ver e reivindicar" já aplicada em getConversacoes.
async function podeAcessarConversa(conversationId: string): Promise<boolean> {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return false

  const { data: meuPerfil } = await authClient.from('profiles').select('perfil').eq('id', user.id).single()
  if ((meuPerfil?.perfil ?? 'vendedor') !== 'vendedor') return true

  const admin = createAdminClient()
  const { data: conversa } = await admin.from('conversations').select('contact_id').eq('id', conversationId).single()
  if (!conversa?.contact_id) return false

  const { data: contato } = await admin.from('contacts').select('responsavel_id').eq('id', conversa.contact_id).single()
  return !contato?.responsavel_id || contato.responsavel_id === user.id
}
```

- [ ] **Step 3: `getMensagens` e `marcarComoLida` — checar dono silenciosamente**

São funções chamadas automaticamente (polling a cada 3s, e ao selecionar/atualizar via Realtime), não por um clique direto do usuário — por isso, sem dono retorna vazio/não faz nada, em vez de lançar erro.

Troque:

```ts
export async function getMensagens(conversationId: string) {
  const supabase = createAdminClient()
  const { data } = await supabase
    .from('messages')
```

por:

```ts
export async function getMensagens(conversationId: string) {
  if (!(await podeAcessarConversa(conversationId))) return []

  const supabase = createAdminClient()
  const { data } = await supabase
    .from('messages')
```

Troque:

```ts
export async function marcarComoLida(conversationId: string) {
  const supabase = createAdminClient()
  await supabase.from('conversations').update({ unread_count: 0 }).eq('id', conversationId)
}
```

por:

```ts
export async function marcarComoLida(conversationId: string) {
  if (!(await podeAcessarConversa(conversationId))) return
  const supabase = createAdminClient()
  await supabase.from('conversations').update({ unread_count: 0 }).eq('id', conversationId)
}
```

- [ ] **Step 4: `pauseConversa` e `resumeConversa` — checar dono, lançar erro**

São ações de clique direto do usuário — mesmo padrão de erro já usado em `reatribuirConversa`.

Troque:

```ts
export async function pauseConversa(conversationId: string) {
  const supabase = createAdminClient()
  await supabase.from('conversations').update({ status: 'paused' }).eq('id', conversationId)
}

export async function resumeConversa(conversationId: string) {
  const supabase = createAdminClient()
  await supabase.from('conversations').update({ status: 'active' }).eq('id', conversationId)
}
```

por:

```ts
export async function pauseConversa(conversationId: string) {
  if (!(await podeAcessarConversa(conversationId))) throw new Error('Sem permissão para esta conversa')
  const supabase = createAdminClient()
  await supabase.from('conversations').update({ status: 'paused' }).eq('id', conversationId)
}

export async function resumeConversa(conversationId: string) {
  if (!(await podeAcessarConversa(conversationId))) throw new Error('Sem permissão para esta conversa')
  const supabase = createAdminClient()
  await supabase.from('conversations').update({ status: 'active' }).eq('id', conversationId)
}
```

- [ ] **Step 5: `atribuirResponsavelSeNecessario` — só vendedor reivindica**

Troque:

```ts
async function atribuirResponsavelSeNecessario(conversationId: string) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return

  const admin = createAdminClient()
  const { data: conversa } = await admin.from('conversations').select('contact_id').eq('id', conversationId).single()
  if (!conversa?.contact_id) return

  await admin.from('contacts').update({ responsavel_id: user.id }).eq('id', conversa.contact_id).is('responsavel_id', null)
}
```

por:

```ts
async function atribuirResponsavelSeNecessario(conversationId: string) {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return

  // Só vendedor "puxa" uma conversa sem dono ao responder — é assim que ele reivindica
  // um lead novo. Se quem respondeu for admin/gerente, não faz sentido virar o
  // "responsável" dela: isso é papel da reatribuição manual (reatribuirConversa).
  const { data: meuPerfil } = await authClient.from('profiles').select('perfil').eq('id', user.id).single()
  if ((meuPerfil?.perfil ?? 'vendedor') !== 'vendedor') return

  const admin = createAdminClient()
  const { data: conversa } = await admin.from('conversations').select('contact_id').eq('id', conversationId).single()
  if (!conversa?.contact_id) return

  await admin.from('contacts').update({ responsavel_id: user.id }).eq('id', conversa.contact_id).is('responsavel_id', null)
}
```

- [ ] **Step 6: As três funções de envio — checar dono, lançar erro**

Troque:

```ts
export async function sendTextMessage(
  conversationId: string,
  instanceName: string,
  phone: string,
  content: string,
) {
  const supabase = createAdminClient()
  const evoRes = await evoFetch(`/message/sendText/${instanceName}`, { number: phone, text: content })
  await atribuirResponsavelSeNecessario(conversationId)
```

por:

```ts
export async function sendTextMessage(
  conversationId: string,
  instanceName: string,
  phone: string,
  content: string,
) {
  if (!(await podeAcessarConversa(conversationId))) throw new Error('Sem permissão para esta conversa')
  const supabase = createAdminClient()
  const evoRes = await evoFetch(`/message/sendText/${instanceName}`, { number: phone, text: content })
  await atribuirResponsavelSeNecessario(conversationId)
```

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
  await atribuirResponsavelSeNecessario(conversationId)
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
  if (!(await podeAcessarConversa(conversationId))) throw new Error('Sem permissão para esta conversa')
  const supabase = createAdminClient()
  const mediatype = mimetype.startsWith('image/') ? 'image' : mimetype.startsWith('video/') ? 'video' : 'document'
  const evoRes = await evoFetch(`/message/sendMedia/${instanceName}`, { number: phone, mediatype, mimetype, caption, media: mediaBase64 })
  await atribuirResponsavelSeNecessario(conversationId)
```

Troque:

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
  await atribuirResponsavelSeNecessario(conversationId)
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
  if (!(await podeAcessarConversa(conversationId))) throw new Error('Sem permissão para esta conversa')
  const supabase = createAdminClient()
  const evoRes = await evoFetch(`/message/sendWhatsAppAudio/${instanceName}`, { number: phone, audio: audioBase64, encoding: true })
  await atribuirResponsavelSeNecessario(conversationId)
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: mesmo erro pré-existente conhecido e nenhum erro novo.

- [ ] **Step 8: Lint**

Run: `npm run lint`
Expected: mesma contagem do baseline.

- [ ] **Step 9: Build**

Run: `npm run build`
Expected: sucesso.

- [ ] **Step 10: Commit**

```bash
git add app/dashboard/inbox/actions.ts
git commit -m "fix(inbox): let vendedor claim unowned conversations, enforce ownership on individual actions"
```

---

### Task 7: CRM — Inbox: cobrir `scheduleMessage`/`updateContactDetails`, falhar fechado em erro de consulta

**Repo:** `C:\Users\rgrasso\claude teste\meu-crm` (branch `main`)

**Depends on:** Task 6 (mesmo arquivo). Adicionada depois da segunda revisão final de branch, que perguntou explicitamente se `updateContactDetails`/`scheduleMessage` eram uma fronteira defensável — não são: são o mesmo tipo de brecha que a Task 6 fechou nas outras funções, só que nessas duas ninguém tinha olhado ainda. `scheduleMessage` é a mais grave: o worker do `agente-de-ia` processa `scheduled_messages` pendentes e manda de verdade pro WhatsApp depois — um vendedor conseguiria mandar mensagem numa conversa que não é dele só agendando em vez de mandar direto.

**Files:**
- Modify: `app/dashboard/inbox/actions.ts`

**Interfaces:**
- Produces: `podeAcessarContato(contactId: string): Promise<boolean>` — helper interno, mesma regra de `podeAcessarConversa` mas partindo direto do `contactId` (não precisa do passo extra de resolver `conversation → contact_id`).
- Não muda assinatura pública de nenhuma função existente.

- [ ] **Step 1: `podeAcessarConversa` — falhar fechado se a consulta do contato não retornar linha**

Troque:

```ts
  const { data: contato } = await admin.from('contacts').select('responsavel_id').eq('id', conversa.contact_id).single()
  return !contato?.responsavel_id || contato.responsavel_id === user.id
}
```

por:

```ts
  const { data: contato } = await admin.from('contacts').select('responsavel_id').eq('id', conversa.contact_id).single()
  // Falha fechado: se a consulta não retornar linha nenhuma (erro transitório,
  // FK pendurada, ou a coluna responsavel_id ainda não existir porque a migration
  // não rodou), nega em vez de liberar — antes disso caía no `!contato?.responsavel_id`
  // (que também é `true` quando `contato` é `null`), liberando acesso sem querer.
  if (!contato) return false
  return !contato.responsavel_id || contato.responsavel_id === user.id
}
```

- [ ] **Step 2: Adicionar `podeAcessarContato`**

Logo depois do fim de `podeAcessarConversa` (antes de `export async function getMensagens`), adicione:

```ts

// Mesma regra de podeAcessarConversa, mas a partir do contato direto — usada por
// funções que já recebem contactId em vez de conversationId.
async function podeAcessarContato(contactId: string): Promise<boolean> {
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()
  if (!user) return false

  const { data: meuPerfil } = await authClient.from('profiles').select('perfil').eq('id', user.id).single()
  if ((meuPerfil?.perfil ?? 'vendedor') !== 'vendedor') return true

  const admin = createAdminClient()
  const { data: contato } = await admin.from('contacts').select('responsavel_id').eq('id', contactId).single()
  if (!contato) return false
  return !contato.responsavel_id || contato.responsavel_id === user.id
}
```

- [ ] **Step 3: `scheduleMessage` — checar dono, lançar erro**

Troque:

```ts
export async function scheduleMessage(
  conversationId: string,
  content: string,
  scheduledAt: string,
  mediaBase64?: string,
  mediaType?: 'text' | 'image' | 'audio',
  mimetype?: string,
) {
  const supabase = createAdminClient()
  await supabase.from('scheduled_messages').insert({
```

por:

```ts
export async function scheduleMessage(
  conversationId: string,
  content: string,
  scheduledAt: string,
  mediaBase64?: string,
  mediaType?: 'text' | 'image' | 'audio',
  mimetype?: string,
) {
  if (!(await podeAcessarConversa(conversationId))) throw new Error('Sem permissão para esta conversa')
  const supabase = createAdminClient()
  await supabase.from('scheduled_messages').insert({
```

- [ ] **Step 4: `updateContactDetails` — checar dono, lançar erro**

Troque:

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
```

por:

```ts
export async function updateContactDetails(
  contactId: string,
  phone: string,
  name: string,
  notes: string | null,
) {
  const trimmedName = name.trim()
  if (!trimmedName) throw new Error('Nome não pode ser vazio')

  if (!(await podeAcessarContato(contactId))) throw new Error('Sem permissão para este contato')

  const supabase = createAdminClient()
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: mesmo erro pré-existente conhecido e nenhum erro novo.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: mesma contagem do baseline.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: sucesso.

- [ ] **Step 8: Commit**

```bash
git add app/dashboard/inbox/actions.ts
git commit -m "fix(inbox): guard scheduleMessage/updateContactDetails and fail closed on lookup errors"
```

---

### Task 8: Backend — RLS de verdade nas tabelas do Inbox

**Repo:** `C:\Users\rgrasso\agente de ia` (branch `master`)

**Depends on:** nenhuma task de código (é uma migration nova, independente). Adicionada depois da terceira revisão final de branch encontrar que `contacts`, `conversations`, `messages` e `scheduled_messages` não têm RLS nenhuma — toda a restrição por vendedor construída nas Tasks 2-7 roda só dentro das server actions (que usam a service role key). O navegador também usa um client autenticado comum (anon key) — hoje só para o canal Realtime do Inbox, confirmado por auditoria de código (nenhum `.from(...)` direto em componente algum, só `.channel(...)` e `.auth.*`) — mas nada impede alguém de abrir o console do navegador e consultar essas tabelas direto, contornando toda a restrição. Confirmado com o usuário: adicionar a política real.

**Files:**
- Create: `supabase/migrations/20260714_inbox_rls.sql`

**Interfaces:**
- Produces: RLS habilitada + políticas de `SELECT` em `contacts`, `conversations`, `messages`, `scheduled_messages` — sem nenhuma política de escrita pra `authenticated` (todo escrita nessas tabelas, em ambos os repos, já passa pela service role key, que ignora RLS — não há caminho legítimo de escrita via `authenticated` a proteger). Consumida pelo CRM via Supabase direto (repo separado); como efeito colateral também passa a limitar corretamente o que o canal Realtime do Inbox entrega pra cada vendedor (Realtime respeita RLS).

- [ ] **Step 1: Escrever a migration**

Crie `supabase/migrations/20260714_inbox_rls.sql`:

```sql
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
```

- [ ] **Step 2: Typecheck e suíte completa (regressão)**

Run: `npm run typecheck --workspace=apps/api && npm run typecheck --workspace=packages/db && npm test`
Expected: sem erros novos, 48 testes continuam passando — este arquivo é só SQL, não afeta nenhum código TypeScript.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260714_inbox_rls.sql
git commit -m "feat(db): enable RLS on inbox tables to enforce per-vendedor access at the database layer"
```

---

### Task 9: CRM — alargar RLS de gerente em Funil/Clientes/Profiles

**Repo:** `C:\Users\rgrasso\claude teste\meu-crm` (branch `main`)

**Depends on:** nenhuma task de código (migration nova, independente). Adicionada porque as políticas de RLS já existentes em `migration-fase4.sql` (rodada antes deste projeto) restringem `gerente` a editar/excluir só os próprios negócios/clientes — mas a Task 3 alargou a checagem *no código* pra gerente gerenciar tudo (mesma decisão de "gerente vê e gerencia o time inteiro" do spec). Sem esse ajuste no banco, a tela mostraria a ação como permitida mas o RLS recusaria silenciosamente. De quebra, a política de leitura de `profiles` também só liberava a lista completa pra admin — sem isso, o dropdown de reatribuir conversa (Task 5) e o filtro de ranking em Relatórios voltam vazios pra gerente, mostrando só ele mesmo.

**Files:**
- Create: `migration-fase5.sql` (raiz do repo, mesmo padrão de `migration-fase4.sql` — rodado manualmente no SQL Editor do Supabase)

**Interfaces:**
- Não produz nem consome nada de outra task — ajusta políticas de RLS já existentes, criadas por `migration-fase4.sql` (não faz parte deste plano, já em produção).

- [ ] **Step 1: Escrever a migration**

Crie `migration-fase5.sql`:

```sql
-- ============================================================
-- FASE 5: Alarga permissões de gerente (RLS) para bater com a
-- decisão "gerente vê e gerencia o time inteiro, igual admin"
-- (já aplicada no código em negocios/clientes) e corrige a leitura
-- de profiles, que só liberava a lista completa pra admin — sem
-- isso o dropdown de reatribuir conversa e o filtro de ranking em
-- Relatórios voltam vazios pra gerente.
-- Rodar no SQL Editor do Supabase, depois da fase 4.
-- ============================================================

-- ---- NEGOCIOS: gerente passa a editar/mover/excluir qualquer negócio ----
drop policy if exists "negocios_gerente_update" on negocios;
create policy "negocios_gerente_update" on negocios
for update using (
  (select perfil from profiles where id = auth.uid()) = 'gerente'
);

drop policy if exists "negocios_gerente_delete" on negocios;
create policy "negocios_gerente_delete" on negocios
for delete using (
  (select perfil from profiles where id = auth.uid()) = 'gerente'
);

-- ---- CLIENTES: gerente passa a editar/excluir qualquer cliente ----
drop policy if exists "clientes_gerente_update" on clientes;
create policy "clientes_gerente_update" on clientes
for update using (
  (select perfil from profiles where id = auth.uid()) = 'gerente'
);

drop policy if exists "clientes_gerente_delete" on clientes;
create policy "clientes_gerente_delete" on clientes
for delete using (
  (select perfil from profiles where id = auth.uid()) = 'gerente'
);

-- ---- PROFILES: gerente também precisa ler a lista completa de usuários
-- (dropdown de reatribuir conversa, filtro de ranking em Relatórios) ----
drop policy if exists "profiles_leitura" on profiles;
create policy "profiles_leitura" on profiles
for select using (
  id = auth.uid()
  or (select perfil from profiles where id = auth.uid()) in ('admin', 'gerente')
);
```

(`negocios_gerente_insert`/`clientes_gerente_insert` ficam como estão — continuam exigindo `responsavel_id`/`user_id = auth.uid()`, mas isso já bate com o app: `criarNegocio`/`criarCliente` sempre gravam o criador como dono, nunca atribuem a outra pessoa na criação, então não há nenhum fluxo hoje que essa restrição bloqueie.)

- [ ] **Step 2: Typecheck, lint e build (regressão)**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: mesmo baseline conhecido (1 erro pré-existente de tsc, 6 problemas de lint), sem novidade — este arquivo é só SQL, não afeta nenhum código TypeScript.

- [ ] **Step 3: Commit**

```bash
git add migration-fase5.sql
git commit -m "feat(db): widen gerente RLS on negocios/clientes and fix profiles read policy"
```
