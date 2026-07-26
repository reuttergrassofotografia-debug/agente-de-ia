# CRM: Nomear e visualizar vendedor responsável em Clientes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let admin/gerente see which vendedor owns each client in the Clientes list and change that ownership from the existing create/edit dialog — vendedor keeps today's behavior unchanged (always owns what they create, no visibility into others).

**Architecture:** Extend the existing `ClientesTable`/`ClienteForm` components with a `meuPerfil`/`meuUserId`/`profiles` prop chain (mirroring the pattern `InboxPanel` already uses for its own perfil-aware rendering), rendered only for non-vendedor roles. `criarCliente`/`editarCliente` read an optional `vendedorId` field from the form and only ever apply it when the actor's own profile is not `vendedor` — a vendedor submitting a tampered request still can't move ownership. No schema change: `clientes.user_id` and the `clientes_gerente_update`/`clientes_gerente_delete` RLS policies already exist (confirmed in the design spec).

**Tech Stack:** Next.js 16 (App Router, Server Actions), Supabase JS, TypeScript, React (`useTransition`).

**Repo:** `meu-crm` (local checkout: `C:\Users\rgrasso\claude teste\meu-crm`) — run every command below from that directory.

## Global Constraints

- No automated test framework in `meu-crm` — verification is `npx tsc --noEmit`, `npm run lint`, `npm run build`, plus manual validation in the browser (per [[sdd_fable_workflow]] memory). Do not write Jest/Vitest tests for this plan.
- Follow the existing code style in the touched files exactly (no semicolons, single quotes, existing import ordering conventions) — do not reformat unrelated lines.
- No database migration in this plan — `clientes.user_id` and the gerente RLS policies on `clientes` already exist (see spec `docs/superpowers/specs/2026-07-26-clientes-vendedor-assignment-design.md`).
- Vendedor must never be able to change a client's `user_id`, even via a hand-crafted request — the `editarCliente` guard in Task 1 Step 1 is not optional.
- Do not run `git push` — commit locally only. Pushing is a deploy trigger for the `crm` service, and its "Deploy Automático" is currently OFF (confirmed 2026-07-26) — a manual "Implantar" click in EasyPanel is required after any future push, separate from this plan.

---

### Task 1: Add vendedor assignment column and selector to Clientes

**Files:**
- Modify: `app/dashboard/clientes/actions.ts` (full file is 78 lines; `criarCliente` lines 22-39, `editarCliente` lines 41-63)
- Modify: `app/dashboard/clientes/page.tsx` (full file, 45 lines)
- Modify: `components/clientes/cliente-form.tsx` (full file, 121 lines)
- Modify: `components/clientes/clientes-table.tsx` (full file, 127 lines)

**Interfaces:**
- Produces: `ClienteFormProps` gains `meuPerfil: string`, `meuUserId: string`, `profiles: { id: string; nome: string | null }[]` (all required, alongside existing `cliente?: Cliente` and `trigger: React.ReactNode`).
- Produces: `ClientesTableProps` gains the same three fields (required), alongside existing `clientes: Cliente[]` and `q: string`.
- Consumes: `getProfilesParaFiltro(): Promise<{ id: string; nome: string | null }[]>` — already exported from `lib/supabase/queries.ts:161-168`, unchanged.
- No other task depends on this — it's the only task in this plan.

- [ ] **Step 1: Update `criarCliente` and `editarCliente` in `actions.ts`**

Open `app/dashboard/clientes/actions.ts`. Replace the `criarCliente` function (lines 22-39):

```ts
export async function criarCliente(formData: FormData) {
  const { supabase, user } = await getAuthUser()
  const perfil = await getPerfil(supabase, user.id)

  const statusRaw = formData.get('status') as string
  const status: Status = STATUS_VALIDOS.includes(statusRaw as Status) ? (statusRaw as Status) : 'lead'

  const vendedorId = (formData.get('vendedorId') as string)?.trim() || ''
  const userId = perfil !== 'vendedor' && vendedorId ? vendedorId : user.id

  const { error } = await supabase.from('clientes').insert({
    nome: (formData.get('nome') as string).trim(),
    empresa: (formData.get('empresa') as string)?.trim() || null,
    email: (formData.get('email') as string)?.trim() || null,
    telefone: (formData.get('telefone') as string)?.trim() || null,
    status,
    user_id: userId,
  })

  if (error) throw new Error('Erro ao criar cliente: ' + error.message)
  revalidatePath('/dashboard/clientes')
}
```

