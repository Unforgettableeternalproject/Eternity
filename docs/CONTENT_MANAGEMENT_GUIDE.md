# 主頁內容管理系統使用指南

## 快速開始

### 啟動開發伺服器

```bash
npm run dev
```

- **主站**: http://127.0.0.1:4321/
- **UEP 文件站**: http://localhost:4322/
- **Keystatic 後台**: http://127.0.0.1:4321/keystatic

## 使用 Keystatic 後台

### 訪問後台

### 方法 1: 直接訪問（開發環境）

1. 打開瀏覽器訪問 http://127.0.0.1:4321/keystatic
2. 你會看到左側選單：
   - 專案 (Projects)
   - 連結 (Links)
   - 最新動態 (Updates)

### 方法 2: 隱藏入口（生產環境）

為了安全性，主頁有一個隱藏的管理員入口：

1. **啟用入口**：在 URL 後加上 `/a` 或查詢參數
   
   **支援的 URL 格式**：
   - `http://127.0.0.1:4321/a` （根路徑）
   - `http://127.0.0.1:4321/zh-tw/a` （中文路徑）
   - `http://127.0.0.1:4321/en/a` （英文路徑）
   - `http://127.0.0.1:4321/?a=1` （查詢參數）
   - `http://127.0.0.1:4321/zh-tw?a=1` （中文 + 查詢參數）

2. **出現 Admin 按鈕**：右下角會顯示一個紫色漸變的「🔐 Admin」按鈕

3. **輸入密碼**：點擊按鈕後，輸入管理員密碼：`426067`

4. **進入後台**：密碼正確後會自動跳轉到對應語言的 Keystatic 管理後台
   - 如果從 `/zh-tw/a` 進入 → 跳轉到 `/zh-tw/keystatic`
   - 如果從 `/en/a` 進入 → 跳轉到 `/en/keystatic`

**測試步驟**：
```bash
# 開啟瀏覽器訪問任一以下 URL
http://127.0.0.1:4321/zh-tw/a
# 或
http://127.0.0.1:4321/en/a
# 或
http://127.0.0.1:4321/?a=1

# 應該會在右下角看到 Admin 按鈕
# 點擊後輸入: 426067
```

**注意**：
- 在正常 URL（如 `/zh-tw`、`/en`、`/`）下**不會**顯示 Admin 按鈕
- 只有知道密碼的人才能進入後台
- 這個功能主要用於生產環境的安全訪問
- 開發環境也可以直接訪問 `/keystatic` 或 `/zh-tw/keystatic`

### 編輯內容

#### 編輯專案

1. 點擊左側「專案」
2. 選擇要編輯的專案（如 UEP、Eternity、創意作品集）
3. 編輯欄位：
   - **標題**: 專案名稱
   - **描述**: 簡短描述
   - **標籤列表**: 添加技術標籤（如 Astro, TypeScript）
   - **在首頁顯示**: 是否在首頁精選區顯示
   - **排序順序**: 數字越小越靠前
   - **狀態**: 進行中 / 已完成 / 已封存
   - **圖片路徑**: `/images/projects/xxx.jpg`
   - **相關連結**: Demo / GitHub / 網站連結
   - **詳細內容**: 使用 Markdown 編輯完整內容

4. 點擊右上角「Save」儲存

#### 新增專案

1. 點擊「專案」右側的「Create」按鈕
2. 填寫所有必填欄位
3. 儲存

#### 編輯連結

1. 點擊「連結」
2. 選擇連結進行編輯
3. 欄位說明：
   - **連結網址**: 完整 URL
   - **分類**: 社群媒體 / 工作相關 / 創作平台 / 其他
   - **Icon 名稱**: 如 github, twitter, link
   - **重要連結**: 是否在重要位置顯示

#### 編輯最新動態

1. 點擊「最新動態」
2. 編輯或新增更新
3. **在首頁顯示**: 勾選後會出現在首頁

## 直接編輯 Markdown 文件

如果你熟悉 Markdown，也可以直接編輯檔案：

### 專案

路徑: `apps/root/src/content/projects/`

