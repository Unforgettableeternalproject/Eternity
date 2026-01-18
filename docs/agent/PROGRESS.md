# 專案進度追蹤

## 最近更新 (2026-01-18)

### ✅ 已完成

- **專案詳情頁圖片查看器模態視窗** (NEW - 2026-01-18)
  - 創建 React Portal 組件 `ImageViewerModal`
  - 使用 `createPortal` 渲染到 document.body，覆蓋整個頁面（包括導航欄、側邊欄、Footer）
  - 全局單一實例設計，避免多個模態視窗同時開啟
  - **功能特性**：
    * 縮放控制：0.5x - 3x（按鈕控制 ±0.25，滾輪控制 ±0.1）
    * 拖曳移動：縮放>1時可拖曳圖片
    * 鍵盤快捷鍵：ESC（關閉）、+/-（縮放）、R（重置）
    * 點擊 backdrop 關閉
  - **視覺設計**：
    * Glassmorphism（玻璃擬態）美學
    * 85% 不透明度黑色背景 + 12px 模糊
    * 頂部控制條：半透明圓角，含縮放按鈕、縮放百分比、重置、關閉
    * 圖片容器：玻璃效果，漸層背景，白色半透明邊框
    * 底部標題：圓角半透明背景
  - **動畫效果**：
    * 開啟：fadeIn (0.2s) + scaleIn (0.3s, cubic-bezier bounce)
    * 關閉：fadeOut (0.2s) + scaleOut (0.2s)
  - **響應式設計**：手機版調整控制條排版和圖片尺寸
  - **技術整合**：
    * 全局監聽 `openImageModal` 自定義事件
    * MarkdocImage 點擊觸發事件傳遞圖片資訊
    * 整合至 BaseLayout（唯一實例）

- **專案內容 Markdoc 圖片支援** (2026-01-18)
  - 配置 Keystatic markdoc 欄位支援圖片上傳
  - 圖片目錄：`public/images/projects/`
  - 創建 `markdoc.config.mjs` 自定義圖片渲染
  - 創建 `MarkdocImage.astro` 組件處理圖片優化
  - 使用 `import.meta.glob` 載入圖片資源
  - 圖片優化（Astro Image 組件）+ 點擊放大功能
  - 懸停效果：縮放 1.05 + 放大鏡圖標

- **專案「暫時停滯」狀態** (2026-01-18)
  - Schema 新增 `paused` 狀態（active/paused/completed/archived）
  - 所有專案詳情頁顯示暫停狀態（黃色徽章）
  - 專案列表頁新增暫停狀態篩選按鈕
  - 排序邏輯調整：狀態優先級（active > completed > paused > archived）→ 日期（新→舊）→ Order
  - 卡片樣式：暫停狀態使用黃色配色（bg-yellow-100/900, text-yellow-700/300）

- **首頁專案卡片優化** (2026-01-18)
  - 移除卡片正面的敘述（避免重複，翻面才顯示）
  - 卡片背面敘述限制為 6 行（line-clamp-6）
  - 專案圖片改為正方形（aspect-square, 160x160）使用 object-cover
  - View Details 連結固定在卡片左下角（使用 mt-auto）

- **專案內容動態載入修復** (2026-01-18)
  - 從 Astro.glob 改用 dynamic import
  - 使用 title_zh/title_en 匹配專案資料夾名稱（而非格式化的 project.id）
  - 支援中文和特殊字元的資料夾名稱
  - 完整錯誤處理和 fallback 機制

## 最近更新 (2026-01-14)

### ✅ 已完成

- **關於我頁面 - 打字機特效與 HTML 支援** (NEW - 2026-01-14)
  - 創建 `AboutBioTypewriter` 元件，支援打字機特效
  - **首次載入特效**：使用 localStorage 永久記錄，只在第一次訪問時播放
  - **HTML 格式支援**：fullBio 支援 HTML 標籤（`<strong>`, `<em>`, `<span style="color:#xxx">`）
  - 打字音效：每 5 個字元播放一次，音量 0.2（避免太吵）
  - 打字速度：20ms/字元，延遲 300ms 開始
  - 使用 `dangerouslySetInnerHTML` 渲染 HTML 內容
  - 整合 prose 樣式（`prose prose-lg dark:prose-invert`）