Then replace `editarCliente` (lines 41-63):

```ts
export async function editarCliente(id: string, formData: FormData) {
  const { supabase, user } = await getAuthUser()
  const perfil = await getPerfil(supabase, user.id)
  const souVendedor = perfil === 'vendedor'

  const statusRaw = formData.get('status') as string
  const status: Status = STATUS_VALIDOS.includes(statusRaw as Status) ? (statusRaw as Status) : 'lead'

  const dadosUpdate: Record<string, unknown> = {
    nome: (formData.get('nome') as string).trim(),
    empresa: (formData.get('empresa') as string)?.trim() || null,
    email: (formData.get('email') as string)?.trim() || null,
    telefone: (formData.get('telefone') as string)?.trim() || null,
    status,
  }

  if (!souVendedor) {
    const vendedorId = (formData.get('vendedorId') as string)?.trim() || ''
    if (vendedorId) dadosUpdate.user_id = vendedorId
  }

  let query = supabase.from('clientes').update(dadosUpdate, { count: 'exact' }).eq('id', id)

  if (souVendedor) query = query.eq('user_id', user.id)

  const { error, count } = await query
  if (error) throw new Error('Erro ao editar cliente: ' + error.message)
  if (count === 0) throw new Error('Cliente não encontrado ou sem permissão.')
  revalidatePath('/dashboard/clientes')
}
```

`excluirCliente` (lines 65-77) is unchanged.

This is the security-critical part of the plan: when `souVendedor` is `true`, `dadosUpdate` never gains a `user_id` key — no matter what a vendedor sends in `vendedorId`, the update payload sent to Supabase simply doesn't contain that field for them.

- [ ] **Step 2: Add the vendedor selector to `cliente-form.tsx`**

Open `components/clientes/cliente-form.tsx`. Replace the whole file:

