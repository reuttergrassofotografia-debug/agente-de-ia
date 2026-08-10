# Funil: etapas dinâmicas (criar, reordenar, colorir) — repo `meu-crm`

## Contexto

Hoje o Funil de Vendas tem exatamente 5 etapas fixas — `lead`, `proposta`, `negociacao`, `fechado`, `encerrado` — hardcoded como um **enum do Postgres** (`etapa_enum`, `migration-fase2.sql`) e repetidas literalmente em 12 arquivos do frontend (kanban, formulário de negócio, dashboard, relatórios). Duas regras de negócio estão amarradas aos nomes exatos dessas etapas, não a um conceito genérico:

1. **`encerrado` exige motivo** — imposto por um `CHECK` no banco (`chk_motivo`) e duplicado em `app/dashboard/funil/actions.ts`.
2. **`fechado` é a etapa "ganha"** — usada em `lib/supabase/queries.ts` para calcular receita fechada, taxa de conversão e ranking de vendedores (`getDashboardMetrics`, `getSalesChartData`, `getTaxaConversaoPorEtapa`, `getRankingVendedores*`).

Pedido do usuário, a partir de prints de um CRM de referência: poder **criar novas etapas** e **reordenar** as existentes no Funil.

## Goals

- Etapas do Funil deixam de ser fixas: usuário cria, renomeia, recolore, reordena e exclui (etapa vazia) livremente.
- As duas regras de negócio hoje amarradas a `encerrado`/`fechado` continuam funcionando — mas como **propriedades configuráveis por etapa**, não mais por nome fixo.
- Nenhum negócio existente muda de etapa nem perde dados na migração.
- Dashboard, relatórios e ranking de vendedores continuam corretos com qualquer conjunto de etapas que o usuário definir.

## Non-goals (fora desta spec)

- Múltiplos funis/pipelines (o print de referência mostra um seletor de funil no topo — não replicado; continua um único funil, como hoje).
- Color picker livre — a cor de cada etapa é escolhida entre as cores já existentes no design system (violeta, azul, teal, âmbar, verde, vermelho), não uma paleta arbitrária.
- Automação/regras condicionais além de "exigir motivo" (ex: mover automaticamente após X dias) — não pedido.

## Decisões (via brainstorming)

- **"Exigir motivo" vira uma opção por etapa** (checkbox ao criar/editar qualquer etapa), não mais amarrada ao nome "Encerrado" especificamente. A etapa "Encerrado" (semeada na migração) já vem com essa opção ligada por padrão; o usuário pode ligar em outras etapas que criar.
- **Cor escolhida pelo usuário**, dentre a paleta curada do design system — sem picker de cor livre.
- **Classificação por tipo** (`aberto` | `ganho` | `perdido`), necessária tecnicamente para dashboard/relatórios continuarem corretos sem depender de nomes fixos — confirmada com o usuário. `fechado` (semeada) → `ganho`; `encerrado` (semeada) → `perdido`; as demais → `aberto`. Isso é ortogonal a "exigir motivo": uma etapa pode ser `perdido` sem exigir motivo, ou `aberto` e exigir motivo, são dois eixos independentes.
- **Guarda-corpos na exclusão**: nunca permitir excluir a última etapa restante, nem uma etapa que tenha negócios nela (bloqueia com mensagem clara, sem realocação automática).
- **Quem gerencia etapas**: apenas admin/gerente (mesmo padrão de outras configurações estruturais do CRM) — vendedor continua só movendo cards entre etapas já existentes.

## Modelo de dados

Nova tabela `etapas_funil`:

| Coluna | Tipo | Notas |
|---|---|---|
| `id` | uuid PK | `gen_random_uuid()` |
| `nome` | text NOT NULL | |
| `cor` | text NOT NULL | uma de: `violeta`, `azul`, `teal`, `ambar`, `verde`, `vermelho` (CHECK) |
| `ordem` | integer NOT NULL | posição no board, 0-based |
| `tipo` | text NOT NULL DEFAULT `'aberto'` | `aberto` \| `ganho` \| `perdido` (CHECK) |
| `exige_motivo` | boolean NOT NULL DEFAULT `false` | |
| `created_at` | timestamptz NOT NULL DEFAULT now() | |

`negocios.etapa` (hoje `etapa_enum`) é substituída por `negocios.etapa_id uuid REFERENCES etapas_funil(id)`. A migração:
1. Cria `etapas_funil` e semeia as 5 etapas atuais, na ordem atual, com `tipo`/`exige_motivo` conforme a tabela de decisões acima.
2. Adiciona `negocios.etapa_id`, faz backfill fazendo o join do `etapa` enum antigo com o `nome` recém-semeado (mapeamento 1:1 por posição, não por nome livre — os 5 nomes semeados são exatamente os 5 valores do enum antigo).
3. Remove `negocios.etapa` (coluna antiga) e o tipo `etapa_enum` (`DROP TYPE`), e o `CHECK chk_motivo` (substituído pelo trigger abaixo).

