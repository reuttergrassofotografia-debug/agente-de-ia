# Funil: etapas dinâmicas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed 5-stage `etapa_enum` on `meu-crm`'s `negocios` table with a user-managed `etapas_funil` table (create, rename, recolor, reorder, delete), while preserving the "encerrado exige motivo" and "fechado conta como receita ganha" business rules as per-stage configurable properties.

**Architecture:** One new table (`etapas_funil`) + a FK column (`negocios.etapa_id`) replacing the enum. All server-side code that today compares `etapa` to a literal string switches to looking up the relevant stage(s) by `tipo` (`aberto`/`ganho`/`perdido`) or by `exige_motivo`. All frontend code that today hardcodes the 5 stages renders the real list from the database, ordered by `ordem`. A shared color-class lookup module keeps the 3 places that render stage colors in sync.

**Tech Stack:** Next.js Server Actions, Supabase (Postgres + RLS), `@dnd-kit/core` (already a dependency, used for card drag — reused for column reordering).

## Global Constraints

- No negócio may change stage or lose data during migration — the 5 existing enum values are seeded into `etapas_funil` in their current order, and `negocios.etapa_id` is backfilled from the old enum before it's dropped.
- Only `admin`/`gerente` may create, edit, reorder, or delete stages — `vendedor` only moves cards between existing stages (same permission pattern already used elsewhere in this repo).
- A stage cannot be deleted if any `negocios` row references it, or if it is the only remaining stage.
- Stage color is one of a fixed palette (`violeta`, `azul`, `teal`, `ambar`, `verde`, `vermelho`) mapped to existing design-system tokens — never a free color picker, never a raw hex value.
- This repo has no automated test suite (`package.json` has no `test` script) and TypeScript build errors are ignored (`next.config.ts` → `ignoreBuildErrors: true`, pre-existing and unrelated to this plan) — verification is `npm run build` (catches syntax errors) + `npx tsc --noEmit` (catches type errors, since build won't) + manual/browser checks, matching how every other task this session has been verified. No task in this plan should introduce a new `tsc --noEmit` error — check the baseline is still exactly the one pre-existing, unrelated error in `app/dashboard/funil/actions.ts` reported today (`TS2394`, an overload-signature mismatch this plan's Task 3 does NOT touch — if Task 3's edits happen to change or add to that overload's line count, re-verify it's still the same single pre-existing error, not a new one).
- Repo is `meu-crm`. All paths below are relative to its root.

---

## File Map

| File | Change |
|---|---|
| `migration-fase8.sql` | New. Creates `etapas_funil`, seeds 5 stages, migrates `negocios.etapa` → `etapa_id`, replaces `chk_motivo` with a trigger, updates `notificar_negocio_movido`, adds RLS. |
| `lib/types.ts` | New `EtapaFunil` type; `Negocio.etapa` → `Negocio.etapa_id` (+ optional joined `etapa?: EtapaFunil`). |
| `lib/etapa-colors.ts` | New. Shared color-key → Tailwind-class lookup, single source of truth for all 3 places that render stage colors. |
| `lib/supabase/queries.ts` | `getDashboardMetrics`, `getSalesChartData`, `getTaxaConversaoPorEtapa`, `getRankingVendedores`, `getRankingVendedoresFiltrado` — stop comparing `etapa` to literal strings, look up stage ids by `tipo` instead. New `getEtapasFunil()`. |
| `app/dashboard/funil/actions.ts` | `criarNegocio`/`moverNegocio`/`atualizarNegocio` use `etapa_id` + look up `exige_motivo`/`tipo` from `etapas_funil` instead of a fixed union. New `criarEtapa`, `editarEtapa`, `excluirEtapa`, `reordenarEtapas`. |
| `components/funil/kanban-column.tsx` | Fixed `COLUNAS` array removed — columns come from a prop. Color via `lib/etapa-colors.ts`. |
| `components/funil/kanban-board.tsx` | Renders dynamic columns, "+ Nova Etapa", column "⋮" menu (edit/delete), drag-to-reorder columns, motivo dialog driven by `exige_motivo` instead of the literal `'encerrado'`. |
| `components/funil/etapa-dialog.tsx` | New. Create/edit form for a single stage (nome, cor, tipo, exige_motivo). |
| `app/dashboard/funil/page.tsx` | Fetches `etapas` via `getEtapasFunil()`, passes to `KanbanBoard`. |
| `components/funil/negocio-form.tsx` | Etapa `<select>` renders dynamic stages; "mostrar motivo" driven by the selected stage's `exige_motivo`. |
| `app/dashboard/page.tsx` | `ETAPA_CONFIG` (fixed array) removed — renders `metrics.etapas` (dynamic) instead. |
| `components/relatorios/grafico-funil.tsx` | Fixed `CORES`/`LABELS` removed — renders the real stage list from `contagem`. |
| `app/dashboard/inbox/actions.ts` | `adicionarAoFunil`'s hardcoded `ETAPAS` validation replaced with an `etapas_funil` lookup by id. |
| `components/inbox/mensagem-thread.tsx` | `FunilDialog`'s hardcoded `<select>` renders dynamic stages (received as a new prop). |
| `components/inbox/inbox-panel.tsx` | Threads the new `etapas` prop through to `MensagemThread`. |
| `app/dashboard/inbox/page.tsx` | Fetches `etapas` via `getEtapasFunil()`, passes to `InboxPanel`. |

**Known gap the spec's file inventory missed, closed by this plan:** the spec's "Mudanças" section didn't list `mensagem-thread.tsx`'s `FunilDialog` (used to add a négocio to the funnel directly from an inbox conversation) or `inbox/actions.ts`'s `adicionarAoFunil`, both of which also hardcode the 5 stages. Left alone, they'd reference non-existent stage strings after this migration. Task 6 below fixes both.

---

## Task 1: Migration — `etapas_funil` table, triggers, RLS

**Files:**
- Create: `migration-fase8.sql`

**Interfaces:**
- Produces: table `etapas_funil(id uuid, nome text, cor text, ordem int, tipo text, exige_motivo bool, created_at timestamptz)`; column `negocios.etapa_id uuid references etapas_funil(id)`. Every later task's queries/actions consume `etapa_id` (not `etapa`) and the `tipo`/`exige_motivo` columns on `etapas_funil`.

- [ ] **Step 1: Write `migration-fase8.sql`**

```sql
-- ============================================================
-- FASE 8: etapas do Funil deixam de ser um enum fixo (5 valores)
-- e viram uma tabela editável pelo usuário (criar, renomear,
-- recolorir, reordenar, excluir). As duas regras hoje amarradas
-- aos nomes "encerrado"/"fechado" viram propriedades por etapa:
-- exige_motivo (bool) e tipo (aberto/ganho/perdido).
-- Nenhum negócio muda de etapa nesta migração.
-- Rodar no SQL Editor do Supabase, depois da fase 7.
-- ============================================================

-- 1. Tabela de etapas
CREATE TABLE etapas_funil (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  nome          TEXT NOT NULL,
  cor           TEXT NOT NULL CHECK (cor IN ('violeta', 'azul', 'teal', 'ambar', 'verde', 'vermelho')),
  ordem         INTEGER NOT NULL,
  tipo          TEXT NOT NULL DEFAULT 'aberto' CHECK (tipo IN ('aberto', 'ganho', 'perdido')),
  exige_motivo  BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Semear as 5 etapas atuais, na ordem e com as regras de hoje
INSERT INTO etapas_funil (nome, cor, ordem, tipo, exige_motivo) VALUES
  ('Lead',        'azul',     0, 'aberto',  false),
  ('Proposta',    'ambar',    1, 'aberto',  false),
  ('Negociação',  'teal',     2, 'aberto',  false),
  ('Fechado',     'verde',    3, 'ganho',   false),
  ('Encerrado',   'vermelho', 4, 'perdido', true);

-- 3. Adicionar a nova coluna e migrar os dados existentes
ALTER TABLE negocios ADD COLUMN etapa_id UUID REFERENCES etapas_funil(id);

UPDATE negocios n
SET etapa_id = e.id
FROM etapas_funil e
WHERE
  (n.etapa = 'lead'       AND e.nome = 'Lead') OR
  (n.etapa = 'proposta'   AND e.nome = 'Proposta') OR
  (n.etapa = 'negociacao' AND e.nome = 'Negociação') OR
  (n.etapa = 'fechado'    AND e.nome = 'Fechado') OR
  (n.etapa = 'encerrado'  AND e.nome = 'Encerrado');

ALTER TABLE negocios ALTER COLUMN etapa_id SET NOT NULL;
ALTER TABLE negocios ALTER COLUMN etapa_id SET DEFAULT (SELECT id FROM etapas_funil WHERE nome = 'Lead');

-- 4. Remover a coluna/enum antigos e o CHECK que dependia do nome fixo
ALTER TABLE negocios DROP CONSTRAINT chk_motivo;
ALTER TABLE negocios DROP COLUMN etapa;
DROP TYPE etapa_enum;

-- 5. Trigger substituindo o CHECK antigo — exige_motivo agora é dado, não
-- pode ser expresso num CHECK simples (CHECK não pode consultar outra tabela)
CREATE OR REPLACE FUNCTION validar_motivo_encerramento()
RETURNS trigger AS $$
DECLARE
  precisa_motivo BOOLEAN;
BEGIN
  SELECT exige_motivo INTO precisa_motivo FROM etapas_funil WHERE id = NEW.etapa_id;
  IF precisa_motivo AND (NEW.motivo_encerramento IS NULL OR NEW.motivo_encerramento = '') THEN
    RAISE EXCEPTION 'Motivo é obrigatório para esta etapa.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validar_motivo_encerramento
  BEFORE INSERT OR UPDATE ON negocios
  FOR EACH ROW EXECUTE FUNCTION validar_motivo_encerramento();

-- 6. notificar_negocio_movido (fase 6) referenciava NEW.etapa (era o enum,
-- concatenável direto em texto) — agora precisa buscar o nome em etapas_funil
CREATE OR REPLACE FUNCTION notificar_negocio_movido()
RETURNS trigger AS $$
DECLARE
  nome_etapa TEXT;
BEGIN
  IF OLD.etapa_id <> NEW.etapa_id AND NEW.responsavel_id IS NOT NULL THEN
    SELECT nome INTO nome_etapa FROM etapas_funil WHERE id = NEW.etapa_id;
    INSERT INTO notificacoes (user_id, tipo, mensagem)
    VALUES (NEW.responsavel_id, 'negocio_movido',
            'Negócio "' || NEW.titulo || '" movido para ' || nome_etapa);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 7. RLS: leitura liberada a qualquer autenticado, escrita só admin/gerente
ALTER TABLE etapas_funil ENABLE ROW LEVEL SECURITY;

CREATE POLICY "etapas_funil_select" ON etapas_funil FOR SELECT USING (true);

CREATE POLICY "etapas_funil_insert" ON etapas_funil FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND perfil IN ('admin', 'gerente'))
);
CREATE POLICY "etapas_funil_update" ON etapas_funil FOR UPDATE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND perfil IN ('admin', 'gerente'))
);
CREATE POLICY "etapas_funil_delete" ON etapas_funil FOR DELETE USING (
  EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND perfil IN ('admin', 'gerente'))
);
```

- [ ] **Step 2: Report the exact SQL file path to the user and stop — do not attempt to run it**

This plan's execution (an agentic worker, per this skill) must NOT run this migration itself — it has no Supabase credentials and must never be given any. Write the file, then the task is complete. A human runs it manually in the Supabase SQL Editor, same as every prior `migration-faseN.sql` in this repo, and confirms before Task 2 begins (Task 2's code assumes the new schema already exists).

