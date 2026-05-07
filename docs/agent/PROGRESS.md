# U.E.P Progress

Last updated: 2026-05-07

This document tracks the current implementation state of the Eternity / UEP workspace for future agents. Older notes from January 2026 were mostly mojibake and described a now-superseded static-docs direction, so this file has been rewritten around the current architecture.

## Current Baseline

UEP is no longer only a static documentation site. The history section is now the first area backed by a Cloudflare Worker + D1 content layer, and the public history reader has been redesigned around the newer UEP map/zone experience.

The important current split is:

- Static/generated Astro content still exists for the general UEP docs routes.
- `/history` is now a client-side React reader that fetches history content from the content-api Worker at runtime.
- The history landing page is not a normal article reader. It is the "三向通道" module home and embeds PAGE-level history content directly.
- Reading pages begin from ZONE-level nodes and below.

## Completed: Content API Worker + D1

Implemented under `workers/content-api/`.

- Added `workers/*` to `pnpm-workspace.yaml`.
- Added `content-api-worker` package with Wrangler scripts:
  - `dev`
  - `deploy`
  - `db:migrate:local`
  - `db:migrate:remote`
- Added D1 binding `CONTENT_DB`.
- Added migrations:
  - `0001_init.sql`: `pages`, `sync_log`, base indexes.
  - `0002_add_hierarchy.sql`: `parent_id`, `depth`, `page_type`, hierarchy indexes.
- `pages` supports sync and hierarchy metadata:
  - `source_file`
  - `base_content_hash`
  - `status`: `synced`, `modified`, `local_only`
  - `metadata`
  - `parent_id`
  - `depth`
  - `page_type`
- `page_type` currently supports:
  - `zone`
  - `chapter`
  - `arc`
  - `section`
  - `page`

Implemented Worker endpoints:

- `GET /api/health`
- `GET /api/content/:area`
- `GET /api/content/:area/tree`
- `GET /api/content/:area/:slug`
- `PUT /api/content/:area/:slug`
- `DELETE /api/content/:area/:slug`
- `POST /api/content/sync/import`
- `GET /api/content/sync/status`

Other Worker notes:

- CORS is configured from `ALLOWED_ORIGINS`.
- Write routes can be protected by `API_TOKEN`.
- Tree responses are built from `parent_id`, `depth`, `page_type`, and `sort_order`.

## Completed: History Migration

Implemented in `scripts/migrate-history.mjs`.

- Parses `apps/uep/content/SUMMARY.md`.
- Builds the history hierarchy from GitBook-style indentation.
- Derives:
  - `id`
  - `slug`
  - `parentId`
  - `depth`
  - `pageType`
  - `sortOrder`
- Converts Markdown and GitBook-flavored constructs into the rich content format used by the Worker.
- Imports pages through `POST /api/content/sync/import`.
- Can clear/import history content during local migration workflows.

Current practical status:

- Local D1 history content has been validated.
- Remote D1 migration/import still needs confirmation before production deployment.

## Completed: Admin Content UI

Implemented under `apps/uep/src/pages/admin/`.

- `admin/index.astro` talks to the content-api Worker.
- It displays sync status from `/api/content/sync/status`.
- History uses `/api/content/history/tree` and renders a tree view.
- Non-history areas still use a flat table view.
- Admin tree supports search, expand/collapse, status labels, and edit links.
- `admin/edit/[...slug].astro` loads individual pages for editing.
- `RichEditor.tsx` provides the current TipTap editor base.
- `apps/uep/src/utils/content-api.ts` provides the frontend API client helpers.

Current limitation:

- The editor exists as a working base, but rich content round-trip, conflict resolution, and polished sync UX are not yet production-complete.

## Completed: History Reader Redesign

Main files:

- `apps/uep/src/pages/history.astro`
- `apps/uep/src/components/history/HistoryReader.tsx`

Current behavior:

- `history.astro` is now a thin wrapper around `HistoryReader`.
- `HistoryReader` fetches runtime content from `PUBLIC_CONTENT_API_URL` or `http://localhost:8788`.
- It loads:
  - `/api/content/history/tree`
  - `/api/content/:id`
- `/history` defaults to the history landing view, not the old static home.
- The landing view is based on `history/passage`, titled "三向通道".
- PAGE-level content is embedded into the landing page:
  - `history/passage`
  - `history/note`
- The three landing arches represent the U / E / P channel zones.
- `路邊的紙條` is treated as a special note section on the landing page.
- The left sidebar no longer shows PAGE-level nodes, because those are module-home content.
- Reader navigation begins at ZONE-level nodes and continues into chapter/arc/section nodes.
- The sidebar title "歷史典藏庫" is clickable and returns to the 三向通道 landing view.
- `?page=` remains the deep-link mechanism for history reading pages.
- Article pages use a main reading column and omit the right-side technical TOC.

