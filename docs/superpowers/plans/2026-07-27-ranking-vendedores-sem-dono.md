# Ranking de Vendedores: Reconciliar com Fechados Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `getRankingVendedores`/`getRankingVendedoresFiltrado` from silently dropping closed deals with no `responsavel_id`, so the sum of the ranking table always equals the Dashboard's "Fechados" total — unattributed deals show as a distinct, non-competing "Sem vendedor" row at the end of the list.

**Architecture:** Both query functions already build the same per-vendedor aggregation independently (duplicated `forEach` loop). Factor that into one shared `agruparRanking` helper in `lib/supabase/queries.ts` that groups deals with no `responsavel` join under a synthetic `sem-vendedor` key instead of skipping them, tags that entry with `semVendedor: true`, and always places it last (real vendedores stay sorted by total desc). `RankingVendedores` (the shared display component used by both Dashboard and Relatórios) renders that entry with muted styling instead of the normal green/bold vendor styling, and switches its list key from `v.nome` (collision-prone — two vendedores can share a name, or two aggregated rows can now share the label "Sem vendedor"/"Sem nome") to the array index.

**Tech Stack:** Next.js 16 (App Router, Server Components), Supabase JS, TypeScript, React.

**Repo:** `meu-crm` (local checkout: `C:\Users\rgrasso\claude teste\meu-crm`) — run every command below from that directory.

## Global Constraints

- No automated test framework in `meu-crm` — verification is `npx tsc --noEmit`, `npm run lint`, `npm run build`, plus manual validation in the browser (per [[sdd_fable_workflow]] memory). Do not write Jest/Vitest tests for this plan.
- Follow the existing code style in the touched files exactly (no semicolons, single quotes, existing import ordering conventions) — do not reformat unrelated lines.
- No database migration — this is a read/aggregation-only fix, no schema change (see spec `docs/superpowers/specs/2026-07-27-ranking-vendedores-sem-dono-design.md`).
- The "Sem vendedor" entry must never participate in the by-value sort with real vendedores — it is always appended last, regardless of its total.
- Do not run `git push` — commit locally only. Pushing is a deploy trigger for the `crm` service, and its "Deploy Automático" is currently OFF — a manual "Implantar" click in EasyPanel is required after any future push.

---

### Task 1: Reconcile ranking totals and fix the row key

**Files:**
- Modify: `lib/supabase/queries.ts` (full file is 232+ lines; `getRankingVendedores` is lines 140-159, `getProfilesParaFiltro` at 161-168 is unrelated and stays untouched in between, `getRankingVendedoresFiltrado` is lines 170-194)
- Modify: `components/relatorios/ranking-vendedores.tsx` (full file, 39 lines)
- Modify: `components/relatorios/exportar-relatorio.tsx` (only the `ranking` prop type on line 9)

