# CRM: Deletar usuário em Configurações

## Contexto

Configurações (`meu-crm/app/dashboard/configuracoes`) já permite ao admin **editar** nome/perfil de qualquer usuário (`editarUsuario`) e **revogar/reativar acesso** (`revogarAcesso`/`reativarAcesso` — bane/desbane o login via `auth.admin.updateUserById(..., ban_duration)`, reversível, não apaga nada). O usuário pediu duas coisas: poder editar nome (já existe, nada a fazer) e poder **deletar** um usuário permanentemente — capacidade nova, distinta de revogar.

## Achado técnico que molda o design

Cadeia de constraints em torno de `profiles.id`:

- `profiles.id` → `auth.users(id)` **ON DELETE CASCADE** (`migration.sql`) — apagar o usuário no Supabase Auth já apaga a linha de `profiles` sozinho.
- `clientes.user_id`, `negocios.responsavel_id`, `tarefas.user_id` → `profiles(id)` **ON DELETE SET NULL** (`migration-fase2.sql`) — negócios/clientes/tarefas do usuário deletado ficam "sem dono" automaticamente, sem apagar nada.
- `contacts.responsavel_id` → `profiles(id)` **sem `ON DELETE` explícito** (`agente-de-ia/supabase/migrations/20260712_contacts_responsavel.sql`, default é `NO ACTION`) — se o usuário ainda for dono de conversas no Inbox, apagar o perfil **falha** com erro de foreign key.

Ou seja: o schema já trata negócios/clientes/tarefas do jeito certo (dono vira null). Só falta replicar esse comportamento pra `contacts` — mas sem mudar o schema, direto na server action, que já roda no mesmo projeto Supabase.

## Decisões (via brainstorming, confirmadas pelo usuário)

- **Conversas do WhatsApp do usuário deletado:** desatribuídas automaticamente (`contacts.responsavel_id = null`) antes de apagar o usuário — mesmo comportamento de "sem dono" já usado pra negócios/clientes/tarefas, sem precisar de migration nova.
- **Revogar acesso continua existindo** como ação separada e reversível; Deletar é uma ação nova, adicional, permanente.
- **Confirmação:** `confirm()` nativo do navegador com mensagem explicando a consequência — mesmo padrão já usado pelos outros deletes do CRM (`clientes-table.tsx`, `tarefa-list.tsx`), sem modal customizado novo.
- **Quem pode deletar:** só admin — mesma regra já aplicada a editar e revogar. Confirmado explicitamente pelo usuário.
- **Guardas:** não pode deletar a si mesmo; não pode deletar o último admin do sistema — mesmas guardas já existentes em `editarUsuario`/`revogarAcesso`, replicadas aqui.

## Mudanças — repo `meu-crm`

### `app/dashboard/configuracoes/actions.ts` — nova função `deletarUsuario`

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

Segue o mesmo formato de retorno (`{ erro }` / `{ sucesso: true }`) das outras funções do arquivo — `usuario-list.tsx` já sabe lidar com esse formato (`setErro(resultado.erro)`).

`clientes.user_id`, `negocios.responsavel_id` e `tarefas.user_id` não precisam de tratamento manual — o `ON DELETE SET NULL` já existente cuida disso quando `admin.auth.admin.deleteUser` apaga a linha de `auth.users` (que cascateia pra `profiles`).

### `components/configuracoes/usuario-list.tsx`

Novo botão "Deletar" na mesma célula de ações, ao lado de "Revogar acesso"/"Reativar acesso", visível só quando `!souEu` (mesma condição já usada pra esconder as ações da própria linha do admin logado).

```tsx
<button
  onClick={() => {
    if (!confirm(`Deletar "${u.nome ?? 'este usuário'}" permanentemente?\n\nIsso não pode ser desfeito. Negócios, clientes, tarefas e conversas do WhatsApp atribuídos a ele ficarão sem dono.`)) return
    setSalvando(u.id)
    setErro(null)
    startTransition(async () => {
      const resultado = await deletarUsuario(u.id)
      setSalvando(null)
      if (resultado.erro) setErro(resultado.erro)
    })
  }}
  disabled={isPending && salvando === u.id}
  className="px-2.5 py-1 text-xs font-medium rounded-md border text-red-700 border-red-300 hover:bg-red-50 disabled:opacity-50"
>
  {salvando === u.id ? '...' : 'Deletar'}
</button>
```

Precisa importar `deletarUsuario` de `@/app/dashboard/inbox/actions` — não, de `@/app/dashboard/configuracoes/actions` (mesmo import de `revogarAcesso`/`reativarAcesso`).

Se o usuário deletado com sucesso estava selecionado/em exibição em qualquer outra tela aberta, isso é responsabilidade do reload padrão do Next (`revalidatePath`) — sem tratamento especial.

## Fora de escopo

- Exportar ou arquivar os dados do usuário antes de deletar.
- Deletar em lote (múltiplos usuários de uma vez).
- Permitir `gerente` deletar — fica restrito a `admin`, mesma regra de `editarUsuario`/`revogarAcesso`.
- Qualquer migration/mudança de schema — a solução inteira roda em cima das constraints já existentes, só adicionando um `UPDATE` manual pra `contacts` antes do delete.
- Notificar o usuário deletado por e-mail ou qualquer outro canal.

## Testes / verificação

Sem framework de teste automatizado neste repo — verificação via `npx tsc --noEmit`, `npm run lint`, `npm run build`, e validação manual:

1. Como admin, deletar um vendedor de teste que **não** tem conversas/negócios atribuídos — confirma que a linha some da lista e o login dele para de funcionar.
2. Deletar um vendedor de teste que **tem** conversas no Inbox atribuídas a ele — confirma que a exclusão funciona (sem erro de foreign key) e que essas conversas aparecem como "sem dono" pros outros vendedores depois.
3. Tentar deletar a própria conta — confirma que o botão nem aparece (mesma regra de esconder ações na própria linha).
4. Com só 1 admin no sistema, tentar deletar esse admin (usando outra conta admin, se houver) — confirma a mensagem de erro do último admin.
5. Confirmar que "Revogar acesso"/"Reativar acesso" continuam funcionando normalmente, sem nenhuma mudança de comportamento.
