# Eternity — Bernie 的個人網站 Monorepo

### 本專案提供多語言 README

[![Static Badge](https://img.shields.io/badge/lang-zh--tw-yellow)](./README.zh-tw.md) [![Static Badge](https://img.shields.io/badge/lang-en-red)](./README.md)

## U.E.P 和 Exera 的對話

「等等——主站整個重新設計了？」

「對啊！Quartz 設計系統、D1 後端、完整的後台編輯器⋯⋯Keystatic 已經完全拿掉了。噢，還有可以拖曳的卡片，有物理效果的那種！」

「物理效果。在卡片上。」

「甩動的時候會噴粒子，放開會彈簧彈回去。Bernie 說這是『必要功能』。」

「⋯⋯果然是他會說的話。文件站呢？」

「一樣好好的——五個區域、所有閱讀器都正常運作，透過同一個 Content API 同步。現在全部統一了。」

「所以我們真的要上線了。」

「快了。只需要確保不會爆炸就好。」

## 專案概覽

**Eternity** 是使用 **pnpm workspaces + Turborepo** 管理的個人網站 monorepo，部署在 **Cloudflare Pages + Workers**。包含兩個 Astro 站點、兩個 Cloudflare Worker 和共用套件——結合了個人作品集與沉浸式世界觀文件平台。

| 站點          | 網域                                                                               | 說明                                       |
| ------------- | ---------------------------------------------------------------------------------- | ------------------------------------------ |
| 🌟 **主站**   | [unforgettableeternalproject.com](https://unforgettableeternalproject.com)         | 作品集、專案展示、動態、連結 — Quartz 設計 |
| 📚 **文件站** | [uep.unforgettableeternalproject.com](https://uep.unforgettableeternalproject.com) | 世界觀文件，5 個主題區域                   |

> **目前版本：v0.9.8.2** — UI 微調與編輯器強化（Markdown 匯入/匯出、混合樣式偵測、內容保護）。

## 專案結構

```
Eternity/
├── apps/
│   ├── root/                   # 主站 — Astro 5 + React + Quartz 設計
│   └── uep/                    # 文件站 — Astro 4 + React + TipTap 編輯器
├── packages/
│   ├── config/                 # 共用 ESLint / Prettier / TypeScript / Tailwind
│   └── ui/                     # 共用 UI 元件
├── workers/
│   ├── content-api/            # D1 + R2 內容 API (port 8788)
│   └── visitor-counter/        # KV 訪客計數器 (port 8787)
├── scripts/
│   ├── migrate-*.mjs           # 內容匯入腳本（各 zone + 主站）
│   ├── seed-*.mjs              # 資料填充（about、contact、page text）
│   ├── sync.mjs                # 統一同步 dispatcher
│   ├── sync-content.mjs        # 文件站 D1 同步（本地 ↔ 遠端）
│   ├── sync-root.mjs           # 主站 D1 + R2 同步
│   ├── sync-utils.mjs          # 共用同步工具
│   ├── sync-auth.mjs           # 共用同步認證
│   └── convert-content-to-html.mjs  # Markdown → HTML 轉換器
├── e2e/                        # Playwright E2E 測試
├── docs/                       # 專案文件
├── turbo.json                  # Turborepo 管線設定
├── pnpm-workspace.yaml         # pnpm workspace 定義
└── package.json
```

## 技術棧

### 前端

- **[Astro](https://astro.build)** 5.x (root) / 4.x (uep) — 靜態 + Hybrid SSR
- **[React](https://react.dev)** 19 — 互動式 islands（`client:only`、`client:load`）
- **TypeScript** — 完整型別覆蓋
- **[Tailwind CSS](https://tailwindcss.com)** — Utility-first 樣式
- **[Three.js](https://threejs.org)** — 3D 地圖（PieMap3D）
- **[TipTap](https://tiptap.dev)** — 富文字編輯器（兩站後台）

### 後端與資料層

- **[Cloudflare Workers](https://workers.cloudflare.com)** — Serverless 運算
- **[Cloudflare D1](https://developers.cloudflare.com/d1/)** — SQLite 內容資料庫（兩站共用）
- **[Cloudflare R2](https://developers.cloudflare.com/r2/)** — 靜態資源儲存（各站獨立 bucket）
- **[Cloudflare KV](https://developers.cloudflare.com/kv/)** — 訪客統計
- **[Resend](https://resend.com)** — 聯絡表單郵件 API

### 工具鏈

- **pnpm** workspaces + **Turborepo** — Monorepo 管理
- **ESLint** + **Prettier** — 程式碼品質
- **Vitest** + **Playwright** — 測試（單元 + E2E）
- **Wrangler** — Cloudflare CLI
- **Conventional Commits** — 提交訊息規範

## 快速開始

### 前置條件

- Node.js 20+
- pnpm 9+

### 安裝

```bash
# 啟用 pnpm（透過 Corepack）
corepack enable

# 安裝依賴
pnpm install

# 初始化本地 D1 資料庫
pnpm --filter content-api-worker db:migrate:local
```

### 開發

```bash
# 啟動 Worker（各開一個終端）
pnpm --filter content-api-worker dev      # 內容 API → localhost:8788
pnpm --filter visitor-counter-worker dev  # 訪客計數 → localhost:8787

# 啟動站點
pnpm dev                                  # 全部站點（root:4320, uep:4321）
pnpm --filter @uep/root dev              # 僅主站
pnpm --filter @uep/uep dev               # 僅文件站
```

> **注意：** 兩站都需要 content-api Worker 正在運行才能載入內容。

## 開發指令

### 品質檢查

```bash
pnpm check          # 一鍵全跑：lint → typecheck → format:check → build
pnpm lint            # ESLint
pnpm typecheck       # TypeScript 型別檢查
pnpm format          # Prettier 格式化
pnpm format:check    # Prettier 格式檢查
```

### 測試

```bash
pnpm test            # 前端單元測試（Vitest）
pnpm test:workers    # Worker 整合測試（Vitest + Cloudflare pool）
pnpm test:all        # 全部單元 + Worker 測試
pnpm test:e2e        # E2E 煙霧測試（Playwright）
```

### Worker 部署

```bash
pnpm deploy:content-api    # 部署 content-api Worker
pnpm deploy:visitor        # 部署 visitor-counter Worker
```

### D1 資料庫

```bash
pnpm --filter content-api-worker db:migrate:local    # 執行遷移（本地）
pnpm --filter content-api-worker db:migrate:remote   # 執行遷移（遠端）
```

### 內容同步

```bash
# 統一同步 dispatcher（兩站、單次認證）
pnpm sync                  # 互動模式（差異預覽、逐一確認）
pnpm sync:push             # 本地 → 遠端
pnpm sync:pull             # 遠端 → 本地

# 從來源 repo 匯入內容
node scripts/migrate-history.mjs              # 匯入到本地 D1
node scripts/migrate-history.mjs --remote     # 匯入到遠端 D1
```

> ⚠️ `--clean` 會重置所有 metadata（包含手動設定的圖示）。建議改用 `pnpm sync` 做增量同步。

## 部署

站點部署在 **Cloudflare Pages**，API 部署在 **Cloudflare Workers**。

| 專案                   | 分支    | 網域                                          |
| ---------------------- | ------- | --------------------------------------------- |
| eternity-root          | main    | unforgettableeternalproject.com               |
| eternity-root-staging  | staging | staging-root.pages.dev                        |
| eternity-uep           | main    | uep.unforgettableeternalproject.com           |
| eternity-uep-staging   | staging | staging-uep.pages.dev                         |
| content-api Worker     | —       | eternity-content-api.ptyc4076.workers.dev     |
| visitor-counter Worker | —       | eternity-visitor-counter.ptyc4076.workers.dev |

### 分支策略

```
main         → 正式環境部署
develop      → 日常開發
staging      → 推送後自動觸發 Cloudflare Pages 預覽
release/*    → Release candidate（staging 自動部署）
```

推送到 staging 預覽：`git push origin develop:staging`

## 架構亮點

### 主站 — Quartz 設計系統（v0.9.8）

主站採用 **Quartz 設計語言** — JetBrains Mono 等寬字體、navy/coral/ink 色彩系統、極簡邊框、靜謐的紙質質感。

核心特色：

- **所有內容來自 D1** — 不再使用 Keystatic；兩站統一 Content API
- **三欄式後台編輯器** — Entry List | TipTap 編輯器 | Inspector
- **獨立 R2 bucket** — `eternity-root-assets`，與文件站完全隔離
- **Widget 系統** — 8 個可設定的側邊欄 widget（名言、音樂、統計、傳送門等）
- **可拖曳卡片** — 基於物理的拖曳，慣性、彈簧彈回、粒子特效
- **暗色模式** — TipTap 內容的 CSS 變數色彩正規化

### 文件站 — Zone 系統

五個主題區域，各有專屬 Reader、入場動畫、背景特效、頁面轉場：

| Zone        | 背景特效            | 說明                                  |
| ----------- | ------------------- | ------------------------------------- |
| 📜 History  | 文字粒子飄浮        | 時序敘事，章節樹狀結構                |
| 🔊 Echoes   | 回聲漣漪波紋        | 音訊內容，cluster 導航                |
| 🎨 Visuals  | 光柱 + 浮動框架     | 圖庫，division/subcategory/group 分層 |
| 💡 Concepts | 格線 + 數位雨       | 結構化資料，四種 variant Reader       |
| 📦 Storage  | 灰塵粒子 + 飄浮 SVG | 檔案庫，clearing 卡片系統             |

### Content API Worker

兩站共用的 Cloudflare Worker：

- **D1 資料庫** (`eternity-content`) — 頁面、樹狀結構、同步日誌
- **R2 儲存** — 兩個隔離的 bucket（`eternity-assets` + `eternity-root-assets`）
- **5 張主站表** — `root_projects`、`root_links`、`root_updates`、`root_singletons`、`root_cards`
- **同步工具** — 統一 dispatcher、共用認證、R2 刪除追蹤與傳播

## 開發狀態

### ✅ 已完成

- **Monorepo 架構** — pnpm workspaces + Turborepo 管線
- **主站 — Quartz 全面改版**（v0.9.8）
  - D1 後端遷移（從 Keystatic）
  - 三欄式 TipTap 後台編輯器（8 個頁面編輯器）
  - 媒體庫與獨立 R2 bucket
  - Widget 系統、可拖曳卡片、暗色模式正規化
  - Quartz 導覽列、搜尋、Footer、固定目錄
- **文件站 — 5 個主題區域**，各有專屬 Reader、入場動畫、背景特效、頁面轉場
- **3D 地圖** — Three.js PieMap3D，zone 導航
- **內容 API** — D1 驅動的 CRUD，支援樹狀結構、雙 R2、同步
- **同步工具** — 統一 dispatcher、雙向 D1 + R2 同步、R2 刪除追蹤
- **CI/CD** — GitHub Actions 品質檢查與 Worker 部署
- **測試基礎設施** — Vitest（單元 + Worker）+ Playwright（E2E）

### 📅 計劃中（上線後）

- History 章節門控 / 防劇透策略
- History 互動式嵌入（entity/media cue 系統）
- Zone Islands（互動式嵌入工具）
- Console 指令系統（主站彩蛋）
- 主題與進度設定後台

## 相關 Repository

| Repository                                                                                        | 說明                         |
| ------------------------------------------------------------------------------------------------- | ---------------------------- |
| [Eternity-Design](https://github.com/unforgettableeternalproject/Eternity-Design)                 | 設計稿與視覺資源             |
| [U.E.P-s-Imaginary-Space](https://github.com/unforgettableeternalproject/U.E.P-s-Imaginary-Space) | GitBook 格式的世界觀來源內容 |

## 貢獻者

❦ **Bernie** — 專案建立者與主要開發者

- GitHub: [@unforgettableeternalproject](https://github.com/unforgettableeternalproject)

## 授權

Copyright © 2025-2026 Bernie. All rights reserved.

本專案採用 MIT 授權。詳見 [LICENSE](./LICENSE)。

---

_最後更新：2026 年 6 月_
