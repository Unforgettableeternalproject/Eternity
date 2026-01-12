# 專案進度追蹤

## 最近更新 (2026-01-12)

### ✅ 已完成
- **Keystatic 側邊欄卡片管理系統**（NEW）
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
- 準備開發下一個大功能

### 📋 待處理
- 將 RippleEffect 應用到更多可點擊元素
- UEP 文件站內容遷移（從 U.E.P-s-Imaginary-Space）

### 🐛 已知問題
- Astro.glob 已棄用警告（建議改用 import.meta.glob）
- TypeScript 類型錯誤（既有問題，不影響運行）

---

**上次更新**: 2026-01-12 10:15