範例檔案結構:
```markdown
---
title: "專案名稱"
description: "專案描述"
tags: ["標籤1", "標籤2"]
featured: true
order: 1
status: "active"
image: "/images/projects/example.jpg"
links:
  website: "https://example.com"
  github: "https://github.com/..."
startDate: 2024-01-01
endDate: 2024-12-31
---

# 專案詳細內容

這裡是 Markdown 格式的完整專案描述...
```

### 連結

路徑: `apps/root/src/content/links/`

```markdown
---
title: "GitHub"
description: "查看我的開源專案"
url: "https://github.com/username"
category: "social"
icon: "github"
featured: true
order: 1
---

額外說明內容（可選）
```

### 最新動態

路徑: `apps/root/src/content/updates/`

```markdown
---
title: "更新標題"
description: "更新描述"
date: 2025-12-27
category: "website"
featured: true
---

# 詳細更新內容

使用 Markdown 撰寫...
```

## 內容顯示位置

### 首頁 (index.astro)

- **精選專案**: 顯示 `featured: true` 且按 `order` 排序的前 3 個專案
- **最新動態**: 顯示 `featured: true` 且按日期排序的前 4 個更新

### 專案頁面 (projects.astro)

- 顯示所有專案，按 `order` 排序
- 點擊「查看詳情」進入 `/projects/[slug]` 詳細頁面

### 詳細頁面 (projects/[slug].astro)

- 顯示專案的完整 Markdown 內容
- 包含標籤、連結、日期等完整資訊

## 添加圖片

1. 將圖片放到 `apps/root/public/images/projects/` 目錄
2. 在專案的 `image` 欄位填寫 `/images/projects/your-image.jpg`
3. 圖片會自動顯示在專案卡片上

## 常見問題

### Q: 為什麼我的修改沒有顯示？

A: 
- 確保已儲存檔案
- 檢查開發伺服器是否正在運行
- 重新整理瀏覽器（Ctrl + F5）

### Q: 如何更改首頁顯示的專案數量？

A: 編輯 `apps/root/src/pages/index.astro`，修改:
```javascript
.slice(0, 3)  // 改為你想要的數量
```

### Q: 如何添加新的內容類型？

A: 
1. 在 `apps/root/src/content/config.ts` 添加新的 collection
2. 在 `keystatic.config.tsx` 添加對應的配置
3. 建立對應的頁面檔案

### Q: Keystatic 後台顯示空白？

A: 
- 確保 React 已正確安裝
- 檢查瀏覽器控制台是否有錯誤
- 嘗試清除瀏覽器快取

## 部署到生產環境

目前配置使用 `local` storage 模式。如需部署到生產環境：

### 選項 1: 使用 GitHub Storage

修改 `keystatic.config.tsx`:

```tsx
storage: {
  kind: 'github',
  repo: 'Unforgettableeternalproject/Eternity',
}
```

需要設定 GitHub OAuth App。

### 選項 2: 僅在本地編輯

保持 `local` 模式，內容通過 Git 提交到儲存庫，部署時自動重建。

## 下一步

- [ ] 建立 `links.astro` 連結列表頁面
- [ ] 建立 `updates.astro` 更新動態頁面
- [ ] 添加實際的專案圖片
- [ ] 自訂 Keystatic 的視覺樣式
- [ ] 考慮整合 GitHub Storage 用於協作編輯

## 技術細節

### 使用的技術

- **Astro 5.16**: 靜態網站生成器
- **Content Collections**: 型別安全的內容管理
- **Keystatic**: 視覺化 CMS 介面
- **Markdoc**: Markdown 擴展語法
- **React**: Keystatic 依賴

### 檔案結構

```
apps/root/
├── src/
│   ├── content/
│   │   ├── config.ts          # Content Collections 定義
│   │   ├── projects/          # 專案 Markdown 檔案
│   │   ├── links/             # 連結 Markdown 檔案
│   │   ├── updates/           # 更新 Markdown 檔案
│   │   └── articles/          # 文章（未來使用）
│   └── pages/
│       ├── index.astro        # 首頁
│       ├── projects.astro     # 專案列表
│       └── projects/
│           └── [slug].astro   # 專案詳細頁
├── astro.config.mjs           # Astro 配置
└── keystatic.config.tsx       # Keystatic 配置
```

---

**提示**: 如需幫助，請參考 [Keystatic 文檔](https://keystatic.com/docs) 或 [Astro Content Collections 文檔](https://docs.astro.build/en/guides/content-collections/)
