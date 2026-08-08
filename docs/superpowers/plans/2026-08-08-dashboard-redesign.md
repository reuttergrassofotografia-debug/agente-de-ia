# Dashboard visual redesign (shell + overview) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the untouched shadcn/ui default theme in the `meu-crm` CRM with a dark-only, 3-layer depth design system (violet/indigo accent, Geist Sans/Mono), applied to the app shell and the dashboard overview page.

**Architecture:** This is a pure CSS-token + Tailwind-class + JSX-markup change — no new components, no new business logic, no new routes. All work happens through the existing shadcn/Tailwind v4 CSS-variable theming already wired in `app/globals.css`'s `@theme inline` block, plus direct class edits on the small number of components that currently bypass those tokens with hardcoded gray/blue Tailwind classes.

**Tech Stack:** Next.js 16, React 19, Tailwind v4 (CSS-variable theming via `@theme inline`), recharts (SVG charts, themed via CSS custom properties passed as `fill`/`stroke` values), `geist` npm package for fonts.

## Global Constraints

- Dark-only for this phase — no light/dark toggle. `.dark`'s CSS variable block is applied unconditionally; `:root` (light) values are left in place but unreachable.
- No new dependencies except `geist` (fonts). No new shared UI primitives.
- Every class change must resolve through the design tokens defined in Task 1 (`bg-card`, `text-muted-foreground`, `bg-primary`, `text-chart-N`, etc.) — never introduce a new hardcoded Tailwind gray/blue/etc. color class.
- Repo is `meu-crm` (all file paths below are relative to its root) unless noted otherwise.
- No automated visual-regression tooling exists in this repo. Every task's verification step is a manual check against a running `npm run dev` server — be specific about what to look at, not just "looks right."

---

## File Map

| File | Change |
|---|---|
| `app/globals.css` | Rewrite `.dark` token values, add `--success`/`--warning` tokens, fix `--font-sans` (was circular), fix radius scale to explicit asymmetric values |
| `app/layout.tsx` | Swap Inter for Geist Sans/Mono, force `className="dark"` on `<html>` |
| `app/(auth)/layout.tsx` | `bg-gray-50` → `bg-background` (otherwise breaks once dark is forced globally — the login/cadastro `Card` already uses `components/ui/card`, which *does* pick up the new theme, so leaving this hardcoded would put a dark card on a light-gray page) |
| `package.json` | Add `geist` dependency |
| `components/dashboard/dashboard-shell.tsx` | `bg-gray-50` → `bg-background` |
| `components/dashboard/sidebar.tsx` | Hardcoded white/gray/blue → tokens; new active-item treatment (12%-opacity fill + left accent bar, replacing solid blue block) |
| `components/dashboard/header.tsx` | Hardcoded white/gray/red → tokens; drop `shadow-sm` |
| `components/dashboard/notificacoes-bell.tsx` | Hardcoded gray/red → tokens |
| `components/dashboard/notificacoes-panel.tsx` | Hardcoded white/gray/blue → tokens; popover surface + explicit shadow |
| `components/dashboard/metric-card.tsx` | `COLOR_MAP` rebuilt on success/warning/primary/destructive/muted tokens (plus one chart token for the informational "blue" case); value text now neutral + Geist Mono instead of per-color |
| `app/dashboard/page.tsx` | Header text tokens, eyebrow-label styling, `ETAPA_CONFIG` colors moved to chart tokens |
| `components/dashboard/sales-chart.tsx` | Recharts theming via CSS custom properties (bar fill, grid, axis ticks, tooltip) |
| `components/dashboard/funil-etapas-card.tsx` | Hardcoded gray → tokens; numeric columns in Geist Mono |
| `components/relatorios/ranking-vendedores.tsx` | Hardcoded gray/blue/green → tokens; table restyled per spec (no vertical rules, uppercase label header, right-aligned mono numbers) |

**Known, accepted gap:** `components/ui/card.tsx` and `components/ui/dialog.tsx` (used by the login page and any modals elsewhere, not touched in this phase) use `rounded-xl`, which resolves to 12px under the new radius scale — one step larger than the 8px this plan uses for the hand-styled dashboard cards. Not fixed here: those files are outside this phase's scope (non-goal in the spec), and the difference is subtle enough not to read as broken.

---

## Task 1: Foundation — tokens, fonts, dark-only enforcement

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Modify: `app/(auth)/layout.tsx`
- Modify: `package.json` (via `npm install`)