- **關於我頁面改進** (2026-01-14)
  - 添加 `fullBio` 欄位用於完整自我介紹
  - `bio` 保留作為簡短介紹（顯示在頁面標題下方）
  - `fullBio` 用於主要內容區（支援多行文字，`whitespace-pre-line`）
  - 向下相容：如果 `fullBio` 為空，自動使用 `bio`
  - 更新 Schema（content.config.ts 和 config.ts）
  - 更新 Keystatic 配置（繁中和英文）

- **搜尋欄手機版優化** (2026-01-14)
  - 移除手機版搜尋按鈕上的 `⌘K` 快捷鍵提示
  - 移除手機版模態框底部的鍵盤操作說明（`↑↓` `Enter` `Esc`）
  - 使用 CSS media query（≤640px）隱藏，避免觸控裝置看到無用的電腦操作提示

- **本日名言每日更新** (NEW - 2026-01-14)
  - 改用基於日期種子的隨機算法
  - 同一天所有用戶看到相同名言
  - 每天午夜自動更換（無需手動觸發）
  - 確定性隨機（相同日期永遠得到相同結果）

- **音樂播放器 Toast 整合** (2026-01-14)
  - 播放/暫停操作顯示 Toast 提示（⏸️ 音樂已暫停 / ▶️ 正在播放）
  - 切換曲目顯示歌曲名稱和演唱者（🎵 歌名 - 歌手）
  - 完整中英文支援
  - 使用 `info` 類型（播放控制）和 `success` 類型（切換曲目）

- **Resend 郵件服務整合** (2026-01-14)
  - 從 MailChannels 切換到 Resend（免費 3000 emails/月）
  - Resend API 測試成功（Email ID: ff757d17-0d57-4594-b8e6-1a5143a0a372）
  - DNS 記錄設置並驗證（DKIM, SPF, DMARC）
  - Cloudflare Pages 環境變數雙重訪問機制（runtime.env + import.meta.env）
  - TypeScript 類型定義（App.Locals.runtime）
  - 創建 debug-env.json.ts 除錯 API
  - 本地環境測試通過
  - CI 測試全部通過（Lint, Typecheck, Format, Build）
  - **待辦**: Cloudflare Pages 設置 RESEND_API_KEY 環境變數後測試

- **聯絡頁面與視覺優化** (2026-01-13)
  - **聯絡頁面實作**:
    - 左右分佈設計（社群連結 + 聯絡表單）
    - 社群平台簡潔條列式設計（hover 顯示背景色）
    - 整合 Cloudflare MailChannels 免費郵件服務
    - Toast 通知系統整合（移除內建訊息框）
  - **全站幾何裝飾**:
    - 主頁、關於、專案、聯絡頁面添加幾何圖形輪廓
    - 6px 粗邊框，50-60% 透明度，固定定位
    - 圓形、方形、旋轉圖形混搭，增加視覺豐富度
  - **Footer 更新**: Bernie 連結改為聯絡頁面連結
  - **程式碼清理**: 
    - 移除 ConsoleEasterEgg 和 UEPCharacter 的 console.log
    - 修正 ThemeToggle.astro 的 JSX 註解格式錯誤
  - **i18n 支援**: 完整繁中/英文翻譯（社群平台、表單欄位、提示訊息）
  - **CI/CD 驗證**: ✅ Lint (0 errors) / ✅ TypeCheck (0 errors) / ✅ Format / ✅ Build
  - **狀態**: 準備部署至 staging 環境

