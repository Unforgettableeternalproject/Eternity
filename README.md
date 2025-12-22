# Eternity - Bernie's Personal Website Monorepo

### This project provides multilanguage README

[![Static Badge](https://img.shields.io/badge/lang-zh--tw-yellow)](./README.zh-tw.md) [![Static Badge](https://img.shields.io/badge/lang-en-red)](./README.md)

## Conversation between U.E.P and Exera

"What are you working on this time?"

"Hey! Bernie seems to want to create a complete platform to host everything! Including..."

"Including your little space? That's quite an ambition, can you really pull it off?"

"Well... but Bernie always finds a way! He said he'll take it step by step, starting with the basic infrastructure."

"Let's hope so..."

## Project Overview

Eternity is Bernie's personal website monorepo project, using pnpm workspaces + TurboRepo to manage multiple sites and shared packages. It integrates personal introduction, creative showcase, and knowledge base functionalities.

## Main Features

🌟 **Main Site (apps/root)**

- Domain: unforgettableeternalproject.com
- Personal introduction and contact information
- Project portfolio showcase
- Technology stack and skills display

📚 **Documentation Site (apps/uep)**

- Domain: uep.unforgettableeternalproject.com
- Personal creative articles and knowledge base
- Technical notes and tutorials
- Project documentation

## Project Structure

```
Eternity/
├── apps/
│   ├── root/                # Main site (unforgettableeternalproject.com)
│   │   ├── src/
│   │   │   ├── layouts/
│   │   │   └── pages/
│   │   ├── public/
│   │   ├── astro.config.mjs
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── uep/                 # Docs site (uep.unforgettableeternalproject.com)
│       ├── src/
│       │   ├── layouts/
│       │   └── pages/
│       ├── public/
│       ├── astro.config.mjs
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   ├── config/              # Shared configuration
│   │   ├── eslint/
│   │   ├── prettier/
│   │   ├── tsconfig/
│   │   └── package.json
│   └── ui/                  # Shared UI components
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── .github/
│   └── workflows/
│       └── ci.yml           # GitHub Actions CI
├── .nvmrc                   # Node version (20)
├── pnpm-workspace.yaml      # pnpm workspace config
├── turbo.json               # TurboRepo config
├── package.json             # Root package.json
└── README.md
```

## Tech Stack

- **Framework**: [Astro](https://astro.build) - Static site generator
- **Monorepo**: pnpm workspaces + TurboRepo
- **Language**: TypeScript
- **Styling**: CSS (built into Astro components)
- **Lint/Format**: ESLint + Prettier
- **CI/CD**: GitHub Actions
- **Deployment**: Cloudflare Pages

## Development Commands

### Install Dependencies

```bash
# Ensure Node 20+
node --version

# Enable Corepack (pnpm)
corepack enable

# Install all dependencies
pnpm install
```

### Development Mode

```bash
# Start all sites simultaneously (root: port 4320, uep: port 4321)
pnpm dev

# Start main site only
pnpm --filter @uep/root dev

# Start docs site only
pnpm --filter @uep/uep dev
```

### Build

```bash
# Build all sites
pnpm build

# Build main site only
pnpm --filter @uep/root build

# Build docs site only
pnpm --filter @uep/uep build
```

### Code Quality

```bash
# Run lint
pnpm lint

# Run type check
pnpm typecheck

# Format code
pnpm format

# Check formatting
pnpm format:check
```

## Development Status

### ✅ Phase 1: Monorepo Architecture Setup (Completed)

- ✅ pnpm workspace + TurboRepo configuration
- ✅ Shared config package (@uep/config)
- ✅ Shared UI components package (@uep/ui)
- ✅ Main site foundation (apps/root)
- ✅ Documentation site foundation (apps/uep)
- ✅ GitHub Actions CI setup
- ✅ ESLint + Prettier + TypeScript configuration

### 📅 Phase 2: Content Development (In Progress)

- ⏳ Enhance main site content
- ⏳ Write documentation site content
- ⏳ Design responsive layout
- ⏳ SEO optimization

### 📅 Phase 3: Deployment & Optimization (Planned)

- ⏳ Cloudflare Pages deployment
- ⏳ Domain configuration
- ⏳ Performance optimization
- ⏳ Monitoring and analytics

## Workspace Packages

### @uep/root

Main website, located in `apps/root`.

### @uep/uep

Documentation site, located in `apps/uep`.

### @uep/config

Shared configuration package, includes:

- ESLint configuration (base + astro)
- Prettier configuration
- TypeScript configuration

### @uep/ui

Shared UI components package (currently skeleton with example Button component).

## Contributors

❦ **Bernie** - Project Creator & Main Developer

- GitHub: [@unforgettableeternalproject](https://github.com/unforgettableeternalproject)

## License

Copyright © 2025 Bernie. All rights reserved.

This project is licensed under MIT License. See [LICENSE](./LICENSE) for details.

---

_Last Updated: December 2025_