**Interfaces:**
- Produces: CSS custom properties consumed by every later task — `--background`, `--card`, `--popover`, `--primary`, `--accent`, `--muted`, `--muted-foreground`, `--destructive`, `--success`, `--warning`, `--border`, `--chart-1` through `--chart-5`, `--sidebar*`, `--radius-sm/md/lg/xl`. Also produces the corresponding Tailwind utility classes (`bg-card`, `text-muted-foreground`, `bg-chart-2/15`, `rounded-lg`, etc.) via the existing `@theme inline` mapping — no task after this one adds new tokens.

- [ ] **Step 1: Install the `geist` font package**

Run: `npm install geist`

- [ ] **Step 2: Replace `app/globals.css` in full**

```css
@import "tailwindcss";
@import "tw-animate-css";
@import "shadcn/tailwind.css";

@custom-variant dark (&:is(.dark *));

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --font-sans: var(--font-geist-sans);
  --font-mono: var(--font-geist-mono);
  --font-heading: var(--font-sans);
  --color-sidebar-ring: var(--sidebar-ring);
  --color-sidebar-border: var(--sidebar-border);
  --color-sidebar-accent-foreground: var(--sidebar-accent-foreground);
  --color-sidebar-accent: var(--sidebar-accent);
  --color-sidebar-primary-foreground: var(--sidebar-primary-foreground);
  --color-sidebar-primary: var(--sidebar-primary);
  --color-sidebar-foreground: var(--sidebar-foreground);
  --color-sidebar: var(--sidebar);
  --color-chart-5: var(--chart-5);
  --color-chart-4: var(--chart-4);
  --color-chart-3: var(--chart-3);
  --color-chart-2: var(--chart-2);
  --color-chart-1: var(--chart-1);
  --color-ring: var(--ring);
  --color-input: var(--input);
  --color-border: var(--border);
  --color-destructive: var(--destructive);
  --color-success: var(--success);
  --color-success-foreground: var(--success-foreground);
  --color-warning: var(--warning);
  --color-warning-foreground: var(--warning-foreground);
  --color-accent-foreground: var(--accent-foreground);
  --color-accent: var(--accent);
  --color-muted-foreground: var(--muted-foreground);
  --color-muted: var(--muted);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-secondary: var(--secondary);
  --color-primary-foreground: var(--primary-foreground);
  --color-primary: var(--primary);
  --color-popover-foreground: var(--popover-foreground);
  --color-popover: var(--popover);
  --color-card-foreground: var(--card-foreground);
  --color-card: var(--card);
  --radius-sm: 0.375rem;
  --radius-md: 0.5rem;
  --radius-lg: 0.5rem;
  --radius-xl: 0.75rem;
  --radius-2xl: 0.75rem;
  --radius-3xl: 0.75rem;
  --radius-4xl: 0.75rem;
}

:root {
  --background: oklch(1 0 0);
  --foreground: oklch(0.145 0 0);
  --card: oklch(1 0 0);
  --card-foreground: oklch(0.145 0 0);
  --popover: oklch(1 0 0);
  --popover-foreground: oklch(0.145 0 0);
  --primary: oklch(0.205 0 0);
  --primary-foreground: oklch(0.985 0 0);
  --secondary: oklch(0.97 0 0);
  --secondary-foreground: oklch(0.205 0 0);
  --muted: oklch(0.97 0 0);
  --muted-foreground: oklch(0.556 0 0);
  --accent: oklch(0.97 0 0);
  --accent-foreground: oklch(0.205 0 0);
  --destructive: oklch(0.577 0.245 27.325);
  --success: oklch(0.6 0.15 155);
  --success-foreground: oklch(0.985 0 0);
  --warning: oklch(0.7 0.16 80);
  --warning-foreground: oklch(0.145 0 0);
  --border: oklch(0.922 0 0);
  --input: oklch(0.922 0 0);
  --ring: oklch(0.708 0 0);
  --chart-1: oklch(0.87 0 0);
  --chart-2: oklch(0.556 0 0);
  --chart-3: oklch(0.439 0 0);
  --chart-4: oklch(0.371 0 0);
  --chart-5: oklch(0.269 0 0);
  --radius: 0.625rem;
  --sidebar: oklch(0.985 0 0);
  --sidebar-foreground: oklch(0.145 0 0);
  --sidebar-primary: oklch(0.205 0 0);
  --sidebar-primary-foreground: oklch(0.985 0 0);
  --sidebar-accent: oklch(0.97 0 0);
  --sidebar-accent-foreground: oklch(0.205 0 0);
  --sidebar-border: oklch(0.922 0 0);
  --sidebar-ring: oklch(0.708 0 0);
}

.dark {
  --background: oklch(0.16 0.006 285);
  --foreground: oklch(0.97 0.005 285);
  --card: oklch(0.20 0.008 285);
  --card-foreground: oklch(0.97 0.005 285);
  --popover: oklch(0.245 0.010 285);
  --popover-foreground: oklch(0.97 0.005 285);
  --primary: oklch(0.62 0.19 291);
  --primary-foreground: oklch(0.97 0.005 285);
  --secondary: oklch(0.245 0.010 285);
  --secondary-foreground: oklch(0.97 0.005 285);
  --muted: oklch(0.20 0.008 285);
  --muted-foreground: oklch(0.65 0.01 285);
  --accent: oklch(0.245 0.010 285);
  --accent-foreground: oklch(0.97 0.005 285);
  --destructive: oklch(0.65 0.19 25);
  --success: oklch(0.72 0.17 155);
  --success-foreground: oklch(0.16 0.006 285);
  --warning: oklch(0.78 0.15 80);
  --warning-foreground: oklch(0.16 0.006 285);
  --border: oklch(1 0 0 / 8%);
  --input: oklch(1 0 0 / 10%);
  --ring: oklch(0.62 0.19 291);
  --chart-1: oklch(0.62 0.19 291);
  --chart-2: oklch(0.65 0.16 250);
  --chart-3: oklch(0.70 0.14 190);
  --chart-4: oklch(0.72 0.17 155);
  --chart-5: oklch(0.78 0.15 80);
  --sidebar: oklch(0.20 0.008 285);
  --sidebar-foreground: oklch(0.97 0.005 285);
  --sidebar-primary: oklch(0.62 0.19 291);
  --sidebar-primary-foreground: oklch(0.97 0.005 285);
  --sidebar-accent: oklch(0.245 0.010 285);
  --sidebar-accent-foreground: oklch(0.97 0.005 285);
  --sidebar-border: oklch(1 0 0 / 8%);
  --sidebar-ring: oklch(0.62 0.19 291);
}

@layer base {
  * {
    @apply border-border outline-ring/50;
  }
  body {
    @apply bg-background text-foreground;
  }
  html {
    @apply font-sans;
  }
}
```

