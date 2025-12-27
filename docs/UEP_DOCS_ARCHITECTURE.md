# UEP 文件系統架構設計

> **狀態**: 規劃中 | **優先級**: 中 | **預計完成時間**: 3-4 週

## 概述

為 `apps/uep` 子網域建立完整的文件管理系統，整合 Gitbook 編輯工作流程，使用 Git-based CMS (Keystatic) 提供可選的視覺化編輯介面，實現內容與程式碼分離。

## 目標

1. **內容與程式碼分離**: 文件內容保存在 `U.E.P-s-Imaginary-Space` 儲存庫，網站程式碼在 `Eternity` 儲存庫
2. **編輯工作流程**: 主要在 Gitbook 編輯，自動同步到網站
3. **備用編輯器**: 提供 `/keystatic` 後台作為快速編輯選項
4. **自動化部署**: 內容更新時自動觸發網站重建
5. **優秀的閱讀體驗**: 分類導航、全文搜尋、響應式設計

## 技術架構

### 核心技術棧

- **Framework**: Astro 4.x (已安裝)
- **Content Management**: Astro Content Collections + Keystatic
- **Content Source**: Git Submodule → U.E.P-s-Imaginary-Space
- **Search**: Pagefind (靜態全文搜尋)
- **Styling**: Tailwind CSS (共享配置)
- **Authentication**: GitHub OAuth (透過 Keystatic)
- **Deployment**: Cloudflare Pages (現有設定)

### 內容組織結構

```
apps/uep/
├── src/
│   ├── content/
│   │   ├── config.ts                 # Content Collections 定義
│   │   └── uep-docs/                 # Git Submodule
│   │       ├── history/              # 歷史典藏庫
│   │       ├── echos/                # 回音蒐藏間
│   │       ├── concepts/             # 概念調整房
│   │       └── visuals/              # 幻影重現室
│   ├── layouts/
│   │   ├── BaseLayout.astro          # 現有基礎佈局
│   │   └── DocLayout.astro           # 新增文件佈局
│   ├── components/
│   │   ├── Sidebar.astro             # 側邊欄導航
│   │   ├── TableOfContents.astro     # 目錄
│   │   ├── Breadcrumb.astro          # 麵包屑
│   │   └── Search.astro              # 搜尋元件
│   └── pages/
│       ├── index.astro               # 文件首頁
│       ├── docs/
│       │   ├── index.astro           # 文件列表
│       │   └── [...slug].astro       # 動態路由
│       └── keystatic/
│           └── [...params].astro     # Keystatic 後台
├── keystatic.config.tsx              # Keystatic 配置
└── astro.config.mjs                  # 更新配置
```

## 實作階段

### Phase 1: Content Collections 設定 (第 1 週)

**任務**:
1. 建立 `src/content/config.ts`
2. 定義 4 個主要集合的 Zod schema
3. 配置 MDX 支援

**Content Collections Schema**:

```typescript
// src/content/config.ts
import { defineCollection, z } from 'astro:content';

const historyCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    icon: z.string().optional(),
    chapter: z.string().optional(),
    arc: z.number().optional(),
    date: z.date().optional(),
    order: z.number().optional(),
  }),
});

const echosCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    category: z.enum(['areas', 'characters', 'stories', 'special']),
    region: z.string().optional(),
    type: z.string().optional(),
    tags: z.array(z.string()).optional(),
  }),
});

const conceptsCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    category: z.enum(['magic', 'quantum', 'spirit', 'other']),
    subcategory: z.string().optional(),
    complexity: z.enum(['basic', 'intermediate', 'advanced']).optional(),
  }),
});

const visualsCollection = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string().optional(),
    type: z.enum(['profiles', 'illustrations', 'sketches', 'aiart']),
    era: z.string().optional(),
    subject: z.string().optional(),
    artist: z.string().optional(),
  }),
});

export const collections = {
  history: historyCollection,
  echos: echosCollection,
  concepts: conceptsCollection,
  visuals: visualsCollection,
};
```

### Phase 2: Git Submodule 整合 (第 1-2 週)

**任務**:
1. 將 U.E.P-s-Imaginary-Space 加為 submodule
2. 配置自動更新腳本
3. 測試內容讀取

**指令**:

```bash
cd apps/uep
git submodule add https://github.com/Unforgettableeternalproject/U.E.P-s-Imaginary-Space.git src/content/uep-docs
```

**注意事項**:
- Submodule 指向特定 commit，需定期更新
- CI/CD 需配置 `submodules: recursive`
- 本地開發需 `git submodule update --remote`

### Phase 3: Keystatic CMS 整合 (第 2 週)

**任務**:
1. 安裝 Keystatic 依賴
2. 配置 `keystatic.config.tsx`
3. 設定 GitHub OAuth
4. 建立管理後台路由

**安裝**:

```bash
pnpm add @keystatic/core @keystatic/astro
```

**配置範例**:

```tsx
// keystatic.config.tsx
import { config, collection, fields } from '@keystatic/core';

export default config({
  storage: {
    kind: 'github',
    repo: 'Unforgettableeternalproject/U.E.P-s-Imaginary-Space',
  },
  
  ui: {
    brand: {
      name: 'U.E.P 文件管理',
      mark: () => '📚',
    },
  },

  collections: {
    history: collection({
      label: '歷史典藏庫',
      slugField: 'title',
      path: 'history/passage/*',
      format: { contentField: 'content' },
      schema: {
        title: fields.slug({ name: { label: '標題' } }),
        description: fields.text({ 
          label: '描述', 
          multiline: true 
        }),
        icon: fields.text({ label: 'Icon' }),
        content: fields.document({
          label: '內容',
          formatting: true,
          links: true,
          images: true,
        }),
      },
    }),
    
    // ... 其他 collections
  },
});
```

**Astro 配置更新**:

```javascript
// astro.config.mjs
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import keystatic from '@keystatic/astro';

export default defineConfig({
  site: 'https://uep.unforgettableeternalproject.com',
  integrations: [
    mdx(),
    keystatic(),
  ],
  build: { format: 'directory' },
});
```

### Phase 4: 文件頁面 Layout 與路由 (第 3 週)

**任務**:
1. 建立 DocLayout.astro
2. 實作 Sidebar 階層導航
3. 建立動態路由
4. 實作麵包屑和 TOC

**DocLayout.astro**:

```astro
---
import BaseLayout from './BaseLayout.astro';
import Sidebar from '../components/Sidebar.astro';
import TableOfContents from '../components/TableOfContents.astro';
import Breadcrumb from '../components/Breadcrumb.astro';

const { frontmatter, headings } = Astro.props;
const { collection, slug } = Astro.params;
---

<BaseLayout title={frontmatter.title}>
  <div class="docs-layout">
    <!-- 側邊欄 -->
    <aside class="docs-sidebar">
      <Sidebar currentPath={Astro.url.pathname} />
    </aside>

    <!-- 主要內容區 -->
    <main class="docs-content">
      <Breadcrumb collection={collection} slug={slug} />
      
      <article class="prose dark:prose-invert max-w-none">
        <h1>{frontmatter.title}</h1>
        {frontmatter.description && (
          <p class="lead">{frontmatter.description}</p>
        )}
        <slot />
      </article>

      <!-- 上一頁/下一頁導航 -->
      <nav class="docs-pagination">
        <!-- 實作邏輯 -->
      </nav>
    </main>

    <!-- 目錄 -->
    <aside class="docs-toc">
      <TableOfContents headings={headings} />
    </aside>
  </div>
</BaseLayout>
```

**動態路由**:

```astro
---
// src/pages/docs/[...slug].astro
import { getCollection } from 'astro:content';
import DocLayout from '../../layouts/DocLayout.astro';

export async function getStaticPaths() {
  const allDocs = await Promise.all([
    getCollection('history'),
    getCollection('echos'),
    getCollection('concepts'),
    getCollection('visuals'),
  ]).then(results => results.flat());

  return allDocs.map(doc => ({
    params: { slug: `${doc.collection}/${doc.slug}` },
    props: { doc },
  }));
}

const { doc } = Astro.props;
const { Content, headings } = await doc.render();
---

<DocLayout frontmatter={doc.data} headings={headings}>
  <Content />
</DocLayout>
```

### Phase 5: 搜尋功能整合 (第 3-4 週)

**任務**:
1. 安裝 Pagefind
2. 配置 build 流程
3. 建立搜尋 UI

**安裝**:

```bash
pnpm add -D pagefind
```

**package.json 更新**:

```json
{
  "scripts": {
    "build": "astro check && astro build && pagefind --site dist"
  }
}
```

**搜尋元件**:

```astro
---
// src/components/Search.astro
---

<div id="search" class="search-container"></div>

<link href="/_pagefind/pagefind-ui.css" rel="stylesheet">
<script>
  import { PagefindUI } from '/_pagefind/pagefind-ui.js';
  
  new PagefindUI({
    element: "#search",
    showSubResults: true,
    translations: {
      placeholder: "搜尋文件...",
      clear_search: "清除",
      load_more: "載入更多結果",
      search_label: "搜尋此網站",
      filters_label: "篩選",
      zero_results: "找不到 [SEARCH_TERM] 的結果",
    }
  });
</script>
```

### Phase 6: CI/CD 自動部署 (第 4 週)

**任務**:
1. 配置 GitHub Actions 監聽 submodule 更新
2. 設定 U.E.P-s-Imaginary-Space 的觸發器
3. 測試自動部署流程

**Eternity Workflow**:

```yaml
# .github/workflows/deploy-uep.yml
name: Deploy UEP Docs

on:
  push:
    branches: [main]
    paths:
      - 'apps/uep/**'
  # 監聽來自 U.E.P-s-Imaginary-Space 的觸發
  repository_dispatch:
    types: [content-updated]
  # 定時檢查 (備用方案)
  schedule:
    - cron: '0 */6 * * *'  # 每 6 小時

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive  # 關鍵！
          
      - name: Update submodules
        run: |
          git submodule update --remote --merge
          
      - uses: pnpm/action-setup@v2
        with:
          version: 9
      
      - name: Install dependencies
        run: pnpm install
      
      - name: Build UEP site
        run: pnpm --filter @uep/uep build
      
      - name: Publish to Cloudflare Pages
        uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: uep-docs
          directory: apps/uep/dist
```