```tsx
'use client'

import { useState, useTransition } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Cliente } from '@/lib/types'
import { criarCliente, editarCliente } from '@/app/dashboard/clientes/actions'

interface ClienteFormProps {
  cliente?: Cliente
  trigger: React.ReactNode
  meuPerfil: string
  meuUserId: string
  profiles: { id: string; nome: string | null }[]
}

export function ClienteForm({ cliente, trigger, meuPerfil, meuUserId, profiles }: ClienteFormProps) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const vejoVendedor = meuPerfil !== 'vendedor'

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)

    startTransition(async () => {
      try {
        if (cliente) {
          await editarCliente(cliente.id, formData)
        } else {
          await criarCliente(formData)
        }
        setOpen(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Ocorreu um erro.')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={trigger as React.ReactElement}></DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{cliente ? 'Editar cliente' : 'Novo cliente'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label htmlFor="nome">Nome *</Label>
            <Input
              id="nome"
              name="nome"
              placeholder="Nome do cliente"
              defaultValue={cliente?.nome ?? ''}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="empresa">Empresa</Label>
            <Input
              id="empresa"
              name="empresa"
              placeholder="Nome da empresa"
              defaultValue={cliente?.empresa ?? ''}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="email@exemplo.com"
              defaultValue={cliente?.email ?? ''}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="telefone">Telefone</Label>
            <Input
              id="telefone"
              name="telefone"
              placeholder="(00) 00000-0000"
              defaultValue={cliente?.telefone ?? ''}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="status">Status</Label>
            <select
              id="status"
              name="status"
              defaultValue={cliente?.status ?? 'lead'}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="lead">Lead</option>
              <option value="ativo">Ativo</option>
              <option value="inativo">Inativo</option>
            </select>
          </div>
          {vejoVendedor && (
            <div className="space-y-2">
              <Label htmlFor="vendedorId">Vendedor responsável</Label>
              <select
                id="vendedorId"
                name="vendedorId"
                defaultValue={cliente?.user_id ?? meuUserId}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome ?? p.id}
                  </option>
                ))}
              </select>
            </div>
          )}
          {error && (
            <p className="text-sm text-red-500 bg-red-50 p-3 rounded-md">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 3: Thread the new props through `clientes-table.tsx`**

Open `components/clientes/clientes-table.tsx`. Replace the whole file:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ClienteForm } from './cliente-form'
import { excluirCliente } from '@/app/dashboard/clientes/actions'
import { Cliente } from '@/lib/types'
import { Pencil, Trash2, Plus } from 'lucide-react'

const STATUS_CLASSES: Record<string, string> = {
  lead: 'bg-gray-100 text-gray-700',
  ativo: 'bg-green-100 text-green-700',
  inativo: 'bg-red-100 text-red-700',
}

const STATUS_LABELS: Record<string, string> = {
  lead: 'Lead',
  ativo: 'Ativo',
  inativo: 'Inativo',
}

interface ClientesTableProps {
  clientes: Cliente[]
  q: string
  meuPerfil: string
  meuUserId: string
  profiles: { id: string; nome: string | null }[]
}

export function ClientesTable({ clientes, q, meuPerfil, meuUserId, profiles }: ClientesTableProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const vejoVendedor = meuPerfil !== 'vendedor'

  function handleSearch(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
    const params = new URLSearchParams()
    if (value) params.set('q', value)
    router.push(`/dashboard/clientes?${params.toString()}`)
  }

  function handleExcluir(id: string, nome: string) {
    if (!confirm(`Tem certeza que deseja excluir o cliente "${nome}"?`)) return
    startTransition(() => excluirCliente(id))
  }

  function nomeVendedor(userId: string | null) {
    if (!userId) return '— Sem vendedor —'
    return profiles.find((p) => p.id === userId)?.nome ?? '— Sem vendedor —'
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <Input
          placeholder="Buscar por nome ou empresa..."
          defaultValue={q}
          onChange={handleSearch}
          className="max-w-sm"
        />
        <ClienteForm
          meuPerfil={meuPerfil}
          meuUserId={meuUserId}
          profiles={profiles}
          trigger={
            <Button>
              <Plus className="size-4 mr-2" />
              Novo Cliente
            </Button>
          }
        />
      </div>

      <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
        {clientes.length === 0 ? (
          <div className="p-12 text-center text-gray-400 text-sm">
            {q
              ? `Nenhum cliente encontrado para "${q}"`
              : 'Nenhum cliente cadastrado. Clique em "+ Novo Cliente" para começar.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Nome</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 hidden md:table-cell">Empresa</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500 hidden lg:table-cell">Email</th>
                <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                {vejoVendedor && (
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Vendedor</th>
                )}
                <th className="px-4 py-3 w-24" />
              </tr>
            </thead>
            <tbody className="divide-y">
              {clientes.map((cliente) => (
                <tr key={cliente.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{cliente.nome}</td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{cliente.empresa ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500 hidden lg:table-cell">{cliente.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_CLASSES[cliente.status]}`}>
                      {STATUS_LABELS[cliente.status]}
                    </span>
                  </td>
                  {vejoVendedor && (
                    <td className="px-4 py-3 text-gray-500">{nomeVendedor(cliente.user_id)}</td>
                  )}
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <ClienteForm
                        cliente={cliente}
                        meuPerfil={meuPerfil}
                        meuUserId={meuUserId}
                        profiles={profiles}
                        trigger={
                          <Button variant="ghost" size="icon" className="size-8">
                            <Pencil className="size-4" />
                          </Button>
                        }
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-red-500 hover:text-red-700 hover:bg-red-50"
                        onClick={() => handleExcluir(cliente.id, cliente.nome)}
                        disabled={isPending}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-xs text-gray-400">
        {clientes.length} cliente{clientes.length !== 1 ? 's' : ''} encontrado{clientes.length !== 1 ? 's' : ''}
      </p>
    </div>
  )
}
```

- [ ] **Step 4: Fetch profiles and wire props in `page.tsx`**

Open `app/dashboard/clientes/page.tsx`. Replace the whole file:

```tsx
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProfilesParaFiltro } from '@/lib/supabase/queries'
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

  const { data: meuPerfilRow } = await supabase.from('profiles').select('perfil').eq('id', user.id).single()
  const perfil = meuPerfilRow?.perfil ?? 'vendedor'
  const souVendedor = perfil === 'vendedor'

  let query = supabase
    .from('clientes')
    .select('*')
    .order('created_at', { ascending: false })

  if (souVendedor) query = query.eq('user_id', user.id)

  if (q) {
    // Sanitize: strip PostgREST meta chars (,()%) and LIKE wildcards (%_\) to prevent filter injection
    const safe = q.trim().slice(0, 64).replace(/[%_\\,()]/g, '')
    if (safe) {
      query = query.or(`nome.ilike.%${safe}%,empresa.ilike.%${safe}%`)
    }
  }

  const { data: clientes } = await query
  const profiles = souVendedor ? [] : await getProfilesParaFiltro()

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Clientes</h2>
        <p className="text-gray-500 text-sm mt-1">Gerencie seus clientes e leads</p>
      </div>
      <ClientesTable
        clientes={(clientes as Cliente[]) ?? []}
        q={q ?? ''}
        meuPerfil={perfil}
        meuUserId={user.id}
        profiles={profiles}
      />
    </div>
  )
}
```

- [ ] **Step 5: Type-check, lint, and build**

Run: `npx tsc --noEmit`
Expected: no errors referencing `app/dashboard/clientes/actions.ts`, `app/dashboard/clientes/page.tsx`, `components/clientes/cliente-form.tsx`, or `components/clientes/clientes-table.tsx`. (A pre-existing, unrelated error in `app/dashboard/funil/actions.ts` may appear — ignore it, it predates this change.)

Run: `npm run lint`
Expected: no new errors (pre-existing warnings/errors in other files, e.g. `components/inbox/inbox-panel.tsx`, are unrelated and acceptable).

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Manual verification**

Start the dev server (`npm run dev`), and check the following at `http://localhost:3000/crm/dashboard/clientes` (basePath is `/crm`):

