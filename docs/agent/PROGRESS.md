# 專案進度追蹤

## 最近更新 (2026-01-20)

### ✅ 已完成

- **UEP 文件站區域頁面導航改進** (NEW - 2026-01-20 深夜)
  - **移除重複內容**:
    * echos.astro, visuals.astro, concepts.astro, storage.astro 清理
    * 移除重複的 HTML 結構（舊版實作殘留）
    * 現在只保留 BaseLayout + AreaPage 元件
  - **可收縮樹狀導航實現**:
    * 將頁面重新組織成樹狀結構（buildTree 函數）
    * Level 0 頂層項目有子項時顯示展開/收合按鈕（▼/▶）
    * 點擊箭頭展開/收合子項目
    * 子項目淡入淡出 + max-height 動畫（300ms ease）
    * 收合時箭頭旋轉 -90deg
  - **視覺設計優化**:
    * 更緊湊的導航設計（縮小字體和間距）
    * 子項目背景略深（rgba(0, 0, 0, 0.15)）
    * 子項目左側縮排 2.5rem（與展開按鈕寬度一致）
    * 展開按鈕金色，hover 時縮放 1.2 倍
    * 所有項目保持原有 hover 效果（背景、邊框、箭頭）
  - **JavaScript 互動**:
    * astro:page-load 後綁定所有 collapse-toggle 按鈕
    * 點擊時切換 aria-expanded 屬性
    * 動態設定 maxHeight（展開時根據 scrollHeight）
    * 防止事件冒泡（stopPropagation）
  - **響應式設計**:
    * 手機版調整按鈕和子項目邊距
    * 較小的字體和圖標尺寸
    * 建構測試：0 errors

- **UEP 文件站三層內容渲染架構** (NEW - 2026-01-20 深夜)
  - **設計概念**:
    * Layer 1: 原始文檔（來自子模組，永遠不會被改動）
    * Layer 2: 二次設計層（隔離文字區段和排版，無需修改原始文件）
    * Layer 3: 額外元件層（音樂播放器、附件、自定義元件）
  - **內容渲染工具** (`src/utils/content-renderer.ts`):
    * `parseMarkdownToSections()` - 將 Markdown 按空行切割成區段
    * `parseLineToBlock()` - 解析各種內容塊（標題、程式碼、引用、圖片、文字）
    * `applyAreaStyle()` - 套用區域特定樣式（narrative/gallery/documentation/showcase/casual）
  - **ContentRenderer 元件** (`src/components/ContentRenderer.astro`):
    * 三層架構實現：前置元件 → 內容區段 → 後置元件 + 浮動元件
    * 區段插入點（beforeInsert/afterInsert），可在不修改原文的情況下加入內容
    * 支援 6 種內容塊：text, heading, code, quote, image, divider
    * 間距控制：compact/normal/relaxed
    * 多欄佈局：1/2/3 columns
  - **區域樣式配置**:
    * history - narrative 風格，relaxed 間距
    * echos - gallery 風格，2 欄佈局
    * concepts - documentation 風格，compact 間距
    * visuals - showcase 風格，3 欄佈局
    * storage - casual 風格，normal 間距
  - **[...slug].astro 整合**:
    * 使用 `parseMarkdownToSections()` 取代 `markdownToHtml()`
    * 自動套用區域樣式（根據 areaId）
    * 傳遞 sections, layout, components 給 ContentRenderer
  - **技術特點**:
    * 原始 Markdown 的空行現在成為區段分隔符，可用於靈活排版
    * 未來可插入音樂播放器、附件下載等元件，無需修改子模組內容
    * 每個區域可以有不同的視覺風格和佈局方式
  - **建構測試**:
    * 156 頁面成功生成（0 errors）
    * TypeScript 檢查通過（0 errors）
    * 新渲染系統正常運作

- **UEP 文件站導航層級視覺化** (2026-01-20 深夜)
  - **層級顯示系統**:
    * 層級縮排（level * 2rem）
    * 層級專屬圖標（📄 📃 📝 📋）
    * 層級專屬邊框顏色（opacity: 100% → 60% → 40% → 20%）
  - **區域頁面更新**:
    * AreaPage.astro 新增 `level` 支援
    * 從 grid 改為 flex-column 以顯示層級結構
    * 修復連結顏色繼承問題（避免全部變藍）
  - **所有區域頁面適配**:
    * history.astro, echos.astro, visuals.astro, concepts.astro, storage.astro
    * 傳遞 `level` 資訊至 AreaPage 元件
  - **視覺效果**:
    * 清楚展示父子關係
    * Hover 時主題色高亮
    * 白色文字，避免藍色連結問題