**U.E.P-s-Imaginary-Space Workflow**:

```yaml
# U.E.P-s-Imaginary-Space/.github/workflows/notify-parent.yml
name: Notify Parent Repo

on:
  push:
    branches: [main]

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Eternity rebuild
        run: |
          curl -X POST \
            -H "Authorization: token ${{ secrets.PARENT_REPO_TOKEN }}" \
            -H "Accept: application/vnd.github.v3+json" \
            https://api.github.com/repos/Unforgettableeternalproject/Eternity/dispatches \
            -d '{"event_type":"content-updated"}'
```

## 工作流程

### 主要編輯流程 (Gitbook)

1. 在 Gitbook 編輯器中編輯內容
2. 儲存後推送到 U.E.P-s-Imaginary-Space
3. GitHub Action 觸發通知 Eternity repo
4. Eternity 更新 submodule
5. 重建 apps/uep
6. 部署到 Cloudflare Pages

### 備用編輯流程 (Keystatic)

1. 訪問 `https://uep.unforgettableeternalproject.com/keystatic`
2. 使用 GitHub OAuth 登入
3. 直接編輯 markdown 內容
4. 提交變更到 U.E.P-s-Imaginary-Space
5. 觸發相同的部署流程

## UI/UX 設計要點

### 導航結構

- **頂部導航**: Logo、搜尋欄、主題切換、語言切換、管理後台連結
- **側邊欄**: 階層式導航，對應 SUMMARY.md 結構，支援展開/收合
- **麵包屑**: 顯示當前位置，可快速返回上層
- **目錄**: 右側固定，顯示當前頁面的標題結構
- **分頁導航**: 上一頁/下一頁，按集合順序排列

### 響應式設計

- **桌面端**: 三欄佈局（側邊欄 + 內容 + 目錄）
- **平板**: 兩欄佈局（可切換的側邊欄 + 內容）
- **手機**: 單欄佈局，漢堡選單導航

### 視覺設計

- 延續主站的設計語言（配色、字體、動畫）
- 使用 Tailwind Typography 優化閱讀體驗
- 支援深色模式
- 程式碼區塊語法高亮

## 技術決策

### 為什麼選擇 Git Submodule？

✅ **優點**:
- 保持單一內容來源
- Git 原生功能，無額外依賴
- 內容與程式碼版本獨立
- CI/CD 支援良好

⚠️ **缺點**:
- 初次設定較複雜
- 需要記得更新 submodule

**替代方案**: 同步腳本（prebuild 時複製），但會失去版本控制的優勢

### 為什麼選擇 Keystatic？

✅ **優點**:
- Astro 原生整合
- Git-based，無需資料庫
- 免費（單使用者）
- TypeScript 優先

❌ **不選擇的替代方案**:
- **Tina CMS**: 需要雲端後端（付費）
- **Decap CMS**: 較舊，社群活躍度下降
- **Strapi/Contentful**: 過於重量級，需要後端

### 為什麼選擇 Pagefind？

✅ **優點**:
- 完全靜態，無需伺服器
- 快速建立索引
- 支援中文分詞
- 體積小，效能好

❌ **不選擇的替代方案**:
- **Algolia**: 付費，且需要 API key
- **Fuse.js**: 需載入全部內容，大型文件庫效能差

## 風險與緩解措施

### 風險 1: Submodule 更新失敗

**緩解**: 
- 設定定時檢查（cron job）
- 手動觸發 workflow 選項
- 錯誤通知機制

### 風險 2: 內容 Schema 變更

**緩解**:
- 使用 `.optional()` 讓欄位可選
- 逐步遷移舊內容
- 版本化 schema

### 風險 3: 搜尋索引過大

**緩解**:
- 配置 Pagefind 排除不需索引的檔案
- 考慮分割索引
- 監控 bundle 大小

## 成功指標

- [ ] 所有 U.E.P-s-Imaginary-Space 的內容成功顯示
- [ ] 搜尋可正確找到中文內容
- [ ] 側邊欄導航正確反映 SUMMARY.md 結構
- [ ] Gitbook 編輯後 15 分鐘內部署完成
- [ ] Keystatic 後台可正常編輯並提交
- [ ] 移動端閱讀體驗良好
- [ ] 燈塔評分 > 90

## 參考資料

- [Astro Content Collections](https://docs.astro.build/en/guides/content-collections/)
- [Keystatic 文檔](https://keystatic.com/docs)
- [Pagefind 文檔](https://pagefind.app/)
- [Git Submodules](https://git-scm.com/book/en/v2/Git-Tools-Submodules)
- [Example-Theme getPosts.ts](../Example-Theme/src/utils/getPosts.ts) - 參考實作

## 更新日誌

- **2025-12-26**: 初始架構設計文件建立