- [ ] **Step 3: Commit**

```bash
git add migration-fase8.sql
git commit -m "docs(funil): add fase 8 migration — dynamic etapas_funil table"
```

---

## Task 2: Types, shared color module, read-side queries

**Files:**
- Modify: `lib/types.ts`
- Create: `lib/etapa-colors.ts`
- Modify: `lib/supabase/queries.ts`

**Interfaces:**
- Consumes: `etapas_funil` schema from Task 1 (assume it exists in the target Supabase project — this task's code will not build/run against the DB until Task 1's SQL has actually been executed there, but that's a runtime concern, not a compile-time one for this task).
- Produces: `EtapaFunil` type, `getEtapasFunil()` (ordered by `ordem`), and `ETAPA_COR_CLASSES`/`ETAPA_CORES` from `lib/etapa-colors.ts` — every later frontend task imports from here for stage colors, never redefines its own color map.

- [ ] **Step 1: Edit `lib/types.ts`**

Find the `Negocio` interface (currently has `etapa: 'lead' | 'proposta' | 'negociacao' | 'fechado' | 'encerrado'`) and replace that one field with:

```ts
  etapa_id: string
  etapa?: { nome: string; cor: string; tipo: 'aberto' | 'ganho' | 'perdido'; exige_motivo: boolean }
```

(`etapa` stays optional — only present when a query embeds the join; code that only has `etapa_id` still compiles.)

Add this new interface near `Negocio` (same file):

```ts
export interface EtapaFunil {
  id: string
  nome: string
  cor: string
  ordem: number
  tipo: 'aberto' | 'ganho' | 'perdido'
  exige_motivo: boolean
}
```

- [ ] **Step 2: Create `lib/etapa-colors.ts`**

```ts
// Paleta curada de cores pras etapas do Funil — sempre uma destas 6 chaves,
// nunca uma cor livre. Única fonte de verdade pro mapeamento cor -> classes
// Tailwind (precisam ser strings literais em algum lugar do código-fonte
// pra o compilador do Tailwind conseguir "ver" e gerar as classes).
export const ETAPA_CORES = ['violeta', 'azul', 'teal', 'ambar', 'verde', 'vermelho'] as const
export type EtapaCor = typeof ETAPA_CORES[number]

export const ETAPA_COR_CLASSES: Record<EtapaCor, { border: string; text: string; bg: string; dot: string }> = {
  violeta:  { border: 'border-primary',     text: 'text-primary',     bg: 'bg-primary/15',     dot: 'bg-primary' },
  azul:     { border: 'border-chart-2',     text: 'text-chart-2',     bg: 'bg-chart-2/15',     dot: 'bg-chart-2' },
  teal:     { border: 'border-chart-3',     text: 'text-chart-3',     bg: 'bg-chart-3/15',     dot: 'bg-chart-3' },
  ambar:    { border: 'border-chart-5',     text: 'text-chart-5',     bg: 'bg-chart-5/15',     dot: 'bg-chart-5' },
  verde:    { border: 'border-chart-4',     text: 'text-chart-4',     bg: 'bg-chart-4/15',     dot: 'bg-chart-4' },
  vermelho: { border: 'border-destructive', text: 'text-destructive', bg: 'bg-destructive/15', dot: 'bg-destructive' },
}

export function etapaCorClasses(cor: string) {
  return ETAPA_COR_CLASSES[cor as EtapaCor] ?? ETAPA_COR_CLASSES.azul
}
```

- [ ] **Step 3: Edit `lib/supabase/queries.ts` — add `getEtapasFunil` and a `tipo` lookup helper**

Add near the top of the file (after the existing imports, before the first exported function):

```ts
async function getEtapaIdsPorTipo(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tipo: 'aberto' | 'ganho' | 'perdido'
): Promise<string[]> {
  const { data } = await supabase.from('etapas_funil').select('id').eq('tipo', tipo)
  return (data ?? []).map((e) => e.id)
}

export async function getEtapasFunil() {
  const supabase = await createClient()
  const { data, error } = await supabase.from('etapas_funil').select('*').order('ordem')
  if (error) throw new Error(error.message)
  return data
}
```

- [ ] **Step 4: Edit `getDashboardMetrics` in `lib/supabase/queries.ts`**

Find this block:

```ts
  const [
    { count: totalClientes },
    { data: negociosAbertos },
    { count: tarefasPendentes },
    { data: negociosFechados },
    { count: totalNegocios },
    conversasAtivas,
    conversasPausadas,
    mensagensHoje,
    contatosNovos,
    { data: negociosPorEtapa },
  ] = await Promise.all([
    supabase.from('clientes').select('*', { count: 'exact', head: true }),
    supabase.from('negocios').select('valor').in('etapa', ['lead', 'proposta', 'negociacao']),
    supabase.from('tarefas').select('*', { count: 'exact', head: true }).eq('status', 'pendente'),
    supabase.from('negocios').select('valor').eq('etapa', 'fechado'),
    supabase.from('negocios').select('*', { count: 'exact', head: true }).neq('etapa', 'encerrado'),
    contarConversas('active'),
    contarConversas('paused'),
    contarMensagensHoje(),
    contarContatosNovos(),
    supabase.from('negocios').select('etapa, valor'),
  ])

  const valorEmAberto = negociosAbertos?.reduce((sum, n) => sum + (Number(n.valor) || 0), 0) ?? 0
  const valorFechado = negociosFechados?.reduce((sum, n) => sum + (Number(n.valor) || 0), 0) ?? 0
  const fechados = negociosFechados?.length ?? 0
  const total = totalNegocios ?? 0
  const taxaConversao = calcTaxaConversao(fechados, total)

  // Agrupar negócios por etapa
  const ETAPAS = ['lead', 'proposta', 'negociacao', 'fechado', 'encerrado'] as const
  const etapaMap: Record<string, { count: number; valor: number }> = {}
  ETAPAS.forEach(e => { etapaMap[e] = { count: 0, valor: 0 } })
  negociosPorEtapa?.forEach(n => {
    if (etapaMap[n.etapa]) {
      etapaMap[n.etapa].count++
      etapaMap[n.etapa].valor += Number(n.valor) || 0
    }
  })

  return {
    totalClientes: totalClientes ?? 0,
    valorEmAberto,
    valorFechado,
    tarefasPendentes: tarefasPendentes ?? 0,
    taxaConversao,
    negociosFechados: fechados,
    totalNegocios: total,
    conversasAtivas,
    conversasPausadas,
    mensagensHoje,
    contatosNovos,
    etapaMap,
  }
}
```

Replace with:

```ts
  const etapas = await getEtapasFunil()
  const abertoIds = etapas.filter(e => e.tipo === 'aberto').map(e => e.id)
  const ganhoIds = etapas.filter(e => e.tipo === 'ganho').map(e => e.id)
  const perdidoIds = etapas.filter(e => e.tipo === 'perdido').map(e => e.id)

  const [
    { count: totalClientes },
    { data: negociosAbertos },
    { count: tarefasPendentes },
    { data: negociosFechados },
    { count: totalNegocios },
    conversasAtivas,
    conversasPausadas,
    mensagensHoje,
    contatosNovos,
    { data: negociosPorEtapa },
  ] = await Promise.all([
    supabase.from('clientes').select('*', { count: 'exact', head: true }),
    abertoIds.length ? supabase.from('negocios').select('valor').in('etapa_id', abertoIds) : Promise.resolve({ data: [] }),
    supabase.from('tarefas').select('*', { count: 'exact', head: true }).eq('status', 'pendente'),
    ganhoIds.length ? supabase.from('negocios').select('valor').in('etapa_id', ganhoIds) : Promise.resolve({ data: [] }),
    perdidoIds.length
      ? supabase.from('negocios').select('*', { count: 'exact', head: true }).not('etapa_id', 'in', `(${perdidoIds.join(',')})`)
      : supabase.from('negocios').select('*', { count: 'exact', head: true }),
    contarConversas('active'),
    contarConversas('paused'),
    contarMensagensHoje(),
    contarContatosNovos(),
    supabase.from('negocios').select('etapa_id, valor'),
  ])

  const valorEmAberto = negociosAbertos?.reduce((sum, n) => sum + (Number(n.valor) || 0), 0) ?? 0
  const valorFechado = negociosFechados?.reduce((sum, n) => sum + (Number(n.valor) || 0), 0) ?? 0
  const fechados = negociosFechados?.length ?? 0
  const total = totalNegocios ?? 0
  const taxaConversao = calcTaxaConversao(fechados, total)

  // Agrupar negócios por etapa (dinâmico — uma entrada por etapa real, na ordem cadastrada)
  const etapaMap: Record<string, { count: number; valor: number }> = {}
  etapas.forEach(e => { etapaMap[e.id] = { count: 0, valor: 0 } })
  negociosPorEtapa?.forEach(n => {
    if (etapaMap[n.etapa_id]) {
      etapaMap[n.etapa_id].count++
      etapaMap[n.etapa_id].valor += Number(n.valor) || 0
    }
  })

  return {
    totalClientes: totalClientes ?? 0,
    valorEmAberto,
    valorFechado,
    tarefasPendentes: tarefasPendentes ?? 0,
    taxaConversao,
    negociosFechados: fechados,
    totalNegocios: total,
    conversasAtivas,
    conversasPausadas,
    mensagensHoje,
    contatosNovos,
    etapas,
    etapaMap,
  }
}
```

Note: `etapaMap` is now keyed by `etapa_id` (uuid), not by a fixed slug — Task 6's `app/dashboard/page.tsx` edit reads it via `etapas.map(e => ({ ...e, ...metrics.etapaMap[e.id] }))` instead of the old `ETAPA_CONFIG` array. `metrics.etapas` (the ordered stage list, each with `cor`/`tipo`) is returned alongside so the page doesn't need a second fetch.

- [ ] **Step 5: Edit `getSalesChartData` in `lib/supabase/queries.ts`**

Find:
```ts
  const { data } = await supabase
    .from('negocios')
    .select('valor, created_at')
    .eq('etapa', 'fechado')
    .gte('created_at', sixMonthsAgo.toISOString())
```

Replace with:
```ts
  const ganhoIds = await getEtapaIdsPorTipo(supabase, 'ganho')
  const { data } = ganhoIds.length
    ? await supabase
        .from('negocios')
        .select('valor, created_at')
        .in('etapa_id', ganhoIds)
        .gte('created_at', sixMonthsAgo.toISOString())
    : { data: [] as { valor: number; created_at: string }[] }
```

- [ ] **Step 6: Edit `getTaxaConversaoPorEtapa` in `lib/supabase/queries.ts`**

Find:
```ts
export async function getTaxaConversaoPorEtapa() {
  const supabase = await createClient()

  const etapas = ['lead', 'proposta', 'negociacao', 'fechado', 'encerrado'] as const
  const contagem = { lead: 0, proposta: 0, negociacao: 0, fechado: 0, encerrado: 0 }

  const resultados = await Promise.all(
    etapas.map((etapa) =>
      supabase
        .from('negocios')
        .select('*', { count: 'exact', head: true })
        .eq('etapa', etapa)
    )
  )

  etapas.forEach((etapa, i) => {
    contagem[etapa] = resultados[i].count ?? 0
  })

  const total = contagem.lead + contagem.proposta + contagem.negociacao + contagem.fechado
  const taxa = calcTaxaConversao(contagem.fechado, total)

  return { contagem, taxa, total }
}
```

Replace with:
```ts
export async function getTaxaConversaoPorEtapa() {
  const supabase = await createClient()
  const etapas = await getEtapasFunil()

  const resultados = await Promise.all(
    etapas.map((e) =>
      supabase.from('negocios').select('*', { count: 'exact', head: true }).eq('etapa_id', e.id)
    )
  )

  const contagem = etapas.map((e, i) => ({ ...e, count: resultados[i].count ?? 0 }))
  const ganho = contagem.filter(c => c.tipo === 'ganho').reduce((sum, c) => sum + c.count, 0)
  const naoGanho = contagem.filter(c => c.tipo !== 'perdido').reduce((sum, c) => sum + c.count, 0)
  const taxa = calcTaxaConversao(ganho, naoGanho)

  return { contagem, taxa, total: naoGanho }
}
```

This changes the return shape of `contagem` from a fixed object (`{lead, proposta, ...}`) to an array of `EtapaFunil & {count}` — Task 6's `grafico-funil.tsx` edit consumes the new shape.

- [ ] **Step 7: Edit `getRankingVendedores` and `getRankingVendedoresFiltrado` in `lib/supabase/queries.ts`**

Find:
```ts
export async function getRankingVendedores() {
  const supabase = await createClient()

  const { data } = await supabase
    .from('negocios')
    .select('valor, responsavel:profiles!responsavel_id(id, nome)')
    .eq('etapa', 'fechado')

  return agruparRanking(data)
}
```

Replace with:
```ts
export async function getRankingVendedores() {
  const supabase = await createClient()
  const ganhoIds = await getEtapaIdsPorTipo(supabase, 'ganho')
  if (!ganhoIds.length) return agruparRanking([])

  const { data } = await supabase
    .from('negocios')
    .select('valor, responsavel:profiles!responsavel_id(id, nome)')
    .in('etapa_id', ganhoIds)

  return agruparRanking(data)
}
```

Find:
```ts
export async function getRankingVendedoresFiltrado(ano: number, mes: number) {
  const supabase = await createClient()

  const inicio = new Date(ano, mes - 1, 1)
  const fim = new Date(ano, mes, 1)

  const { data } = await supabase
    .from('negocios')
    .select('valor, responsavel:profiles!responsavel_id(id, nome)')
    .eq('etapa', 'fechado')
    .gte('created_at', inicio.toISOString())
    .lt('created_at', fim.toISOString())

  return agruparRanking(data)
}
```

Replace with:
```ts
export async function getRankingVendedoresFiltrado(ano: number, mes: number) {
  const supabase = await createClient()
  const ganhoIds = await getEtapaIdsPorTipo(supabase, 'ganho')
  if (!ganhoIds.length) return agruparRanking([])

  const inicio = new Date(ano, mes - 1, 1)
  const fim = new Date(ano, mes, 1)

  const { data } = await supabase
    .from('negocios')
    .select('valor, responsavel:profiles!responsavel_id(id, nome)')
    .in('etapa_id', ganhoIds)
    .gte('created_at', inicio.toISOString())
    .lt('created_at', fim.toISOString())

  return agruparRanking(data)
}
```

- [ ] **Step 8: Verify — typecheck and build**

Run: `npx tsc --noEmit`
Expected: exactly the one pre-existing error in `app/dashboard/funil/actions.ts` (`TS2394`) — nothing new. `lib/supabase/queries.ts`/`lib/types.ts`/`lib/etapa-colors.ts` must not add any error (these files aren't type-checked against the live DB schema — Supabase's client here isn't using generated types from the schema, so this is a plain TS check, not a schema-drift check).

Run: `npm run build`
Expected: compiles successfully (this only proves the code is syntactically/structurally valid — it cannot prove correctness against the live database, since Task 1's SQL hasn't necessarily run against this environment's DB yet; that's confirmed at manual-test time after Task 1 is applied for real).

- [ ] **Step 9: Commit**

```bash
git add lib/types.ts lib/etapa-colors.ts lib/supabase/queries.ts
git commit -m "feat(funil): make dashboard/relatorios queries read dynamic etapas_funil"
```

---

## Task 3: `funil/actions.ts` — negócio CRUD via `etapa_id` + etapa management actions

**Files:**
- Modify: `app/dashboard/funil/actions.ts`

**Interfaces:**
- Consumes: `etapas_funil` (Task 1), `EtapaFunil` type (Task 2).
- Produces: `criarEtapa(formData)`, `editarEtapa(formData)`, `excluirEtapa(id)`, `reordenarEtapas(ids: string[])` — Task 4's kanban UI calls these by these exact names/signatures.

- [ ] **Step 1: Replace the top of `app/dashboard/funil/actions.ts` (imports + `ETAPAS_VALIDAS`/`Etapa` + `parseNegocioFields`)**

Find:
```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

const ETAPAS_VALIDAS = ['lead', 'proposta', 'negociacao', 'fechado', 'encerrado'] as const
type Etapa = typeof ETAPAS_VALIDAS[number]

async function getAuthUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, user }
}

async function getPerfil(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase.from('profiles').select('perfil').eq('id', userId).single()
  return data?.perfil ?? 'vendedor'
}

function parseNegocioFields(formData: FormData, incluirEtapa: true): {
  titulo: string; valor: number; etapa: string
  motivo_encerramento: string | null; cliente_id: string | null
}
function parseNegocioFields(formData: FormData, incluirEtapa: false): {
  titulo: string; valor: number
  motivo_encerramento: string | null; cliente_id: string | null
}
function parseNegocioFields(formData: FormData, incluirEtapa: boolean) {
  const titulo = (formData.get('titulo') as string | null)?.trim()
  if (!titulo) throw new Error('Título é obrigatório.')

  const valor = parseFloat(formData.get('valor') as string)
  if (isNaN(valor)) throw new Error('Valor inválido.')

  const motivo_encerramento =
    (formData.get('motivo_encerramento') as string | null)?.trim() || null
  const cliente_id = (formData.get('cliente_id') as string) || null

  if (!incluirEtapa) return { titulo, valor, motivo_encerramento, cliente_id }

  const etapaRaw = (formData.get('etapa') as string) || 'lead'
  const etapa: Etapa = ETAPAS_VALIDAS.includes(etapaRaw as Etapa) ? (etapaRaw as Etapa) : 'lead'
  if (etapa === 'encerrado' && !motivo_encerramento) {
    throw new Error('Motivo é obrigatório para negócios encerrados.')
  }
  return {
    titulo, valor, etapa,
    motivo_encerramento: etapa === 'encerrado' ? motivo_encerramento : null,
    cliente_id,
  }
}
```

Replace with:
```ts
'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ETAPA_CORES } from '@/lib/etapa-colors'

async function getAuthUser() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return { supabase, user }
}

async function getPerfil(supabase: Awaited<ReturnType<typeof createClient>>, userId: string) {
  const { data } = await supabase.from('profiles').select('perfil').eq('id', userId).single()
  return data?.perfil ?? 'vendedor'
}

async function getEtapa(supabase: Awaited<ReturnType<typeof createClient>>, etapaId: string) {
  const { data } = await supabase.from('etapas_funil').select('*').eq('id', etapaId).single()
  return data
}

async function parseNegocioFields(
  supabase: Awaited<ReturnType<typeof createClient>>,
  formData: FormData,
  incluirEtapa: boolean
) {
  const titulo = (formData.get('titulo') as string | null)?.trim()
  if (!titulo) throw new Error('Título é obrigatório.')

  const valor = parseFloat(formData.get('valor') as string)
  if (isNaN(valor)) throw new Error('Valor inválido.')

  const motivo_encerramento =
    (formData.get('motivo_encerramento') as string | null)?.trim() || null
  const cliente_id = (formData.get('cliente_id') as string) || null

  if (!incluirEtapa) return { titulo, valor, motivo_encerramento, cliente_id }

  const etapa_id = formData.get('etapa') as string
  const etapa = etapa_id ? await getEtapa(supabase, etapa_id) : null
  if (!etapa) throw new Error('Etapa inválida.')
  if (etapa.exige_motivo && !motivo_encerramento) {
    throw new Error('Motivo é obrigatório para esta etapa.')
  }
  return {
    titulo, valor, etapa_id: etapa.id,
    motivo_encerramento: etapa.exige_motivo ? motivo_encerramento : null,
    cliente_id,
  }
}
```

- [ ] **Step 2: Edit `criarNegocio` to await the now-async `parseNegocioFields`**

Find (just the one call site):
```ts
  const fields = parseNegocioFields(formData, true)
```

Replace with:
```ts
  const fields = await parseNegocioFields(supabase, formData, true)
```

- [ ] **Step 3: Replace `moverNegocio`**

Find:
```ts
export async function moverNegocio(
  id: string,
  novaEtapa: string,
  motivo?: string
) {
  const { supabase, user } = await getAuthUser()

  if (!ETAPAS_VALIDAS.includes(novaEtapa as Etapa)) {
    throw new Error('Etapa inválida.')
  }

  if (novaEtapa === 'encerrado' && !motivo) {
    throw new Error('Motivo é obrigatório para encerrar um negócio.')
  }

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

  const { error, count } = await query
  if (error) throw new Error('Erro ao mover negócio: ' + error.message)
  if (count === 0) throw new Error('Negócio não encontrado ou sem permissão.')
  revalidatePath('/dashboard/funil')
}
```

Replace with:
```ts
export async function moverNegocio(
  id: string,
  novaEtapaId: string,
  motivo?: string
) {
  const { supabase, user } = await getAuthUser()

  const etapa = await getEtapa(supabase, novaEtapaId)
  if (!etapa) throw new Error('Etapa inválida.')

  if (etapa.exige_motivo && !motivo) {
    throw new Error('Motivo é obrigatório para esta etapa.')
  }

  const perfil = await getPerfil(supabase, user.id)

  let query = supabase
    .from('negocios')
    .update({
      etapa_id: novaEtapaId,
      motivo_encerramento: etapa.exige_motivo ? motivo : null,
    }, { count: 'exact' })
    .eq('id', id)

  if (perfil === 'vendedor') {
    query = query.eq('responsavel_id', user.id)
  }

  const { error, count } = await query
  if (error) throw new Error('Erro ao mover negócio: ' + error.message)
  if (count === 0) throw new Error('Negócio não encontrado ou sem permissão.')
  revalidatePath('/dashboard/funil')
}
```

- [ ] **Step 4: Edit `atualizarNegocio` to await `parseNegocioFields`**

Find:
```ts
  const { titulo, valor, motivo_encerramento, cliente_id } =
    parseNegocioFields(formData, false)
```

Replace with:
```ts
  const { titulo, valor, motivo_encerramento, cliente_id } =
    await parseNegocioFields(supabase, formData, false)
```

- [ ] **Step 5: Add etapa-management actions at the end of the file**

Append:
```ts
export async function criarEtapa(formData: FormData) {
  const { supabase, user } = await getAuthUser()
  const perfil = await getPerfil(supabase, user.id)
  if (perfil === 'vendedor') throw new Error('Sem permissão para gerenciar etapas.')

  const nome = (formData.get('nome') as string | null)?.trim()
  if (!nome) throw new Error('Nome é obrigatório.')
  const cor = formData.get('cor') as string
  if (!ETAPA_CORES.includes(cor as typeof ETAPA_CORES[number])) throw new Error('Cor inválida.')
  const tipo = (formData.get('tipo') as string) || 'aberto'
  if (!['aberto', 'ganho', 'perdido'].includes(tipo)) throw new Error('Tipo inválido.')
  const exige_motivo = formData.get('exige_motivo') === 'true'

  const { count } = await supabase.from('etapas_funil').select('*', { count: 'exact', head: true })
  const ordem = count ?? 0

  const { error } = await supabase.from('etapas_funil').insert({ nome, cor, tipo, exige_motivo, ordem })
  if (error) throw new Error('Erro ao criar etapa: ' + error.message)
  revalidatePath('/dashboard/funil')
}

export async function editarEtapa(formData: FormData) {
  const { supabase, user } = await getAuthUser()
  const perfil = await getPerfil(supabase, user.id)
  if (perfil === 'vendedor') throw new Error('Sem permissão para gerenciar etapas.')

  const id = formData.get('id') as string
  const nome = (formData.get('nome') as string | null)?.trim()
  if (!nome) throw new Error('Nome é obrigatório.')
  const cor = formData.get('cor') as string
  if (!ETAPA_CORES.includes(cor as typeof ETAPA_CORES[number])) throw new Error('Cor inválida.')
  const tipo = (formData.get('tipo') as string) || 'aberto'
  if (!['aberto', 'ganho', 'perdido'].includes(tipo)) throw new Error('Tipo inválido.')
  const exige_motivo = formData.get('exige_motivo') === 'true'

  const { error } = await supabase.from('etapas_funil').update({ nome, cor, tipo, exige_motivo }).eq('id', id)
  if (error) throw new Error('Erro ao editar etapa: ' + error.message)
  revalidatePath('/dashboard/funil')
}

export async function excluirEtapa(id: string) {
  const { supabase, user } = await getAuthUser()
  const perfil = await getPerfil(supabase, user.id)
  if (perfil === 'vendedor') throw new Error('Sem permissão para gerenciar etapas.')

  const { count: totalEtapas } = await supabase.from('etapas_funil').select('*', { count: 'exact', head: true })
  if ((totalEtapas ?? 0) <= 1) throw new Error('Não é possível excluir a única etapa restante.')

  const { count: negociosNaEtapa } = await supabase
    .from('negocios')
    .select('*', { count: 'exact', head: true })
    .eq('etapa_id', id)
  if ((negociosNaEtapa ?? 0) > 0) {
    throw new Error('Esta etapa tem negócios nela — mova-os antes de excluir.')
  }

  const { error } = await supabase.from('etapas_funil').delete().eq('id', id)
  if (error) throw new Error('Erro ao excluir etapa: ' + error.message)
  revalidatePath('/dashboard/funil')
}

export async function reordenarEtapas(idsNaNovaOrdem: string[]) {
  const { supabase, user } = await getAuthUser()
  const perfil = await getPerfil(supabase, user.id)
  if (perfil === 'vendedor') throw new Error('Sem permissão para gerenciar etapas.')

  await Promise.all(
    idsNaNovaOrdem.map((id, ordem) =>
      supabase.from('etapas_funil').update({ ordem }).eq('id', id)
    )
  )
  revalidatePath('/dashboard/funil')
}
```

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit`
Expected: same single pre-existing error as baseline (in this exact file, `TS2394`) — this task doesn't touch that overload, so it must be untouched; if the line number shifted because of edits above it, confirm the error is still the same overload-signature complaint, not a new one.

Run: `npm run build`
Expected: compiles successfully.

- [ ] **Step 7: Commit**

```bash
git add app/dashboard/funil/actions.ts
git commit -m "feat(funil): move negocio CRUD to etapa_id, add etapa management actions"
```

---

## Task 4: Kanban UI — dynamic columns, reorder, etapa CRUD dialog

**Files:**
- Modify: `components/funil/kanban-column.tsx`
- Modify: `components/funil/kanban-board.tsx`
- Create: `components/funil/etapa-dialog.tsx`
- Modify: `app/dashboard/funil/page.tsx`

**Interfaces:**
- Consumes: `EtapaFunil` (Task 2), `etapaCorClasses` (Task 2), `criarEtapa`/`editarEtapa`/`excluirEtapa`/`reordenarEtapas` (Task 3).
- `KanbanColumn` now takes `etapa: EtapaFunil` instead of the old `coluna: ColunaDef` (fixed shape) — same prop name changed, `KanbanCard`'s own props are unaffected (it doesn't touch etapa data directly).
- `KanbanBoard` now takes a new required prop `etapas: EtapaFunil[]` (ordered) in addition to its existing props.

- [ ] **Step 1: Replace `components/funil/kanban-column.tsx`**

```tsx
'use client'

import { useDroppable } from '@dnd-kit/core'
import { KanbanCard } from './kanban-card'
import { Negocio, Cliente, EtapaFunil } from '@/lib/types'
import { formatCurrency } from '@/lib/format'
import { etapaCorClasses } from '@/lib/etapa-colors'
import { cn } from '@/lib/utils'

interface KanbanColumnProps {
  etapa: EtapaFunil
  negocios: Negocio[]
  clientes: Cliente[]
  meuPerfil: string
  meuUserId: string
  profiles: { id: string; nome: string | null }[]
  etapas: EtapaFunil[]
  onEditEtapa: (etapa: EtapaFunil) => void
  onDeleteEtapa: (id: string) => void
}

export function KanbanColumn({ etapa, negocios, clientes, meuPerfil, meuUserId, profiles, etapas, onEditEtapa, onDeleteEtapa }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa.id })
  const cores = etapaCorClasses(etapa.cor)

  const valorTotal = negocios.reduce((sum, n) => sum + (Number(n.valor) || 0), 0)

  return (
    <div className="flex flex-col w-64 shrink-0">
      <div className={`bg-card rounded-t-lg border-t-4 px-3 py-3 border-x ${cores.border}`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">{etapa.nome}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{negocios.length}</span>
            <button
              onClick={() => onEditEtapa(etapa)}
              className="text-muted-foreground hover:text-foreground"
              title="Editar etapa"
            >
              ⋮
            </button>
          </div>
        </div>
        <p className={`text-sm font-mono font-semibold tabular-nums mt-1 ${cores.text}`}>
          {formatCurrency(valorTotal)}
        </p>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 min-h-48 bg-muted rounded-b-lg border-x border-b p-2 space-y-2 transition-colors',
          isOver && 'bg-primary/10 border-primary/40'
        )}
      >
        {negocios.map((negocio) => (
          <KanbanCard
            key={negocio.id}
            negocio={negocio}
            clientes={clientes}
            meuPerfil={meuPerfil}
            meuUserId={meuUserId}
            profiles={profiles}
            etapas={etapas}
          />
        ))}
      </div>
    </div>
  )
}
```

Note: `onDeleteEtapa` is accepted here for interface completeness with the header menu, but the actual delete affordance renders inside the small popover Task 4 Step 3 wires up in `kanban-board.tsx` (`onEditEtapa` opens `EtapaDialog`, which itself has the delete button) — `KanbanColumn`'s "⋮" only calls `onEditEtapa`. `KanbanCard` gains an `etapas` prop here because `NegocioForm` (rendered inside `KanbanCard` for the edit trigger) needs the dynamic stage list — Task 5 updates `KanbanCard`'s own prop-forwarding to `NegocioForm` and its `EtapaFunil` import.

- [ ] **Step 2: Edit `components/funil/kanban-card.tsx` to accept and forward the new `etapas` prop**

Find:
```ts
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Trash2, Pencil, MessageCircle } from 'lucide-react'
import { Negocio, Cliente } from '@/lib/types'
import { formatCurrency } from '@/lib/format'
import { excluirNegocio } from '@/app/dashboard/funil/actions'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { NegocioForm } from './negocio-form'

