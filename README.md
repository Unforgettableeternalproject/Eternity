# Eternity — Bernie's Personal Website Monorepo

### This project provides multilanguage README

[![Static Badge](https://img.shields.io/badge/lang-zh--tw-yellow)](./README.zh-tw.md) [![Static Badge](https://img.shields.io/badge/lang-en-red)](./README.md)

## A Conversation Between U.E.P and Exera

"Wait — the main site got completely redesigned?"

"Yep! Quartz design system, D1 backend, full admin editor... no more Keystatic. Oh, and draggable cards with physics!"

"Physics. On cards."

"They bounce back with spring animation and shoot particles when you shake them. Bernie said it was 'essential.'"

"...Of course he did. What about the docs site?"

"Still running strong — five zones, all readers working, synced through the same Content API. Everything's unified now."

"So we're really doing this. Going live."

"Almost. Just need to make sure nothing explodes first."

## Project Overview

**Eternity** is a personal website monorepo built with **pnpm workspaces + Turborepo**, deployed on **Cloudflare Pages + Workers**. It houses two Astro-based sites, two Cloudflare Workers, and shared packages — combining a personal portfolio with an immersive world-building documentation platform.

| Site             | Domain                                                                             | Description                                         |
| ---------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------- |
| 🌟 **Main Site** | [unforgettableeternalproject.com](https://unforgettableeternalproject.com)         | Portfolio, projects, updates, links — Quartz design |
| 📚 **UEP Docs**  | [uep.unforgettableeternalproject.com](https://uep.unforgettableeternalproject.com) | World-building documentation with 5 themed zones    |

> **Current Version: v0.9.8** — Main site redesign complete. Release candidate.

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
│   └── visitor-counter/        # KV visitor counter (port 8787)
├── scripts/
│   ├── migrate-*.mjs           # Content import scripts (per zone + root)
│   ├── seed-*.mjs              # Data seeding (about, contact, page text)
│   ├── sync.mjs                # Unified sync dispatcher
│   ├── sync-content.mjs        # Docs site D1 sync (local ↔ remote)
│   ├── sync-root.mjs           # Main site D1 + R2 sync
│   ├── sync-utils.mjs          # Shared sync utilities
│   ├── sync-auth.mjs           # Shared auth for sync scripts
│   └── convert-content-to-html.mjs  # Markdown → HTML converter
├── e2e/                        # Playwright E2E tests
├── docs/                       # Project documentation
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
pnpm test            # Frontend unit tests (Vitest)
pnpm test:workers    # Worker integration tests (Vitest + Cloudflare pool)
pnpm test:all        # All unit + Worker tests
pnpm test:e2e        # E2E smoke tests (Playwright)
```

### Worker Deployment

```bash
pnpm deploy:content-api    # Deploy content-api Worker
pnpm deploy:visitor        # Deploy visitor-counter Worker
```

### D1 Database

```bash
pnpm --filter content-api-worker db:migrate:local    # Apply migrations (local)
pnpm --filter content-api-worker db:migrate:remote   # Apply migrations (remote)
```

### Content Sync

```bash
# Unified sync dispatcher (both sites, single auth)
pnpm sync                  # Interactive mode (diff preview, confirm each)
pnpm sync:push             # Local → Remote
pnpm sync:pull             # Remote → Local

# Import content from source repos
node scripts/migrate-history.mjs              # Import to local D1
node scripts/migrate-history.mjs --remote     # Import to remote D1
```

> ⚠️ `--clean` flag resets all metadata including manually edited icons. Use `pnpm sync` for incremental updates instead.

## Deployment

Deployed on **Cloudflare Pages** (sites) and **Cloudflare Workers** (APIs).

| Project                | Branch  | Domain                                        |
| ---------------------- | ------- | --------------------------------------------- |
| eternity-root          | main    | unforgettableeternalproject.com               |
| eternity-root-staging  | staging | staging-root.pages.dev                        |
| eternity-uep           | main    | uep.unforgettableeternalproject.com           |
| eternity-uep-staging   | staging | staging-uep.pages.dev                         |
| content-api Worker     | —       | eternity-content-api.ptyc4076.workers.dev     |
| visitor-counter Worker | —       | eternity-visitor-counter.ptyc4076.workers.dev |

### Branch Strategy

```
main         → Production deployment
develop      → Daily development
staging      → Push triggers Cloudflare Pages preview
release/*    → Release candidates (staging auto-deploy)
```

Push to staging for preview: `git push origin develop:staging`

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

Five themed zones, each with dedicated Reader, boot animation, background effects, and page transitions:

| Zone        | Background Effect      | Description                                |
| ----------- | ---------------------- | ------------------------------------------ |
| 📜 History  | Text particle float    | Chronological narrative, chapter tree      |
| 🔊 Echoes   | Echo ripple waves      | Audio content, cluster navigation          |
| 🎨 Visuals  | Light pillars + frames | Gallery, division/subcategory/group layers |
| 💡 Concepts | Grid + digital rain    | Structured data, four variant readers      |
| 📦 Storage  | Dust + floating SVG    | Archive, clearing card system              |

### Content API Worker

Shared Cloudflare Worker serving both sites:

- **D1 database** (`eternity-content`) — pages, tree structure, sync log
- **R2 storage** — Two isolated buckets (`eternity-assets` + `eternity-root-assets`)
- **5 main site tables** — `root_projects`, `root_links`, `root_updates`, `root_singletons`, `root_cards`
- **Sync utilities** — Unified dispatcher with shared auth, R2 delete propagation

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
- **3D Map** — Three.js PieMap3D with zone navigation
- **Content API** — D1-backed CRUD with tree structure, dual R2, and sync
- **Sync tooling** — Unified dispatcher, bidirectional D1 + R2 sync, R2 delete tracking
- **CI/CD** — GitHub Actions for quality checks and Worker deployment
- **Testing infrastructure** — Vitest (unit + Worker) + Playwright (E2E)

### 📅 Planned (Post-Launch)

- History chapter gating / spoiler strategy
- History interactive embed (entity/media cue system)
- Zone Islands (interactive embedded tools)
- Console command system (main site Easter egg)
- Theme & progress settings admin

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

_Last Updated: June 2026_
