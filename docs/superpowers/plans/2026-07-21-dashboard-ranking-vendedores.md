# Dashboard: Ranking de Vendedores Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Últimas atividades" (`ActivityFeed`) widget on the CRM's main Dashboard (`meu-crm`) with the existing "Ranking de vendedores" widget, reusing the components/queries already in production on the Relatórios page.

**Architecture:** Pure reshuffle in `app/dashboard/page.tsx` — swap one data fetch (`getRecentActivity` → `getRankingVendedores`) and one rendered component (`ActivityFeed` → `RankingVendedores`). No new components, no new queries, no schema/RLS change. The now-unused `ActivityFeed` component and `getRecentActivity` query are deleted since nothing else references them.

**Tech Stack:** Next.js 16 (App Router, Server Components), Supabase JS client, TypeScript.

**Repo:** `meu-crm` (local checkout: `C:\Users\rgrasso\claude teste\meu-crm`) — **not** `agente-de-ia`. Run every command below from that directory.

## Global Constraints

- No automated test framework in `meu-crm` — verification is `npx tsc --noEmit`, `npm run lint`, and `npm run build`, plus manual validation in the browser (per [[sdd_fable_workflow]] memory). Do not write Jest/Vitest tests for this plan.
- Follow the existing code style in the touched files exactly (no semicolons, single quotes, existing import ordering conventions) — do not reformat unrelated lines.
- Do not touch `app/dashboard/relatorios/*` or `getRankingVendedoresFiltrado` — out of scope per the spec.
- Do not run `git push` — commit locally only. Pushing is a deploy trigger in this project and needs explicit user confirmation first.

---

### Task 1: Swap ActivityFeed for RankingVendedores on the Dashboard and remove dead code

**Files:**
- Modify: `app/dashboard/page.tsx`
- Modify: `lib/supabase/queries.ts` (delete `getRecentActivity`, lines 111-139)
- Delete: `components/dashboard/activity-feed.tsx`

**Interfaces:**
- Consumes: `getRankingVendedores(): Promise<{ nome: string; total: number; count: number }[]>` (already exported from `lib/supabase/queries.ts:169-188`, unchanged by this task).
- Consumes: `RankingVendedores` component, `{ ranking: { nome: string; total: number; count: number }[] }` props (already exported from `components/relatorios/ranking-vendedores.tsx`, unchanged by this task).
- Produces: nothing new — this task only rewires existing exports. No other task depends on this one.

- [ ] **Step 1: Update imports in `app/dashboard/page.tsx`**

Current top of file:

```tsx
import { getDashboardMetrics, getSalesChartData, getRecentActivity } from '@/lib/supabase/queries'
import { MetricCard } from '@/components/dashboard/metric-card'
import { SalesChart } from '@/components/dashboard/sales-chart'
import { ActivityFeed } from '@/components/dashboard/activity-feed'
import { FunilEtapasCard } from '@/components/dashboard/funil-etapas-card'
import { formatCurrency } from '@/lib/format'
```

Replace with:

```tsx
import { getDashboardMetrics, getSalesChartData, getRankingVendedores } from '@/lib/supabase/queries'
import { MetricCard } from '@/components/dashboard/metric-card'
import { SalesChart } from '@/components/dashboard/sales-chart'
import { RankingVendedores } from '@/components/relatorios/ranking-vendedores'
import { FunilEtapasCard } from '@/components/dashboard/funil-etapas-card'
import { formatCurrency } from '@/lib/format'
```

- [ ] **Step 2: Update the data fetch**

Current:

```tsx
  const [metrics, chartData, activities] = await Promise.all([
    getDashboardMetrics(),
    getSalesChartData(),
    getRecentActivity(),
  ])
```

Replace with:

```tsx
  const [metrics, chartData, ranking] = await Promise.all([
    getDashboardMetrics(),
    getSalesChartData(),
    getRankingVendedores(),
  ])
```

- [ ] **Step 3: Update the rendered widget**

Current (end of file, inside the "Gráficos e atividades" grid):

```tsx
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <SalesChart data={chartData} />
        <FunilEtapasCard etapas={etapas} />
        <ActivityFeed activities={activities} />
      </div>
```

Replace with:

```tsx
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <SalesChart data={chartData} />
        <FunilEtapasCard etapas={etapas} />
        <RankingVendedores ranking={ranking} />
      </div>
```

