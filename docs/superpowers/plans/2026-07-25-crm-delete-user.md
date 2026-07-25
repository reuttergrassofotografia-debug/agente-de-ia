# CRM: Deletar usuário Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin permanently delete a user from Configurações — distinct from the existing reversible "Revogar acesso" (ban) — while safely orphaning (not cascading deletes onto) any data that user owned.

**Architecture:** One new server action (`deletarUsuario`) in the existing `configuracoes/actions.ts`, following the exact guard/return-shape pattern already used by `editarUsuario`/`revogarAcesso` in that file. It nulls `contacts.responsavel_id` by hand (the one FK in the schema without `ON DELETE SET NULL`), then calls `admin.auth.admin.deleteUser`, which cascades through `profiles` (`ON DELETE CASCADE`) and, via that, sets `clientes.user_id`/`negocios.responsavel_id`/`tarefas.user_id` to null automatically (those already have `ON DELETE SET NULL`). One new button in `usuario-list.tsx`, using the same native `confirm()` pattern already used by `clientes-table.tsx` and `tarefa-list.tsx` for destructive deletes elsewhere in this app. No schema change, no migration.

**Tech Stack:** Next.js 16 (App Router, Server Actions), Supabase JS (`@supabase/supabase-js` admin client + `auth.admin.deleteUser`), TypeScript, React (`useTransition`).

**Repo:** `meu-crm` (local checkout: `C:\Users\rgrasso\claude teste\meu-crm`) — run every command below from that directory.

## Global Constraints

- No automated test framework in `meu-crm` — verification is `npx tsc --noEmit`, `npm run lint`, `npm run build`, plus manual validation in the browser (per [[sdd_fable_workflow]] memory). Do not write Jest/Vitest tests for this plan.
- Follow the existing code style in the touched files exactly (no semicolons, single quotes, existing import ordering conventions) — do not reformat unrelated lines.
- Only `admin` can delete users — same restriction already enforced for edit/revoke in this file.
- Deleting is irreversible; "Revogar acesso" must keep working unchanged (see spec `docs/superpowers/specs/2026-07-25-crm-delete-user-design.md`).
- Do not run `git push` — commit locally only. Pushing is a deploy trigger in this project and needs explicit user confirmation first.

---

### Task 1: Add `deletarUsuario` server action and wire the "Deletar" button

**Files:**
- Modify: `app/dashboard/configuracoes/actions.ts` (append after `reativarAcesso`, currently ends at line 171)
- Modify: `components/configuracoes/usuario-list.tsx`

**Interfaces:**
- Produces: `deletarUsuario(userId: string): Promise<{ erro: string } | { sucesso: true }>`, exported from `app/dashboard/configuracoes/actions.ts`. Same return shape as `revogarAcesso`/`reativarAcesso`/`editarUsuario` in the same file — no other task depends on this, it's the final piece of the plan.

- [ ] **Step 1: Add `deletarUsuario` to `actions.ts`**

Open `app/dashboard/configuracoes/actions.ts`. After the closing `}` of `reativarAcesso` (line 171), append:

```ts

export async function deletarUsuario(userId: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { erro: 'Não autenticado' }

  if (userId === user.id) return { erro: 'Você não pode deletar seu próprio usuário.' }

  const { data: meuPerfil } = await supabase
    .from('profiles')
    .select('perfil')
    .eq('id', user.id)
    .single()

  if (meuPerfil?.perfil !== 'admin') return { erro: 'Apenas administradores podem deletar usuários' }

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
      return { erro: 'Não é possível deletar o último administrador do sistema.' }
    }
  }

  const admin = createAdminClient()

  // contacts.responsavel_id não tem ON DELETE SET NULL — desatribui na mão antes de
  // apagar o usuário, senão o deleteUser abaixo falha com violação de foreign key.
  await admin.from('contacts').update({ responsavel_id: null }).eq('responsavel_id', userId)

  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) return { erro: error.message }

  revalidatePath('/dashboard/configuracoes')
  return { sucesso: true }
}
```