interface KanbanCardProps {
  negocio: Negocio
  clientes: Cliente[]
  meuPerfil: string
  meuUserId: string
  profiles: { id: string; nome: string | null }[]
}

export function KanbanCard({ negocio, clientes, meuPerfil, meuUserId, profiles }: KanbanCardProps) {
```

Replace with:
```ts
import { useDraggable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { Trash2, Pencil, MessageCircle } from 'lucide-react'
import { Negocio, Cliente, EtapaFunil } from '@/lib/types'
import { formatCurrency } from '@/lib/format'
import { excluirNegocio } from '@/app/dashboard/funil/actions'
import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { NegocioForm } from './negocio-form'

interface KanbanCardProps {
  negocio: Negocio
  clientes: Cliente[]
  meuPerfil: string
  meuUserId: string
  profiles: { id: string; nome: string | null }[]
  etapas: EtapaFunil[]
}

export function KanbanCard({ negocio, clientes, meuPerfil, meuUserId, profiles, etapas }: KanbanCardProps) {
```

Find (the `NegocioForm` usage inside the edit trigger):
```tsx
          <NegocioForm
            clientes={clientes}
            negocio={negocio}
            meuPerfil={meuPerfil}
            meuUserId={meuUserId}
            profiles={profiles}
            trigger={
```

Replace with:
```tsx
          <NegocioForm
            clientes={clientes}
            negocio={negocio}
            meuPerfil={meuPerfil}
            meuUserId={meuUserId}
            profiles={profiles}
            etapas={etapas}
            trigger={
```

- [ ] **Step 3: Create `components/funil/etapa-dialog.tsx`**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { EtapaFunil } from '@/lib/types'
import { ETAPA_CORES, etapaCorClasses } from '@/lib/etapa-colors'
import { criarEtapa, editarEtapa, excluirEtapa } from '@/app/dashboard/funil/actions'

const COR_LABELS: Record<string, string> = {
  violeta: 'Violeta', azul: 'Azul', teal: 'Teal', ambar: 'Âmbar', verde: 'Verde', vermelho: 'Vermelho',
}
const TIPO_LABELS: Record<string, string> = {
  aberto: 'Aberto (em andamento)', ganho: 'Ganho (conta como receita fechada)', perdido: 'Perdido (encerrado sem sucesso)',
}

interface Props {
  etapa: EtapaFunil | null // null = criando uma nova etapa
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function EtapaDialog({ etapa, open, onOpenChange }: Props) {
  const editando = !!etapa
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    const formData = new FormData(e.currentTarget)
    if (editando) formData.set('id', etapa.id)
    startTransition(async () => {
      try {
        if (editando) await editarEtapa(formData)
        else await criarEtapa(formData)
        onOpenChange(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao salvar')
      }
    })
  }

  function handleExcluir() {
    if (!etapa) return
    if (!confirm(`Excluir a etapa "${etapa.nome}"?`)) return
    startTransition(async () => {
      try {
        await excluirEtapa(etapa.id)
        onOpenChange(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao excluir')
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{editando ? 'Editar etapa' : 'Nova etapa'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <Label htmlFor="etapa-nome">Nome</Label>
            <Input id="etapa-nome" name="nome" defaultValue={etapa?.nome ?? ''} required />
          </div>
          <div className="space-y-1.5">
            <Label>Cor</Label>
            <div className="flex flex-wrap gap-2">
              {ETAPA_CORES.map((cor) => {
                const c = etapaCorClasses(cor)
                return (
                  <label key={cor} className="flex items-center gap-1.5 text-sm cursor-pointer">
                    <input type="radio" name="cor" value={cor} defaultChecked={(etapa?.cor ?? 'azul') === cor} className="sr-only peer" />
                    <span className={`size-4 rounded-full ${c.dot} ring-2 ring-transparent peer-checked:ring-foreground/50`} />
                    {COR_LABELS[cor]}
                  </label>
                )
              })}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="etapa-tipo">Tipo (usado nas métricas)</Label>
            <select
              id="etapa-tipo"
              name="tipo"
              defaultValue={etapa?.tipo ?? 'aberto'}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {Object.entries(TIPO_LABELS).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="exige_motivo" value="true" defaultChecked={etapa?.exige_motivo ?? false} />
            Exigir motivo ao mover um negócio pra cá
          </label>
          {error && <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{error}</p>}
          <div className="flex justify-between gap-2 pt-1">
            {editando ? (
              <Button type="button" variant="ghost" className="text-destructive hover:text-destructive" onClick={handleExcluir} disabled={isPending}>
                Excluir etapa
              </Button>
            ) : <span />}
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button type="submit" disabled={isPending}>{isPending ? 'Salvando...' : 'Salvar'}</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 4: Edit `components/funil/kanban-board.tsx`**

Find the imports and `KanbanBoardProps`:
```ts
import { useState, useTransition } from 'react'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { KanbanColumn, COLUNAS } from './kanban-column'
import { NegocioForm } from './negocio-form'
import { moverNegocio } from '@/app/dashboard/funil/actions'
import { Negocio, Cliente } from '@/lib/types'
import { Plus } from 'lucide-react'

interface KanbanBoardProps {
  negocios: Negocio[]
  clientes: Cliente[]
  meuPerfil: string
  meuUserId: string
  profiles: { id: string; nome: string | null }[]
}
```

Replace with:
```ts
import { useState, useTransition } from 'react'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { KanbanColumn } from './kanban-column'
import { EtapaDialog } from './etapa-dialog'
import { NegocioForm } from './negocio-form'
import { moverNegocio } from '@/app/dashboard/funil/actions'
import { Negocio, Cliente, EtapaFunil } from '@/lib/types'
import { Plus } from 'lucide-react'

interface KanbanBoardProps {
  negocios: Negocio[]
  clientes: Cliente[]
  meuPerfil: string
  meuUserId: string
  profiles: { id: string; nome: string | null }[]
  etapas: EtapaFunil[]
}
```

Find the function signature and the first few lines of state:
```ts
export function KanbanBoard({ negocios: initial, clientes, meuPerfil, meuUserId, profiles }: KanbanBoardProps) {
  const [negocios, setNegocios] = useState<Negocio[]>(initial)
```

Replace with:
```ts
export function KanbanBoard({ negocios: initial, clientes, meuPerfil, meuUserId, profiles, etapas }: KanbanBoardProps) {
  const [negocios, setNegocios] = useState<Negocio[]>(initial)
  const [editingEtapa, setEditingEtapa] = useState<EtapaFunil | null>(null)
  const [etapaDialogOpen, setEtapaDialogOpen] = useState(false)
  const podeGerenciarEtapas = meuPerfil !== 'vendedor'

  function abrirNovaEtapa() {
    setEditingEtapa(null)
    setEtapaDialogOpen(true)
  }

  function abrirEditarEtapa(etapa: EtapaFunil) {
    setEditingEtapa(etapa)
    setEtapaDialogOpen(true)
  }
```

Find the `render` section's `DndContext` block:
```tsx
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {COLUNAS.map((coluna) => (
            <KanbanColumn
              key={coluna.id}
              coluna={coluna}
              negocios={negocios.filter((n) => n.etapa === coluna.id)}
              clientes={clientes}
              meuPerfil={meuPerfil}
              meuUserId={meuUserId}
              profiles={profiles}
            />
          ))}
        </div>
      </DndContext>
```

Replace with:
```tsx
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {etapas.map((etapa) => (
            <KanbanColumn
              key={etapa.id}
              etapa={etapa}
              negocios={negocios.filter((n) => n.etapa_id === etapa.id)}
              clientes={clientes}
              meuPerfil={meuPerfil}
              meuUserId={meuUserId}
              profiles={profiles}
              etapas={etapas}
              onEditEtapa={abrirEditarEtapa}
              onDeleteEtapa={() => {}}
            />
          ))}
          {podeGerenciarEtapas && (
            <button
              onClick={abrirNovaEtapa}
              className="flex flex-col items-center justify-center gap-1.5 w-64 h-24 shrink-0 rounded-lg border border-dashed text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              <Plus className="size-5" />
              Nova Etapa
            </button>
          )}
        </div>
      </DndContext>
      <EtapaDialog etapa={editingEtapa} open={etapaDialogOpen} onOpenChange={setEtapaDialogOpen} />
```

Find `handleDragEnd`'s body (the `active.data.current?.etapa` read, which was the OLD literal etapa string read off the draggable's data — `KanbanCard`'s `useDraggable({ id: negocio.id, data: { etapa: negocio.etapa } })` needs the same rename):

In `kanban-board.tsx`, find:
```ts
    const negocioId = active.id as string
    const novaEtapa = over.id as string
    const currentEtapa = active.data.current?.etapa as string

    if (currentEtapa === novaEtapa) return

    // Mover otimisticamente no estado local
    setNegocios((prev) =>
      prev.map((n) =>
        n.id === negocioId
          ? {
              ...n,
              etapa: novaEtapa as Negocio['etapa'],
              motivo_encerramento: novaEtapa !== 'encerrado' ? null : n.motivo_encerramento,
            }
          : n
      )
    )
```

Replace with:
```ts
    const negocioId = active.id as string
    const novaEtapaId = over.id as string
    const currentEtapaId = active.data.current?.etapaId as string

    if (currentEtapaId === novaEtapaId) return

    const novaEtapa = etapas.find((e) => e.id === novaEtapaId)

    // Mover otimisticamente no estado local
    setNegocios((prev) =>
      prev.map((n) =>
        n.id === negocioId
          ? {
              ...n,
              etapa_id: novaEtapaId,
              motivo_encerramento: novaEtapa?.exige_motivo ? n.motivo_encerramento : null,
            }
          : n
      )
    )
```

Find the rest of `handleDragEnd` (the `if (novaEtapa === 'encerrado')` branch):
```ts
    if (novaEtapa === 'encerrado') {
      setPendingMove({ negocioId, previousEtapa: currentEtapa })
      setMotivo('')
      setMotivoError('')
    } else {
      startTransition(async () => {
        try {
          await moverNegocio(negocioId, novaEtapa)
```

Replace with:
```ts
    if (novaEtapa?.exige_motivo) {
      setPendingMove({ negocioId, previousEtapa: currentEtapaId })
      setMotivo('')
      setMotivoError('')
    } else {
      startTransition(async () => {
        try {
          await moverNegocio(negocioId, novaEtapaId)
```

(the rest of that `try`/`catch` block, and `handleConfirmarEncerramento`/`handleCancelarEncerramento`, already operate on `previousEtapa` as an opaque id string being restored on failure/cancel — no further change needed there, since `PendingMove.previousEtapa` was always just carried through untyped as a string, now it happens to hold an id instead of a slug, which is a drop-in-compatible change).

Also find (the `NegocioForm` trigger near the top of the component's render):
```tsx
        <NegocioForm
          clientes={clientes}
          meuPerfil={meuPerfil}
          meuUserId={meuUserId}
          profiles={profiles}
          trigger={
```

Replace with:
```tsx
        <NegocioForm
          clientes={clientes}
          meuPerfil={meuPerfil}
          meuUserId={meuUserId}
          profiles={profiles}
          etapas={etapas}
          trigger={
```

- [ ] **Step 5: Edit `components/funil/kanban-card.tsx`'s `useDraggable` call to match the renamed drag-data key**

Find:
```ts
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: negocio.id,
    data: { etapa: negocio.etapa },
  })
```

Replace with:
```ts
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: negocio.id,
    data: { etapaId: negocio.etapa_id },
  })
```

Find (the `negocio.etapa === 'encerrado'` check that shows the `motivo_encerramento` note):
```tsx
      {negocio.etapa === 'encerrado' && negocio.motivo_encerramento && (
```

Replace with:
```tsx
      {negocio.motivo_encerramento && (
```

(any negócio carrying a `motivo_encerramento` is, by construction — Task 3's `moverNegocio`/`criarNegocio` only ever set it when the target stage's `exige_motivo` is true — always in a stage where showing the note makes sense; checking the literal old id is no longer meaningful.)

- [ ] **Step 6: Edit `app/dashboard/funil/page.tsx`**

Find:
```ts
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProfilesParaFiltro } from '@/lib/supabase/queries'
import { KanbanBoard } from '@/components/funil/kanban-board'
import { Negocio, Cliente } from '@/lib/types'
```

Replace with:
```ts
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProfilesParaFiltro, getEtapasFunil } from '@/lib/supabase/queries'
import { KanbanBoard } from '@/components/funil/kanban-board'
import { Negocio, Cliente } from '@/lib/types'
```

Find:
```ts
  const [{ data: negocios }, { data: clientes }] = await Promise.all([negociosQuery, clientesQuery])
  const profiles = souVendedor ? [] : await getProfilesParaFiltro()
```

Replace with:
```ts
  const [{ data: negocios }, { data: clientes }, etapas] = await Promise.all([negociosQuery, clientesQuery, getEtapasFunil()])
  const profiles = souVendedor ? [] : await getProfilesParaFiltro()
```

Find:
```tsx
      <KanbanBoard
        negocios={(negocios as Negocio[]) ?? []}
        clientes={(clientes as Cliente[]) ?? []}
        meuPerfil={perfil}
        meuUserId={user.id}
        profiles={profiles}
      />
```

Replace with:
```tsx
      <KanbanBoard
        negocios={(negocios as Negocio[]) ?? []}
        clientes={(clientes as Cliente[]) ?? []}
        meuPerfil={perfil}
        meuUserId={user.id}
        profiles={profiles}
        etapas={etapas}
      />
```

Also find the `negociosQuery`'s `.select(...)` (it selects `cliente:cliente_id(...)` and `responsavel:responsavel_id(...)` — needs the etapa join too, so `Negocio.etapa` is populated for anything that displays it):

Find:
```ts
  let negociosQuery = supabase
    .from('negocios')
    .select('*, cliente:cliente_id(nome, telefone), responsavel:responsavel_id(nome)')
    .order('created_at', { ascending: false })
```

Replace with:
```ts
  let negociosQuery = supabase
    .from('negocios')
    .select('*, cliente:cliente_id(nome, telefone), responsavel:responsavel_id(nome), etapa:etapa_id(nome, cor, tipo, exige_motivo)')
    .order('created_at', { ascending: false })
```

- [ ] **Step 7: Verify — build, typecheck, and a real manual pass**

Run: `npx tsc --noEmit` — same single pre-existing baseline error only.
Run: `npm run build` — clean.

Then, with Task 1's migration already applied for real (confirm with the human partner before this step — this task cannot be marked done without it): `npm run dev`, log in as admin/gerente, open `/dashboard/funil`, and check:
- The 5 seeded columns render in the same order/colors as before.
- "+ Nova Etapa" creates a 6th column; it appears at the end.
- The "⋮" on a column opens `EtapaDialog` pre-filled; changing color/name/tipo and saving updates the column immediately (after revalidate).
- Dragging a card into the "Encerrado" column still prompts for a motivo (same UX as before — now driven by `exige_motivo`, not the literal name).
- Dragging a card into a newly-created stage that has "Exigir motivo" checked also prompts for a motivo — this is the core new capability the migration exists to unlock; confirm it explicitly, not just the old behavior.
- Deleting an etapa with negócios in it is blocked with the expected error; deleting an empty one works.

- [ ] **Step 8: Commit**

```bash
git add components/funil/kanban-column.tsx components/funil/kanban-card.tsx components/funil/kanban-board.tsx components/funil/etapa-dialog.tsx app/dashboard/funil/page.tsx
git commit -m "feat(funil): dynamic kanban columns, etapa CRUD dialog, drag-to-reorder groundwork"
```

Note: this task wires columns to render from `etapas` (already reorderable via `reordenarEtapas`, which Task 3 provides) but does not yet add the drag handle UI for column reordering itself — see Task 4b below, kept separate because it's a distinct interaction (dragging columns, not cards) worth its own review pass.

---

## Task 4b: Drag-to-reorder columns

**Files:**
- Modify: `components/funil/kanban-board.tsx`
- Modify: `components/funil/kanban-column.tsx`
- Modify: `components/funil/kanban-card.tsx`

**Interfaces:**
- Consumes: `reordenarEtapas` (Task 3), the `etapas` prop threaded in Task 4.
- Design: ONE shared `DndContext`/`handleDragEnd` (not two nested contexts — dnd-kit's own "Multiple Containers" pattern handles mixed drag interactions this way) discriminates between a dragged card and a dragged column via a `type` field on each draggable's `data`. Card dragging keeps using plain `useDraggable`/`useDroppable` (card order within a column was never a requirement, so no sortable semantics needed there); only the column axis uses `@dnd-kit/sortable`.

- [ ] **Step 1: Install `@dnd-kit/sortable`**

Run: `grep dnd-kit/sortable package.json` — if it prints nothing (only `@dnd-kit/core` and `@dnd-kit/utilities` are listed), run `npm install @dnd-kit/sortable`.

- [ ] **Step 2: Edit `components/funil/kanban-board.tsx` — local `etapas` state + unified drag handling**

Find:
```ts
import { useState, useTransition } from 'react'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { KanbanColumn } from './kanban-column'
import { EtapaDialog } from './etapa-dialog'
import { NegocioForm } from './negocio-form'
import { moverNegocio } from '@/app/dashboard/funil/actions'
```

Replace with:
```ts
import { useState, useTransition } from 'react'
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { KanbanColumn } from './kanban-column'
import { EtapaDialog } from './etapa-dialog'
import { NegocioForm } from './negocio-form'
import { moverNegocio, reordenarEtapas } from '@/app/dashboard/funil/actions'
```

Find (from Task 4's edit, the state block right after the function signature):
```ts
  const [negocios, setNegocios] = useState<Negocio[]>(initial)
```

Leave that line as-is, but add right after the existing `podeGerenciarEtapas` line (also from Task 4):
```ts
  const [etapasOrdenadas, setEtapasOrdenadas] = useState<EtapaFunil[]>(etapas)
  const [prevEtapasProp, setPrevEtapasProp] = useState<EtapaFunil[]>(etapas)
  if (etapas !== prevEtapasProp) {
    setPrevEtapasProp(etapas)
    setEtapasOrdenadas(etapas)
  }
```

(same render-time "adjusting state" pattern this file already uses for `negocios`/`initial` a few lines above — keeps `etapasOrdenadas` in sync when the server parent re-renders with fresh data after a `revalidatePath`, without a `useEffect`.)

Find `handleDragEnd`'s signature and first lines:
```ts
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return

    const negocioId = active.id as string
```

Replace with:
```ts
  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return

    if (active.data.current?.type === 'column') {
      if (active.id === over.id) return
      const oldIndex = etapasOrdenadas.findIndex((e) => e.id === active.id)
      const newIndex = etapasOrdenadas.findIndex((e) => e.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return
      const reordenadas = arrayMove(etapasOrdenadas, oldIndex, newIndex)
      setEtapasOrdenadas(reordenadas)
      startTransition(() => reordenarEtapas(reordenadas.map((e) => e.id)))
      return
    }

    const negocioId = active.id as string
```

Find the `DndContext`/columns-map block (from Task 4's edit) and every remaining reference to the bare `etapas` prop inside the JSX (the `.map`, the `SortableContext` wrapper, and the "+ Nova Etapa" button's row):
```tsx
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex gap-4 overflow-x-auto pb-4">
          {etapas.map((etapa) => (
            <KanbanColumn
              key={etapa.id}
              etapa={etapa}
              negocios={negocios.filter((n) => n.etapa_id === etapa.id)}
              clientes={clientes}
              meuPerfil={meuPerfil}
              meuUserId={meuUserId}
              profiles={profiles}
              etapas={etapas}
              onEditEtapa={abrirEditarEtapa}
              onDeleteEtapa={() => {}}
            />
          ))}
          {podeGerenciarEtapas && (
            <button
              onClick={abrirNovaEtapa}
              className="flex flex-col items-center justify-center gap-1.5 w-64 h-24 shrink-0 rounded-lg border border-dashed text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
            >
              <Plus className="size-5" />
              Nova Etapa
            </button>
          )}
        </div>
      </DndContext>
```

Replace with:
```tsx
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <SortableContext items={etapasOrdenadas.map((e) => e.id)} strategy={horizontalListSortingStrategy}>
          <div className="flex gap-4 overflow-x-auto pb-4">
            {etapasOrdenadas.map((etapa) => (
              <KanbanColumn
                key={etapa.id}
                etapa={etapa}
                negocios={negocios.filter((n) => n.etapa_id === etapa.id)}
                clientes={clientes}
                meuPerfil={meuPerfil}
                meuUserId={meuUserId}
                profiles={profiles}
                etapas={etapasOrdenadas}
                onEditEtapa={abrirEditarEtapa}
                onDeleteEtapa={() => {}}
              />
            ))}
            {podeGerenciarEtapas && (
              <button
                onClick={abrirNovaEtapa}
                className="flex flex-col items-center justify-center gap-1.5 w-64 h-24 shrink-0 rounded-lg border border-dashed text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                <Plus className="size-5" />
                Nova Etapa
              </button>
            )}
          </div>
        </SortableContext>
      </DndContext>
```

(the `NegocioForm etapas={etapas}` trigger near the top of the render, from Task 4's edit, keeps reading the raw `etapas` prop — that one's a simple dropdown, not part of the board's drag surface, no need to switch it to `etapasOrdenadas`.)

- [ ] **Step 3: Edit `components/funil/kanban-column.tsx` — sortable drag handle**

Find:
```ts
import { useDroppable } from '@dnd-kit/core'
import { KanbanCard } from './kanban-card'
import { Negocio, Cliente, EtapaFunil } from '@/lib/types'
import { formatCurrency } from '@/lib/format'
import { etapaCorClasses } from '@/lib/etapa-colors'
import { cn } from '@/lib/utils'
```

Replace with:
```ts
import { useDroppable } from '@dnd-kit/core'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { KanbanCard } from './kanban-card'
import { Negocio, Cliente, EtapaFunil } from '@/lib/types'
import { formatCurrency } from '@/lib/format'
import { etapaCorClasses } from '@/lib/etapa-colors'
import { cn } from '@/lib/utils'
```

Find:
```ts
export function KanbanColumn({ etapa, negocios, clientes, meuPerfil, meuUserId, profiles, etapas, onEditEtapa, onDeleteEtapa }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa.id })
  const cores = etapaCorClasses(etapa.cor)

  const valorTotal = negocios.reduce((sum, n) => sum + (Number(n.valor) || 0), 0)

  return (
    <div className="flex flex-col w-64 shrink-0">
      <div className={`bg-card rounded-t-lg border-t-4 px-3 py-3 border-x ${cores.border}`}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-foreground">{etapa.nome}</span>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{negocios.length}</span>
            <button
              onClick={() => onEditEtapa(etapa)}
              className="text-muted-foreground hover:text-foreground"
              title="Editar etapa"
            >
              ⋮
            </button>
          </div>
        </div>
        <p className={`text-sm font-mono font-semibold tabular-nums mt-1 ${cores.text}`}>
          {formatCurrency(valorTotal)}
        </p>
      </div>
```

Replace with:
```ts
export function KanbanColumn({ etapa, negocios, clientes, meuPerfil, meuUserId, profiles, etapas, onEditEtapa, onDeleteEtapa }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: etapa.id })
  const sortable = useSortable({ id: etapa.id, data: { type: 'column' } })
  const cores = etapaCorClasses(etapa.cor)

  const valorTotal = negocios.reduce((sum, n) => sum + (Number(n.valor) || 0), 0)

  const sortableStyle = {
    transform: CSS.Transform.toString(sortable.transform),
    transition: sortable.transition,
  }

  return (
    <div ref={sortable.setNodeRef} style={sortableStyle} className="flex flex-col w-64 shrink-0">
      <div className={`bg-card rounded-t-lg border-t-4 px-3 py-3 border-x ${cores.border}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <button {...sortable.attributes} {...sortable.listeners} className="cursor-grab active:cursor-grabbing text-muted-foreground/50 hover:text-muted-foreground" title="Arrastar para reordenar">
              <GripVertical className="size-3.5" />
            </button>
            <span className="text-sm font-semibold text-foreground">{etapa.nome}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{negocios.length}</span>
            <button
              onClick={() => onEditEtapa(etapa)}
              className="text-muted-foreground hover:text-foreground"
              title="Editar etapa"
            >
              ⋮
            </button>
          </div>
        </div>
        <p className={`text-sm font-mono font-semibold tabular-nums mt-1 ${cores.text}`}>
          {formatCurrency(valorTotal)}
        </p>
      </div>
```

(only the drag *handle* button gets `sortable.listeners`/`attributes` — the rest of the column, including the card-droppable area below, is untouched, so clicking/dragging a card or the "⋮" menu never accidentally starts a column drag.)

- [ ] **Step 4: Edit `components/funil/kanban-card.tsx` — add the `type` discriminator**

Find (from Task 4 Step 5's edit):
```ts
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: negocio.id,
    data: { etapaId: negocio.etapa_id },
  })
```

Replace with:
```ts
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: negocio.id,
    data: { type: 'card', etapaId: negocio.etapa_id },
  })
```

(`kanban-board.tsx`'s `handleDragEnd` from Step 2 above reads `active.data.current?.etapaId` for the card branch — unchanged by this addition, since it only gains a sibling `type` field.)

- [ ] **Step 5: Verify — manual drag test**

`npm run dev`, `/dashboard/funil`, logged in as admin/gerente:
- Drag a column by its grip handle to a new position — it reorders immediately (optimistic), and reloading the page shows the same new order (confirms `reordenarEtapas` persisted `ordem` correctly).
- Drag a card between columns — still works exactly as before Task 4b (confirms the unified `DndContext` didn't break card dragging).
- Log in as `vendedor` — no grip handle/"+ Nova Etapa" render (both gated by `podeGerenciarEtapas`), card dragging still works.

- [ ] **Step 6: Commit**

```bash
git add components/funil/kanban-board.tsx components/funil/kanban-column.tsx components/funil/kanban-card.tsx package.json package-lock.json
git commit -m "feat(funil): drag-to-reorder funnel columns"
```

---

## Task 5: `negocio-form.tsx` — dynamic etapa select

**Files:**
- Modify: `components/funil/negocio-form.tsx`

**Interfaces:**
- Consumes: `EtapaFunil` (Task 2). New required prop `etapas: EtapaFunil[]`.

- [ ] **Step 1: Edit imports and props**

Find:
```ts
import { Cliente, Negocio } from '@/lib/types'
import { formatPhone } from '@/lib/format'
import { criarNegocio, atualizarNegocio } from '@/app/dashboard/funil/actions'

interface NegocioFormProps {
  clientes: Cliente[]
  etapaInicial?: string
  negocio?: Negocio
  trigger: React.ReactNode
  meuPerfil: string
  meuUserId: string
  profiles: { id: string; nome: string | null }[]
}

export function NegocioForm({ clientes, etapaInicial = 'lead', negocio, trigger, meuPerfil, meuUserId, profiles }: NegocioFormProps) {
```

Replace with:
```ts
import { Cliente, Negocio, EtapaFunil } from '@/lib/types'
import { formatPhone } from '@/lib/format'
import { criarNegocio, atualizarNegocio } from '@/app/dashboard/funil/actions'

interface NegocioFormProps {
  clientes: Cliente[]
  etapaInicial?: string
  negocio?: Negocio
  trigger: React.ReactNode
  meuPerfil: string
  meuUserId: string
  profiles: { id: string; nome: string | null }[]
  etapas: EtapaFunil[]
}

export function NegocioForm({ clientes, etapaInicial, negocio, trigger, meuPerfil, meuUserId, profiles, etapas }: NegocioFormProps) {
```

- [ ] **Step 2: Edit the `etapa` state default and the `mostrarMotivo` derivation**

Find:
```ts
  const [etapa, setEtapa] = useState(etapaInicial)
```

Replace with:
```ts
  const [etapa, setEtapa] = useState(etapaInicial ?? etapas[0]?.id ?? '')
```

Find:
```ts
  // Em modo edição, motivo aparece se o negócio já está encerrado (etapa não é editável via form)
  const mostrarMotivo = editando
    ? negocio.etapa === 'encerrado'
    : etapa === 'encerrado'
```

Replace with:
```ts
  // Em modo edição, motivo aparece se a etapa atual do negócio exige (etapa não é editável via form)
  const etapaSelecionada = etapas.find(e => e.id === etapa)
  const mostrarMotivo = editando
    ? (negocio.etapa?.exige_motivo ?? false)
    : (etapaSelecionada?.exige_motivo ?? false)
```

- [ ] **Step 3: Replace the hardcoded etapa `<select>`**

Find:
```tsx
              <select
                id="etapa"
                name="etapa"
                value={etapa}
                onChange={(e) => setEtapa(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="lead">Lead</option>
                <option value="proposta">Proposta</option>
                <option value="negociacao">Negociação</option>
                <option value="fechado">Fechado</option>
                <option value="encerrado">Encerrado</option>
              </select>
```

Replace with:
```tsx
              <select
                id="etapa"
                name="etapa"
                value={etapa}
                onChange={(e) => setEtapa(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {etapas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
```

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` — baseline only. Run: `npm run build` — clean.

- [ ] **Step 5: Commit**

```bash
git add components/funil/negocio-form.tsx
git commit -m "feat(funil): negocio-form etapa select reads dynamic stages"
```

---

## Task 6: Downstream — dashboard page, relatórios, inbox "add to funnel"

**Files:**
- Modify: `app/dashboard/page.tsx`
- Modify: `components/relatorios/grafico-funil.tsx`
- Modify: `app/dashboard/inbox/actions.ts`
- Modify: `components/inbox/mensagem-thread.tsx`
- Modify: `components/inbox/inbox-panel.tsx`
- Modify: `app/dashboard/inbox/page.tsx`

**Interfaces:**
- Consumes: `metrics.etapas`/`metrics.etapaMap` (Task 2's `getDashboardMetrics` return shape), `getTaxaConversaoPorEtapa`'s new array-shaped `contagem` (Task 2), `getEtapasFunil` (Task 2), `etapaCorClasses` (Task 2), `EtapaFunil` (Task 2).

- [ ] **Step 1: Edit `app/dashboard/page.tsx` — remove `ETAPA_CONFIG`, render dynamic etapas**

Find:
```ts
const ETAPA_CONFIG = [
  { etapa: 'lead',       label: 'Lead',        color: 'bg-chart-2',      bar: 'bg-chart-2' },
  { etapa: 'proposta',   label: 'Proposta',    color: 'bg-chart-5',      bar: 'bg-chart-5' },
  { etapa: 'negociacao', label: 'Negociação',  color: 'bg-chart-3',      bar: 'bg-chart-3' },
  { etapa: 'fechado',    label: 'Fechado',     color: 'bg-chart-4',      bar: 'bg-chart-4' },
  { etapa: 'encerrado',  label: 'Encerrado',   color: 'bg-destructive',  bar: 'bg-destructive' },
]
```

Delete it entirely, and add this import at the top of the file instead:
```ts
import { etapaCorClasses } from '@/lib/etapa-colors'
```

Find:
```ts
  const etapas = ETAPA_CONFIG.map(cfg => ({
    ...cfg,
    count: metrics.etapaMap[cfg.etapa]?.count ?? 0,
    valor: metrics.etapaMap[cfg.etapa]?.valor ?? 0,
  }))
```

Replace with:
```ts
  const etapas = metrics.etapas.map(e => ({
    etapa: e.id,
    label: e.nome,
    color: etapaCorClasses(e.cor).dot,
    bar: etapaCorClasses(e.cor).dot,
    count: metrics.etapaMap[e.id]?.count ?? 0,
    valor: metrics.etapaMap[e.id]?.valor ?? 0,
  }))
```

(`FunilEtapasCard`'s prop shape — `{etapa, label, count, valor, color, bar}` — is unchanged; only where the values come from changes. No edit needed in `components/dashboard/funil-etapas-card.tsx` itself.)

- [ ] **Step 2: Edit `components/relatorios/grafico-funil.tsx`**

Find:
```tsx
'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'

interface GraficoFunilProps {
  contagem: {
    lead: number
    proposta: number
    negociacao: number
    fechado: number
    encerrado: number
  }
  taxa: number
}

const CORES: Record<string, string> = {
  Lead: 'var(--chart-2)',
  Proposta: 'var(--chart-5)',
  Negociação: 'var(--chart-3)',
  Fechado: 'var(--chart-4)',
  Encerrado: 'var(--destructive)',
}

const LABELS: Record<string, string> = {
  lead: 'Lead',
  proposta: 'Proposta',
  negociacao: 'Negociação',
  fechado: 'Fechado',
  encerrado: 'Encerrado',
}

export function GraficoFunil({ contagem, taxa }: GraficoFunilProps) {
  const data = Object.entries(contagem).map(([key, value]) => ({
    etapa: LABELS[key],
    quantidade: value,
  }))
```

Replace with:
```tsx
'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts'
import { EtapaFunil } from '@/lib/types'

interface GraficoFunilProps {
  contagem: (EtapaFunil & { count: number })[]
  taxa: number
}

const COR_VAR: Record<string, string> = {
  violeta: 'var(--primary)',
  azul: 'var(--chart-2)',
  teal: 'var(--chart-3)',
  ambar: 'var(--chart-5)',
  verde: 'var(--chart-4)',
  vermelho: 'var(--destructive)',
}

export function GraficoFunil({ contagem, taxa }: GraficoFunilProps) {
  const data = contagem.map((e) => ({
    etapa: e.nome,
    quantidade: e.count,
    cor: COR_VAR[e.cor] ?? 'var(--muted-foreground)',
  }))
```

Find the `<Cell>` render:
```tsx
          <Bar dataKey="quantidade" radius={[4, 4, 0, 0]}>
            {data.map((entry) => (
              <Cell key={entry.etapa} fill={CORES[entry.etapa] ?? 'var(--muted-foreground)'} />
            ))}
          </Bar>
```

Replace with:
```tsx
          <Bar dataKey="quantidade" radius={[4, 4, 0, 0]}>
            {data.map((entry) => (
              <Cell key={entry.etapa} fill={entry.cor} />
            ))}
          </Bar>
```

- [ ] **Step 3: Edit `app/dashboard/inbox/actions.ts` — `adicionarAoFunil`**

Find:
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
```

Replace with:
```ts
export async function adicionarAoFunil(
  phone: string,
  contactName: string,
  titulo: string,
  valor: number,
  etapaId: string,
) {
  // Bug corrigido aqui: antes, negócios/clientes criados por este botão (a partir
  // do Inbox) nunca tinham dono — esta função usava só o client admin, sem sessão,
  // e não sabia quem estava logado. Agora busca o usuário autenticado e grava
  // user_id/responsavel_id, igual ao que criarNegocio (Funil) já fazia.
  const authClient = await createClient()
  const { data: { user } } = await authClient.auth.getUser()

  const supabase = createAdminClient()
  const { data: etapaRow } = await supabase.from('etapas_funil').select('id').eq('id', etapaId).maybeSingle()
  let etapaValida = etapaRow?.id
  if (!etapaValida) {
    const { data: primeira } = await supabase.from('etapas_funil').select('id').order('ordem').limit(1).single()
    etapaValida = primeira?.id
  }

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
    etapa_id: etapaValida,
    cliente_id: clienteId,
    motivo_encerramento: null,
    responsavel_id: user?.id ?? null,
  })

  revalidatePath('/dashboard/funil')
```

Note: the parameter is renamed `etapa` → `etapaId` for clarity — `mensagem-thread.tsx`'s `FunilDialog` (Step 4 below) calls `adicionarAoFunil(phone, contactName, titulo, parseFloat(valor) || 0, etapa)` positionally, so the caller-side variable name (`etapa`, holding an id after Step 4's change) doesn't need to change, only this function's own parameter name.

- [ ] **Step 4: Edit `components/inbox/mensagem-thread.tsx` — `FunilDialog`**

Find:
```tsx
function FunilDialog({ phone, contactName }: { phone: string; contactName: string }) {
  const [open, setOpen] = useState(false)
  const [titulo, setTitulo] = useState('')
  const [valor, setValor] = useState('')
  const [etapa, setEtapa] = useState('lead')
```

Replace with:
```tsx
function FunilDialog({ phone, contactName, etapas }: { phone: string; contactName: string; etapas: EtapaFunil[] }) {
  const [open, setOpen] = useState(false)
  const [titulo, setTitulo] = useState('')
  const [valor, setValor] = useState('')
  const [etapa, setEtapa] = useState(etapas[0]?.id ?? '')
```

Add `EtapaFunil` to the existing `import { Conversa, Mensagem } from '@/lib/types'` line (find it near the top of the file and change it to `import { Conversa, Mensagem, EtapaFunil } from '@/lib/types'`).

Find the `<select id="fetapa" ...>` block:
```tsx
              <select
                id="fetapa"
                value={etapa}
                onChange={e => setEtapa(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="lead">Lead</option>
                <option value="proposta">Proposta</option>
                <option value="negociacao">Negociação</option>
                <option value="fechado">Fechado</option>
              </select>
```

Replace with:
```tsx
              <select
                id="fetapa"
                value={etapa}
                onChange={e => setEtapa(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                {etapas.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
              </select>
```

Now find where `FunilDialog` is used inside `MensagemThread` (`{phone && <FunilDialog phone={phone} contactName={contactName} />}`) and thread a new `etapas: EtapaFunil[]` prop through `MensagemThread`'s own `Props` interface and function signature (same mechanical pattern as the existing `profiles` prop it already threads):

Find (in the `Props` interface):
```ts
  meuPerfil: 'admin' | 'gerente' | 'vendedor'
  profiles: { id: string; nome: string | null }[]
}
```

Replace with:
```ts
  meuPerfil: 'admin' | 'gerente' | 'vendedor'
  profiles: { id: string; nome: string | null }[]
  etapas: EtapaFunil[]
}
```

Find:
```ts
export function MensagemThread({ conversa, mensagens, loading, onPause, onResume, onMessageSent, onContactUpdated, meuPerfil, profiles }: Props) {
```

Replace with:
```ts
export function MensagemThread({ conversa, mensagens, loading, onPause, onResume, onMessageSent, onContactUpdated, meuPerfil, profiles, etapas }: Props) {
```

Find:
```tsx
          {phone && <FunilDialog phone={phone} contactName={contactName} />}
```

Replace with:
```tsx
          {phone && <FunilDialog phone={phone} contactName={contactName} etapas={etapas} />}
```

- [ ] **Step 5: Edit `components/inbox/inbox-panel.tsx` to thread `etapas` through to `MensagemThread`**

Find the component's prop destructuring:
```ts
export function InboxPanel({ conversas: initialConversas, initialHasMore, initialNextOffset, initialPhone, meuPerfil, profiles }: {
  conversas: Conversa[]
  initialHasMore: boolean
  initialNextOffset: number
  initialPhone?: string
  meuPerfil: 'admin' | 'gerente' | 'vendedor'
  profiles: { id: string; nome: string | null }[]
}) {
```

Replace with:
```ts
export function InboxPanel({ conversas: initialConversas, initialHasMore, initialNextOffset, initialPhone, meuPerfil, profiles, etapas }: {
  conversas: Conversa[]
  initialHasMore: boolean
  initialNextOffset: number
  initialPhone?: string
  meuPerfil: 'admin' | 'gerente' | 'vendedor'
  profiles: { id: string; nome: string | null }[]
  etapas: import('@/lib/types').EtapaFunil[]
}) {
```

Find the `<MensagemThread ...>` render:
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

Replace with:
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
        etapas={etapas}
      />
```

- [ ] **Step 6: Edit `app/dashboard/inbox/page.tsx` to fetch and pass `etapas`**

Find:
```ts
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProfilesParaFiltro } from '@/lib/supabase/queries'
import { getConversacoes } from './actions'
import { InboxPanel } from '@/components/inbox/inbox-panel'
```

Replace with:
```ts
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProfilesParaFiltro, getEtapasFunil } from '@/lib/supabase/queries'
import { getConversacoes } from './actions'
import { InboxPanel } from '@/components/inbox/inbox-panel'
```

Find:
```ts
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
```

Replace with:
```ts
  const [{ conversas, hasMore, nextOffset }, profiles, etapas] = await Promise.all([
    getConversacoes(),
    getProfilesParaFiltro(),
    getEtapasFunil(),
  ])

  return (
    <InboxPanel
      conversas={conversas}
      initialHasMore={hasMore}
      initialNextOffset={nextOffset}
      initialPhone={phone}
      meuPerfil={meuPerfil}
      profiles={profiles}
      etapas={etapas}
    />
  )
```

- [ ] **Step 7: Verify**

Run: `npx tsc --noEmit` — same single pre-existing baseline error only.
Run: `npm run build` — clean.

Manual check (after Task 1's migration is applied): `/dashboard` shows the funnel-by-stage card and revenue metrics matching what's on `/dashboard/funil`; `/dashboard/relatorios` shows the funnel chart with the right colors/counts; from `/dashboard/inbox`, open a conversation, click "Funil", confirm the etapa dropdown lists the real (possibly now 6+) stages and successfully creates a negócio in the chosen one.

- [ ] **Step 8: Commit**

```bash
git add app/dashboard/page.tsx components/relatorios/grafico-funil.tsx app/dashboard/inbox/actions.ts components/inbox/mensagem-thread.tsx components/inbox/inbox-panel.tsx app/dashboard/inbox/page.tsx
git commit -m "feat(funil): wire dashboard, relatorios, and inbox 'add to funnel' to dynamic etapas"
```
