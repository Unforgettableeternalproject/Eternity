# Eternity — Bernie's Personal Website Monorepo

### This project provides multilanguage README

[![Static Badge](https://img.shields.io/badge/lang-zh--tw-yellow)](./README.zh-tw.md) [![Static Badge](https://img.shields.io/badge/lang-en-red)](./README.md)

## A Conversation Between U.E.P and Exera

"So... it's actually done?"

"Well, not just done — there are five zones now! History, Echoes, Visuals, Concepts, Storage... each with their own readers, animations, and atmosphere. Oh, and a 3D map! And an admin panel with a rich text editor and—"

"Okay okay, I get it. Bernie really went all in this time."

"Mmhm! He said the next step is making sure nothing breaks when real people start visiting."

"...Knowing him, that's probably the hardest part."

## Project Overview

**Eternity** is a personal website monorepo built with **pnpm workspaces + Turborepo**, deployed on **Cloudflare Pages + Workers**. It houses two Astro-based sites, two Cloudflare Workers, and shared packages — combining a personal portfolio with an immersive world-building documentation platform.

| Site             | Domain                                                                             | Description                                      |
| ---------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| 🌟 **Main Site** | [unforgettableeternalproject.com](https://unforgettableeternalproject.com)         | Portfolio, projects, articles, contact           |
| 📚 **UEP Docs**  | [uep.unforgettableeternalproject.com](https://uep.unforgettableeternalproject.com) | World-building documentation with 5 themed zones |

> **Current Version: v0.9.6** — Release candidate, approaching production launch.

## Project Structure

```
Eternity/
├── apps/
│   ├── root/                   # Main site — Astro 5 + React + Keystatic CMS
│   └── uep/                    # Docs site — Astro 4 + React + TipTap editor
├── packages/
│   ├── config/                 # Shared ESLint / Prettier / TypeScript / Tailwind
│   └── ui/                     # Shared UI components
├── workers/
│   ├── content-api/            # D1 + R2 content API (port 8788)
│   └── visitor-counter/        # KV visitor counter (port 8787)
├── scripts/
│   ├── migrate-history.mjs     # Import History zone from GitBook
│   ├── migrate-echoes.mjs      # Import Echoes zone data
│   ├── migrate-visuals.mjs     # Import Visuals zone data
│   ├── migrate-concepts.mjs    # Import Concepts zone data
│   ├── migrate-storage.mjs     # Import Storage zone data
│   ├── migrate-homepage.mjs    # Import homepage content
│   ├── seed-homepage.mjs       # Seed homepage data
│   ├── merge-dossier-variants.mjs  # Merge dossier variants
│   └── sync-content.mjs        # Bidirectional D1 sync (local ↔ remote)
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
- **[TipTap](https://tiptap.dev)** — Rich text editor (admin)

### Backend & Data

- **[Cloudflare Workers](https://workers.cloudflare.com)** — Serverless compute
- **[Cloudflare D1](https://developers.cloudflare.com/d1/)** — SQLite database for content
- **[Cloudflare R2](https://developers.cloudflare.com/r2/)** — Asset storage
- **[Cloudflare KV](https://developers.cloudflare.com/kv/)** — Visitor statistics
- **[Keystatic](https://keystatic.com)** — Git-based CMS (main site)
- **[Resend](https://resend.com)** — Email API for contact form

### Tooling

- **pnpm** workspaces + **Turborepo** — Monorepo management
- **ESLint** + **Prettier** — Code quality
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

# Initialize local D1 database (for docs site)
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

> **Note:** The content-api Worker must be running for the docs site to load content.

## Development Commands

### Quality Checks

```bash
pnpm check          # Run all: lint → typecheck → format:check → build
pnpm lint            # ESLint
pnpm typecheck       # TypeScript type checking
pnpm format          # Prettier format
pnpm format:check    # Prettier format check
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
# Import content from source repos
node scripts/migrate-history.mjs              # Import to local D1
node scripts/migrate-history.mjs --remote     # Import to remote D1

# Bidirectional sync (local ↔ remote D1)
pnpm sync                  # Interactive mode
pnpm sync:push             # Local → Remote
pnpm sync:pull             # Remote → Local
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

## Development Status

### ✅ Completed

- **Monorepo architecture** — pnpm workspaces + Turborepo pipeline
- **Main site** — Portfolio, projects, articles, contact form, i18n (zh-tw/en), Keystatic CMS
- **Docs site — 5 themed zones** with dedicated Readers, boot animations, background effects, and page transitions
  - 📜 **History** — Chronological narrative with text particle effects
  - 🔊 **Echoes** — Audio content with ripple effects and cluster navigation
  - 🎨 **Visuals** — Gallery with light pillars and frame decorations
  - 💡 **Concepts** — Structured data with grid, digital rain, and CRT boot animation
  - 📦 **Storage** — Archive with dust particles and floating SVG decorations
- **3D Map** — Three.js PieMap3D with zone navigation
- **Admin panel** — TipTap rich text editor, media library, homepage management
- **Content API** — D1-backed CRUD with tree structure and sync
- **Reader primitives** — ReaderShell, ZoneStateDisplay, ZonePrevNext, useZoneRouter, contentVisibility
- **Homepage scroll state machine** — Wheel-driven zone transitions with boot animations
- **Migration scripts** — Per-zone import from GitBook sources
- **Bidirectional sync** — Local ↔ Remote D1 with conflict detection

### 🔧 In Progress (v0.9.6)

- System documentation update
- Automated test infrastructure
- Stability testing and bug fixes

### 📅 Planned (Post-Launch)

- Zone Islands (interactive embedded tools)
- History interactive embed (entity/media cue system)
- History chapter gating / spoiler strategy
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

_Last Updated: May 2026_
