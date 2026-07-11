# CRM: Gestão de Usuários em Configurações Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Corrigir o bug de usuários convidados ficarem com o nome em branco, e dar ao admin um jeito de editar nome/perfil e revogar/reativar o acesso de qualquer usuário em Configurações.

**Architecture:** Tudo em `meu-crm`. `banned_until` já é um campo nativo do Supabase Auth (`auth.users`) — "revogar acesso" só chama a Admin API pra banir/desbanir, sem nenhuma coluna nova no banco. `getUsuarios` passa a cruzar `profiles` com `admin.auth.admin.listUsers()` pra trazer esse status junto. O formulário de convite ganha um campo de nome opcional, e a função `alterarPerfil` é substituída por `editarUsuario` (nome + perfil juntos).

**Tech Stack:** TypeScript, Next.js App Router (Server Actions + Server Components), Supabase (Postgres + Auth Admin API).

## Global Constraints

- Nenhuma task faz `git push` — só commits locais.
- `meu-crm` não tem framework de teste — verificação é `npx tsc --noEmit`, `npm run lint`, `npm run build`. Baseline conhecido (confirmado antes desta rodada): 1 erro pré-existente de tsc (`app/dashboard/funil/actions.ts(22)` TS2394) e 6 problemas de lint (1 erro `react-hooks/set-state-in-effect` em `components/inbox/inbox-panel.tsx` + 5 warnings de `<img>`) — nenhum deles é regressão sua.
- "Excluir" usuário = revogar acesso (reversível), nunca apagar de verdade. Ninguém pode revogar a própria conta nem a do último admin do sistema — mesma regra que já existe pra rebaixar de perfil.
- Nenhuma coluna nova no banco — status ativo/inativo vem só de `auth.users.banned_until` via Admin API.

---

### Task 1: Backend — tipo, `getUsuarios` com status, e server actions

**Files:**
- Modify: `lib/types.ts`
- Modify: `lib/supabase/queries.ts`
- Modify: `app/dashboard/configuracoes/actions.ts`

**Interfaces:**
- Produces: `UsuarioComStatus` (tipo, `lib/types.ts`) — `Profile` mais `banned_until: string | null`. Consumido pela Task 3.
- Produces: `getUsuarios(): Promise<UsuarioComStatus[]>` (assinatura de retorno muda, nome da função não) — consumido por `app/dashboard/configuracoes/page.tsx` (ajustado na Task 3).
- Produces: `convidarUsuario(formData: FormData)` — mesma assinatura, passa a ler um campo `nome` opcional do FormData. Consumido pela Task 2.
- Produces: `editarUsuario(userId: string, nome: string, perfil: 'admin' | 'gerente' | 'vendedor'): Promise<{ erro?: string; sucesso?: true }>` — adicionada ao lado de `alterarPerfil` (que continua existindo até a Task 3 remover). Consumido pela Task 3.
- Produces: `revogarAcesso(userId: string): Promise<{ erro?: string; sucesso?: true }>` e `reativarAcesso(userId: string): Promise<{ erro?: string; sucesso?: true }>` — consumidos pela Task 3.

- [ ] **Step 1: Adicionar o tipo `UsuarioComStatus`**

Em `lib/types.ts`, troque:

```ts
export interface Profile {
  id: string
  nome: string | null
  perfil: 'admin' | 'gerente' | 'vendedor'
  created_at: string
  updated_at: string
}
```

por:

```ts
export interface Profile {
  id: string
  nome: string | null
  perfil: 'admin' | 'gerente' | 'vendedor'
  created_at: string
  updated_at: string
}

export interface UsuarioComStatus extends Profile {
  // banned_until vem do Supabase Auth (auth.users), não da tabela profiles —
  // null significa acesso ativo, qualquer string significa banido até essa data.
  banned_until: string | null
}
```

- [ ] **Step 2: `getUsuarios` passa a incluir o status de acesso**

Em `lib/supabase/queries.ts`, troque:

```ts
export async function getUsuarios() {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: false })
  return data ?? []
}
```

por:

```ts
export async function getUsuarios() {
  const supabase = await createClient()
  const admin = createAdminClient()
  const [{ data: profiles }, { data: authData }] = await Promise.all([
    supabase.from('profiles').select('*').order('created_at', { ascending: false }),
    admin.auth.admin.listUsers(),
  ])

  const bannedById = new Map((authData?.users ?? []).map((u) => [u.id, u.banned_until ?? null]))

  return (profiles ?? []).map((p) => ({ ...p, banned_until: bannedById.get(p.id) ?? null }))
}
```

(`createAdminClient` já está importado no topo do arquivo — é usado em `getDashboardMetrics` mais acima.)

