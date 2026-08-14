# @uep/uep — 世界觀文件站

> U.E.P 的幻想空間。Hybrid SSR，內容從 D1 即時載入。

文件站是 Eternity monorepo 的核心站點，以五個主題區域（Zones）呈現世界觀內容。每個 Zone 有獨立的視覺風格、閱讀器、入場動畫、背景特效與頁面轉場。

v1.0.0 起，文件站不只是閱讀介面——它有一套**進度系統**：讀者帳號、雙視角、掃描線閱讀追蹤、內容閘門、互動式嵌入、五座浮島工具，以及跨區域的互聯線索。詳見下方「進度系統」章節。

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
- **專屬浮島（Island）** — 該區域的常駐工具視窗（見「進度系統」）

## 進度系統

閱讀本身是有狀態的。讀者的位置、讀過什麼、解鎖了什麼，構成一條可累積的軸線。

### 分層

```
L0 地基    Progress Store + 旗標系統 + 雙視角
L1 進度軸  掃描線 + ProgressMarker + 已讀判定 + 進度迷霧
L2 互動樞紐 Interactive Embed（entity 標記 → 浮島消費）
L3 後端    讀者帳號 + 進度同步（D1 blob + CAS）
L4 浮島    Island Runtime + 五座區域浮島
L5 互聯    劇情點 / 實體 key 跨區域串連
```

### 雙視角

| 視角                   | 語意                                                 |
| ---------------------- | ---------------------------------------------------- |
| **探索者**（Explorer） | 預設。內容依進度逐步解鎖                             |
| **觀測者**（Observer） | 全解鎖，但留下永久印記（`observerEver`，單向不可逆） |

視角切換入口藏在識別證面板內，切換前有劇透警告。
`pristineOnly`（純潔者限定）的內容**觀測者也擋得住**。

### 掃描線

視窗 80% 處有一條看不見的線。它通過內容中的標記時記錄進度：

- `hr` 與 `ProgressMarkerNode` 都是標記；帶 `grantsFlags` 的是 **FlagMarker**
- 文末哨兵負責完成判定 → 授予 `completed:{pageId}`，**沒有 `hr` 的短文也算得出來**
- 跨 session 續讀靠最後通過的標記反推位置
- 極速捲動（rush）時 echo spot 視為「事件不存在」，不授旗也不留提示

### 內容閘門

四維條件是 **AND 聯集**，任一不滿足即鎖上：

1. 進度頁標記（可由容器頁向下繼承，`gateExempt` 可切斷）
2. 需先讀完某篇（`completed:{pageId}`）
3. 自訂旗標（必須先在 `/admin/settings` 註冊，否則存檔被 409 擋下）
4. 純潔者限定

### 浮島

桌面（≥761px）、已登入探索者、已解鎖、未停用——四關全過才掛載。

| 島       | 名稱     | 職責                                |
| -------- | -------- | ----------------------------------- |
| History  | 導航樹   | 章節樹 + 書籤條目                   |
| Concepts | 終端     | 指令輸入 + 條目查詢，輸出歷史持久化 |
| Echoes   | 流浪回聲 | 跨頁不中斷的播放器 + echo spot 插播 |
| Visuals  | 浮動幻影 | 圖片投射 + Visual Clue 書籤         |
| Storage  | 便條     | 可拖曳釘選的便條層                  |

> ⚠️ **掛載 ≠ 展開**。島收合時 echo spot 不得直接播放——存成 pending
> 並讓 dock chip 閃爍，等使用者明確展開島才消費。

### 互聯

劇情點（storyKey）與實體（entityKey）把散落在五個區域的錨點串起來。
衍生表 `history_interlink_index` / `interlink_keys` 由內容存檔時重建，
套 migration 後必須跑一次 `pnpm interlink:reindex:*` 補建。

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
├── teatime.astro        # 茶會（靜態，彩蛋）
├── admin/
│   ├── index.astro      # Admin 儀表板
│   ├── login.astro      # 登入頁
│   ├── media.astro      # 媒體庫管理
│   ├── settings.astro   # 設定（key / flag / 進度 / 站台 四分頁）
│   ├── edit/[...slug].astro  # TipTap 編輯器（catch-all）
│   └── homepage/[zone].astro # 首頁內容管理
└── api/                 # 同源 SSR proxy（需授權的 admin 端點必經）
    ├── assets/
    ├── content/[...path].ts
    ├── flags/[...path].ts
    ├── interlink/[...path].ts
    └── settings/[...path].ts
```

> ⚠️ 需要授權的 admin 前端**一定要走同源 SSR proxy**——admin JWT 存在
> httpOnly cookie，瀏覽器端讀不到也組不出 Bearer header，直接打 worker
> 一律 401。只讀公開 GET 的元件才可以直連。

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
    ├── IdentCard.tsx            # 識別證（登入後的吊掛面板）
    ├── OnboardingGate.tsx       # 入站儀式
    └── UepDialogue.tsx          # 對話氣泡
```

進度系統相關模組獨立於 `components/` 之外：

```
src/
├── progress/       # Progress Store、旗標、gating、掃描線、迷霧
├── embed/          # entity/cue 標記的序列化格式與前台啟用層
├── auth/           # 讀者身分（與 admin 完全分離）
├── audio/          # 跨頁音訊 store（提升到 document 層）
├── islands/        # Island Runtime + 五座島 + dock + 互聯觸發
└── devtools/       # UepDevTools（Ctrl+Shift+D）、ScanlineHud
```

> ⚠️ 跨 island 的狀態共享走 `window.__uep*` bridge（沿用 Toast/Dialog
> 模式），**不用 React Context**——浮島與 Reader 不在同一棵 React 樹裡。

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
- `metadata`: JSON 欄位，含圖示、顏色、hidden/locked/spoiler、gate 條件等

