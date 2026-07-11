# CRM: Gestão de Usuários em Configurações

## Contexto

O CRM (`meu-crm`) já tem um sistema de perfis (`profiles.perfil`: `admin` / `gerente` / `vendedor`) e uma tela em Configurações que lista usuários e deixa o admin trocar o perfil de qualquer um via um `<select>` inline. Faltam duas coisas que o usuário pediu: usuários **convidados** aparecem com o nome em branco na lista, e não existe forma de editar o nome ou de desativar o acesso de alguém.

Esta é a primeira de três frentes relacionadas discutidas no brainstorming (gestão de usuários / controle de acesso por vendedor / ranking de vendedores) — as outras duas (**B**: restringir visão do Funil e Inbox por vendedor; **C**: ranking de vendedores no dashboard principal, no lugar do widget de "últimas atividades") ficam para specs e planos separados, propositalmente, por serem subsistemas relativamente independentes. A decisão de posicionamento do ranking (C) já foi capturada aqui para não se perder: **substitui o widget de "últimas atividades" do dashboard principal**.

## Causa raiz do bug do nome em branco

`convidarUsuario` (`app/dashboard/configuracoes/actions.ts`) cria o usuário via `admin.auth.admin.inviteUserByEmail(email)`, que não recebe nenhum metadado de nome — diferente do autocadastro (`components/auth/signup-form.tsx`), que manda `data: { nome }` no `supabase.auth.signUp(...)`. O gatilho que popula `profiles.nome` a partir dos metadados do `auth.users` não tem o que copiar para usuários convidados, então `profiles.nome` fica `null` permanentemente para todo mundo que entrou por convite (a maioria dos usuários deste CRM).

## Decisões (via brainstorming)

- **Escopo do "editar":** um único formulário por usuário reunindo **nome** e **perfil** juntos — substitui o `<select>` solto atual (que só trocava perfil). E-mail não é editável pelo admin (gerenciado pelo próprio usuário via Supabase Auth).
- **Escopo do "excluir":** não é exclusão de verdade — é **revogar acesso** (bloquear login), reversível. Histórico do usuário (negócios, mensagens) permanece intacto. O mesmo botão vira "Reativar" para desfazer.
- **Correção da causa raiz:** adicionar campo "Nome" opcional no formulário de convite, para que convites novos já nasçam com nome preenchido. Usuários já existentes com nome em branco são corrigidos manualmente pelo admin usando a nova função de editar.
- **Regras de segurança**, no mesmo padrão que já existe para troca de perfil (`alterarPerfil` já impede rebaixar o último admin):
  - Admin não pode revogar a própria conta.
  - Admin não pode revogar o último admin do sistema.

## Mudanças — repo `meu-crm`

### Mecanismo de revogar/reativar acesso

Usa a Supabase Admin API diretamente — **sem nova coluna no banco**. `banned_until` já é um campo nativo de `auth.users`, exposto via `supabase.auth.admin.updateUserById(userId, { ban_duration: '876000h' })` para banir (usa uma duração bem longa como "permanente" reversível) e `{ ban_duration: 'none' }` para reativar. Isso bloqueia novos logins; uma sessão já ativa continua válida até o token expirar (comportamento padrão do Supabase, aceitável — não é uma sessão de longa duração neste projeto).

### `lib/supabase/queries.ts` — `getUsuarios`

Hoje lê só a tabela `profiles`. Passa a também consultar `admin.auth.admin.listUsers()` (mesmo padrão de client admin já usado em `convidarUsuario`) e cruzar por `id`, incluindo `banned_until` no retorno de cada usuário — é isso que a lista usa para mostrar "Inativo" e decidir se o botão mostra "Revogar" ou "Reativar".

### `app/dashboard/configuracoes/actions.ts`

- `convidarUsuario`: aceita um novo campo opcional `nome` do formulário; se preenchido, grava em `profiles.nome` junto com o `perfil` (mesma chamada que já grava o perfil após o convite).
- Nova função `editarUsuario(userId, nome, perfil)`: substitui `alterarPerfil` — mesmas checagens de admin e de "não pode rebaixar o último admin" (reaproveitadas), mais a atualização do nome. `alterarPerfil` é removida (nenhum outro call site a usa).
- Nova função `revogarAcesso(userId)`: checa admin, bloqueia auto-revogação, bloqueia revogar o último admin (mesma contagem de `alterarPerfil`), chama `admin.auth.admin.updateUserById(userId, { ban_duration: '876000h' })`.
- Nova função `reativarAcesso(userId)`: checa admin, chama `admin.auth.admin.updateUserById(userId, { ban_duration: 'none' })`.

### `components/configuracoes/convidar-usuario-dialog.tsx`

Adiciona um campo de texto opcional "Nome" no formulário, antes do campo de e-mail ou logo depois — enviado como parte do `FormData` para `convidarUsuario`.

### `components/configuracoes/usuario-list.tsx`

- Cada linha ganha um badge "Inativo" (cinza, ao lado do nome) quando o usuário está banido.
- O `<select>` de perfil inline é removido.
- Novo botão "Editar" por linha (exceto a própria, que continua só mostrando o badge de perfil) abre um formulário inline ou modal simples com nome + perfil, salvando via `editarUsuario`.
- Novo botão "Revogar acesso" / "Reativar acesso" (texto muda conforme o estado atual), oculto na própria linha do admin logado.

## Fora de escopo (fica para as specs B e C)

- Qualquer restrição de leitura no Funil ou Inbox por vendedor/gerente.
- Ranking de vendedores no dashboard principal.
- Edição de e-mail de login pelo admin.
- Um fluxo de "completar cadastro" no primeiro acesso do usuário convidado (o admin pode preencher o nome no convite ou depois via editar; não há tela adicional para o próprio usuário definir o nome no primeiro login).

## Testes / verificação

Sem framework de teste automatizado neste repo — verificação via `npx tsc --noEmit`, `npm run lint`, `npm run build`, e validação manual: convidar um usuário com nome preenchido, editar nome/perfil de um usuário existente, revogar e reativar acesso (confirmando que o usuário revogado não consegue logar), e confirmar que as duas regras de segurança (não revogar a si mesmo, não revogar o último admin) bloqueiam corretamente.