**Interfaces:**
- Produces: `agruparRanking(data: { valor: unknown; responsavel: unknown }[] | null): RankingEntry[]` — new private helper in `lib/supabase/queries.ts`, not exported, used by both ranking query functions.
- Produces: `RankingEntry` — new interface in `lib/supabase/queries.ts`: `{ nome: string; total: number; count: number; semVendedor?: boolean }`. This is the new shape returned by `getRankingVendedores`/`getRankingVendedoresFiltrado`, consumed by `RankingVendedores` (`components/relatorios/ranking-vendedores.tsx`) and `ExportarRelatorio` (`components/relatorios/exportar-relatorio.tsx`) — both already receive this data as their `ranking` prop, only their prop *type* needs to widen to match (no logic change needed in `exportar-relatorio.tsx`, the export code iterates generically over `{nome, total, count}` and doesn't care about the extra optional field).
- No other task — this plan has one task.

- [ ] **Step 1: Add the shared `agruparRanking` helper and rewrite both ranking functions**

Open `lib/supabase/queries.ts`. Replace `getRankingVendedores` (currently lines 140-159) with:

```ts
interface RankingEntry {
  nome: string
  total: number
  count: number
  semVendedor?: boolean
}

function agruparRanking(data: { valor: unknown; responsavel: unknown }[] | null): RankingEntry[] {
  const ranking: Record<string, RankingEntry> = {}

  data?.forEach((n) => {
    const resp = n.responsavel as unknown as { id: string; nome: string | null } | null
    const key = resp?.id ?? 'sem-vendedor'
    if (!ranking[key]) {
      ranking[key] = resp
        ? { nome: resp.nome ?? 'Sem nome', total: 0, count: 0 }
        : { nome: 'Sem vendedor', total: 0, count: 0, semVendedor: true }
    }
    ranking[key].total += Number(n.valor) || 0
    ranking[key].count++
  })

  const entradas = Object.values(ranking)
  const comVendedor = entradas.filter((e) => !e.semVendedor).sort((a, b) => b.total - a.total)
  const semVendedor = entradas.find((e) => e.semVendedor)

  return semVendedor ? [...comVendedor, semVendedor] : comVendedor
}

export async function getRankingVendedores() {
  const supabase = await createClient()

  const { data } = await supabase
    .from('negocios')
    .select('valor, responsavel:profiles!responsavel_id(id, nome)')
    .eq('etapa', 'fechado')

  return agruparRanking(data)
}
```

Leave `getProfilesParaFiltro` (lines 161-168) exactly as-is — it sits between the two ranking functions and is unrelated to this change.

Then replace `getRankingVendedoresFiltrado` (currently lines 170-194) with:

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

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors referencing `lib/supabase/queries.ts`. (A pre-existing, unrelated error in `app/dashboard/funil/actions.ts` may appear — ignore it, it predates this change.)

- [ ] **Step 3: Update `RankingVendedores` to style the "Sem vendedor" row and fix the list key**

Open `components/relatorios/ranking-vendedores.tsx`. Replace the whole file:

```tsx
import { formatCurrency } from '@/lib/format'

interface RankingVendedoresProps {
  ranking: { nome: string; total: number; count: number; semVendedor?: boolean }[]
}

export function RankingVendedores({ ranking }: RankingVendedoresProps) {
  return (
    <div className="bg-white rounded-xl border p-6 shadow-sm">
      <h3 className="text-sm font-medium text-gray-500 mb-4">Ranking de vendedores</h3>
      {ranking.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">Nenhuma venda fechada ainda</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b">
              <th className="pb-2 text-gray-500 font-medium">#</th>
              <th className="pb-2 text-gray-500 font-medium">Vendedor</th>
              <th className="pb-2 text-gray-500 font-medium text-right">Negócios</th>
              <th className="pb-2 text-gray-500 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {ranking.map((v, i) => (
              <tr key={i} className="border-b last:border-0">
                <td className="py-3 text-gray-400 font-medium">{i + 1}</td>
                <td className={`py-3 font-medium ${v.semVendedor ? 'text-gray-500 italic' : 'text-gray-900'}`}>
                  {v.nome}
                </td>
                <td className="py-3 text-gray-600 text-right">{v.count}</td>
                <td className={`py-3 font-semibold text-right ${v.semVendedor ? 'text-gray-500' : 'text-green-600'}`}>
                  {formatCurrency(v.total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Widen the `ranking` prop type in `ExportarRelatorio`**

Open `components/relatorios/exportar-relatorio.tsx`. On line 9, change:

```ts
  ranking: { nome: string; total: number; count: number }[]
```

to:

```ts
  ranking: { nome: string; total: number; count: number; semVendedor?: boolean }[]
```

No other change in this file — the export logic (CSV/XLSX/PDF generation) already iterates generically over `nome`/`total`/`count` and needs no changes; the "Sem vendedor" row will be included in exports automatically, which is correct (exported totals should also reconcile with "Fechados").

- [ ] **Step 5: Type-check, lint, and build**

Run: `npx tsc --noEmit`
Expected: no errors referencing `lib/supabase/queries.ts`, `components/relatorios/ranking-vendedores.tsx`, or `components/relatorios/exportar-relatorio.tsx`. (Same pre-existing `app/dashboard/funil/actions.ts` error is fine to see.)

Run: `npm run lint`
Expected: no new errors (pre-existing warnings/errors in other files, e.g. `components/inbox/inbox-panel.tsx`, are unrelated and acceptable).

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Manual verification**

Start the dev server (`npm run dev`) and check both `http://localhost:3000/crm/dashboard` and `http://localhost:3000/crm/dashboard/relatorios` (basePath is `/crm`), logged in as `admin`:

1. On the Dashboard, confirm "Fechados" and the sum of every row in "Ranking de vendedores" now match (as of this plan being written: "Fechados" = R$ 60.000; ranking should show one normal row — the admin account, labeled "Sem nome" since that profile has no name set, R$ 15.000 — plus a final muted/italic "Sem vendedor" row for R$ 45.000across the 4 unattributed deals). Exact figures may have changed by the time you test — the invariant to check is that they now match, not the specific numbers above.
2. Confirm the "Sem vendedor" row is visually distinct (gray/italic) from real vendedor rows, and is the last row regardless of its value being larger than other rows.
3. On Relatórios, apply the month/year filter and confirm the same reconciliation holds for the filtered period (whatever period actually contains the closed deals — adjust the filter to a month/year that includes them if the current month shows nothing).
4. Click "Exportar" on Relatórios (CSV/XLSX/PDF, whichever is fastest to check) and confirm the exported ranking includes the "Sem vendedor" row with the correct total.
5. Confirm no console errors, and that the "Nenhuma venda fechada ainda" empty state still shows correctly if you can find/simulate a period with zero closed deals (e.g. a future month).

- [ ] **Step 7: Commit**

```bash
git add lib/supabase/queries.ts components/relatorios/ranking-vendedores.tsx components/relatorios/exportar-relatorio.tsx
git commit -m "fix(relatorios): include unattributed closed deals in ranking as Sem vendedor"
```

---

## Push

Do not push. After Task 1 is committed and manually verified, stop and ask the user for explicit confirmation before `git push` — and remember the `crm` service's "Deploy Automático" is currently OFF, so a manual "Implantar" click in EasyPanel will also be needed after the push.