Design rationale:

- History content is novel/prose-like, so a right article outline is less useful than it is in a technical document.
- PAGE-level nodes are module-home material, not normal reading entries.

## Completed: New UEP Design Adoption

The history area now shares the newer UEP zone/map interaction model instead of being a standalone GitBook-like page.

Shared components now used by history or zone pages:

- `DesignLayout`
- `TopBar`
- `ZoneAtmosphere`
- `UepDialogue`
- `Minimap`
- `BigMapModal`
- `IntroOverlay`
- `PortalTransition`
- `PieMap3D`

Map/navigation behavior:

- `Minimap` is draggable.
- `Minimap` persists its position in `localStorage`, so it no longer resets to the bottom-left corner after route/zone changes.
- Minimap and big-map zone picks use the same intro/portal transition flow as the home page.
- Big map sectors are clickable and open the zone intro modal.
- Confirming the intro enters the target zone.
- In non-home contexts, clicking the big map center returns to the UEP home page.
- `PieMap3D` pointer handling was adjusted so sector clicks are not swallowed by parent modal interactions.

## Completed: Astro Build Compatibility

These routes/utilities were adjusted so UEP can continue to build cleanly while `/history` remains a runtime reader:

- `apps/uep/src/pages/[...slug].astro`
- `apps/uep/src/pages/article.astro`
- `apps/uep/src/pages/test-overlay.astro`
- `apps/uep/src/utils/overlay-renderer.ts`
- `apps/uep/src/utils/summary.ts`

Current state:

- Static UEP content routes continue to prerender.
- Node-only `fs/path` usage was removed from UEP build paths and replaced with Vite raw import / `import.meta.glob` patterns where needed.
- `/history` remains the D1-backed runtime route.

## Validation

Recently verified:

- `pnpm --filter @uep/uep exec astro check` passes.
- `pnpm --filter @uep/uep build` passes.
- Local content-api endpoints returned expected history data:
  - `/api/content/history/tree`
  - `/api/content/history/passage`
  - `/api/content/history/note`
  - zone/article content endpoints
- Route smoke checks passed:
  - `/history`
  - `/history?page=history/passage`
  - `/history?page=history/passage/unforgettable_story`

Not yet fully verified:

- Browser automation for big-map/minimap/portal interactions. Playwright is not installed in this workspace yet.
- Remote D1 deployment/import state.

Known repo-wide CI noise:

- Full `pnpm lint` still reports many pre-existing repo-wide issues.
- Full `pnpm format:check` still reports many pre-existing formatting issues.
- A local Windows `pnpm typecheck` run previously hit an `EPERM` around Vite cache cleanup in `apps/root`; this looks like local filesystem/cache noise rather than a UEP history regression.

## CI Notes

No CI change is required just because history now uses D1/content-api.

Reason:

- The Astro build does not need the Worker or D1 to be running.
- History content is fetched at runtime by the client-side reader.
- Current CI only installs, lints, typechecks, format-checks, builds, and uploads `apps/*/dist`.

If PR CI must be green, the repo-wide lint/format debt still needs to be handled separately or CI needs to be scoped to changed packages. That is not specific to the content Worker work.

## Remaining Work

- Confirm remote D1 migrations and import for `eternity-content-api`.
- Decide when/if non-history areas should move to D1.
- If other areas move to D1, define their `page_type` and landing/reader rules rather than reusing history assumptions blindly.
- Split `HistoryReader.tsx` into smaller components once behavior stabilizes:
  - landing view
  - sidebar tree
  - article reader
  - map integration
  - content transforms
- Productize the admin editor:
  - save states
  - sync conflict handling
  - rich content round-trip checks
  - clearer modified/local-only workflows
- Add browser-level tests or a lightweight Playwright setup for:
  - minimap drag persistence
  - big map sector click
  - center click home navigation
  - intro modal enter flow
  - `/history?page=...` deep links

## Agent Handoff Notes

- Treat `apps/uep/src/components/history/HistoryReader.tsx` as the current source of truth for history reading behavior.
- Treat `workers/content-api/src/index.ts` and `workers/content-api/src/types.ts` as the current source of truth for content API behavior.
- Treat `scripts/migrate-history.mjs` as the current source of truth for history hierarchy import rules.
- Do not reintroduce the old static history landing page.
- Do not put PAGE-level history entries back into the sidebar tree unless the product rule changes.
- The three-arch landing is intentional and represents the U / E / P channels.
- The minimap is a persistent top-level navigation affordance; avoid making it page-local state again.
