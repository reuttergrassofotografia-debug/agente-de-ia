# CRM: Nomear e visualizar vendedor responsável em Clientes

## Contexto

Hoje `clientes.user_id` é setado automaticamente pra quem cria o registro e nunca pode ser trocado — não existe coluna "Vendedor" na listagem nem seletor no formulário. Isso é a mesma classe de funcionalidade já implementada no Inbox (`ReatribuirDialog`, controle de acesso por vendedor — item B), só que ainda não replicada na tela de Clientes (`/dashboard/clientes`).

Pedido do usuário, a partir de screenshot da tela de Clientes: como admin, poder nomear o vendedor responsável por um cliente e ver numa coluna quem é esse responsável.

## Estado atual (verificado no código)

- `app/dashboard/clientes/page.tsx`: busca clientes filtrando por `user_id = auth.uid()` quando `souVendedor`; admin/gerente veem todos, sem filtro.
- `app/dashboard/clientes/actions.ts`: `criarCliente` sempre grava `user_id: user.id` (quem cria); `editarCliente`/`excluirCliente` não tocam em `user_id`, só scopam a query por `user_id` quando o ator é vendedor.
- `components/clientes/clientes-table.tsx`: colunas atuais — Nome, Empresa, Email, Status, ações. Sem coluna de vendedor.
- `components/clientes/cliente-form.tsx`: modal único usado tanto pra criar quanto editar (`ClienteForm`). Campos: nome, empresa, email, telefone, status. Sem campo de vendedor.
- `lib/types.ts` (`Cliente`): já tem `user_id: string | null` — a FK já existe e permite null (`clientes.user_id` tem `ON DELETE SET NULL`, confirmado no plano do item B — deletar um usuário orfaniza os clientes dele, não os apaga).
- RLS: `migration-fase5.sql` já criou `clientes_gerente_update`/`clientes_gerente_delete` — gerente já pode escrever em qualquer cliente no banco. Nenhuma migration nova é necessária.
- Precedente de UI a reaproveitar: `getProfilesParaFiltro()` (`lib/supabase/queries.ts:161-168`) — já usada pelo Inbox pra listar `{id, nome}` de todos os perfis (sem filtro de ativo/banido, mesmo comportamento a manter aqui).

## Decisões (via brainstorming)

- **Quem vê e reatribui:** admin e gerente — mesmo padrão já usado em Inbox/Funil (vendedor nunca vê nem gerencia atribuição de outros).
- **Onde fica o seletor:** dentro do modal existente `ClienteForm` (criar e editar), não um diálogo dedicado separado — reaproveita a tela já existente.
- **Padrão ao criar:** campo vem pré-selecionado com quem está criando (admin/gerente), mas editável na hora, sem exigir escolha obrigatória.
- **Cliente sem vendedor (órfão por delete de usuário):** coluna mostra "— Sem vendedor —"; o formulário trata como nenhuma opção selecionada, e admin/gerente escolhe um vendedor pra corrigir.
- **Lista de opções do seletor:** todos os perfis (`getProfilesParaFiltro`), sem filtro de ativo/banido — mesmo comportamento já aceito no Inbox, não é escopo desta feature mudar isso.

## Mudanças — repo `meu-crm`

### `app/dashboard/clientes/page.tsx`

Passa a buscar também a lista de perfis (`getProfilesParaFiltro`) e repassa `meuPerfil`, `meuUserId` (= `user.id`, já disponível) e `profiles` pra `ClientesTable` (que hoje só recebe `clientes` e `q`).

### `components/clientes/clientes-table.tsx`

- Novas props: `meuPerfil: string`, `meuUserId: string` e `profiles: { id: string; nome: string | null }[]`.
- Nova coluna "Vendedor", renderizada só quando `meuPerfil !== 'vendedor'` (cabeçalho e células), posicionada entre "Status" e a coluna de ações. Mostra o nome do vendedor responsável (`profiles.find(p => p.id === cliente.user_id)?.nome`) ou "— Sem vendedor —" quando `cliente.user_id` é `null` ou não bate com nenhum perfil.
- Repassa `meuPerfil`, `meuUserId` e `profiles` pro `ClienteForm` (criar e editar).

### `components/clientes/cliente-form.tsx`

- Novas props: `meuPerfil: string`, `meuUserId: string`, `profiles: { id: string; nome: string | null }[]`.
- Quando `meuPerfil !== 'vendedor'`: renderiza um `<select name="vendedorId">` logo após o campo Status, com todos os `profiles` como opções. Valor inicial: `cliente?.user_id ?? meuUserId` — ao editar, o dono atual do cliente; ao criar, pré-selecionado com quem está logado (editável em ambos os casos).
- Quando `meuPerfil === 'vendedor'`: campo não renderiza, comportamento idêntico ao atual.
- `meuUserId` é resolvido uma vez em `page.tsx` (já tem `user.id` disponível ali) e repassado por `ClientesTable` até `ClienteForm`, sem nova chamada ao Supabase.

### `app/dashboard/clientes/actions.ts`

- `criarCliente`: lê `vendedorId` do FormData. Se `perfil !== 'vendedor'` e `vendedorId` foi enviado e não-vazio, usa esse valor como `user_id`; caso contrário (vendedor criando, ou campo vazio), mantém o comportamento atual (`user_id: user.id`).
- `editarCliente`: lê `vendedorId` do FormData. Só inclui `user_id` no objeto de update quando `perfil !== 'vendedor'` — guarda de segurança explícita: mesmo que a requisição seja adulterada, um vendedor nunca consegue mudar o dono de um cliente por essa ação. Quando `perfil !== 'vendedor'` e `vendedorId` vier vazio, mantém o `user_id` atual do registro (não define como null implicitamente).

## Fora de escopo

- Nenhuma mudança de RLS ou migration — banco já suporta (verificado acima).
- Filtro/aba por vendedor na listagem de Clientes (como existe no Inbox) — não foi pedido, não incluído.
- Filtrar usuários banidos/inativos do seletor — mantém o mesmo comportamento já aceito no Inbox (`getProfilesParaFiltro` sem filtro).
- Réplica do mesmo padrão em Funil (`negocios` já tem `responsavel_id` mas também não tem UI de reatribuição) — mencionado aqui só como precedente técnico, não faz parte deste trabalho.
