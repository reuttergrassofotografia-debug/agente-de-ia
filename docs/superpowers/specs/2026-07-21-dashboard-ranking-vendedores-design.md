# CRM: Ranking de vendedores no Dashboard principal

## Contexto

Esta é a frente **C** mencionada na spec de [gestão de usuários](2026-07-10-crm-user-management-design.md) (§Contexto): mover o ranking de vendedores para o Dashboard principal (`app/dashboard/page.tsx`), no lugar do widget "Últimas atividades" (`ActivityFeed`). O componente (`components/relatorios/ranking-vendedores.tsx`) e as queries (`getRankingVendedores`, `getRankingVendedoresFiltrado`, em `lib/supabase/queries.ts`) já existem e estão em produção na tela de Relatórios — não há nada novo a construir, só reposicionar.

## Decisões (via brainstorming)

- **Layout:** substitui totalmente o `ActivityFeed` no grid de 3 colunas (Gráfico de vendas + Funil por etapa + Ranking). Não convivem lado a lado.
- **Período:** ranking acumulado, sem filtro de data — reusa `getRankingVendedores()` (a versão sem argumentos), consistente com o resto do Dashboard hoje, que também é tudo acumulado (Total de Clientes, Fechados, Taxa de Conversão etc. não têm filtro de período).
- **Visibilidade:** sem gate de role na página — mesmo padrão já usado em Relatórios. O RLS de `negocios` (`migration-fase2.sql`, `negocios_select`) já encolhe o dado sozinho: vendedor vê só os próprios negócios fechados (uma linha no ranking, ele mesmo), admin/gerente veem o time todo. Nenhuma lógica nova de acesso.

## Mudanças — repo `meu-crm`

### `app/dashboard/page.tsx`

- Troca o import de `getRecentActivity` por `getRankingVendedores` e de `ActivityFeed` por `RankingVendedores` (`@/components/relatorios/ranking-vendedores`).
- No `Promise.all` que busca `metrics`/`chartData`/`activities`, troca `getRecentActivity()` por `getRankingVendedores()`.
- No grid final, troca `<ActivityFeed activities={activities} />` por `<RankingVendedores ranking={ranking} />`.

### Remoção de código morto

`ActivityFeed` e `getRecentActivity` só são usados em `app/dashboard/page.tsx` (confirmado por busca no repo) — depois da troca, ninguém mais os referencia:

- Apaga `components/dashboard/activity-feed.tsx`.
- Apaga a função `getRecentActivity` em `lib/supabase/queries.ts`.

## Fora de escopo

- Qualquer mudança em Relatórios (`getRankingVendedoresFiltrado`, filtro por mês/vendedor) — continua exatamente como está.
- RLS ou migration — nenhuma tabela/política muda.
- Vazamento de `getDashboardMetrics`/`getRecentActivity` sem escopo por vendedor (achado na revisão final da spec de [controle de acesso por vendedor](2026-07-12-crm-vendor-access-control-design.md)) — item separado, não tratado aqui. Note que `getRecentActivity` está sendo removida por ficar sem uso, não por causa desse vazamento; o vazamento equivalente em `getDashboardMetrics` (que continua em uso, sem filtro por vendedor) permanece.

## Testes / verificação

Sem framework de teste automatizado neste repo — verificação via `npx tsc --noEmit`, `npm run lint`, `npm run build`, e validação manual: abrir o Dashboard como admin/gerente (ranking mostra o time todo) e como vendedor (ranking mostra só a própria linha), confirmar que "Últimas atividades" não aparece mais em lugar nenhum.