- [ ] **Step 3: Convite passa a aceitar um nome opcional**

Em `app/dashboard/configuracoes/actions.ts`, troque:

```ts
export async function convidarUsuario(formData: FormData) {
  const email = (formData.get('email') as string)?.trim()
  const perfilRaw = (formData.get('perfil') as string) ?? 'vendedor'
  if (!email) return { erro: 'Email obrigatório' }
```

por:

```ts
export async function convidarUsuario(formData: FormData) {
  const email = (formData.get('email') as string)?.trim()
  const nome = (formData.get('nome') as string | null)?.trim() || null
  const perfilRaw = (formData.get('perfil') as string) ?? 'vendedor'
  if (!email) return { erro: 'Email obrigatório' }
```

Troque:

```ts
  if (novoUsuario?.user?.id) {
    const { error: perfilError } = await admin
      .from('profiles')
      .update({ perfil })
      .eq('id', novoUsuario.user.id)
    if (perfilError) return { erro: 'Convite enviado, mas falha ao definir perfil: ' + perfilError.message }
  }
```

por:

```ts
  if (novoUsuario?.user?.id) {
    const { error: perfilError } = await admin
      .from('profiles')
      .update({ perfil, ...(nome ? { nome } : {}) })
      .eq('id', novoUsuario.user.id)
    if (perfilError) return { erro: 'Convite enviado, mas falha ao definir perfil: ' + perfilError.message }
  }
```

- [ ] **Step 4: Adicionar `editarUsuario`, `revogarAcesso` e `reativarAcesso`**

`alterarPerfil` continua existindo por enquanto — `usuario-list.tsx` ainda a importa até a Task 3 trocar por `editarUsuario` no mesmo passo em que a remove daqui. Remover as duas coisas juntas nesta task deixaria o `tsc` quebrado até a Task 3 rodar.

No mesmo arquivo, logo depois do fim da função `alterarPerfil` (antes do fim do arquivo), adicione:

```ts

export async function editarUsuario(userId: string, nome: string, perfil: 'admin' | 'gerente' | 'vendedor') {
  const trimmedNome = nome.trim()
  if (!trimmedNome) return { erro: 'Nome não pode ser vazio' }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { erro: 'Não autenticado' }

  const { data: meuPerfil } = await supabase
    .from('profiles')
    .select('perfil')
    .eq('id', user.id)
    .single()

  if (meuPerfil?.perfil !== 'admin') return { erro: 'Apenas administradores podem editar usuários' }

  // Se está rebaixando alguém de admin, verificar se sobra pelo menos 1 admin
  if (perfil !== 'admin') {
    const { data: alvoProfile } = await supabase
      .from('profiles')
      .select('perfil')
      .eq('id', userId)
      .single()

    if (alvoProfile?.perfil === 'admin') {
      const { count: adminCount } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('perfil', 'admin')

      if ((adminCount ?? 0) <= 1) {
        return { erro: 'Não é possível remover o último administrador do sistema.' }
      }
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ nome: trimmedNome, perfil })
    .eq('id', userId)

  if (error) return { erro: error.message }

  revalidatePath('/dashboard/configuracoes')
  return { sucesso: true }
}

export async function revogarAcesso(userId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { erro: 'Não autenticado' }

  if (userId === user.id) return { erro: 'Você não pode revogar o próprio acesso.' }

  const { data: meuPerfil } = await supabase
    .from('profiles')
    .select('perfil')
    .eq('id', user.id)
    .single()

  if (meuPerfil?.perfil !== 'admin') return { erro: 'Apenas administradores podem revogar acesso' }

  const { data: alvoProfile } = await supabase
    .from('profiles')
    .select('perfil')
    .eq('id', userId)
    .single()

  if (alvoProfile?.perfil === 'admin') {
    const { count: adminCount } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      .eq('perfil', 'admin')

    if ((adminCount ?? 0) <= 1) {
      return { erro: 'Não é possível revogar o acesso do último administrador do sistema.' }
    }
  }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' })
  if (error) return { erro: error.message }

  revalidatePath('/dashboard/configuracoes')
  return { sucesso: true }
}

export async function reativarAcesso(userId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { erro: 'Não autenticado' }

  const { data: meuPerfil } = await supabase
    .from('profiles')
    .select('perfil')
    .eq('id', user.id)
    .single()

  if (meuPerfil?.perfil !== 'admin') return { erro: 'Apenas administradores podem reativar acesso' }

  const admin = createAdminClient()
  const { error } = await admin.auth.admin.updateUserById(userId, { ban_duration: 'none' })
  if (error) return { erro: error.message }

  revalidatePath('/dashboard/configuracoes')
  return { sucesso: true }
}
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: só o erro pré-existente conhecido (`app/dashboard/funil/actions.ts(22)` TS2394), nenhum erro novo. `alterarPerfil` continua existindo e `usuario-list.tsx` não foi tocado ainda, então nada quebra nesta task.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts lib/supabase/queries.ts app/dashboard/configuracoes/actions.ts
git commit -m "feat(configuracoes): add editarUsuario, revogarAcesso and access status to getUsuarios"
```

