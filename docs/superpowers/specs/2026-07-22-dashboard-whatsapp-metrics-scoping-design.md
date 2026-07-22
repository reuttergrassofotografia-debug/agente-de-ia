# CRM: Escopar métricas de WhatsApp/Inbox do Dashboard por vendedor

## Contexto

Achado na revisão final do item B ([controle de acesso por vendedor](2026-07-12-crm-vendor-access-control-design.md)), registrado como fora de escopo naquele momento: `getDashboardMetrics` (`lib/supabase/queries.ts`) lê `conversations`/`messages`/`contacts` via client admin (service role, ignora RLS) sem nenhum filtro por vendedor — mesma classe de vazamento que o item B inteiro existia pra evitar, só que na tela do Dashboard em vez do Inbox/Funil/Clientes.

Antes de propor a correção, investiguei o estado atual do código (a lista de pendências original também citava `getRecentActivity`, mas essa função já foi deletada na rodada anterior — [ranking de vendedores no Dashboard](2026-07-21-dashboard-ranking-vendedores-design.md) — por ficar sem uso; não é mais parte deste trabalho).

## Achados do estado atual

`getDashboardMetrics` (`lib/supabase/queries.ts:8-70`) tem duas seções com comportamento bem diferente:

- **Seção CRM** (Total de Clientes, Em Aberto, Fechados, Tarefas Pendentes, Taxa de Conversão): usa `supabase = await createClient()` — o client de sessão normal, que **respeita RLS**. As políticas de `clientes`/`negocios`/`tarefas` (`migration-fase2.sql`) já restringem vendedor a `user_id`/`responsavel_id` próprio. **Essa seção já está corretamente escopada hoje, sem nenhuma mudança necessária.**
- **Seção WhatsApp/Inbox** (Conversas Ativas, Pausadas, Mensagens Hoje, Contatos Novos Hoje): usa `admin = createAdminClient()` — client de service role, que **ignora RLS por completo**. As 4 queries (`queries.ts:32-35`) não têm filtro nenhum: todo usuário, inclusive vendedor, vê a contagem da empresa inteira.

O Inbox (`getConversacoes`, `app/dashboard/inbox/actions.ts:11-48`) já resolve exatamente esse problema para a lista de conversas, com a regra: vendedor vê contatos com `responsavel_id = auth.uid()` **ou** `responsavel_id is null` (contato ainda sem dono, que ele pode "puxar" respondendo). Admin/gerente veem tudo, sem filtro. Essa é a regra a reaplicar aqui, por consistência — o Dashboard não deve mostrar a um vendedor um número que ele não consegue explicar abrindo o Inbox.

## Decisões (via brainstorming)

- **Escopo do vendedor:** as 4 métricas de WhatsApp/Inbox contam só os contatos do vendedor (próprios + sem dono ainda) — mesma regra do Inbox, aplicada aqui pela primeira vez ao Dashboard.
- **Escopo do gerente:** gerente vê as 4 métricas sem filtro (time todo), igual admin — mesmo padrão já usado em todo o resto do item B (Funil/Clientes/Inbox tratam gerente como equivalente a admin, nunca como vendedor).
- **Seção CRM do Dashboard:** sem mudança — já corretamente escopada via RLS, confirmado acima.

## Mudanças — repo `meu-crm`

### `lib/supabase/queries.ts` — `getDashboardMetrics`

Adiciona, logo após a criação dos clients (`supabase`/`admin`), a mesma resolução de perfil já usada em `getConversacoes`:

```ts
const { data: { user } } = await supabase.auth.getUser()
let souVendedor = false
if (user) {
  const { data: meuPerfil } = await supabase.from('profiles').select('perfil').eq('id', user.id).single()
  souVendedor = (meuPerfil?.perfil ?? 'vendedor') === 'vendedor'
}
```

Depois, para cada uma das 4 métricas, aplica o filtro condicional (só quando `souVendedor`):

- **`conversasAtivas` / `conversasPausadas`** (tabela `conversations`, já tem `contact_id`): reusa o padrão single-hop já validado em produção em `getConversacoes` — `select('*, contacts!inner(responsavel_id)', ...)` + `.or('responsavel_id.eq.<uid>,responsavel_id.is.null', { foreignTable: 'contacts' })`.
- **`contatosNovos`** (tabela `contacts`, é a própria tabela dona de `responsavel_id`, sem join): `.or('responsavel_id.eq.<uid>,responsavel_id.is.null')` direto, sem `foreignTable`.
- **`mensagensHoje`** (tabela `messages`, só tem `conversation_id` — precisa de 2 saltos até `contacts`): em vez de um filtro aninhado de 2 níveis (não há precedente disso em produção neste projeto, e não vale o risco de sintaxe PostgREST não testada num número que decide visibilidade de dado por vendedor), resolve em duas consultas sequenciais **só no caminho do vendedor**:
  1. Busca os `id`s de `conversations` visíveis ao vendedor (mesmo filtro single-hop de `conversasAtivas` acima, sem `head:true` desta vez — precisa dos IDs, não só da contagem).
  2. Conta `messages` com `.in('conversation_id', essesIds)`. Se a lista vier vazia, retorna 0 direto (sem chamar `.in([])`, que gera SQL inválido no PostgREST).

  Para admin/gerente, mantém a query única e simples que já existe hoje (sem os 2 passos).

Todas as 4 métricas continuam resolvidas dentro do mesmo `Promise.all` que já existe — a lógica sequencial de `mensagensHoje` no caminho vendedor fica encapsulada numa função async local, cuja Promise entra no mesmo array, então não perde paralelismo com as outras 9 métricas da função.

## Fora de escopo

- Qualquer mudança na seção CRM do Dashboard (já corretamente escopada, ver Achados).
- `getRecentActivity` — já foi removida por ficar sem uso, não existe mais.
- Qualquer outra tela além do Dashboard.
- RLS ou migration — nenhuma tabela/política muda; a correção é só na query já usada (mesmo padrão que `getConversacoes` usa há dias em produção, aplicado num client diferente).

## Testes / verificação

Sem framework de teste automatizado neste repo — verificação via `npx tsc --noEmit`, `npm run lint`, `npm run build`, e validação manual: abrir o Dashboard como admin/gerente (4 métricas mostram o total da empresa, sem mudança visível) e como vendedor (4 métricas mostram só a contagem dos contatos dele — comparar com o que aparece pra ele no Inbox, os números devem bater).
