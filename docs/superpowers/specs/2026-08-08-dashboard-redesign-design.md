# Dashboard visual redesign — design system + shell/overview rollout

## Problem

The CRM currently uses the untouched shadcn/ui default theme: pure grayscale OKLCH tokens, no brand accent color, default Inter font with no defined type scale, default 10px radius, and no dark mode (no `next-themes`, no `ThemeProvider`, `.dark` class never applied). The result reads as an unmodified AI-generated template rather than a considered product, with no visual hierarchy, depth, or personality.

The team uses this CRM as their primary, all-day work surface (vendedores field WhatsApp leads through it for hours), which makes visual fatigue and information density first-order design constraints, not secondary polish.

## Goals

- Establish a dark-first, single-theme (no light/dark toggle) design system with a distinct visual identity
- Apply it to the app shell (sidebar, header) and the dashboard overview page (metric cards, sales chart) as the flagship rollout
- Reduce visual fatigue for multi-hour daily use while adding depth/sophistication the current flat gray theme lacks

## Non-goals (this phase)

- Light mode is out of scope. The existing `:root` (light) CSS variables are left untouched but unreachable — `.dark` is applied unconditionally on `<html>`, no toggle is built. Revisiting light mode is a separate future project if ever needed.
- The other 7 dashboard areas (funil, inbox, clientes, relatórios, tarefas, agente, configurações) are **not** redesigned in this phase. They inherit the new design system automatically wherever they already use shared `components/ui/*` primitives and shell chrome, but page-specific layouts there are follow-up work.
- No brand constraint — this is an internal tool, accent color was chosen on pure aesthetic/technical merit, not to match any external brand identity.

## Direction

Three visual personalities were considered:

- **Flat technical (Linear-style)** — 1px borders only, zero shadow, accent used only on interactive states. Rejected as primary direction: risks feeling cold for a sales team, though its border discipline is borrowed.
- **High-contrast glow (Vercel-style)** — near-black background, dramatic violet glow on primary elements. Rejected: highest visual impact but highest fatigue risk for a tool used all day, which is the confirmed primary usage pattern.
- **Layered depth (Raycast-style)** — chosen. Three background layers create depth without heavy shadows, softened corners feel more tactile than pure-flat, and contrast stays moderate — sustainable for long sessions while still reading as deliberate and premium.