1. Log in as `admin`. Confirm the table now shows a "Vendedor" column between "Status" and the action icons, with each row showing the current owner's name.
2. Click the pencil on an existing cliente. Confirm a "Vendedor responsável" dropdown appears, pre-selected with that cliente's current owner. Change it to a different user, save, and confirm the table's "Vendedor" column updates to the new name immediately.
3. Click "+ Novo Cliente". Confirm the dropdown is pre-selected with your own (admin) name. Change it to a different vendedor, save, and confirm the new row shows that vendedor in the "Vendedor" column.
4. Log out and log in as a `vendedor` user. Confirm: the "Vendedor" column does not appear at all; opening "+ Novo Cliente" or editing one of their own clientes shows no "Vendedor responsável" field; a cliente they create is still owned by themselves.
5. As `vendedor`, confirm you still only see your own clientes in the list (no regression from the existing per-vendedor filter).
6. Back as `admin`, confirm search (by nome/empresa) and status still work exactly as before — no regression.
7. If there's a cliente with `user_id = null` (e.g. one orphaned by a prior user deletion), confirm it shows "— Sem vendedor —" in the column, and that assigning a vendedor to it via the edit dialog fixes it.

- [ ] **Step 7: Commit**

```bash
git add app/dashboard/clientes/actions.ts app/dashboard/clientes/page.tsx components/clientes/cliente-form.tsx components/clientes/clientes-table.tsx
git commit -m "feat(clientes): add vendedor assignment column and selector for admin/gerente"
```

---

## Push

Do not push. After Task 1 is committed and manually verified, stop and ask the user for explicit confirmation before `git push` — and remember the `crm` service's "Deploy Automático" is currently OFF, so a manual "Implantar" click in EasyPanel will also be needed after the push.