---

### Task 2: Frontend — campo de nome no convite

**Depends on:** Task 1 (`convidarUsuario` já aceita o campo `nome`). Sequencial no mesmo repo.

**Files:**
- Modify: `components/configuracoes/convidar-usuario-dialog.tsx`

**Interfaces:**
- Consumes: `convidarUsuario(formData: FormData)` (Task 1) — sem mudança de assinatura, só um novo campo no FormData enviado.

- [ ] **Step 1: Adicionar o campo "Nome" no formulário**

Em `components/configuracoes/convidar-usuario-dialog.tsx`, troque:

```tsx
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="usuario@empresa.com"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
```

por:

```tsx
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div>
            <label htmlFor="nome" className="block text-sm font-medium text-gray-700 mb-1">
              Nome (opcional)
            </label>
            <input
              id="nome"
              name="nome"
              type="text"
              placeholder="Nome completo"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
              Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="usuario@empresa.com"
              className="w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: só o erro pré-existente conhecido (`app/dashboard/funil/actions.ts(22)` TS2394), nenhum erro novo.

- [ ] **Step 3: Commit**

```bash
git add components/configuracoes/convidar-usuario-dialog.tsx
git commit -m "feat(configuracoes): add optional name field to invite form"
```

---

### Task 3: Frontend — editar usuário e revogar/reativar acesso na lista

**Depends on:** Task 1 (`editarUsuario`, `revogarAcesso`, `reativarAcesso`, `UsuarioComStatus`). Sequencial no mesmo repo.

**Files:**
- Create: `components/configuracoes/editar-usuario-dialog.tsx`
- Modify: `components/configuracoes/usuario-list.tsx`
- Modify: `app/dashboard/configuracoes/actions.ts` (remove `alterarPerfil`, já sem uso após este task)
- Modify: `app/dashboard/configuracoes/page.tsx`

**Interfaces:**
- Consumes: `editarUsuario`, `revogarAcesso`, `reativarAcesso` (Task 1); `UsuarioComStatus` (Task 1); padrão de dialog controlado já usado em `components/inbox/editar-contato-dialog.tsx` (mesmo `Dialog`/`DialogTrigger`/`DialogContent` de `@/components/ui/dialog`, `Input`/`Label` de `@/components/ui/input` e `@/components/ui/label`).
- Produces: `EditarUsuarioDialog` (componente, `userId: string`, `nomeAtual: string`, `perfilAtual: 'admin' | 'gerente' | 'vendedor'`) — usado só por `usuario-list.tsx`.

- [ ] **Step 1: Criar o dialog de editar usuário**

Crie `components/configuracoes/editar-usuario-dialog.tsx`:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { Pencil } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { editarUsuario } from '@/app/dashboard/configuracoes/actions'

interface Props {
  userId: string
  nomeAtual: string
  perfilAtual: 'admin' | 'gerente' | 'vendedor'
}

export function EditarUsuarioDialog({ userId, nomeAtual, perfilAtual }: Props) {
  const [open, setOpen] = useState(false)
  const [nome, setNome] = useState(nomeAtual)
  const [perfil, setPerfil] = useState(perfilAtual)
  const [erro, setErro] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleOpen(v: boolean) {
    setOpen(v)
    if (v) {
      setNome(nomeAtual)
      setPerfil(perfilAtual)
      setErro(null)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    startTransition(async () => {
      const resultado = await editarUsuario(userId, nome, perfil)
      if (resultado.erro) {
        setErro(resultado.erro)
      } else {
        setOpen(false)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger
        render={
          <button
            title="Editar usuário"
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors shrink-0"
          />
        }
      >
        <Pencil className="size-3.5" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar usuário</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="eusuario-nome">Nome</Label>
            <Input id="eusuario-nome" value={nome} onChange={e => setNome(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="eusuario-perfil">Perfil</Label>
            <select
              id="eusuario-perfil"
              value={perfil}
              onChange={e => setPerfil(e.target.value as 'admin' | 'gerente' | 'vendedor')}
              className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="vendedor">Vendedor</option>
              <option value="gerente">Gerente</option>
              <option value="admin">Admin</option>
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

- [ ] **Step 2: Reescrever `usuario-list.tsx`**

Troque o arquivo inteiro `components/configuracoes/usuario-list.tsx`:

```tsx
'use client'