### ✅ 已完成

- **UEP 文件站 Markdown 完整渲染系統** (NEW - 2026-01-20 深夜)
  - **Markdown 處理工具** (`src/utils/markdown.ts`):
    * `parseFrontmatter()` - 解析並移除 frontmatter
    * `markdownToHtml()` - 將 Markdown 轉換為 HTML
    * 使用 unified + remark + rehype 處理鏈
    * 支援 GitHub Flavored Markdown (GFM)
    * 自動生成標題 ID (rehype-slug)
    * 自動連結標題 (rehype-autolink-headings)
  - **套件安裝**:
    * unified ^11.0.5 - 統一的文本處理框架
    * remark-parse ^11.0.0 - Markdown 解析器
    * remark-rehype ^11.1.2 - Markdown → HTML 轉換
    * rehype-stringify ^10.0.1 - HTML 字串化
  - **[...slug].astro 完整實現**:
    * 讀取原始 Markdown 檔案
    * 解析並移除 frontmatter
    * 渲染 Markdown 為 HTML
    * 使用 frontmatter.description 作為頁面標題
    * 使用 `set:html` 插入渲染後的 HTML
  - **Prose 樣式系統**:
    * 完整的 Markdown 元素樣式
    * 標題層級顏色（h1 金色, h2 紫色, h3 青色, h4 粉色）
    * 連結樣式（金色 + hover 效果）
    * 程式碼塊樣式（深色背景 + 金色邊框）
    * 表格樣式（玻璃擬態 + hover 效果）
    * 引用塊樣式（金色左邊框 + 半透明背景）
    * 列表、圖片、分隔線等完整樣式
  - **建構測試**:
    * 所有 100+ 頁面成功生成
    * Markdown 正確渲染為 HTML
    * Frontmatter 正確解析
    * 無錯誤或警告

- **UEP 文件站區域頁面列表展示** (2026-01-20 深夜)
  - **AreaPage 元件增強**:
    * 新增 `pages` 參數接受頁面列表
    * 條件渲染：有頁面時顯示列表，無頁面時顯示建設中
    * 頁面卡片設計（Grid 佈局）
  - **頁面卡片樣式**:
    * 圖標 + 標題 + 路徑顯示
    * Hover 效果：上移 + 邊框發光 + 圖標旋轉 + 箭頭滑動
    * 漸變背景 overlay
    * 路徑文字使用 monospace 字體
    * 響應式 Grid（auto-fill, minmax(350px, 1fr)）
  - **所有區域頁面更新**:
    * history.astro - 顯示歷史區域所有頁面
    * echos.astro - 顯示回音區域所有頁面
    * visuals.astro - 顯示幻影區域所有頁面
    * concepts.astro - 顯示概念區域所有頁面
    * storage.astro - 顯示置物空間所有頁面
    * 每個區域自動從 SUMMARY.md 篩選對應頁面
  - **建構測試**:
    * 所有區域頁面成功生成
    * 無 TypeScript 錯誤
    * 頁面路徑正確顯示

- **UEP 文件站 Markdown 渲染系統基礎** (NEW - 2026-01-20 深夜)
  - **SUMMARY.md 解析工具** (`src/utils/summary.ts`):
    * `parseSummary()` - 解析 SUMMARY.md 生成導航樹
    * `extractRoutes()` - 從導航樹提取所有路由路徑
    * `loadSummary()` - 讀取並解析 SUMMARY.md
    * `findNavigationItem()` - 根據路徑尋找對應導航項
    * 支援 Gitbook 格式（列表項 + 標題 + anchor）
    * 支援深層巢狀結構（最多 5 層）
  - **動態路由實現** (`src/pages/[...slug].astro`):
    * `getStaticPaths()` 使用 SUMMARY.md 自動生成所有路由
    * 成功生成 100+ 個頁面路徑
    * 側邊欄 + 主內容區域佈局（grid 280px + 1fr）
    * Sticky 側邊欄設計（max-height, overflow-y）
    * 錯誤處理（檔案不存在時顯示錯誤訊息）
    * 暫時使用 `<pre>` 顯示原始 Markdown（等待渲染器）
  - **Markdown 套件安裝**:
    * @astrojs/markdown-remark ^6.3.10
    * remark-gfm ^4.0.1 - GitHub Flavored Markdown
    * rehype-slug ^6.0.0 - 自動生成標題 ID
    * rehype-autolink-headings ^7.1.0 - 自動連結標題
  - **建構測試**:
    * `pnpm build` 成功通過
    * 無 TypeScript 錯誤
    * 生成路徑範例：
      - /README/index.html
      - /history/passage/unforgettable_story/chpt.01/arc.01/sect.01/index.html
      - /echos/plaza/areas/ad_main/index.html
      - 等 100+ 個頁面