- [ ] **Step 4: Type-check before deleting anything**

Run: `npx tsc --noEmit`
Expected: no errors referencing `app/dashboard/page.tsx`. (There may be pre-existing unrelated errors elsewhere in the repo — only care about this file.)

- [ ] **Step 5: Delete the now-unused `getRecentActivity` query**

In `lib/supabase/queries.ts`, find this block (currently lines 111-139, right before the `// ---- RELATÓRIOS ----` comment):

```ts
export async function getRecentActivity() {
  const supabase = await createClient()
  const admin = createAdminClient()

  const [{ data: clientes }, { data: negocios }, { data: tarefas }, { data: conversas }] = await Promise.all([
    supabase.from('clientes').select('id, nome, created_at').order('created_at', { ascending: false }).limit(4),
    supabase.from('negocios').select('id, titulo, created_at').order('created_at', { ascending: false }).limit(4),
    supabase.from('tarefas').select('id, descricao, created_at').order('created_at', { ascending: false }).limit(4),
    admin.from('conversations').select('id, last_message_at, contacts(name, phone)').order('last_message_at', { ascending: false, nullsFirst: false }).limit(4),
  ])

  type Tipo = 'cliente' | 'negocio' | 'tarefa' | 'conversa'

  const activities: { tipo: Tipo; descricao: string; created_at: string }[] = [
    ...(clientes?.map((c) => ({ tipo: 'cliente' as Tipo, descricao: `Novo cliente: ${c.nome}`, created_at: c.created_at })) ?? []),
    ...(negocios?.map((n) => ({ tipo: 'negocio' as Tipo, descricao: `Novo negócio: ${n.titulo}`, created_at: n.created_at })) ?? []),
    ...(tarefas?.map((t) => ({ tipo: 'tarefa' as Tipo, descricao: `Nova tarefa: ${t.descricao}`, created_at: t.created_at })) ?? []),
    ...(conversas?.filter(c => c.last_message_at).map((c) => {
      const contact = c.contacts as { name?: string | null; phone?: string | null } | null
      const nome = contact?.name || contact?.phone || 'Contato'
      return { tipo: 'conversa' as Tipo, descricao: `Mensagem de ${nome}`, created_at: c.last_message_at! }
    }) ?? []),
  ]

  return activities
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 12)
}

```

Delete the whole block above (including its trailing blank line), so that `getSalesChartData`'s closing `}` is followed by exactly one blank line and then `// ---- RELATÓRIOS ----`.

- [ ] **Step 6: Delete the now-unused `ActivityFeed` component**

Delete the file `components/dashboard/activity-feed.tsx` entirely.

- [ ] **Step 7: Verify nothing else references the deleted code**

Run: `grep -rn "ActivityFeed\|getRecentActivity" --include="*.ts" --include="*.tsx" . --exclude-dir=node_modules --exclude-dir=.next`
Expected: no output (no matches anywhere in the repo).

- [ ] **Step 8: Type-check, lint, and build**

Run: `npx tsc --noEmit`
Expected: no errors.

Run: `npm run lint`
Expected: no errors (pre-existing warnings unrelated to this change are acceptable).

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 9: Manual verification**

Start the dev server (`npm run dev`), log in as an `admin` or `gerente` user, open the Dashboard (`/dashboard`), and confirm:
- The third card in the "Gráficos e atividades" row is now titled "Ranking de vendedores" and lists vendedores with totals (or the empty state "Nenhuma venda fechada ainda" if there's no closed deal yet).
- "Últimas atividades" no longer appears anywhere on the page.

If a `vendedor`-role test account is available, log in as one and confirm the ranking table shows at most one row (their own) — this is RLS (`negocios_select` policy), not new code, so it should already work; just confirm no crash/blank page.

- [ ] **Step 10: Commit**

```bash
git add app/dashboard/page.tsx lib/supabase/queries.ts components/dashboard/activity-feed.tsx
git commit -m "feat(dashboard): replace últimas atividades with ranking de vendedores"
```

Note: `git add` on a deleted file stages the deletion — this is correct, do not use `git rm` separately.

---

## Push

Do not push. After Task 1 is committed and manually verified, stop and ask the user for explicit confirmation before `git push` (EasyPanel auto-deploys the `crm` service on push to `main`).
