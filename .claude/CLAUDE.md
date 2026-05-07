# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 語言規範

一律使用繁體中文回覆。程式碼註解也使用繁體中文。絕不使用簡體中文。

## 專案概覽

Eternity 是一個個人網站 monorepo，使用 **pnpm workspaces + Turborepo** 管理，部署在 **Cloudflare Pages + Workers**。
包含兩個 Astro 站點、兩個 Cloudflare Worker、以及共用套件。

## 架構總覽

```
apps/
  root/     @uep/root — 主站 (unforgettableeternalproject.com)
  uep/      @uep/uep  — 世界觀文件站 (uep.unforgettableeternalproject.com)
packages/
  config/   @uep/config — 共用 ESLint/Prettier/TypeScript/Tailwind 設定
  ui/       @uep/ui     — 共用 UI 元件
workers/
  content-api/       — 內容 API (D1 資料庫)
  visitor-counter/   — 訪客計數器 (KV)
scripts/
  migrate-history.mjs — 從 GitBook SUMMARY.md 匯入內容到 D1
```

## 兩站職責

### apps/root — 主站

- Astro 5.x + React + Tailwind，靜態輸出
- 本地開發 port: **4320**
- 使用 **Keystatic CMS** 管理內容（projects、links、updates、articles 等）
- 多語言 i18n：`zh-tw`（預設）、`en`，路徑策略 pathname
- 聯絡表單透過 **Resend API** 發送郵件

### apps/uep — 世界觀文件站

- Astro 4.x + React + MDX，hybrid 輸出（SSR + 靜態）
- 本地開發 port: **4321**
- 六大區域（zones）：history、echos、visuals、concepts、storage、portal
- `/history` 頁面在 runtime 從 content-api Worker 擷取 D1 資料
- `/admin` 和 `/admin/edit/[...slug]` 提供 TipTap 富文字編輯器
- 設計系統使用 `DesignLayout.astro`，包含 3D 地圖、區域氣氛、過場動畫等互動元件

## Workers 與資料層

### content-api (port 8788)

Cloudflare Worker + **D1** 資料庫 (`eternity-content`)，負責所有 UEP 內容的 CRUD 和同步。

主要端點：

- `GET /api/content/:area` — 列出區域頁面
- `GET /api/content/:area/tree` — 樹狀結構
- `GET /api/content/:area/:slug` — 單頁內容
- `PUT /api/content/:area/:slug` — 建立/更新
- `POST /api/content/sync/import` — 批次匯入
- 寫入操作需要 `Bearer API_TOKEN`，未設定時為開發模式（全通過）

D1 表結構：`pages` 表有層級欄位 `parent_id`、`depth`、`page_type`（zone/chapter/arc/section/page），`sync_log` 記錄匯入歷史。

### visitor-counter (port 8787)

Cloudflare Worker + **KV** (`VISITOR_STATS`)，提供訪客計數 API。

## 內容來源

歷史內容的 Markdown 來源在同一工作區的 sibling repo：
`../U.E.P-s-Imaginary-Space/`（GitBook 格式，含 SUMMARY.md）。

使用 `node scripts/migrate-history.mjs --remote` 匯入到遠端 D1。

## 常用指令

```bash
# === 開發 ===
pnpm dev                                    # 啟動所有 apps（root:4320, uep:4321）
pnpm --filter @uep/root dev                 # 只啟動主站
pnpm --filter @uep/uep dev                  # 只啟動文件站
pnpm --filter content-api-worker dev         # 啟動 content-api Worker (:8788)
pnpm --filter visitor-counter-worker dev     # 啟動 visitor-counter Worker (:8787)

# === 建置與品質檢查 ===
pnpm build                                  # 建置全部
pnpm lint                                   # ESLint 全部
pnpm typecheck                              # TypeScript 型別檢查
pnpm format                                 # Prettier 格式化
pnpm format:check                           # 檢查格式

# === Worker 部署 ===
pnpm --filter content-api-worker deploy
pnpm --filter visitor-counter-worker deploy

# === D1 資料庫 ===
pnpm --filter content-api-worker db:migrate:local
pnpm --filter content-api-worker db:migrate:remote
npx wrangler d1 execute eternity-content --local --command="SELECT COUNT(*) FROM pages;"
npx wrangler d1 execute eternity-content --remote --command="SELECT COUNT(*) FROM pages;"

# === 內容匯入 ===
node scripts/migrate-history.mjs             # 匯入到本地 D1
node scripts/migrate-history.mjs --remote    # 匯入到遠端 D1
node scripts/migrate-history.mjs --remote --clean  # 清除後重新匯入
```