- **UEP 文件站 UI/UX 全面升級** (NEW - 2026-01-20 晚上)
  - **Navbar 元件化與美化**：
    * 創建獨立 Navbar.astro 元件
    * 金色漸層 Logo + 閃爍動畫
    * 導航選單 hover 效果與活躍狀態
    * 裝飾性浮動粒子
    * 滑入動畫 (slideDown)
  - **BaseLayout 現代化升級**：
    * 背景漸層層 (3 色徑向漸層)
    * 動態網格背景 (gridMove 動畫)
    * 鼠標跟隨光效 (smooth tracking)
    * 優化 Footer 設計（Logo + 連結 + Shimmer 效果）
    * 頁面淡入動畫 (fadeIn)
  - **區域頁面動畫系統**：
    * 創建 AreaPage.astro 通用元件
    * 浮動圖標 + 脈動光暈
    * 標題文字光暈動畫 (titleGlow)
    * 建設中粒子上升效果
    * U.E.P 工作圖片搖擺動畫 (bobbing)
    * 進度條加載動畫
  - **Portal 頁面特效**：
    * 光柱效果 (lightBeam 動畫)
    * 損壞傳送門故障效果 (glitch)
    * 卡片 hover 彈起動畫
    * 箭頭滑動提示
  - **全站動畫統一**：
    * 頁面進入動畫 (pageEnter)
    * 返回按鈕滑動效果
    * 所有可交互元素 hover 反饋
    * 響應式設計優化

- **UEP 文件站主頁重構** (2026-01-20 中午)
  - **主頁內容整合**：完全呈現 README.md 的故事內容
    * 世界的軸心完整敘事
    * U.E.P 的自我介紹與對話
    * 邊際世界遊歷導覽
    * 永恆的意義詩篇
  - **粒子效果恢復**：
    * 50 個浮動粒子系統
    * 雜訊覆蓋層（SVG noise filter）
    * 動態上升動畫
  - **互動式區域導航**：
    * 六大區域卡片（紫/青/粉/綠/橙/金）
    * Hover 效果與視覺反饋
    * 直接連結至各區域入口
  - **視覺優化**：
    * U.E.P 頭像浮動動畫
    * 金色光暈脈動效果
    * 玻璃擬態對話框
    * 響應式設計
  - **頁面滾動修復**：內容可正常滾動

- **UEP 文件站基礎架構** (2026-01-20 早上)
  - **Git Submodule 整合**：成功整合 U.E.P-s-Imaginary-Space
    * 位置：apps/uep/content
    * 提交：dd55e78 on main
  - **頁面架構創建**：
    * 主頁 (index.astro) - 世界的軸心（已重構）
    * 六大區域入口頁面：
      - history.astro - 歷史典藏庫
      - echos.astro - 回音蒐藏間
      - visuals.astro - 幻影重現室
      - concepts.astro - 概念調整房
      - storage.astro - 某人的置物空間
      - portal.astro - 外部基軸大廳（含外部連結）
    * 動態路由骨架 ([...slug].astro)
  - **UEP 素材整合**：
    * Big UEP.png - 主頁 U.E.P 頭像
    * Working.png, Lead.png, Peek.png, Forklift.png, Cat.png - 各區域建設中
  - **重點澄清**：
    * 世界的軸心 = content/README.md（主頁）
    * 基軸大廳 = content/portal/（外部連結）
    * 優先內容整合，視覺設計後續優化

### 🔄 進行中

- **Markdown 渲染系統** (IN PROGRESS)
  - 需要安裝 markdown 處理套件
  - frontmatter 解析
  - Gitbook 特殊語法支援

### 📋 待辦事項（按優先順序）

1. **內容渲染實現**
   - [ ] 安裝 remark/rehype 或類似套件
   - [ ] 實現 Markdown → HTML 轉換
   - [ ] 處理 frontmatter metadata
   - [ ] 支援 Gitbook 語法（embed, hint 等）

2. **動態路由完善**
   - [ ] 掃描 content/ 生成所有路徑
   - [ ] [...slug].astro getStaticPaths() 實現
   - [ ] 處理巢狀路由

