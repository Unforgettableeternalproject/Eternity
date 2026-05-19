# Eternity — Bernie 的個人網站 Monorepo

### 本專案提供多語言 README

[![Static Badge](https://img.shields.io/badge/lang-zh--tw-yellow)](./README.zh-tw.md) [![Static Badge](https://img.shields.io/badge/lang-en-red)](./README.md)

## U.E.P 和 Exera 的對話

「所以⋯⋯真的做出來了？」

「不只做出來了——現在有五個區域了！歷史、回聲、影像、概念、儲藏⋯⋯每個都有自己的閱讀器、動畫和氛圍。噢，還有 3D 地圖！還有後台管理面板的富文字編輯器，還有——」

「好了好了，我知道了。Bernie 這次真的是全力以赴。」

「嗯嗯！他說下一步是確保真正有人來訪的時候不會出問題。」

「⋯⋯了解他的話，那大概才是最難的部分。」

## 專案概覽

**Eternity** 是使用 **pnpm workspaces + Turborepo** 管理的個人網站 monorepo，部署在 **Cloudflare Pages + Workers**。包含兩個 Astro 站點、兩個 Cloudflare Worker 和共用套件——結合了個人作品集與沉浸式世界觀文件平台。

| 站點          | 網域                                                                               | 說明                         |
| ------------- | ---------------------------------------------------------------------------------- | ---------------------------- |
| 🌟 **主站**   | [unforgettableeternalproject.com](https://unforgettableeternalproject.com)         | 作品集、專案展示、文章、聯絡 |
| 📚 **文件站** | [uep.unforgettableeternalproject.com](https://uep.unforgettableeternalproject.com) | 世界觀文件，5 個主題區域     |

> **目前版本：v0.9.6** — Release candidate，即將進入正式上線。

## 專案結構

```
Eternity/
├── apps/
│   ├── root/                   # 主站 — Astro 5 + React + Keystatic CMS
│   └── uep/                    # 文件站 — Astro 4 + React + TipTap 編輯器
├── packages/
│   ├── config/                 # 共用 ESLint / Prettier / TypeScript / Tailwind
│   └── ui/                     # 共用 UI 元件
├── workers/
│   ├── content-api/            # D1 + R2 內容 API (port 8788)
│   └── visitor-counter/        # KV 訪客計數器 (port 8787)
├── scripts/
│   ├── migrate-history.mjs     # 匯入 History zone（從 GitBook）
│   ├── migrate-echoes.mjs      # 匯入 Echoes zone 資料
│   ├── migrate-visuals.mjs     # 匯入 Visuals zone 資料
│   ├── migrate-concepts.mjs    # 匯入 Concepts zone 資料
│   ├── migrate-storage.mjs     # 匯入 Storage zone 資料
│   ├── migrate-homepage.mjs    # 匯入首頁內容
│   ├── seed-homepage.mjs       # 首頁資料填充
│   ├── merge-dossier-variants.mjs  # 合併檔案變體
│   └── sync-content.mjs        # 雙向 D1 同步（本地 ↔ 遠端）
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
- **[TipTap](https://tiptap.dev)** — 富文字編輯器（後台）

### 後端與資料層

- **[Cloudflare Workers](https://workers.cloudflare.com)** — Serverless 運算
- **[Cloudflare D1](https://developers.cloudflare.com/d1/)** — SQLite 內容資料庫
- **[Cloudflare R2](https://developers.cloudflare.com/r2/)** — 靜態資源儲存
- **[Cloudflare KV](https://developers.cloudflare.com/kv/)** — 訪客統計
- **[Keystatic](https://keystatic.com)** — Git-based CMS（主站）
- **[Resend](https://resend.com)** — 聯絡表單郵件 API

### 工具鏈

- **pnpm** workspaces + **Turborepo** — Monorepo 管理
- **ESLint** + **Prettier** — 程式碼品質
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

# 初始化本地 D1 資料庫（文件站用）
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

> **注意：** 文件站需要 content-api Worker 正在運行才能載入內容。

## 開發指令

### 品質檢查

```bash
pnpm check          # 一鍵全跑：lint → typecheck → format:check → build
pnpm lint            # ESLint
pnpm typecheck       # TypeScript 型別檢查
pnpm format          # Prettier 格式化
pnpm format:check    # Prettier 格式檢查
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
# 從來源 repo 匯入內容
node scripts/migrate-history.mjs              # 匯入到本地 D1
node scripts/migrate-history.mjs --remote     # 匯入到遠端 D1

# 雙向同步（本地 ↔ 遠端 D1）
pnpm sync                  # 互動模式
pnpm sync:push             # 本地 → 遠端
pnpm sync:pull             # 遠端 → 本地
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

## 開發狀態

### ✅ 已完成

- **Monorepo 架構** — pnpm workspaces + Turborepo 管線
- **主站** — 作品集、專案展示、文章、聯絡表單、多語言（zh-tw/en）、Keystatic CMS
- **文件站 — 5 個主題區域**，各有專屬 Reader、入場動畫、背景特效、頁面轉場
  - 📜 **History** — 時序敘事，文字粒子特效
  - 🔊 **Echoes** — 音訊內容，回聲漣漪效果與 cluster 導航
  - 🎨 **Visuals** — 圖庫，光柱與浮動框架裝飾
  - 💡 **Concepts** — 結構化資料，格線、數位雨、CRT 開機動畫
  - 📦 **Storage** — 檔案庫，灰塵粒子與飄浮 SVG 裝飾
- **3D 地圖** — Three.js PieMap3D，zone 導航
- **後台管理** — TipTap 富文字編輯器、媒體庫、首頁管理
- **內容 API** — D1 驅動的 CRUD，支援樹狀結構與同步
- **Reader 共用元件** — ReaderShell、ZoneStateDisplay、ZonePrevNext、useZoneRouter、contentVisibility
- **首頁捲動狀態機** — Wheel 驅動的 zone 轉場與 boot 動畫
- **遷移腳本** — 各 zone 從 GitBook 來源匯入
- **雙向同步** — 本地 ↔ 遠端 D1，衝突偵測

### 🔧 進行中 (v0.9.6)

- 系統文件更新
- 自動化測試基礎設施
- 穩定性測試與 bug 修復

### 📅 計劃中（上線後）

- Zone Islands（互動式嵌入工具）
- History 互動式嵌入（entity/media cue 系統）
- History 章節門控 / 防劇透策略
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

_最後更新：2026 年 5 月_