This mirrors `editarUsuario`'s self-edit guard and `revogarAcesso`'s last-admin guard, both already in this file above — same checks, new action.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors referencing `app/dashboard/configuracoes/actions.ts`. (A pre-existing, unrelated error in `app/dashboard/funil/actions.ts` may appear — ignore it, it predates this change.)

- [ ] **Step 3: Add the "Deletar" button to `usuario-list.tsx`**

Open `components/configuracoes/usuario-list.tsx`.

Update the import on line 5 from:

```tsx
import { revogarAcesso, reativarAcesso } from '@/app/dashboard/configuracoes/actions'
```

to:

```tsx
import { revogarAcesso, reativarAcesso, deletarUsuario } from '@/app/dashboard/configuracoes/actions'
```

Then find the actions cell (lines 79-94):

```tsx
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
```

Replace with (adds `handleDeletar` call inline and a new button after the revogar/reativar one):

```tsx
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
                      <button
                        onClick={() => handleDeletar(u.id, u.nome)}
                        disabled={isPending && salvando === u.id}
                        className="px-2.5 py-1 text-xs font-medium rounded-md border text-red-700 border-red-300 hover:bg-red-50 disabled:opacity-50"
                      >
                        {salvando === u.id ? '...' : 'Deletar'}
                      </button>
                    </div>
                  )}
                </td>
```

Now add the `handleDeletar` function. Insert it right after `handleToggleAcesso` (after its closing `}` on line 38):

```tsx
  function handleDeletar(userId: string, nome: string | null) {
    if (!confirm(`Deletar "${nome ?? 'este usuário'}" permanentemente?\n\nIsso não pode ser desfeito. Negócios, clientes, tarefas e conversas do WhatsApp atribuídos a ele ficarão sem dono.`)) return
    setSalvando(userId)
    setErro(null)
    startTransition(async () => {
      const resultado = await deletarUsuario(userId)
      setSalvando(null)
      if (resultado.erro) setErro(resultado.erro)
    })
  }
```

- [ ] **Step 4: Type-check, lint, and build**

Run: `npx tsc --noEmit`
Expected: no errors referencing `components/configuracoes/usuario-list.tsx` or `app/dashboard/configuracoes/actions.ts`.

Run: `npm run lint`
Expected: no new errors (pre-existing warnings/errors in other files, e.g. `components/inbox/inbox-panel.tsx`, are unrelated and acceptable).

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Manual verification**

Start the dev server (`npm run dev`), log in as an `admin` user, open Configurações, and confirm:

1. Every user row except your own now shows three actions: edit (pencil icon), "Revogar acesso"/"Reativar acesso", and "Deletar".
2. Click "Deletar" on a test vendedor with no assigned deals/contacts. Confirm the browser `confirm()` dialog shows the warning text. Accept it — the row disappears from the list, and that user can no longer log in.
3. Create/pick a test vendedor who owns at least one contact in the Inbox (`contacts.responsavel_id` set to them) and at least one negócio. Delete them. Confirm no error occurs, and afterward:
   - That negócio's "responsável" is now empty in the Funil.
   - That Inbox conversation shows as unassigned and is claimable by any vendedor (per the existing auto-assign-on-reply rule).
4. Confirm your own row still has no "Deletar" button (or any action buttons at all — `souEu` hides the whole actions cell).
5. If a second admin account is available, reduce the system to a single admin and attempt to delete that last admin — confirm the red error banner shows "Não é possível deletar o último administrador do sistema." and the user is not deleted.
6. Confirm "Revogar acesso" / "Reativar acesso" still work exactly as before (no regression).

- [ ] **Step 6: Commit**

```bash
git add app/dashboard/configuracoes/actions.ts components/configuracoes/usuario-list.tsx
git commit -m "feat(configuracoes): add permanent user deletion for admins"
```

---

## Push

Do not push. After Task 1 is committed and manually verified, stop and ask the user for explicit confirmation before `git push` (EasyPanel auto-deploys the `crm` service on push to `main`).