3. **導航系統**
   - [ ] 從 SUMMARY.md 解析生成導航結構
   - [ ] 側邊欄導航組件
   - [ ] 麵包屑導航
   - [ ] 上一頁/下一頁

4. **特殊功能（未來）**
   - [ ] 音樂播放器（回音蒐藏間）
   - [ ] 圖片畫廊（幻影重現室）
   - [ ] 閱讀進度（歷史典藏庫）
   - [ ] U.E.P 對話系統（U.E.P 的房間）

---

## 之前完成項目 (2026-01-18)

- **UEP 文件站全新主題設計** (已暫緩，優先內容)
  - **世界觀整合**：基於「邊際世界」概念重新設計
  - **視覺風格**：
    * 深色主題（虛空黑 #0a0a0f + 虛空灰 #1a1a2e）
    * 金色 (#d5b618) + 紫色 (#a855f7) + 青色 (#06b6d4) 三色漸層系統
    * 玻璃擬態（Glassmorphism）美學
    * 半透明元素 + backdrop-filter 模糊效果
  - **粒子系統**：
    * 50 個浮動粒子（金/紫/青三色）
    * 無限上升動畫，模擬概念原質飄浮
    * 雜訊覆蓋層（SVG noise filter）增加科幻感
  - **Hero 區域**：
    * 標題加入微妙的 glitch 抖動效果
    * 三色漸層文字動畫（gradientShift）
    * 紫色建設徽章，內含旋轉光效
    * U.E.P 引言：「萬物由最原初的質所成...」
  - **U.E.P 引導區**：
    * UEP 頭像（發光球體 + 旋轉環）
    * UEP 對話氣泡（金色文字 + 紫色符號）
    * 掃描光效動畫
  - **邊際世界區域卡片**：
    * 4 個區域：歷史典藏庫、回音蒐藏間、幻影重現室、概念調整房
    * 懸停時發光效果（cardGlow）
    * 漸層邊框 + 陰影
    * 「準備中...」狀態標籤
  - **U.E.P 工作圖示區**：
    * 圖片加入玻璃邊框
    * 浮動動畫（分別延遲 0/0.5/1 秒）
    * 金色標題文字發光效果
  - **永恆詩歌區**：
    * 引用 README.md 中的詩歌內容
    * 重點文字（終點與起點、創世與毀滅等）使用金色高亮
    * 「虛無」字眼加入紫色脈衝動畫
    * 背景以太光效（ethereal）
  - **傳送門卡片**：
    * 主要維度（主站）+ 概念倉庫（GitHub）
    * 懸停時光圈擴散效果（portal-light）
    * 金色/紫色雙重陰影
  - **進度條**：
    * 三色漸層（紫→金→青）流動動畫
    * 上層 shimmer 光效
    * 隨機進度 30-50%
    * 提示文字：「概念原質正在重組...」
  - **BaseLayout 更新**：
    * 深色背景 + 徑向漸層
    * 玻璃材質 Header/Footer
    * Logo 金紫漸層
    * 導航欄底線動畫
  - **JavaScript 互動**：
    * 動態生成 50 個粒子
    * 世界卡片 icon 縮放/旋轉效果
    * 圖片卡片點擊重置動畫

- **UEP 文件站建設中頁面** (2026-01-18 - 已升級)
  - 創建 UEP 主題的「建設中...」頁面（apps/uep）
  - **主題配色**：白色 + #d5b618（UEP 金色）→ 升級為深色 + 多色漸層
  - **互動元素**：
    * 3 個 UEP 貼圖（Working.png, Forklift.png, Lead.png）具有浮動動畫
    * 建設中徽章具有呼吸動畫和擺動效果 → 升級為紫色光效徽章
    * 進度條帶有發光動畫（隨機 25-45%）→ 升級為流動漸層動畫
    * 連結卡片具有滑動光效和懸停效果 → 升級為傳送門卡片
    * 圖片卡片可點擊並重新觸發動畫
  - **頁面區塊**：
    * Hero 區：標題 + 建設中徽章 + 副標題 + 引言
    * UEP 引導區：頭像動畫 + 對話
    * 邊際世界預覽區：4 個世界卡片
    * UEP 貼圖展示區：3 個圖片卡片（浮動動畫）
    * 永恆詩歌區：引用詩歌內容
    * 傳送門區：主站 + GitHub
    * 進度條區：模擬建設進度
  - **響應式設計**：手機版單欄佈局、圖片堆疊

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
