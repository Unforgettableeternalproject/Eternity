# Eternity — Bernie's Personal Website Monorepo

### This project provides multilanguage README

[![Static Badge](https://img.shields.io/badge/lang-zh--tw-yellow)](./README.zh-tw.md) [![Static Badge](https://img.shields.io/badge/lang-en-red)](./README.md)

## A Conversation Between U.E.P and Exera

"So it's v1.0.0. We're actually doing this."

"We are! Reading is stateful now — the scanline tracks where you've been, gates open when you've earned them, and five floating islands follow you around."

"Islands. Following people around."

"They remember where you put them! And the Echoes one keeps playing across pages. Bernie said it was 'essential.'"

"...Of course he did. And the observer thing?"

"Permanent mark. You can switch back, but the record stays. That one was intentional."

"Everything really is connected now."

"Story points, entity keys, fog that lifts as you read. Yeah. It's a world, not a wiki."

## Project Overview

**Eternity** is a personal website monorepo built with **pnpm workspaces + Turborepo**, deployed on **Cloudflare Pages + Workers**. It houses two Astro-based sites, two Cloudflare Workers, and shared packages — combining a personal portfolio with an immersive world-building documentation platform.

| Site             | Domain                                                                             | Description                                         |
| ---------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| 🌟 **Main Site** | [unforgettableeternalproject.com](https://unforgettableeternalproject.com)         | Portfolio, projects, updates, links — Quartz design |
| 📚 **UEP Docs**  | [uep.unforgettableeternalproject.com](https://uep.unforgettableeternalproject.com) | World-building documentation with 5 themed zones    |

> **Current Version: v1.0.0** — First stable release. Epic 2 (progress system) complete: reader accounts, dual perspectives, scanline reading tracker, content gates, interactive embeds, five zone islands, and cross-zone interlinking.

## Project Structure

```
Eternity/
├── apps/
│   ├── root/                   # Main site — Astro 5 + React + Quartz design
│   └── uep/                    # Docs site — Astro 4 + React + TipTap editor
├── packages/
│   ├── config/                 # Shared ESLint / Prettier / TypeScript / Tailwind
│   └── ui/                     # Shared UI components
├── workers/
│   ├── content-api/            # D1 + R2 content API (port 8788)
│   ├── visitor-counter/        # KV visitor counter (port 8787)
│   └── discord-widget-sync/    # Discord profile widget cron sync (port 8790)
├── scripts/
│   ├── sync.mjs                # Unified sync dispatcher
│   ├── sync-content.mjs        # Docs site D1 sync (local ↔ remote)
│   ├── sync-root.mjs           # Main site D1 + R2 sync
│   ├── sync-utils.mjs          # Shared sync utilities
│   ├── sync-auth.mjs           # Shared auth for sync scripts
│   ├── seed-test-env.mjs       # Seed the test D1 from production
│   ├── reset-test-env.mjs      # Wipe and reseed the test D1
│   ├── reindex-interlink.mjs   # Rebuild interlink derived tables
│   ├── scan-used-chars.mjs     # Scan site content for font subsetting
│   ├── build-font-subsets.mjs  # Build self-hosted Noto Serif TC subsets
│   ├── perf-measure.mjs        # Playwright + CDP performance measurement
│   └── archive/                # One-off migration scripts (task complete)
├── e2e/                        # Playwright E2E tests
├── docs/                       # Project documentation
│   ├── release-workflow.md     # Release process
│   └── agent/                  # Design docs, task breakdowns, test checklist
├── turbo.json                  # Turborepo pipeline config
├── pnpm-workspace.yaml         # pnpm workspace definition
└── package.json
```

## Tech Stack

### Frontend

- **[Astro](https://astro.build)** 5.x (root) / 4.x (uep) — Static + Hybrid SSR
- **[React](https://react.dev)** 19 — Interactive islands (`client:only`, `client:load`)
- **TypeScript** — Full type coverage
- **[Tailwind CSS](https://tailwindcss.com)** — Utility-first styling
- **[Three.js](https://threejs.org)** — 3D map (PieMap3D)
- **[TipTap](https://tiptap.dev)** — Rich text editor (both admin panels)

### Backend & Data

- **[Cloudflare Workers](https://workers.cloudflare.com)** — Serverless compute
- **[Cloudflare D1](https://developers.cloudflare.com/d1/)** — SQLite database (content for both sites)
- **[Cloudflare R2](https://developers.cloudflare.com/r2/)** — Asset storage (separate buckets per site)
- **[Cloudflare KV](https://developers.cloudflare.com/kv/)** — Visitor statistics
- **[Resend](https://resend.com)** — Email API for contact form

### Tooling

- **pnpm** workspaces + **Turborepo** — Monorepo management
- **ESLint** + **Prettier** — Code quality
- **Vitest** + **Playwright** — Testing (unit + E2E)
- **Wrangler** — Cloudflare CLI
- **Conventional Commits** — Commit message standard

## Quick Start

### Prerequisites

- Node.js 20+
- pnpm 9+

### Setup

```bash
# Enable pnpm via Corepack
corepack enable

# Install dependencies
pnpm install

# Initialize local D1 database
pnpm --filter content-api-worker db:migrate:local
```

### Development

```bash
# Start Workers (in separate terminals)
pnpm --filter content-api-worker dev      # Content API → localhost:8788
pnpm --filter visitor-counter-worker dev  # Visitor counter → localhost:8787

# Start sites
pnpm dev                                  # All sites (root:4320, uep:4321)
pnpm --filter @uep/root dev              # Main site only
pnpm --filter @uep/uep dev               # Docs site only
```

> **Note:** The content-api Worker must be running for both sites to load content.

## Development Commands

### Quality Checks

```bash
pnpm check          # Run all: lint → typecheck → format:check → build
pnpm lint            # ESLint
pnpm typecheck       # TypeScript type checking
pnpm format          # Prettier format
pnpm format:check    # Prettier format check
```

### Testing

```bash
pnpm test              # Frontend unit tests (Vitest)
pnpm test:workers      # Worker integration tests (Vitest + Cloudflare pool)
pnpm test:all          # All unit + Worker tests
pnpm test:e2e          # E2E smoke tests (Playwright, needs dev server)
pnpm test:e2e:stress   # Stress + performance threshold tests
pnpm test:load         # Load tests (local content-api + main site)
pnpm test:release      # Full pre-release suite (unit + stress)
pnpm perf              # Throttled performance measurement (mobile profile)
```

Manual acceptance is tracked in `docs/agent/TEST_CHECKLIST.md` — it covers
the behaviours automation provably cannot reach (real scrolling, audio race
conditions, iOS dynamic toolbars, cross-device sync).

### Worker Deployment

```bash
pnpm deploy:content-api        # Deploy content-api Worker
pnpm deploy:content-api:test   # Deploy the test content-api Worker
pnpm deploy:visitor            # Deploy visitor-counter Worker
pnpm deploy:discord-widget     # Deploy Discord widget sync Worker
```

### D1 Database

```bash
pnpm db:migrate:local     # Apply migrations (local)
pnpm db:migrate:test      # Apply migrations (test)
pnpm db:migrate:remote    # Apply migrations (production)

# After applying migrations, rebuild the interlink derived tables — they are
# derived from page content, so an SQL migration alone leaves them empty and
# the trigger model silently stops surfacing clue cards.
pnpm interlink:reindex:local
pnpm interlink:reindex:test
pnpm interlink:reindex:remote
```

### Content Sync

```bash
# Unified sync dispatcher (both sites, single auth)
pnpm sync                  # Interactive mode (diff preview, confirm each)
pnpm sync:push             # Local → Remote
pnpm sync:pull             # Remote → Local

# Test environment
pnpm test:seed             # Incrementally seed the test D1 from production
pnpm test:reset            # Wipe and reseed the test D1 (requires --confirm)
```

> The one-off import scripts live in `scripts/archive/` — their task is done.
> Day-to-day content changes go through `pnpm sync`.

## Deployment

Deployed on **Cloudflare Pages** (sites) and **Cloudflare Workers** (APIs).

| Project                | Branch  | Domain                                         |
| ---------------------- | ------- | ---------------------------------------------- |
| eternity-root          | main    | unforgettableeternalproject.com                |
| eternity-root-staging  | staging | staging-root.pages.dev                         |
| eternity-uep           | main    | uep.unforgettableeternalproject.com            |
| eternity-uep-staging   | staging | staging-uep.pages.dev                          |
| content-api Worker     | —       | eternity-content-api.ptyc4076.workers.dev      |
| content-api (test)     | —       | eternity-content-api-test.ptyc4076.workers.dev |
| visitor-counter Worker | —       | eternity-visitor-counter.ptyc4076.workers.dev  |
| discord-widget-sync    | —       | Cron only (every 30 min)                       |

### Branch Strategy

```
main         → Production deployment
develop      → Daily development
staging      → Push triggers Cloudflare Pages preview
release/*    → Release candidates (staging auto-deploy)
```

Push to staging for preview: `git push origin develop:staging`

Full release process: `docs/release-workflow.md`

## Architecture Highlights

### Main Site — Quartz Design System (v0.9.8)

The main site uses the **Quartz design language** — JetBrains Mono monospace typography, navy/coral/ink color system, minimalist borders, and a quiet paper-like texture.

Key features:

- **All content from D1** — No more Keystatic; unified Content API for both sites
- **Three-column Admin editor** — Entry list | TipTap editor | Inspector
- **Independent R2 bucket** — `eternity-root-assets`, fully isolated from docs site
- **Widget system** — 8 configurable sidebar widgets (quote, music, stats, portal, etc.)
- **Draggable cards** — Physics-based drag with inertia, spring return, and particle effects
- **Dark mode** — CSS variable color normalization for TipTap content

### Docs Site — Zone System

Five themed zones, each with dedicated Reader, boot animation, background effects, page transitions, and its own floating island:

| Zone        | Background Effect      | Island           | Description                               |
| ----------- | ---------------------- | ---------------- | ----------------------------------------- |
| 📜 History  | Text particle float    | Navigation tree  | Chronological narrative, chapter tree     |
| 🔊 Echoes   | Echo ripple waves      | Wandering echo   | Audio that survives page navigation       |
| 🎨 Visuals  | Light pillars + frames | Floating phantom | Gallery projection, visual clue bookmarks |
| 💡 Concepts | Grid + digital rain    | Terminal         | Structured data, four variant readers     |
| 📦 Storage  | Dust + floating SVG    | Pinned notes     | Archive, clearing card system             |

### Docs Site — Progress System

Reading is stateful. Where you are, what you've read, and what you've unlocked form an accumulating axis.

- **Dual perspective** — Explorer (progressive unlock) vs Observer (full access, but leaves a permanent, irreversible mark)
- **Scanline** — An invisible line at 80% viewport height records progress as it passes markers; an end-of-page sentinel handles completion, so even articles without a single `hr` can be marked read
- **Content gates** — Four conditions in AND union: progress-page inheritance, prerequisite article, custom flags, and pristine-only
- **Progress fog** — Unread content sits behind a fog line that lifts as you read; echo spots and visual clues below it stay masked
- **Interactive embeds** — Entity marks stay plain text until you meet the referent in the narrative, then become clickable and hand off to the relevant island
- **Interlinking** — Story points and entity keys connect anchors scattered across all five zones
- **Reader accounts** — Separate from admin auth; progress syncs to D1 as a single blob guarded by a CAS revision

### Content API Worker

Shared Cloudflare Worker serving both sites:

- **D1 database** (`eternity-content`) — pages, tree structure, sync log
- **R2 storage** — Two isolated buckets (`eternity-assets` + `eternity-root-assets`)
- **5 main site tables** — `root_projects`, `root_links`, `root_updates`, `root_singletons`, `root_cards`
- **Progress tables** — `uep_users`, `uep_user_notes`, `uep_flags`, `interlink_keys`, `uep_settings`, plus the derived `history_interlink_index`
- **Sync utilities** — Unified dispatcher with shared auth, R2 delete propagation
- **Isolated test environment** — A parallel worker, D1, and R2 so admin editing and reader verification never touch production data

## Development Status

### ✅ Completed

- **Monorepo architecture** — pnpm workspaces + Turborepo pipeline
- **Main site — Quartz redesign** (v0.9.8)
  - D1 backend migration (from Keystatic)
  - Three-column TipTap admin editor (8 page editors)
  - Media library with independent R2 bucket
  - Widget system, draggable cards, dark mode normalization
  - Quartz navigation, search, footer, sticky TOC
- **Docs site — 5 themed zones** with dedicated Readers, boot animations, background effects, and page transitions
- **Progress system (Epic 2)** — the whole L0–L5 stack
  - Progress store, flag system, dual perspectives
  - Scanline reading tracker, progress markers, progress fog
  - Content gates with four-condition AND union
  - Interactive embeds (entity marks → island handoff)
  - Reader accounts with CAS-guarded cross-device sync
  - Five zone islands with a shared runtime, dock, and persistence
  - Cross-zone interlinking (story points + entity keys)
- **Admin settings** — key / flag / progress / site parameters, all in one place
- **3D Map** — Three.js PieMap3D with zone navigation
- **Content API** — D1-backed CRUD with tree structure, dual R2, and sync
- **Sync tooling** — Unified dispatcher, bidirectional D1 + R2 sync, R2 delete tracking
- **Isolated test environment** — Parallel worker/D1/R2 with three-layer production guards
- **Self-hosted font subsetting** — Noto Serif TC in three tiers, cut from 2245 KB to roughly 570 KB on first paint
- **Discord widget sync** — Cron worker feeding profile statistics
- **CI/CD** — GitHub Actions for quality checks and Worker deployment
- **Testing infrastructure** — Vitest (unit + Worker) + Playwright (E2E, stress, load) + a manual acceptance checklist

### 📅 Planned (Post-Launch)

- Console command system (main site Easter egg)
- Responsive images / `srcset` for gallery content
- Main-site font subsetting (currently docs site only)
- Password recovery for reader accounts

## Related Repositories

| Repository                                                                                        | Description                                  |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| [Eternity-Design](https://github.com/unforgettableeternalproject/Eternity-Design)                 | Design mockups and visual resources          |
| [U.E.P-s-Imaginary-Space](https://github.com/unforgettableeternalproject/U.E.P-s-Imaginary-Space) | GitBook-format world-building source content |

## Contributors

❦ **Bernie** — Creator & Lead Developer

- GitHub: [@unforgettableeternalproject](https://github.com/unforgettableeternalproject)

## License

Copyright © 2025-2026 Bernie. All rights reserved.

This project is licensed under the MIT License. See [LICENSE](./LICENSE) for details.

---

_Last Updated: August 2026_