各 zone 的葉子 `page_type` 不同：`history/section`、`echoes/song`、
`concepts/type`、`storage/stuff`、`visuals/gallery`
（Concepts 用陣列而非子頁）。

進度系統的表：

| 表                        | 內容                                                       |
| ------------------------- | ---------------------------------------------------------- |
| `uep_users`               | 讀者帳號、代稱、`observer_ever`、進度 blob、`progress_rev` |
| `uep_user_notes`          | 便條（v1.0.0 起從 blob 拆出，PK `(user_id, note_id)`）     |
| `uep_flags`               | 旗標註冊表（自訂旗標未註冊則存檔被擋）                     |
| `interlink_keys`          | 劇情點／實體 key 的說明                                    |
| `history_interlink_index` | 錨點索引（**衍生表**，存檔時重建）                         |
| `uep_settings`            | 站台行為參數（保護三態／便條上限／書籤機率等）             |

> ⚠️ 衍生表不進 `pnpm sync`——同步它只會製造與內容不一致的機會。

### 內容來源

```
U.E.P-s-Imaginary-Space (GitBook)
        ↓ 初次遷移（已歸檔至 scripts/archive/）
    Cloudflare D1
        ↓ content-api Worker
    前端 Reader 元件
```

日常內容變動一律走 `pnpm sync` 增量同步，不要再跑遷移腳本。

## Admin 後台

- **進入路徑：** `/admin`（JWT 驗證保護）
- **編輯器：** TipTap 富文字，各 Zone 有專屬 EditorBody
- **媒體庫：** R2 儲存，支援圖片上傳、搜尋、批次管理
- **首頁管理：** 各 Zone 首頁區塊的內容編輯
- **設定（`/admin/settings`）：** 四分頁
  - **key** — 劇情點／實體 key 的說明與巡查
  - **flag** — 旗標註冊表，四態使用狀態
  - **進度** — History 全樹的進度頁總覽，可就地切換標記
  - **站台** — 保護模式、便條上限、書籤機率等行為參數
- **editorModeRegistry：** 依 Zone 動態載入不同 EditorBody

> 站台參數的生效時機是「**下一次頁面載入**」，不是即時——這是明文契約，
> 前台用 sessionStorage 快取以避免每頁重取。

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
pnpm db:migrate:local

# 補建互聯衍生表（套完 migration 一定要跑一次）
pnpm interlink:reindex:local

# 內容用增量同步取得，不跑遷移腳本
pnpm sync:pull
```

### 環境變數

| 變數                     | 說明             | 預設值                  |
| ------------------------ | ---------------- | ----------------------- |
| `PUBLIC_CONTENT_API_URL` | Content API 位址 | `http://localhost:8788` |
| `PUBLIC_VISITOR_API_URL` | 訪客計數 API     | `http://localhost:8787` |

正式環境在 Cloudflare Pages 設定：`PUBLIC_CONTENT_API_URL=https://eternity-content-api.ptyc4076.workers.dev`

### 測試環境

獨立的 test worker + test D1 + test R2，讓 admin 編輯與 Reader 驗證可以
安全操作而不污染正式資料。切換方式（三擇一）：

1. `/admin` dashboard 的 `AdminTestModeControl`
2. DevTools（`Ctrl+Shift+D`）內的對應 action
3. 手動設 cookie：`uep-test-api-url=https://eternity-content-api-test.ptyc4076.workers.dev`

cookie 存在時每個 layout 頂端會出現 TEST MODE banner。

> ⚠️ test D1 的 `admin_users` 是空的——CLI 腳本的登入對象永遠是**正式
> worker**，兩邊共用 `JWT_SECRET`，正式簽發的 JWT 打 test worker 由本地
> `verifyJwt` 驗過。

### 字型

Noto Serif TC 走**自架子集化**，分三層（core / content / lazy）依
`unicode-range` 按頁下載。產出與重跑方式見
`scripts/build-font-subsets.mjs` 與 `scripts/scan-used-chars.mjs`。

> ⚠️ 三個踩過的坑，改動前務必先讀 `DesignLayout.astro` 的字型註解：
> 400／600 兩個字重都要留（缺字重的合成偽粗體視覺不可接受）、
> `font-display` 維持 `swap`、**字型 CSS 絕不可加 `rel="preload"`**。

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
│   ├── progress/       # 進度系統核心
│   ├── embed/          # 互動式嵌入
│   ├── islands/        # 浮島系統
│   ├── auth/           # 讀者身分
│   ├── audio/          # 跨頁音訊
│   ├── devtools/       # 開發者工具
│   ├── data/           # 靜態資料（zone 定義等）
│   └── styles/         # 全域樣式
├── public/
│   └── fonts/noto-serif-tc/  # 自架字型子集（建置產物）
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
- **`UepToastContainer` / `UepDialogContainer` / `GlobalWelcomeHost` 必須
  `client:load`，不可改 `client:idle`**——`requestIdleCallback` 在主執行緒
  持續繁忙時可以無限期不觸發，而互動層一定更早到。三者必須同進退
- **浮島與條件出現的 UI 用 `?inline` + `useDeferredStyle` 延後注入樣式**：
  Astro 會把 client island 依賴樹裡的所有 CSS 提為 route `<link>`，
  包含 `React.lazy` 的子元件——JS 懶載了 CSS 卻沒有。首屏常駐的元件
  （OnboardingGate / Minimap / JourneyNav / ZoneAtmosphere）**不適用**，
  延後注入只會換來一幀無樣式