import { useState } from 'react'
import { Profile } from '@/lib/types'
import { alterarPerfil } from '@/app/dashboard/configuracoes/actions'

interface UsuarioListProps {
  usuarios: Profile[]
  meuId: string
}

const PERFIL_CORES: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700',
  gerente: 'bg-blue-100 text-blue-700',
  vendedor: 'bg-gray-100 text-gray-600',
}

const PERFIL_LABELS: Record<string, string> = {
  admin: 'Admin',
  gerente: 'Gerente',
  vendedor: 'Vendedor',
}

export function UsuarioList({ usuarios, meuId }: UsuarioListProps) {
  const [salvando, setSalvando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function handleAlterarPerfil(userId: string, novoPerfil: 'admin' | 'gerente' | 'vendedor') {
    setSalvando(userId)
    setErro(null)
    const resultado = await alterarPerfil(userId, novoPerfil)
    setSalvando(null)
    if (resultado.erro) setErro(resultado.erro)
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      {erro && (
        <div className="px-6 py-3 bg-red-50 border-b text-sm text-red-600">{erro}</div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nome</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Desde</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Perfil</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {usuarios.map((u) => (
            <tr key={u.id} className="hover:bg-gray-50">
              <td className="px-6 py-4 font-medium text-gray-900">
                {u.nome ?? '—'}
                {u.id === meuId && (
                  <span className="ml-2 text-xs text-gray-400">(você)</span>
                )}
              </td>
              <td className="px-6 py-4 text-gray-500">
                {new Date(u.created_at).toLocaleDateString('pt-BR')}
              </td>
              <td className="px-6 py-4">
                {u.id === meuId ? (
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${PERFIL_CORES[u.perfil]}`}>
                    {PERFIL_LABELS[u.perfil]}
                  </span>
                ) : (
                  <select
                    value={u.perfil}
                    disabled={salvando === u.id}
                    onChange={(e) =>
                      handleAlterarPerfil(u.id, e.target.value as 'admin' | 'gerente' | 'vendedor')
                    }
                    className="text-sm border rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                  >
                    <option value="vendedor">Vendedor</option>
                    <option value="gerente">Gerente</option>
                    <option value="admin">Admin</option>
                  </select>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

por:

```tsx
'use client'

import { useState, useTransition } from 'react'
import { UsuarioComStatus } from '@/lib/types'
import { revogarAcesso, reativarAcesso } from '@/app/dashboard/configuracoes/actions'
import { EditarUsuarioDialog } from './editar-usuario-dialog'

interface UsuarioListProps {
  usuarios: UsuarioComStatus[]
  meuId: string
}

const PERFIL_CORES: Record<string, string> = {
  admin: 'bg-purple-100 text-purple-700',
  gerente: 'bg-blue-100 text-blue-700',
  vendedor: 'bg-gray-100 text-gray-600',
}

const PERFIL_LABELS: Record<string, string> = {
  admin: 'Admin',
  gerente: 'Gerente',
  vendedor: 'Vendedor',
}

export function UsuarioList({ usuarios, meuId }: UsuarioListProps) {
  const [salvando, setSalvando] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleToggleAcesso(userId: string, ativo: boolean) {
    setSalvando(userId)
    setErro(null)
    startTransition(async () => {
      const resultado = ativo ? await revogarAcesso(userId) : await reativarAcesso(userId)
      setSalvando(null)
      if (resultado.erro) setErro(resultado.erro)
    })
  }

  return (
    <div className="bg-white rounded-xl border shadow-sm overflow-hidden">
      {erro && (
        <div className="px-6 py-3 bg-red-50 border-b text-sm text-red-600">{erro}</div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-gray-50 border-b">
          <tr>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nome</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Desde</th>
            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Perfil</th>
            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {usuarios.map((u) => {
            const ativo = !u.banned_until
            const souEu = u.id === meuId
            return (
              <tr key={u.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 font-medium text-gray-900">
                  {u.nome ?? '—'}
                  {souEu && (
                    <span className="ml-2 text-xs text-gray-400">(você)</span>
                  )}
                  {!ativo && (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-600">
                      Inativo
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 text-gray-500">
                  {new Date(u.created_at).toLocaleDateString('pt-BR')}
                </td>
                <td className="px-6 py-4">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${PERFIL_CORES[u.perfil]}`}>
                    {PERFIL_LABELS[u.perfil]}
                  </span>
                </td>
                <td className="px-6 py-4 text-right">
                  {!souEu && (
                    <div className="flex justify-end items-center gap-1">
                      <EditarUsuarioDialog userId={u.id} nomeAtual={u.nome ?? ''} perfilAtual={u.perfil} />
                      <button
                        onClick={() => handleToggleAcesso(u.id, ativo)}
                        disabled={isPending && salvando === u.id}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md border disabled:opacity-50 ${
                          ativo ? 'text-red-600 border-red-200 hover:bg-red-50' : 'text-emerald-600 border-emerald-200 hover:bg-emerald-50'
                        }`}
                      >
                        {salvando === u.id ? '...' : ativo ? 'Revogar acesso' : 'Reativar acesso'}
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: Remover `alterarPerfil` de `actions.ts`**

Agora que `usuario-list.tsx` (Step 2) não a importa mais, remova a função inteira de `app/dashboard/configuracoes/actions.ts`:

```ts
export async function alterarPerfil(userId: string, novoPerfil: 'admin' | 'gerente' | 'vendedor') {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { erro: 'Não autenticado' }

  const { data: meuPerfil } = await supabase
    .from('profiles')
    .select('perfil')
    .eq('id', user.id)
    .single()

  if (meuPerfil?.perfil !== 'admin') return { erro: 'Apenas administradores podem alterar perfis' }

  // Se está rebaixando alguém de admin, verificar se sobra pelo menos 1 admin
  if (novoPerfil !== 'admin') {
    const { data: alvoProfile } = await supabase
      .from('profiles')
      .select('perfil')
      .eq('id', userId)
      .single()

    if (alvoProfile?.perfil === 'admin') {
      const { count: adminCount } = await supabase
        .from('profiles')
        .select('*', { count: 'exact', head: true })
        .eq('perfil', 'admin')

      if ((adminCount ?? 0) <= 1) {
        return { erro: 'Não é possível remover o último administrador do sistema.' }
      }
    }
  }

  const { error } = await supabase
    .from('profiles')
    .update({ perfil: novoPerfil })
    .eq('id', userId)

  if (error) return { erro: error.message }

  revalidatePath('/dashboard/configuracoes')
  return { sucesso: true }
}
```

Delete o bloco inteiro (do `export async function alterarPerfil` até o `}` de fechamento correspondente) — o restante do arquivo (`convidarUsuario`, `editarUsuario`, `revogarAcesso`, `reativarAcesso`) fica como está.

- [ ] **Step 4: Atualizar o tipo usado em `page.tsx`**

Em `app/dashboard/configuracoes/page.tsx`, troque:

```tsx
import { Profile } from '@/lib/types'
```

por:

```tsx
import { UsuarioComStatus } from '@/lib/types'
```

Troque:

```tsx
  const usuarios = isAdmin ? await getUsuarios() as Profile[] : []
```

por:

```tsx
  const usuarios = isAdmin ? await getUsuarios() as UsuarioComStatus[] : []
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: só o erro pré-existente conhecido (`app/dashboard/funil/actions.ts(22)` TS2394). `alterarPerfil` foi removida (Step 3) e nada mais a referencia.

- [ ] **Step 6: Lint**

Run: `npm run lint`
Expected: mesma contagem do baseline (6 problemas: 1 erro + 5 warnings), nenhum novo.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: sucesso.

- [ ] **Step 8: Verificação manual (se houver navegador disponível)**

1. Convide um usuário novo preenchendo o campo Nome — confirme que ele aparece na lista já com o nome certo (sem precisar editar depois).
2. Clique em "Editar" num usuário existente, mude o nome e/ou perfil, salve — confirme que a lista atualiza.
3. Clique em "Revogar acesso" num usuário — confirme que aparece a marca "Inativo" e que o botão vira "Reativar acesso". Tente logar como esse usuário (se possível) e confirme que o login é recusado.
4. Clique em "Reativar acesso" — confirme que a marca "Inativo" some e o login volta a funcionar.
5. Confirme que a própria linha do admin logado não mostra nem "Editar" nem "Revogar/Reativar".
6. Tente revogar o único admin do sistema (se você só tiver um) — confirme que a mensagem de erro aparece e nada é alterado.

Se não houver navegador disponível, pule este step e reporte explicitamente que não foi feito.

- [ ] **Step 9: Commit**

```bash
git add components/configuracoes/editar-usuario-dialog.tsx components/configuracoes/usuario-list.tsx app/dashboard/configuracoes/page.tsx app/dashboard/configuracoes/actions.ts
git commit -m "feat(configuracoes): add user edit dialog and revoke/reactivate access"
```
