# Agent 工作規範

本文件定義了 AI Agent 在本專案中的工作規範與準則。

## 核心準則

### 1. 開發伺服器管理
- **禁止啟動開發伺服器**
- 原因：已有常駐的開發伺服器在背景執行
- 若需測試，請告知使用者手動重啟或檢查

### 2. 架構理解優先
- **在進行任何程式碼修改之前，必須先理解專案的內部 schema 和架構**
- 使用 `read_file`、`grep_search`、`semantic_search` 等工具充分了解相關檔案
- 未完全理解結構之前，不得進行程式碼修改
- 必要時向使用者確認架構細節

### 3. 最小化變更原則
- **每次僅進行最小必要的改動**
- 完成一項變更後，等待使用者確認通過
- 確認通過後才繼續下一項變更
- 避免一次性進行大規模重構

### 4. 進度追蹤
- **所有變更必須記錄至 [PROGRESS.md](./PROGRESS.md)**
- 記錄內容包含：
  - 預計要做的改動
  - 已完成的改動
  - 目前進度狀態
- 每次進行更新都要同步更新進度文件
- 保持簡要，使下一個會話能快速了解進度

### 5. 語言規範
- **🔴 必須使用繁體中文與使用者對話**
- **🔴 嚴禁使用簡體中文**
- 程式碼註解與文件應使用繁體中文（除非技術文件慣例使用英文）

## 專案架構

### 技術棧
- **框架**: Astro + React
- **前端託管**: Cloudflare Pages
- **樣式**: Tailwind CSS
- **內容管理**: Keystatic CMS
- **文件格式**: Markdoc (`.mdoc`)

### 分支策略
- **開發分支**: `develop`、`feature/*`
- **部署分支**: `staging`、`main`
- **部署流程**:
  1. 在 `develop` 或 `feature/*` 分支開發
  2. 合併至 `staging` 分支進行測試
  3. 測試通過後合併至 `main` 分支正式部署

### 專案結構
```
apps/
├── root/          # 個人主頁
│   ├── src/
│   │   ├── pages/
│   │   │   ├── zh-tw/    # 繁體中文頁面
│   │   │   └── en/       # 英文頁面
│   │   ├── content/      # Keystatic 內容
│   │   │   ├── projects/ # 專案內容
│   │   │   └── updates/  # 更新內容
│   │   └── components/   # Astro/React 元件
│   └── keystatic.config.tsx
└── uep/           # 文件站
    └── src/
```

### 內容遷移計畫
- **來源**: `C:\Users\Bernie\source\repos\Unforgettableeternalproject\U.E.P-s-Imaginary-Space`
- **目標**: `apps/uep/`
- **狀態**: 尚未開始處理

## 開發技巧與慣例

### Schema 理解檢查清單
在修改相關功能前，確認已理解：
- [ ] Content Collection Schema (`src/content/config.ts`)
- [ ] Keystatic Configuration (`keystatic.config.tsx`)
- [ ] 相關元件的 Props 介面
- [ ] 路由結構與參數
- [ ] 多語系處理方式

### 常見陷阱
1. **字元編碼問題**: 使用 Unicode 轉義序列 (`\u9032\u884c\u4e2d`) 處理中文字元
2. **Markdoc 渲染**: 使用 `Content` 元件而非純文字渲染
3. **多語系欄位**: 注意 `title_zh`、`title_en` 等欄位可能不存在，優先使用 `id`

### 工具使用建議
- 使用 `multi_replace_string_in_file` 進行批次修改
- 使用 `grep_search` 快速定位相關程式碼
- 使用 `semantic_search` 理解專案架構
- 修改後使用 `get_errors` 確認無編譯錯誤

## 技能擴充區

<!-- 預留空間供未來新增特定技能或工作流程 -->

### 待補充技能

#### 技能 1: [待定義]
- 待補充

#### 技能 2: [待定義]
- 待補充

#### 技能 3: [待定義]
- 待補充

---

**最後更新**: 2026-01-12
