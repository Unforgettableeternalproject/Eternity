# @uep/root — 主站

> Bernie 的個人網站。Quartz 設計系統，內容全部來自 D1 API。

主站是 Eternity monorepo 的門面，展示作品集、專案動態、連結與聯絡方式。v0.9.8 從 Keystatic CMS 全面遷移至 Content API D1 後端，並以 Quartz 設計語言重新設計所有頁面。

- **線上版本：** [unforgettableeternalproject.com](https://unforgettableeternalproject.com)
- **本地開發：** `http://localhost:4320`

## Quartz 設計系統

以 **Quartz** 為設計語言——JetBrains Mono 等寬字體、navy/coral/ink 色彩系統、極簡邊框與分隔線、靜謐的紙質質感。

### 色彩系統

| Token            | 用途                           |
| ---------------- | ------------------------------ |
| `--quartz-navy`  | 主色調（深色背景、標題）       |
| `--quartz-coral` | 強調色（連結、按鈕、互動元素） |
| `--quartz-ink`   | 文字色                         |
| `--quartz-paper` | 背景色（淺色主題）             |

### 暗色模式

- `data-theme` 屬性切換
- `color-normalize.ts` — SSR 端將 TipTap 硬編碼的 RGB/hex 色值替換為 CSS variable
- ThemeToggle 對角線切割動畫

## 頁面架構

| 路徑               | 頁面     | 輸出模式 | 說明                                                    |
| ------------------ | -------- | -------- | ------------------------------------------------------- |
| `/`                | 首頁     | SSR      | Hero + Stats Bar + Selected Work + About 預覽 + Updates |
| `/about`           | 關於     | 靜態     | Bio / Skills / Experience / Currently 面板              |
| `/projects`        | 作品集   | SSR      | 篩選器（Status + Tag 雙維度）+ 封面圖                   |
| `/projects/[slug]` | 專案詳情 | SSR      | TipTap 富文字內容 + StickyTOC                           |
| `/updates`         | 動態     | SSR      | 時間軸列表                                              |
| `/updates/[slug]`  | 動態詳情 | SSR      | TipTap 富文字內容                                       |
| `/links`           | 連結     | SSR      | 分類分組 + JUMP TO + status 視覺效果                    |
| `/contact`         | 聯絡     | 靜態     | TipTap 富文字輸入 + Resend 發送                         |
| `/console`         | Console  | 靜態     | CRT 風格彩蛋                                            |
| `/admin`           | 後台     | SSR      | 三欄 TipTap 編輯器                                      |
| `/en/*`            | 英文版   | —        | Astro i18n 自動產生                                     |

## 資料層

### Content API（共用 Worker, port 8788）

主站內容由 `content-api` Worker 提供，使用 D1 儲存。v0.9.8 後不再使用 Keystatic。

#### D1 表格

| 表格                  | 用途                                                       |
| --------------------- | ---------------------------------------------------------- |
| `root_projects`       | 專案作品（title, slug, tags, status, featured, content）   |
| `root_links`          | 連結（url, category, status, icon）                        |
| `root_updates`        | 動態文章（title, content, category, date）                 |
| `root_singletons`     | 單一內容（about, contact, homepage, currently, page-text） |
| `root_cards`          | 卡片內容（widget 等）                                      |
| `root_deleted_assets` | R2 刪除追蹤（同步用）                                      |

#### 主要 API 端點

| 方法            | 端點                        | 說明         |
| --------------- | --------------------------- | ------------ |
| GET/PUT         | `/api/root/projects`        | 專案 CRUD    |
| GET/PUT         | `/api/root/links`           | 連結 CRUD    |
| GET/PUT         | `/api/root/updates`         | 動態 CRUD    |
| GET/PUT         | `/api/root/singletons/:key` | 單一內容讀寫 |
| GET/PUT         | `/api/root/cards/:key`      | 卡片內容讀寫 |
| GET/POST/DELETE | `/api/root/assets/*`        | R2 資產管理  |

### 統一 API 層

`src/lib/api.ts` 封裝所有 D1 API 呼叫：

```typescript
import { getProjects, getSingleton, assetUrl } from '../lib/api';

// 取得專案列表
const projects = await getProjects(locale);

// 取得單一內容
const about = await getSingleton('about', locale);

// 資產 URL
const imageUrl = assetUrl('images/projects/xxx/cover.png');
```

### 獨立 R2 Bucket

`eternity-root-assets`（binding: `ROOT_ASSETS_BUCKET`），與文件站的 `eternity-assets` 完全隔離。

#### 資產路徑規範

- **D1 image 欄位**：裸 R2 key（`images/projects/xxx/image.png`）
- **TipTap content HTML**：相對路徑（`/api/root/assets/images/...`）
- **前端渲染**：用 `assetUrl(key)` 轉換

## Admin 後台編輯器

### 架構

三欄 layout：**Entry List**（左）| **TipTap 編輯區**（中）| **Inspector**（右）

### 頁面編輯器

| 編號 | 頁面     | 元件               | 說明                               |
| ---- | -------- | ------------------ | ---------------------------------- |
| 00   | 頁面文字 | `PageTextEditor`   | 各頁面 hero 標題、副標題等         |
| 01   | 關於     | `AboutEditor`      | About 雙語內容 + Currently 面板    |
| 02   | 作品     | `RootEditor`       | Projects CRUD + TipTap             |
| 03   | 動態     | `RootEditor`       | Updates CRUD + TipTap              |
| 04   | 連結     | `RootEditor`       | Links CRUD                         |
| 05   | 聯絡     | `ContactEditor`    | Contact 雙語內容                   |
| 06   | 媒體庫   | `RootMediaLibrary` | R2 資產管理（grid/搜尋/上傳/刪除） |
| 07   | 小工具   | `WidgetEditor`     | Widget 卡片編輯                    |

### 共用元件

- **`ImagePickerDialog`** — TipTap 圖片選擇器，嵌入媒體庫 picker 模式
- **`editorPrimitives`** — Mono, Divider, Field, Input, Select, Toggle, TagEditor, OutlineRow

### 認證

- JWT cookie（`root-admin-jwt`）
- `middleware.ts` 攔截 `/admin/**`
- 開發模式自動跳過登入

## 互動元件

### 可拖曳卡片

`data-draggable-card` 屬性即可啟用：

- 不限範圍拖曳 → 慣性滑行 → spring 彈回
- 左右晃動噴射粒子
- 雙擊復位

### Widget 系統

`QuartzWidgetSystem.tsx` — 右側邊欄 widget 管理系統，`WidgetDataProvider.astro` SSR 端統一取得資料。

8 個 widget：DailyQuote、LatestUpdate、MusicPlayer、Portal、QuickStats、Status、UEP、VisitorCounter

### 其他

- **GlobalSearch** — `⌘K` 全站搜尋
- **StickyTOC** — 頁面右側固定目錄導覽
- **ThemeToggle** — 對角線切割主題切換動畫
- **ImageViewerModal** — 圖片全螢幕檢視，支援拖曳與縮放
- **ConsoleEasterEgg** — CRT 風格 Console 頁面

## 多語言 (i18n)

- 語言：`zh-tw`（預設）、`en`
- 路徑策略：pathname（`/en/about`）
- Astro i18n 自動產生英文版路由

## 本地開發

### 啟動順序

```bash
# 1. 啟動 content-api Worker（必須先起）
pnpm --filter content-api-worker dev

# 2. 啟動主站
pnpm --filter @uep/root dev
```

> content-api Worker 必須在運行中，否則頁面無法載入內容。

### 環境變數

| 變數                     | 說明                 | 預設值                  |
| ------------------------ | -------------------- | ----------------------- |
| `PUBLIC_CONTENT_API_URL` | Content API 位址     | `http://localhost:8788` |
| `PUBLIC_VISITOR_API_URL` | 訪客計數 API         | `http://localhost:8787` |
| `RESEND_API_KEY`         | Resend 郵件 API 金鑰 | —                       |

### 建置

```bash
# 型別檢查 + 建置
pnpm --filter @uep/root build

# 預覽建置結果
pnpm --filter @uep/root preview
```

## 目錄結構

```
apps/root/
├── src/
│   ├── components/
│   │   ├── editor/            # Admin 後台編輯器
│   │   │   ├── RootEditor.tsx         # 通用集合編輯器
│   │   │   ├── AboutEditor.tsx        # About 頁編輯器
│   │   │   ├── ContactEditor.tsx      # Contact 頁編輯器
│   │   │   ├── PageTextEditor.tsx     # 頁面文字編輯器
│   │   │   ├── WidgetEditor.tsx       # Widget 編輯器
│   │   │   ├── RootMediaLibrary.tsx   # 媒體庫
│   │   │   ├── ImagePickerDialog.tsx  # 圖片選擇器
│   │   │   └── editorPrimitives.tsx   # 共用基礎元件
│   │   ├── widgets/           # 側邊欄 Widget 元件
│   │   ├── NavigationWithSearch.astro # 頂部導覽列
│   │   ├── QuartzFooter.astro         # Footer
│   │   ├── QuartzWidgetSystem.tsx     # Widget 系統
│   │   ├── GlobalSearch.tsx           # 全站搜尋
│   │   ├── StickyTOC.css/.tsx         # 固定目錄
│   │   ├── ImageViewerModal.tsx       # 圖片檢視器
│   │   ├── ContactForm.tsx            # 聯絡表單
│   │   ├── MusicPlayer.tsx            # 音樂播放器
│   │   └── ConsoleEasterEgg.tsx       # Console 彩蛋
│   ├── pages/
│   │   ├── index.astro        # 首頁
│   │   ├── about.astro        # 關於
│   │   ├── projects.astro     # 作品集
│   │   ├── projects/[slug].astro  # 專案詳情
│   │   ├── updates.astro      # 動態
│   │   ├── updates/[slug].astro   # 動態詳情
│   │   ├── links.astro        # 連結
│   │   ├── contact.astro      # 聯絡
│   │   ├── console.astro      # Console
│   │   ├── admin/             # 後台路由
│   │   ├── api/               # API routes
│   │   ├── en/                # 英文版
│   │   └── zh-tw/             # 中文版
│   ├── layouts/               # Layout 元件
│   ├── lib/                   # 工具函式
│   │   ├── api.ts             # D1 API 統一存取層
│   │   ├── color-normalize.ts # 暗色模式色彩正規化
│   │   ├── version.ts         # 動態版本號
│   │   └── widgetState.ts     # Widget 狀態管理
│   ├── i18n/                  # 多語言翻譯
│   └── styles/                # 全域樣式
├── public/                    # 靜態資源
├── astro.config.mjs           # Astro 設定（static + cloudflare adapter）
├── tailwind.config.mjs        # Tailwind 設定
├── tsconfig.json              # TypeScript 設定
└── package.json
```

## 注意事項

- 所有頁面版本號從 `package.json` 讀取（Vite `define`），bump 只需改一處
- `apiFetch` 有 inflight cache（`_inflightCache`），注意 `finally` 中的 `delete` 行為
- `color-normalize.ts` 在 SSR 端處理，確保暗色模式下 TipTap 內容顯示正確
- Windows 環境下 `pnpm typecheck` 可能遇到 Vite cache `EPERM` 錯誤，是檔案系統快取噪音