Note what changed vs the original file: the `--font-sans: var(--font-sans)` line was circular (self-referential, so `font-sans` never actually resolved to anything and the app fell back to `Inter` applied directly via `inter.className` in `layout.tsx`) — it's fixed here to point at `--font-geist-sans`, which Step 3 makes real. The `.dark` block's values are entirely replaced per the spec's color table. `--success`/`--warning` are new tokens (not in the original file at all). The `--radius-*` scale changed from a single-value multiplier chain to explicit pixel-equivalent values (6/8/8/12px).

- [ ] **Step 3: Replace `app/layout.tsx` in full**

```tsx
import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import './globals.css'

export const metadata: Metadata = {
  title: 'CRM',
  description: 'Sistema de CRM',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="pt-BR" className={`dark ${GeistSans.variable} ${GeistMono.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  )
}
```

`GeistSans.variable`/`GeistMono.variable` are the fixed class names the `geist` package ships (`--font-geist-sans`/`--font-geist-mono`), which is exactly what `globals.css` now references. `dark` is applied unconditionally — there is no toggle, no `useState`, no `next-themes`.

- [ ] **Step 4: Fix `app/(auth)/layout.tsx`**

Change:
```tsx
    <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
```
to:
```tsx
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
```

- [ ] **Step 5: Verify — start the dev server and check for build/CSS errors**

Run: `npm run dev`
Expected: server starts with no compile errors. Visit `http://localhost:3000/login` in a browser — the whole page (including the `Card` the login form sits in) should render dark (near-black background, light text), not a light-gray page with a dark card floating on it, and not a flash of the old light theme. This confirms tokens, fonts, and the forced dark class are all wired correctly before any component-level restyling happens in later tasks.

- [ ] **Step 6: Commit**

```bash
git add app/globals.css app/layout.tsx "app/(auth)/layout.tsx" package.json package-lock.json
git commit -m "feat(theme): add dark-only design tokens, Geist fonts, force dark mode"
```

---

## Task 2: App shell — sidebar, header, notifications