Accent color: electric violet/indigo (`oklch(0.62 0.19 291)`), chosen for the "premium SaaS tool" association (Linear) without being tied to any existing brand mark. Typography: Geist Sans + Geist Mono (Vercel's typeface, MIT-licensed, ships as an `geist` npm package usable via `next/font`), replacing Inter to shed the generic-template look and give numeric data a distinct, technical treatment via Mono + tabular-nums.

## Design system

### Color (dark-only; values in OKLCH)

**Background layers** (the core depth mechanism — every surface sits on exactly one of these three):

| Token | Value | Used for |
|---|---|---|
| `bg-base` | `oklch(0.16 0.006 285)` | Page canvas, main content area |
| `bg-surface` | `oklch(0.20 0.008 285)` | Cards, sidebar |
| `bg-elevated` | `oklch(0.245 0.010 285)` | Dropdowns, modals, popovers, hover states |

**Text:** primary `oklch(0.97 0.005 285)`, secondary/muted `oklch(0.65 0.01 285)`, tertiary/disabled `oklch(0.45 0.01 285)`.

**Border:** white at 8% opacity — separates layers without drawing boxes.

**Accent (violet):** base `oklch(0.62 0.19 291)`, hover `oklch(0.68 0.19 291)`, subtle fill (badges, selected rows) at 15% opacity.

**Semantic:** success `oklch(0.72 0.17 155)` (emerald), warning `oklch(0.78 0.15 80)` (amber), danger `oklch(0.65 0.19 25)` (red) — each its own hue family, never confusable with accent.

**Charts (5-step categorical scale):** violet → blue (`oklch(0.65 0.16 250)`) → teal (`oklch(0.70 0.14 190)`) → emerald (`oklch(0.72 0.17 155)`) → amber (`oklch(0.78 0.15 80)`).

### Typography (Geist Sans / Geist Mono)

| Role | Size/line-height | Weight | Tracking |
|---|---|---|---|
| H1 (page title) | 24/32px | 600 | -0.015em |
| H2 (section) | 18/28px | 600 | -0.01em |
| H3 (card title) | 15/20px | 600 | normal |
| Body | 14/20px | 400 | normal |
| Meta/secondary | 13/18px, muted color | 400 | normal |
| Label (table headers, eyebrow) | 11/16px, uppercase | 500 | +0.04em |
| Featured metric (Geist Mono, tabular-nums) | 28/32px | 600 | normal |

Only two weights (400, 600) are used anywhere — hierarchy comes from size and color, not a spread of intermediate weights.

### Spacing, radius, grid

Base unit stays 4px (Tailwind default). Page padding 32px; card padding 20px; gap between grid cards 16px; sidebar width 240px (64px collapsed, icon-only); header height 56px. Radius is asymmetric by component role, not derived from one multiplier: 6px (buttons, badges), 8px (cards, inputs), 12px (modals, popovers).

### Base components

- **Button (primary):** solid accent fill, white text, 6px radius, 13px/600 label, heights 32/36/40px (sm/default/lg).
- **Card:** `bg-surface`, 1px border (8% white), 8px radius, 20px padding, **no shadow** — depth comes from the layer, not from a drop shadow.
- **Elevated surfaces** (dropdown/modal/popover): `bg-elevated`, 1px border, subtle shadow (`0 8px 24px rgba(0,0,0,.4)`).
- **Input:** background slightly darker than its surrounding card (recessed feel), 1px border, 6px radius, 36px height, 2px accent ring on focus.
- **Table:** no vertical rules, horizontal dividers at 6% opacity only, header row in the 11px uppercase label style, numeric columns right-aligned in Geist Mono tabular-nums.
- **Sidebar nav item (active state):** accent fill at 12% opacity, accent-colored icon/label, 2px accent bar on the left edge.

## Scope of this phase — repo `meu-crm` (files)

- `app/globals.css` — replace token values (see technical notes below); remove the default gray/no-accent theme.
- `app/layout.tsx` — swap `Inter` for `GeistSans`/`GeistMono`; force `className="dark"` on `<html>` unconditionally (no toggle).
- `components/dashboard/dashboard-shell.tsx`, `sidebar.tsx`, `header.tsx` — apply new layer/spacing/active-state treatment.
- `components/dashboard/metric-card.tsx` — featured-metric typography (Geist Mono), label style, semantic trend color.
- `components/dashboard/sales-chart.tsx` — recharts theming: accent line/area, new chart color scale, low-opacity gridlines.
- `components/dashboard/notificacoes-bell.tsx`, `notificacoes-panel.tsx` — inherit elevated-surface treatment (popover).
- Any shared primitives under `components/ui/*` that the shell/overview page depends on (button, card, input, table, badge) get their tokens/radius updated as needed — full audit happens in the implementation plan, not enumerated here.

## Technical implementation notes

- **Token mapping strategy:** reuse the existing shadcn semantic variable names already wired through `@theme inline` in `globals.css` (`--background`, `--card`, `--popover`, `--sidebar`, `--primary`, `--accent`, `--muted`, `--border`, `--ring`, `--chart-1..5`) rather than inventing new variable names — this lets existing `components/ui/*` primitives pick up the new theme without per-component rewrites. Mapping: `--background` → `bg-base`, `--card`/`--sidebar` → `bg-surface`, `--popover` → `bg-elevated`, `--primary` → accent violet, `--accent` → a subtle neutral hover fill (kept distinct from `--primary` per shadcn convention), `--destructive` → danger red, `--chart-1..5` → the 5-step categorical scale.
- **Dark-only enforcement:** apply `.dark`'s variable block permanently by setting `className="dark"` on `<html>` in `app/layout.tsx`; leave the `:root` (light) block in `globals.css` in place but unreachable, so no code needs deleting and a future toggle stays possible without redoing this work.
- **Radius:** the current single-`--radius`-multiplied scale (`--radius-sm/md/lg/xl` all derived from one `--radius` value) doesn't fit the asymmetric 6/8/12px scale above; the implementation plan should set `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl` to explicit values instead of a computed chain.
- **Font:** add the `geist` npm package; replace the `next/font/google` Inter import in `app/layout.tsx` with `GeistSans`/`GeistMono` from `geist/font/sans` and `geist/font/mono`.

## Testing

Visual/manual only — no new business logic is introduced. Verify in a running dev server: shell + overview page render with the new theme, no light-mode flash on load (since `.dark` is applied server-side via the `className`, not client-side JS), recharts colors pick up the new palette, and no shared `components/ui/*` primitive used elsewhere in the app breaks visually on pages outside this phase's scope (spot-check funil/inbox/clientes at least don't look broken, even though they're not being redesigned).