**Trigger de validação** (substitui o `CHECK chk_motivo`, que não pode consultar outra tabela): `BEFORE INSERT OR UPDATE ON negocios` — busca `exige_motivo` de `etapas_funil` para `NEW.etapa_id`; se verdadeiro e `motivo_encerramento` for nulo/vazio, `RAISE EXCEPTION`.

**Trigger `notificar_negocio_movido`** (já existe, `migration-fase6.sql`) precisa trocar `NEW.etapa` (hoje um enum, vira texto direto na mensagem) por um `SELECT nome FROM etapas_funil WHERE id = NEW.etapa_id` para montar a mesma mensagem de notificação.

**RLS em `etapas_funil`**: SELECT liberado a qualquer usuário autenticado (todo mundo precisa ver as etapas pra renderizar o board). INSERT/UPDATE/DELETE só para `perfil IN ('admin', 'gerente')`.

## Mudanças — repo `meu-crm`

### Backend / queries

- `app/dashboard/funil/actions.ts`: `ETAPAS_VALIDAS`/`Etapa` (union fixa) somem. `criarNegocio`/`moverNegocio`/validação de motivo passam a consultar `etapas_funil` (buscar `tipo`/`exige_motivo` da etapa de destino) em vez de comparar strings fixas. Novas actions: `criarEtapa`, `editarEtapa`, `excluirEtapa` (com os guarda-corpos), `reordenarEtapas` (recebe a nova ordem completa, atualiza `ordem` em lote).
- `lib/supabase/queries.ts`: `getDashboardMetrics`, `getSalesChartData`/`getVendasUltimosSeisMeses`, `getTaxaConversaoPorEtapa`, `getRankingVendedores`, `getRankingVendedoresFiltrado` — toda comparação `.eq('etapa', 'fechado')`/`.in('etapa', [...])`/`.neq('etapa', 'encerrado')` passa a primeiro buscar os `id`s de `etapas_funil` pelo `tipo` relevante (`ganho`, `aberto`, ou `!= 'perdido'`) e filtrar `negocios` por `.in('etapa_id', ids)` — mesmo resultado, sem depender de nomes fixos. `getTaxaConversaoPorEtapa`/`etapaMap` iteram sobre as etapas reais (`etapas_funil`, ordenadas por `ordem`) em vez do array fixo de 5.
- `lib/types.ts`: `Negocio.etapa: 'lead' | ... ` vira `etapa_id: string`, mais um novo tipo `EtapaFunil { id, nome, cor, ordem, tipo, exige_motivo }`.

### Frontend

- `components/funil/kanban-column.tsx`: `COLUNAS` (array fixo) some — colunas vêm de `etapas_funil` via prop, ordenadas por `ordem`. `cor` mapeia pra classes Tailwind via um lookup estático (mesmo padrão já usado aqui e em `grafico-funil.tsx`/`dashboard/page.tsx` — Tailwind precisa de classes literais, não computadas).
- `components/funil/kanban-board.tsx`: recebe a lista de etapas como prop (do server component pai); "+ Nova Etapa" ao final das colunas (dialog simples: nome, cor, tipo, exige motivo); menu "⋮" por coluna (editar as mesmas 4 propriedades, excluir com guarda-corpo); arrastar-para-reordenar usa o `@dnd-kit/core` já presente no projeto, numa segunda área de drag distinta do drag de cards (cards continuam arrastáveis entre colunas como hoje).
- `components/funil/negocio-form.tsx`, `components/clientes/cliente-form.tsx` (usa etapa também): o `<select>` de etapa passa a listar as etapas dinâmicas em vez de 4 opções fixas.
- `app/dashboard/page.tsx` (`ETAPA_CONFIG`) e `components/relatorios/grafico-funil.tsx` (`CORES`/`LABELS`): param de assumir 5 etapas fixas, renderizam a lista real vinda do banco.
- `components/dashboard/funil-etapas-card.tsx`: já recebe `etapas` como prop genérica — não deve precisar mudar, só o formato exato do dado que chega (confirmar ao implementar).

## Testes

Sem suíte automatizada neste projeto (mesmo padrão já estabelecido) — verificação manual/visual, mais confirmação direta no banco (via script read-only, como já fizemos para a feature de tom/finalidade do agente) de que: etapas antigas foram seedadas corretamente, negócios existentes mantiveram a etapa correta após a migração, e o trigger de motivo obrigatório dispara certo pra qualquer etapa marcada `exige_motivo = true` (não só a antiga "Encerrado").
