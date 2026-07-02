# @uep/uep — 世界觀文件站

> U.E.P 的幻想空間。Hybrid SSR，內容從 D1 即時載入。

文件站是 Eternity monorepo 的核心站點，以五個主題區域（Zones）呈現世界觀內容。每個 Zone 有獨立的視覺風格、閱讀器、入場動畫、背景特效與頁面轉場。

- **線上版本：** [uep.unforgettableeternalproject.com](https://uep.unforgettableeternalproject.com)
- **本地開發：** `http://localhost:4321`

## Zone 系統

| Zone        | 路徑        | 背景特效                 | Reader         | 說明                                      |
| ----------- | ----------- | ------------------------ | -------------- | ----------------------------------------- |
| 📜 History  | `/history`  | 文字粒子飄浮             | HistoryReader  | 時序敘事，章節樹狀結構                    |
| 🔊 Echoes   | `/echoes`   | 回聲漣漪波紋             | EchoesReader   | 音訊內容，cluster 導航，音訊播放器        |
| 🎨 Visuals  | `/visuals`  | 光柱 + 浮動框架          | VisualsReader  | 圖庫瀏覽，division/subcategory/group 分層 |
| 💡 Concepts | `/concepts` | 格線 + 數位雨 + 數學符號 | ConceptsReader | 結構化檔案，四種 variant Reader           |
| 📦 Storage  | `/storage`  | 灰塵粒子 + 飄浮 SVG      | StorageReader  | 檔案庫，clearing 卡片系統                 |
| 🌀 Portal   | `/portal`   | —                        | —              | 入口頁（靜態）                            |

每個 Zone 都有：

- **入場動畫（Boot Animation）** — 進入 Zone 時的過渡效果
- **背景特效（Atmosphere）** — Zone 專屬的視覺氛圍
- **頁面轉場（Page Transition）** — Zone 內頁面切換動畫
- **Zone 入口頁（Entry Page）** — ZoneEntryPage 統一入口

## 架構分層

### 頁面層（`src/pages/`）

```
pages/
├── index.astro          # 首頁（捲動狀態機 + 3D 地圖）
├── history.astro        # History zone（SSR）
├── echoes.astro         # Echoes zone（SSR）
├── visuals.astro        # Visuals zone（SSR）
├── concepts.astro       # Concepts zone（靜態）
├── storage.astro        # Storage zone（靜態）
├── portal.astro         # Portal（靜態）
├── admin/
│   ├── index.astro      # Admin 儀表板
│   ├── login.astro      # 登入頁
│   ├── media.astro      # 媒體庫管理
│   ├── edit/[...slug].astro  # TipTap 編輯器（catch-all）
│   └── homepage/[zone].astro # 首頁內容管理
└── api/
    └── assets/          # 代理至 content-api
```

SSR vs 靜態：有即時 API 資料需求的 Zone（History, Echoes, Visuals）使用 SSR；其他靜態輸出。

### 元件層（`src/components/`）

```
components/
├── zone/               # Zone 共用 primitives
│   ├── ReaderShell.tsx          # 閱讀器殼層（TopBar + 地圖 + 轉場）
│   ├── ZoneStateDisplay.tsx     # 載入/錯誤/空白狀態
│   ├── ZonePrevNext.tsx         # 上下篇導航
│   ├── ZoneEntryPage.tsx        # Zone 入口頁
│   ├── ZoneHomepageRenderer.tsx # 首頁 Zone 區塊渲染
│   ├── ZoneBreadcrumb.tsx       # 麵包屑
│   ├── useZoneRouter.ts         # URL 路由 hook
│   ├── useZoneBootReady.ts      # Boot 動畫解除 hook
│   ├── useScrollMemory.ts       # 滾動位置記憶
│   └── contentVisibility.ts     # hidden/locked/spoiler 工具函式
├── history/            # HistoryReader + 專屬元件
├── echoes/             # EchoesReader + AudioPlayer + 專屬元件
├── visuals/            # VisualsReader + Gallery + 專屬元件
├── concepts/           # ConceptsReader + 四種 variant Reader
├── storage/            # StorageReader + Clearing 卡片
├── editor/             # Admin 編輯器
│   ├── RichEditor.tsx           # TipTap 編輯器主體（含 Markdown 匯入/匯出、混合樣式偵測）
│   ├── MediaLibrary.tsx         # 媒體庫
│   ├── IconLibrary.tsx          # 圖示庫
│   └── [zone]/EditorBody.tsx    # 各 Zone 專屬編輯器
├── home/               # 首頁元件
│   ├── HomePage.tsx             # 首頁主體（捲動狀態機）
│   ├── JourneyScene.tsx         # Zone 場景渲染
│   └── JourneyNav.tsx           # 導航控制
├── map/                # 地圖系統
│   ├── PieMap3D.tsx             # Three.js 3D 地圖
│   ├── Minimap.tsx              # 縮小地圖
│   └── BigMapModal.tsx          # 全螢幕地圖
└── ui/                 # 通用 UI
    ├── DesignLayout.astro       # 主要 Layout（zone 主題）
    ├── ZoneAtmosphere.tsx       # 背景特效容器
    ├── PortalTransition.tsx     # 傳送門轉場
    └── UepDialogue.tsx          # 對話氣泡
```

### 設計系統

- **DesignLayout** — 幾乎所有頁面使用，接受 `zone` prop 控制主題色；掛載內容保護腳本（`scripts/content-protection.ts`，禁止選取/右鍵）
- **BaseLayout** — 僅 Portal 使用
- **雙主題** — `data-theme` 屬性切換
- **Zone 色彩** — 每個 Zone 有專屬 CSS 變數（`--zone-primary` 等）
- **動畫系統** — boot animation / page transition / atmosphere 三層

## 資料層

### Content API（port 8788）

文件站的內容由 `content-api` Worker 提供，使用 Cloudflare D1（SQLite）儲存。

主要端點：

| 方法 | 端點                       | 說明                         |
| ---- | -------------------------- | ---------------------------- |
| GET  | `/api/content/:area`       | 列出區域頁面                 |
| GET  | `/api/content/:area/tree`  | 樹狀結構                     |
| GET  | `/api/content/:area/:slug` | 單頁內容                     |
| PUT  | `/api/content/:area/:slug` | 建立/更新（需 Bearer token） |
| POST | `/api/content/sync/import` | 批次匯入                     |

### D1 資料模型

`pages` 表支援層級結構：

- `page_type`: zone / chapter / arc / section / page
- `parent_id` + `depth`: 樹狀層級
- `metadata`: JSON 欄位，含圖示、顏色、hidden/locked/spoiler 等

### 內容來源

```
U.E.P-s-Imaginary-Space (GitBook)
        ↓ migrate-*.mjs
    Cloudflare D1
        ↓ content-api Worker
    前端 Reader 元件
```

## Admin 後台

- **進入路徑：** `/admin`（JWT 驗證保護）
- **編輯器：** TipTap 富文字，各 Zone 有專屬 EditorBody
- **媒體庫：** R2 儲存，支援圖片上傳、搜尋、批次管理
- **首頁管理：** 各 Zone 首頁區塊的內容編輯
- **editorModeRegistry：** 依 Zone 動態載入不同 EditorBody

## 本地開發

### 啟動順序

```bash
# 1. 啟動 content-api Worker（必須先起）
pnpm --filter content-api-worker dev

# 2. 啟動文件站
pnpm --filter @uep/uep dev
```

> content-api Worker 必須在運行中，否則頁面無法載入內容。

### 資料庫初始化

```bash
# 執行 D1 遷移
pnpm --filter content-api-worker db:migrate:local

# 匯入內容（選擇需要的 zone）
node scripts/migrate-history.mjs
node scripts/migrate-echoes.mjs
node scripts/migrate-visuals.mjs
node scripts/migrate-concepts.mjs
node scripts/migrate-storage.mjs
node scripts/migrate-homepage.mjs
```

### 環境變數

| 變數                     | 說明             | 預設值                  |
| ------------------------ | ---------------- | ----------------------- |
| `PUBLIC_CONTENT_API_URL` | Content API 位址 | `http://localhost:8788` |
| `PUBLIC_VISITOR_API_URL` | 訪客計數 API     | `http://localhost:8787` |

正式環境在 Cloudflare Pages 設定：`PUBLIC_CONTENT_API_URL=https://eternity-content-api.ptyc4076.workers.dev`

### 建置

```bash
# 型別檢查 + 建置
pnpm --filter @uep/uep build

# 預覽建置結果
pnpm --filter @uep/uep preview
```

## 目錄結構

```
apps/uep/
├── src/
│   ├── components/     # React 元件（依上方分群）
│   ├── pages/          # Astro 路由
│   ├── layouts/        # DesignLayout / BaseLayout
│   ├── data/           # 靜態資料（zone 定義等）
│   └── styles/         # 全域樣式
├── public/             # 靜態資源
├── astro.config.mjs    # Hybrid output + SSR adapter
├── tailwind.config.mjs # Tailwind 設定
├── tsconfig.json       # TypeScript 設定
└── package.json
```

## 注意事項

- **Middleware** (`middleware.ts`) 保護 `/admin/**` 路由，開發模式自動注入 dev 使用者
- `HistoryReader` 透過 `PUBLIC_CONTENT_API_URL` 在瀏覽器端載入內容
- Windows 環境下 `pnpm typecheck` 可能遇到 Vite cache `EPERM` 錯誤，是檔案系統快取噪音
- 各 Zone Reader 使用 `client:only="react"` 指令，完全在客戶端渲染