- **CI/CD Pipeline 修復** (2026-01-12晚)
  - **ESLint 配置增強**: 添加完整的全域變數宣告（Audio, localStorage, setTimeout, React, HTMLDivElement, fetch, URL 等）
  - **TypeScript 錯誤修復**: 
    - MusicPlayer tracks 加入類型守衛過濾
    - about.astro 使用類型斷言處理動態 schema
    - 修正 slug 引用改為 id
    - 動態路由的 mod.file 可選鏈保護
  - **Prettier 格式化**:
    - HTML 註解改為 JSX 註解（`{/* */}`）
    - 創建 .prettierignore 排除自動產生檔案
  - **Build 配置修復**:
    - 安裝 @astrojs/cloudflare adapter
    - 移除未使用的 API 路由 (search.json.ts)
    - 配置 output: 'static' + adapter: cloudflare()
  - **結果**: lint (0 errors, 39 warnings) ✅ / typecheck (0 errors) ✅ / format ✅ / build ✅

### ✅ 已完成

- **音樂播放器 Cookie 整合與音量持久化**（NEW）
  - Cookie consent 觸發音樂自動播放（繞過瀏覽器限制）
  - 音量和曲目選擇僅在接受 Cookie 後儲存
  - 修復音量持久化問題：
    - 相容 `globalMusicPlayerState` JSON 格式（包含 volume、isPlaying、currentTrack、currentTime）
    - 同時支援獨立 `music-volume` key
    - 讀取優先順序：globalMusicPlayerState.volume → music-volume → 預設 0.5
    - 儲存時同步更新兩種格式
  - 添加 `cookie-consent-changed` 事件監聽，當使用者接受 Cookie 時重新載入設定
  - 使用 sessionStorage 避免重複自動播放

- **U.E.P 角色互動系統**（NEW - 完整實作）
  - **三種出現模式**（加權隨機）：
    - Corner Mode (25%): 右下角固定，Fence.PNG ↔ Poke.PNG hover 切換
    - Peek Mode (45%): 在特定元素探頭，Peek.png + wiggle 動畫
    - Float Mode (30%): 隨機浮動，Lil.PNG，每 5-10 秒自動移動
  - **雙重觸發系統**：
    - 使用者活動：mousemove/keydown/scroll/touchstart，5% 概率
    - 首頁載入：astro:page-load，25% 概率
  - **狀態管理**：
    - 顯示時間 8 秒，冷卻時間 30 秒
    - sessionStorage 記憶（同一會話不重複觸發）
  - **動畫效果**：
    - 淡入/淡出動畫（600ms，scale + translateY）
    - Corner hover：0.1s 延遲後放大（先切換圖片再動畫）
    - Peek wiggle：旋轉搖擺
    - Float bob：上下浮動 + 自動位置移動（hover 時暫停）
  - **響應式設計**：
    - Desktop: Corner 140px, Float 90px, Peek 85px
    - Mobile: 適當縮小尺寸
    - 支援 prefers-reduced-motion
  - **Hover 提示框**：漸變背景 + 引導文字
  - Debug 模式：開發時可設定 100% 觸發機率

- **TypewriterText 打字音效**（NEW）
  - 每個字元播放 `/se/type.wav` 音效（音量 0.3）
  - 自動重置 currentTime 確保快速連續播放

- **View Transitions 相容性修復**
  - FlipCard：添加 `astro:page-load` 事件監聽
  - Reveal 動畫：添加 `astro:page-load` 支援
  - 使用 `data-initialized` flag 避免重複綁定事件
  - 移除巢狀 `transition:persist`（僅保留必要元素）

- **視覺細節優化**
  - 首頁標題文字裁切修復：添加 pb-2 和 pb-1 padding，避免 y 等字元下緣被截斷
  - i18n badge 文字更新：「歡迎來到我的數位空間」→「一個尚未完成的故事」（繁中/英文）