## Cloudflare 部署

四個 Cloudflare Pages 專案：

| 專案                  | 分支    | 網域                                | Build 指令                                                        | 輸出目錄         |
| --------------------- | ------- | ----------------------------------- | ----------------------------------------------------------------- | ---------------- |
| eternity-root         | main    | unforgettableeternalproject.com     | `pnpm install --frozen-lockfile && pnpm --filter @uep/root build` | `apps/root/dist` |
| eternity-root-staging | staging | staging-root.pages.dev              | 同上                                                              | 同上             |
| eternity-uep          | main    | uep.unforgettableeternalproject.com | `pnpm install --frozen-lockfile && pnpm --filter @uep/uep build`  | `apps/uep/dist`  |
| eternity-uep-staging  | staging | staging-uep.pages.dev               | 同上                                                              | 同上             |

Cloudflare Pages 的根目錄必須設為 `/`（repo root），Framework preset 選 `None`。
必要環境變數：`NODE_VERSION=20`。

apps/uep 在 Cloudflare Pages 需設定 `PUBLIC_CONTENT_API_URL=https://eternity-content-api.ptyc4076.workers.dev`。

## 分支策略

```
main (production) ← PR from develop or release/v*
develop (日常開發)
staging (測試部署，推送後自動觸發 Cloudflare Pages)
```

推送到 staging 測試：`git push origin develop:staging`

Commit 使用 Conventional Commits：`feat:`, `fix:`, `docs:`, `refactor:`, `chore:` 等。

## PR 前檢查清單

依序在 repo root 執行，全部必須通過：

1. `pnpm lint`
2. `pnpm typecheck`
3. `pnpm format:check`
4. `pnpm build`

## 環境變數

根目錄 `.env` 包含所有共用環境變數（`PUBLIC_VISITOR_API_URL`、`PUBLIC_CONTENT_API_URL`、Keystatic OAuth、Resend API key）。
Worker 的 secret（如 `API_TOKEN`）透過 `wrangler secret put` 設定，不放在 `.env`。

## 可用的 MCP 工具

以下 MCP 工具可加速開發工作：

- **fff**（Fast File Finder）：使用 `mcp__fff__grep` 搜尋檔案內容、`mcp__fff__find_files` 搜尋檔案名稱。搜尋速度快且支援模糊匹配，適合快速定位程式碼。
- **Cloudflare MCP**：可直接查詢 D1 資料庫、管理 KV namespace、搜尋 Cloudflare 文件、查看 Worker 狀態，無需透過 CLI。
- **claude-in-chrome**：瀏覽器自動化，可用於測試頁面渲染結果。

## 注意事項

- 不要主動啟動 dev server——使用者通常已有持久 dev server 在背景運行。
- `apps/root` 的 Keystatic 管理入口隱藏在 `/a` 路徑，密碼 `426067`。
- `HistoryReader.tsx` 在瀏覽器端透過 `PUBLIC_CONTENT_API_URL` 存取內容，fallback 為 `http://localhost:8788`。
- Windows 環境下 `pnpm typecheck` 可能遇到 `apps/root` 的 Vite cache `EPERM` 錯誤，這是檔案系統快取噪音，非程式碼問題。
- 寫入檔案時注意中文字元不要被轉成 Unicode escape sequences。