**Files:**
- Modify: `components/dashboard/dashboard-shell.tsx`
- Modify: `components/dashboard/sidebar.tsx`
- Modify: `components/dashboard/header.tsx`
- Modify: `components/dashboard/notificacoes-bell.tsx`
- Modify: `components/dashboard/notificacoes-panel.tsx`

**Interfaces:**
- Consumes: tokens/classes from Task 1 (`bg-background`, `bg-sidebar`, `bg-card`, `bg-popover`, `bg-primary`, `text-muted-foreground`, `bg-accent`, `bg-destructive`, `--radius-sm/md/xl`).
- No prop/type signature changes in any of these five components — this task only touches `className` strings and one JSX structural addition (the sidebar's active-item left bar). Every component keeps the exact same props interface other files already call it with.

- [ ] **Step 1: `components/dashboard/dashboard-shell.tsx` — swap the page background**

Change:
```tsx
    <div className="flex h-screen bg-gray-50 overflow-hidden">
```
to:
```tsx
    <div className="flex h-screen bg-background overflow-hidden">
```

- [ ] **Step 2: Replace `components/dashboard/sidebar.tsx` in full**

```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  X,
  LayoutDashboard,
  Users,
  Kanban,
  CheckSquare,
  BarChart3,
  Settings,
  Bot,
  MessageSquare,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/dashboard/clientes', label: 'Clientes', icon: Users },
  { href: '/dashboard/funil', label: 'Funil de Vendas', icon: Kanban },
  { href: '/dashboard/tarefas', label: 'Tarefas', icon: CheckSquare },
  { href: '/dashboard/relatorios', label: 'Relatórios', icon: BarChart3 },
  { href: '/dashboard/inbox', label: 'Inbox', icon: MessageSquare },
  { href: '/dashboard/agente', label: 'Agente IA', icon: Bot },
  { href: '/dashboard/configuracoes', label: 'Configurações', icon: Settings },
]

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const pathname = usePathname()

  return (
    <>
      {isOpen && (
        <div
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 w-64 bg-sidebar border-r flex flex-col transition-transform duration-200 md:static md:translate-x-0 md:z-auto',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b">
          <span className="text-xl font-semibold text-sidebar-foreground">CRM</span>
          <button
            onClick={onClose}
            className="p-1 rounded-sm hover:bg-sidebar-accent md:hidden"
            aria-label="Fechar menu"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === '/dashboard' ? pathname === href : pathname.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-sm text-sm font-medium border-l-2 transition-colors',
                  isActive
                    ? 'bg-primary/12 text-primary border-primary'
                    : 'text-muted-foreground border-transparent hover:bg-sidebar-accent hover:text-sidebar-foreground'
                )}
              >
                <Icon className="size-4 shrink-0" />
                {label}
              </Link>
            )
          })}
        </nav>
      </aside>
    </>
  )
}
```

This replaces the old solid `bg-blue-600 text-white` active state with the spec's 12%-opacity fill + colored text/icon + 2px left accent bar (`border-primary` on the active link, `border-transparent` on inactive ones so nothing shifts layout when active state changes).

- [ ] **Step 3: Replace `components/dashboard/header.tsx` in full**

```tsx
'use client'

import { Menu } from 'lucide-react'
import { NotificacoesBell } from './notificacoes-bell'
import { Notificacao } from '@/lib/types'

interface HeaderProps {
  nome: string
  perfil: string
  userId: string
  notificacoesIniciais: Notificacao[]
  onMenuClick: () => void
  signOut: () => Promise<void>
}

export function Header({ nome, perfil, userId, notificacoesIniciais, onMenuClick, signOut }: HeaderProps) {
  return (
    <header className="bg-card border-b px-4 md:px-6 py-4 flex items-center justify-between shrink-0">
      <button
        onClick={onMenuClick}
        className="p-2 rounded-sm hover:bg-accent md:hidden"
        aria-label="Abrir menu"
      >
        <Menu className="size-5" />
      </button>
      <div className="hidden md:block" />

      <div className="flex items-center gap-3">
        <NotificacoesBell userId={userId} notificacoesIniciais={notificacoesIniciais} />
        <div className="text-right">
          <p className="text-sm font-medium text-foreground">{nome}</p>
          <p className="text-xs text-muted-foreground capitalize">{perfil}</p>
        </div>
        <form action={signOut}>
          <button
            type="submit"
            className="text-sm text-destructive hover:text-destructive/80 hover:underline transition-colors"
          >
            Sair
          </button>
        </form>
      </div>
    </header>
  )
}
```

`shadow-sm` is dropped — per the spec, surface-layer elements (this header sits on the `bg-card` layer) separate from their neighbors via border only, not shadow; shadow is reserved for elevated/popover surfaces (Step 5).

- [ ] **Step 4: Replace `components/dashboard/notificacoes-bell.tsx`'s hardcoded classes**

Change:
```tsx
        className="relative p-2 rounded-md hover:bg-gray-100 transition-colors"
```
to:
```tsx
        className="relative p-2 rounded-sm hover:bg-accent transition-colors"
```

Change:
```tsx
        <Bell className="size-5 text-gray-600" />
```
to:
```tsx
        <Bell className="size-5 text-muted-foreground" />
```

Change:
```tsx
          <span className="absolute top-1 right-1 size-4 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
```
to:
```tsx
          <span className="absolute top-1 right-1 size-4 rounded-full bg-destructive text-white text-[10px] font-bold flex items-center justify-center">
```

- [ ] **Step 5: Replace `components/dashboard/notificacoes-panel.tsx` in full**

```tsx
'use client'

import { X, Bell, Package, Clock } from 'lucide-react'
import { Notificacao } from '@/lib/types'

interface NotificacoesPanelProps {
  notificacoes: Notificacao[]
  onClose: () => void
  onMarcarTodasLidas: () => void
}

function TipoIcon({ tipo }: { tipo: Notificacao['tipo'] }) {
  if (tipo === 'negocio_movido') return <Package className="size-4 text-chart-2 shrink-0" />
  return <Clock className="size-4 text-chart-5 shrink-0" />
}

function formatarData(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function NotificacoesPanel({
  notificacoes,
  onClose,
  onMarcarTodasLidas,
}: NotificacoesPanelProps) {
  const naoLidas = notificacoes.filter((n) => !n.lida).length

  return (
    <div className="fixed right-0 top-0 bottom-0 w-80 bg-popover border-l shadow-[0_8px_24px_rgba(0,0,0,0.4)] z-50 flex flex-col">
      <div className="flex items-center justify-between px-4 py-4 border-b">
        <div>
          <h3 className="font-semibold text-foreground">Notificações</h3>
          {naoLidas > 0 && (
            <p className="text-xs text-muted-foreground">{naoLidas} não lida{naoLidas > 1 ? 's' : ''}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {naoLidas > 0 && (
            <button
              onClick={onMarcarTodasLidas}
              className="text-xs text-primary hover:underline"
            >
              Marcar todas como lidas
            </button>
          )}
          <button
            onClick={onClose}
            className="p-1 rounded-sm hover:bg-accent"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {notificacoes.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
            <Bell className="size-8" />
            <p className="text-sm">Nenhuma notificação</p>
          </div>
        ) : (
          <ul className="divide-y divide-border/60">
            {notificacoes.map((n) => (
              <li
                key={n.id}
                className={`flex gap-3 px-4 py-3 ${n.lida ? 'opacity-60' : 'bg-primary/8'}`}
              >
                <TipoIcon tipo={n.tipo} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground leading-snug">{n.mensagem}</p>
                  <p className="text-xs text-muted-foreground mt-1">{formatarData(n.created_at)}</p>
                </div>
                {!n.lida && (
                  <span className="size-2 rounded-full bg-primary shrink-0 mt-1" />
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
```

This is the plan's first `bg-popover` (elevated-layer) surface, matching the spec's "Elevated surfaces: `bg-elevated`, 1px border, subtle shadow" component spec — the shadow value here (`0 8px 24px rgba(0,0,0,0.4)`) is copied verbatim from the spec.

- [ ] **Step 6: Verify — visually check the shell**

Run: `npm run dev` (if not already running), log in, land on `/dashboard`.
Check:
- Sidebar background is a visibly distinct shade from the main content area behind it (the 3-layer depth should be obvious, not flat).
- The active nav item (Dashboard, since you're on `/dashboard`) shows violet text/icon, a violet left bar, and a faint violet-tinted background — not a solid blue block.
- Header has no drop shadow, just a bottom border.
- Click the bell icon (top right) — the notification panel slides in with a visible shadow and sits one shade lighter than the header/sidebar (the elevated layer).
- Click "Sair" text — it should read in a red/destructive tone, not blue.

- [ ] **Step 7: Commit**

```bash
git add components/dashboard/dashboard-shell.tsx components/dashboard/sidebar.tsx components/dashboard/header.tsx components/dashboard/notificacoes-bell.tsx components/dashboard/notificacoes-panel.tsx
git commit -m "feat(theme): retheme app shell (sidebar, header, notifications)"
```

---

## Task 3: Overview page — metrics grid

**Files:**
- Modify: `components/dashboard/metric-card.tsx`
- Modify: `app/dashboard/page.tsx`

**Interfaces:**
- Consumes: `bg-chart-2` (categorical, for the "blue" metric color only), `bg-success`, `bg-warning`, `bg-primary`, `bg-destructive`, `bg-muted`, `text-muted-foreground`, `text-foreground` (Task 1).
- `MetricCard`'s props interface is unchanged (`titulo`, `valor`, `descricao?`, `icon?`, `color?: keyof typeof COLOR_MAP`) — all seven `COLOR_MAP` keys (`blue`, `green`, `amber`, `purple`, `emerald`, `red`, `gray`) still exist, so every existing call site in `page.tsx` keeps working with zero changes to its own props.

- [ ] **Step 1: Replace `components/dashboard/metric-card.tsx` in full**

```tsx
import { LucideIcon } from 'lucide-react'

const COLOR_MAP = {
  blue:    { bg: 'bg-chart-2/15',     icon: 'text-chart-2' },
  green:   { bg: 'bg-success/15',     icon: 'text-success' },
  amber:   { bg: 'bg-warning/15',     icon: 'text-warning' },
  purple:  { bg: 'bg-primary/15',     icon: 'text-primary' },
  emerald: { bg: 'bg-success/15',     icon: 'text-success' },
  red:     { bg: 'bg-destructive/15', icon: 'text-destructive' },
  gray:    { bg: 'bg-muted',          icon: 'text-muted-foreground' },
}

interface MetricCardProps {
  titulo: string
  valor: string
  descricao?: string
  icon?: LucideIcon
  color?: keyof typeof COLOR_MAP
}

export function MetricCard({ titulo, valor, descricao, icon: Icon, color = 'gray' }: MetricCardProps) {
  const c = COLOR_MAP[color]
  return (
    <div className="bg-card rounded-lg border p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-muted-foreground">{titulo}</p>
        {Icon && (
          <span className={`size-8 rounded-md ${c.bg} flex items-center justify-center shrink-0`}>
            <Icon className={`size-4 ${c.icon}`} />
          </span>
        )}
      </div>
      <p className="text-3xl font-mono font-semibold tabular-nums text-foreground">{valor}</p>
      {descricao && <p className="text-xs text-muted-foreground -mt-1">{descricao}</p>}
    </div>
  )
}
```

Note the deliberate change from the old design: the big value number is no longer colored per-category (`text-blue-700` etc.) — per the spec's typography table, featured metrics are always neutral foreground text in Geist Mono with tabular figures; only the small icon chip carries the semantic color now. `green` and `emerald` intentionally collapse onto the same `--success` token — they were only subtly different shades of green before, and `--success`/`--warning` (defined in Task 1) are semantic status colors, kept deliberately separate from `--chart-1..5` (which is reserved for categorical/sequential chart series — the sales bar and the five funnel stages, both in Task 4). `purple` maps to `--primary` directly rather than `--chart-1` — they're the same underlying hue, but `--primary` is the semantically correct source since this is the app's accent color, not a chart series.

- [ ] **Step 2: Edit `app/dashboard/page.tsx` — page header and section labels**

Change:
```tsx
      <div>
        <h2 className="text-2xl font-bold text-gray-900">Dashboard</h2>
        <p className="text-gray-500 text-sm mt-1">Visão geral do seu CRM e WhatsApp</p>
      </div>
```
to:
```tsx
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Dashboard</h2>
        <p className="text-muted-foreground text-sm mt-1">Visão geral do seu CRM e WhatsApp</p>
      </div>
```

Change (both occurrences — "CRM" and "WhatsApp / Inbox" section eyebrows):
```tsx
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">CRM</p>
```
and
```tsx
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">WhatsApp / Inbox</p>
```
to:
```tsx
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">CRM</p>
```
and
```tsx
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">WhatsApp / Inbox</p>
```

(`font-semibold` → `font-medium` and `tracking-wide` → `tracking-wider`, matching the spec's label row: weight 500, not 600, with wider letter-spacing than body text.)

- [ ] **Step 3: Edit `app/dashboard/page.tsx` — `ETAPA_CONFIG` colors**

Change:
```tsx
const ETAPA_CONFIG = [
  { etapa: 'lead',       label: 'Lead',        color: 'bg-blue-400',   bar: 'bg-blue-400' },
  { etapa: 'proposta',   label: 'Proposta',    color: 'bg-amber-400',  bar: 'bg-amber-400' },
  { etapa: 'negociacao', label: 'Negociação',  color: 'bg-orange-400', bar: 'bg-orange-400' },
  { etapa: 'fechado',    label: 'Fechado',     color: 'bg-green-500',  bar: 'bg-green-500' },
  { etapa: 'encerrado',  label: 'Encerrado',   color: 'bg-red-400',    bar: 'bg-red-400' },
]
```
to:
```tsx
const ETAPA_CONFIG = [
  { etapa: 'lead',       label: 'Lead',        color: 'bg-chart-2',      bar: 'bg-chart-2' },
  { etapa: 'proposta',   label: 'Proposta',    color: 'bg-chart-5',      bar: 'bg-chart-5' },
  { etapa: 'negociacao', label: 'Negociação',  color: 'bg-chart-3',      bar: 'bg-chart-3' },
  { etapa: 'fechado',    label: 'Fechado',     color: 'bg-chart-4',      bar: 'bg-chart-4' },
  { etapa: 'encerrado',  label: 'Encerrado',   color: 'bg-destructive',  bar: 'bg-destructive' },
]
```

This won't be visually complete until Task 4 retheme's `FunilEtapasCard` (the component that actually renders these classes) — that's expected, this step only updates the color source.

- [ ] **Step 4: Verify — check the metrics grid**

Run: `npm run dev`, visit `/dashboard`.
Check: the "CRM" and "WhatsApp / Inbox" section labels are small, uppercase, letter-spaced, and muted (not the previous plain gray). Each of the 9 metric cards shows a neutral-white bold monospace number, with a small colored icon chip (violet/blue/amber/emerald/red depending on the metric) that is NOT the same color as the number itself.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/metric-card.tsx app/dashboard/page.tsx
git commit -m "feat(theme): retheme dashboard metrics grid"
```

---

## Task 4: Overview page — chart, funnel, ranking

**Files:**
- Modify: `components/dashboard/sales-chart.tsx`
- Modify: `components/dashboard/funil-etapas-card.tsx`
- Modify: `components/relatorios/ranking-vendedores.tsx`

**Interfaces:**
- Consumes: `--chart-1` (raw CSS var, for recharts SVG `fill`/`stroke` props, which can't take Tailwind classes), `--border`, `--muted-foreground`, `--popover`, `--popover-foreground`, `--radius-md`, `text-success` (Task 1); `bg-chart-2/3/4/5`, `bg-destructive` classes set on `ETAPA_CONFIG` by Task 3, Step 3.
- No prop interface changes to any of the three components.

- [ ] **Step 1: Replace `components/dashboard/sales-chart.tsx` in full**

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
} from 'recharts'
import { formatCurrency } from '@/lib/format'

interface SalesChartProps {
  data: { mes: string; total: number }[]
}

export function SalesChart({ data }: SalesChartProps) {
  const hasData = data.some((d) => d.total > 0)

  return (
    <div className="bg-card rounded-lg border p-6">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">Vendas por mês</h3>
      {!hasData ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
          Nenhuma venda fechada nos últimos 6 meses
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="mes" tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
            <YAxis tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} tick={{ fontSize: 12, fill: 'var(--muted-foreground)' }} />
            <Tooltip
              formatter={(value) => [formatCurrency(Number(value) || 0), 'Vendas']}
              contentStyle={{
                backgroundColor: 'var(--popover)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-md)',
                color: 'var(--popover-foreground)',
              }}
            />
            <Bar dataKey="total" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}
```

Recharts renders plain SVG, so its `fill`/`stroke`/style props take raw CSS values (`var(--chart-1)`) rather than Tailwind classes — this is the one place in the whole redesign where a CSS custom property is referenced directly instead of through a Tailwind utility class.

- [ ] **Step 2: Replace `components/dashboard/funil-etapas-card.tsx` in full**

```tsx
import { formatCurrency } from '@/lib/format'

interface Etapa {
  etapa: string
  label: string
  count: number
  valor: number
  color: string
  bar: string
}

interface FunilEtapasCardProps {
  etapas: Etapa[]
}

export function FunilEtapasCard({ etapas }: FunilEtapasCardProps) {
  const maxCount = Math.max(...etapas.map(e => e.count), 1)

  return (
    <div className="bg-card rounded-lg border p-6">
      <h3 className="text-sm font-medium text-muted-foreground mb-5">Negócios por etapa</h3>
      <div className="space-y-3">
        {etapas.map(e => (
          <div key={e.etapa}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className={`size-2 rounded-full ${e.color}`} />
                <span className="text-sm text-foreground">{e.label}</span>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="font-semibold text-foreground font-mono tabular-nums">{e.count}</span>
                <span className="font-mono tabular-nums">{formatCurrency(e.valor)}</span>
              </div>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full ${e.bar} transition-all`}
                style={{ width: `${(e.count / maxCount) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Replace `components/relatorios/ranking-vendedores.tsx` in full**

```tsx
import { formatCurrency } from '@/lib/format'

interface RankingVendedoresProps {
  ranking: { nome: string; total: number; count: number; semVendedor?: boolean }[]
}

export function RankingVendedores({ ranking }: RankingVendedoresProps) {
  return (
    <div className="bg-card rounded-lg border p-6">
      <h3 className="text-sm font-medium text-muted-foreground mb-4">Ranking de vendedores</h3>
      {ranking.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">Nenhuma venda fechada ainda</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-border/60">
              <th className="pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">#</th>
              <th className="pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Vendedor</th>
              <th className="pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground text-right">Negócios</th>
              <th className="pb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground text-right">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {ranking.map((v, i) => (
              <tr key={i}>
                <td className="py-3 text-muted-foreground font-mono tabular-nums">{i + 1}</td>
                <td className={`py-3 font-medium ${v.semVendedor ? 'text-muted-foreground italic' : 'text-foreground'}`}>
                  {v.nome}
                </td>
                <td className="py-3 text-muted-foreground text-right font-mono tabular-nums">{v.count}</td>
                <td className={`py-3 font-semibold text-right font-mono tabular-nums ${v.semVendedor ? 'text-muted-foreground' : 'text-success'}`}>
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

`border-border/60` (used for both the header's bottom border and the row dividers via `divide-border/60`) compounds with `--border`'s own baked-in 8% alpha, landing close to the spec's "6% opacity" table-divider target without a dedicated token.

- [ ] **Step 4: Verify — check the bottom row**

Run: `npm run dev`, visit `/dashboard`, scroll to the three-card row at the bottom.
Check:
- Sales chart bars are violet, grid lines are barely visible, hovering a bar shows a dark tooltip (not a white one).
- "Negócios por etapa" dots/bars now show blue → amber → teal → emerald → red across the five stages (not the old blue/amber/orange/green/red), and the counts/values are in monospace.
- Ranking table has no vertical lines, a faint header underline, right-aligned monospace numbers, and the "Total" column is emerald-colored (not the old green-600) for rows with a vendedor.

- [ ] **Step 5: Commit**

```bash
git add components/dashboard/sales-chart.tsx components/dashboard/funil-etapas-card.tsx components/relatorios/ranking-vendedores.tsx
git commit -m "feat(theme): retheme sales chart, funnel-by-stage, and vendor ranking"
```

---

## Task 5: Full visual QA pass

**Files:** None (verification only — fix anything found using the same token vocabulary established in Tasks 1–4; do not introduce new tokens).

**Interfaces:** N/A.

- [ ] **Step 1: Walk every route in the sidebar nav**

Run: `npm run dev`. Log in, then visit each of: `/dashboard`, `/dashboard/clientes`, `/dashboard/funil`, `/dashboard/tarefas`, `/dashboard/relatorios`, `/dashboard/inbox`, `/dashboard/agente`, `/dashboard/configuracoes`.

For each: confirm nothing is unreadable (e.g. dark text on a dark background, or a stray white panel) — these pages are *not* being redesigned this phase, but they now render inside the shell from Task 2 and pick up any shared `components/ui/*` primitive's new tokens automatically, so the bar to clear is "not broken," not "redesigned."

- [ ] **Step 2: Check `/login` and `/cadastro`**

Confirm both render fully dark (page background and the card inside it match), consistent with the Task 1 Step 5 check.

- [ ] **Step 3: Fix anything broken**

If a page shows unreadable text or a jarring light element, it's almost certainly another raw hardcoded Tailwind gray/blue/white class outside this phase's file list — replace it with the matching token from Task 1 (`bg-card`/`bg-background`/`text-foreground`/`text-muted-foreground`/etc.), following the same pattern used throughout Tasks 2–4. Commit each such fix separately with a message like `fix(theme): <file> — replace hardcoded light-mode class`.

- [ ] **Step 4: Final commit if Step 3 found nothing to fix**

If no fixes were needed, no commit is required for this task — it's a verification-only checkpoint.