- **Keystatic 側邊欄卡片管理系統**
  - 每個卡片都是獨立的 singleton：
    - 💬 名言卡片 (card-quote) - 支援繁中/英文名言陣列，隨機選擇顯示
    - 🎵 音樂播放器 (card-music) - 歌曲清單管理
    - 👥 訪客計數器 (card-visitor-counter) - 啟用/排序/位置控制
    - 📢 最新動態 (card-latest-update) - 啟用/排序/位置控制
  - 所有卡片都有：啟用狀態、排序順序、位置（左/右側邊欄）
  - Quote 卡片：中英文名言陣列，每條名言可選填作者
  - Music 卡片：歌曲清單（標題、演唱者、音檔路徑、封面圖）
  - LeftSidebar.astro 整合 Keystatic 資料，隨機選擇名言

- **連結頁面細節優化**
  - 精選連結淡入動畫（100ms delay）
  - 查詢欄預設顯示全部內容（限制8個結果）
  - 彩蛋按鈕淡入淡出效果（0.8s fade-in）
  - 移除底部漸變陰影，增加底部內距避免與 footer 交界問題

- **側邊欄拖曳排序系統**
  - 透明卡片設計（融入背景）
  - 拖曳把手（⋮⋮ Unicode 符號）
  - 平滑動畫（所有卡片響應拖曳）
  - 訪客計數器（僅主頁不重複訪客）
  - 開發環境重置按鈕（使用 envConfig.showDevTools）
  - 音樂播放器、最新更新、本日名言卡片

- **互動效果整合**
  - TypewriterText 打字機效果整合到主頁
    - 標題：80ms 延遲 300ms
    - 名字：100ms 延遲 1200ms（漸變色）
    - 副標題：40ms 延遲 2000ms（無游標）
    - 使用 sessionStorage 避免重複播放
  - RippleEffect 點擊漣漪效果
    - 主頁 CTA 按鈕添加漣漪效果
    - 自定義顏色配置

- **Markdoc 內容渲染系統**
  - 修復 MDOC 內容載入邏輯（簡化為直接使用 `contentModules[0]`）
  - 為內容區域添加淡入動畫（800ms duration）
  - 修復淡入動畫初始狀態（添加 `opacity: 0`）
  - 移除調試代碼

- **語言切換功能修復**（2 處修復）
  - 修復 LanguageSwitch.astro 路徑轉換邏輯
  - 修復 NavigationWithSearch.astro 硬編碼路徑問題
  - 現在切換語言時會保持當前頁面，只改變語言前綴
  - 例如：`/zh-tw/projects/測試` ↔ `/en/projects/測試`

- **FlipCard 3D 卡片系統**
  - Astro 版本實現（使用 slots）
  - 正面：標題、副標題、狀態標籤、tags
  - 背面：封面圖（小圖）、內容摘要、查看詳情連結
- **視覺優化**
  - 封面圖調整為 128x128px 縮圖，放置於標題右側
  - 內容摘要系統（`getExcerpt()` 函數）

### ⏳ 進行中

- **測試環境回饋修復** (2026-01-14)
  - **響應式問題**:
    - [x] 聯絡頁面缺少響應式處理（已優化 padding、grid、標題大小）
    - [x] 搜尋欄在窄螢幕（≤320px）定位問題（margin 導致）
    - [x] 導航欄按鈕在窄螢幕溢出（out of bounds）
    - [x] 搜尋窗格 Tag 內容過多時被擠壓，文字超出容器
  - **搜尋功能優化**:
    - [x] 移除頁面類型搜尋結果（主頁、專案頁等）
    - [x] 只保留物件搜尋（專案、更新、連結等實際內容）
  - **郵件服務升級**:
    - [x] 從 MailChannels 切換到 Resend（免費 3000 emails/月）
    - [x] Resend API 測試成功（Email ID: ff757d17-0d57-4594-b8e6-1a5143a0a372）
    - [x] DNS 記錄設置並驗證（DKIM, SPF, DMARC）
    - [x] Cloudflare Pages 環境變數雙重訪問機制（runtime.env + import.meta.env）
    - [x] TypeScript 類型定義（App.Locals.runtime）
    - [x] 創建 debug-env.json.ts 除錯 API
    - [x] 本地環境測試通過
    - [x] Cloudflare Pages 設置 RESEND_API_KEY 環境變數（Production + Preview）
    - [x] 測試機郵件功能驗證
  - **Toast 整合擴展**:
    - [x] 音樂播放器操作添加 Toast 提示（播放、暫停、切換曲目）
    - [ ] 其他用戶互動添加 Toast 反饋（如需要）
  - **小螢幕適配**:
    - [ ] 針對極窄螢幕（320px，如 Samsung Galaxy S9+）優化排版
    - [ ] 檢查所有主要頁面在小螢幕的表現

### 📋 待處理

- 將 RippleEffect 應用到更多可點擊元素
- UEP 文件站內容遷移（從 U.E.P-s-Imaginary-Space）
- Console 頁面特殊指令實作
- 訂閱制度設計

---

## 🎭 U.E.P 角色互動系統實作計畫

### 目標

讓 U.E.P 角色隨機出現在主站，宣傳文件站，符合世界觀設定（觀察者、故事分享者）

### 素材資源

- `apps/root/public/uep/Fence.PNG` - 圍欄姿勢
- `apps/root/public/uep/Poke.PNG` - 戳戳姿勢
- `apps/root/public/uep/Peek.png` - 偷看姿勢
- `apps/root/public/uep/Lil.PNG` - 小型浮動姿勢

### 出現方式（三選一）

1. **Corner Mode (25%)**: 右下角固定，Fence.png ↔ Poke.png 切換
2. **Peek Mode (45%)**: 在特定元素上探頭（主頁浮動框/關於頭像/側邊欄卡片）
3. **Float Mode (30%)**: 隨機浮動，每 5-10 秒移動

### 觸發條件

- **使用者操作**: mousemove/keydown/scroll/touchstart，5% 概率，30秒冷卻
- **首頁載入**: astro:page-load，25% 概率，sessionStorage 記憶

### 實作步驟

- [ ] 建立 UEPCharacter.tsx 基礎框架
- [ ] 實作觸發系統（操作 + 首頁載入）
- [ ] 實作 Corner Mode
- [ ] 實作 Float Mode
- [ ] 實作 Peek Mode
- [ ] 整合到 BaseLayout
- [ ] 響應式優化與無障礙支援

### 🐛 已知問題

- Astro.glob 已棄用警告（建議改用 import.meta.glob）
- TypeScript 類型錯誤（既有問題，不影響運行）

### 🔧 技術細節備註

#### localStorage 儲存格式

- **Cookie Consent**: `cookie-consent` = 'accepted' | 'declined'
- **音樂播放器狀態**（相容兩種格式）：
  - `globalMusicPlayerState` = `{"isPlaying":boolean,"currentTrack":number,"volume":number,"currentTime":number}`
  - `music-volume` = 數字字串（0-1）
  - `music-current-track` = 數字字串（track index）
- **sessionStorage**: `music-has-played`, `uep-shown`, `typewriter-shown-[text]`, `visitor-tracked`

#### 自訂事件系統

- `cookie-consent-changed`: Cookie 同意狀態改變時觸發
- `cookie-accepted-play-music`: 使用者接受 Cookie 時觸發音樂播放

#### U.E.P 角色配置

- 生產環境：USER_ACTION_CHANCE=5%, PAGE_LOAD_CHANCE=25%, IDLE_TIME=10s
- Debug 模式：所有機率=100%, IDLE_TIME=2s
- 顯示時間：8s，冷卻時間：30s

---

**上次更新**: 2026-01-14
**狀態**: 
- ✅ Resend 郵件服務整合完成（本地測試通過，DNS 已驗證）
- ⏳ 等待 Cloudflare Pages 環境變數設置後進行測試機驗證
- 📋 準備開始下一階段開發（響應式優化 + 搜尋功能改進）
