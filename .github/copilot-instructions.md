# Monorepo + Astro (root + uep) 基礎架構建置指令（請完整照做）

你是資深全端工程師與 DevOps，請在我目前的 GitHub repo 內建立一個「可以長期維護」的 Monorepo 架構：
- 使用 pnpm + workspaces
- 使用 TurboRepo 做 build/lint/typecheck 的 pipeline（可選但建議）
- 兩個 Astro 站點：
  - apps/root → 對應主網域 unforgettableeternalproject.com
  - apps/uep  → 對應子網域 uep.unforgettableeternalproject.com（先建好但可先不部署）
- 共用 packages：
  - packages/config：共用 eslint/tsconfig（以及必要的 prettier config）
  - packages/ui：共用 UI 元件（先建骨架即可，未來可放 Astro/React components）
- Node 版本以 LTS 為主（請用 .nvmrc + engines）
- 全 repo 使用 TypeScript（即使 Astro 站也開啟 TS 支援）
- 先做到「本機一個指令就能同時跑 root 與 uep」以及「CI 能跑 lint/typecheck/build」

## 0) 技術選型要求
- Package manager: pnpm
- Workspace: pnpm-workspace.yaml
- Task runner: turbo
- Lint: eslint（支援 astro、typescript）
- Format: prettier（含 astro plugin）
- Typecheck: tsc（或 astro check + tsc）
- Git hooks: optional（可先不做），但可以放上簡易 lint-staged 範例
- 測試：先不要加 vitest/jest（保持輕量），但預留空間

## 1) 最終目錄結構（必須做到）
repo/
  apps/
    root/
      src/
      public/
      astro.config.mjs
      package.json
      tsconfig.json
    uep/
      src/
      public/
      astro.config.mjs
      package.json
      tsconfig.json
  packages/
    config/
      eslint/
        base.cjs
        astro.cjs
      tsconfig/
        base.json
      prettier/
        prettier.cjs
      package.json
    ui/
      src/
      package.json
      tsconfig.json
  .github/
    workflows/
      ci.yml
  .nvmrc
  pnpm-workspace.yaml
  turbo.json
  package.json
  README.md

## 2) 初始化步驟（請實際產生檔案）
A. 在 repo root 產生：
- pnpm-workspace.yaml（包含 apps/* 與 packages/*）
- turbo.json（定義 build/lint/typecheck/dev pipeline）
- .nvmrc（寫入建議 Node LTS 版本，例如 20 或 22，並在 package.json engines 指定）
- root package.json：
  - private: true
  - packageManager: "pnpm@<latest>"
  - scripts:
    - dev: turbo dev --parallel
    - build: turbo build
    - lint: turbo lint
    - typecheck: turbo typecheck
    - format: prettier -w .
    - format:check: prettier -c .
  - devDependencies: turbo, typescript, eslint, prettier, prettier-plugin-astro 等必要套件
- README.md（寫清楚開發指令、部署概念、Cloudflare Pages 設定重點）

B. 在 packages/config 建立共用設定：
- packages/config/package.json（name: @uep/config 或類似 scope；private 可 true）
- TS config base：packages/config/tsconfig/base.json
- ESLint config：
  - base（typescript + import + node）
  - astro（加 astro plugin 與 parser 設定）
- Prettier config：packages/config/prettier/prettier.cjs（包含 astro plugin）
請讓 apps 內的 eslint/tsconfig/prettier 都是「extend 共用設定」，不要每個 app 重寫一套。

C. 在 apps/root 建立 Astro 模板（必須可運行）
- 使用 Astro 的 minimal/empty template（不要太花）
- 加入一個簡易首頁（類似 “UEP online”）
- 加入一個 /links 或 /about 頁面（展示路由/slug 概念）
- 在首頁放一個 “UEP docs will live at uep.*” 的 placeholder link（先指到 https://uep.unforgettableeternalproject.com）
- SEO 基本 meta（title/description）
- 使用 TypeScript
- 可選：加一個非常小的 layout component（src/layouts/BaseLayout.astro）以示範架構

D. 在 apps/uep 建立 Astro 模板（可與 root 類似，但內容偏文件站）
- 最少要有：
  - 首頁 /（說明這是 uep 子站）
  - 一篇 markdown 頁面在 /guide/intro（示範 slug）
- 先不要做側邊欄、搜尋（保持輕量）
- 但把內容組織預留好（例如 src/content/ 或 src/pages/guide/）

E. 在 packages/ui 建立骨架
- packages/ui/package.json（name: @uep/ui）
- 匯出至少一個簡單元件（例如 Button.tsx 或一個 Astro component），並在 apps/root 引用一次以驗證 workspace link 正常
- TS 設定與 build（可以先用 tsup 或純 tsc；若覺得太重可先用 "type": "module" + exports 指向 src 並在 apps 使用 ts path，但請確保能被正確解析/不報錯）

## 3) 代碼品質與一致性（必須）
- eslint 與 prettier 在整個 monorepo 可用
- `pnpm dev` 可以同時啟動 root 與 uep（兩個不同 port）
- `pnpm build` 能成功產出兩站的 dist
- `pnpm lint` 與 `pnpm typecheck` 能在 CI 乾淨通過

## 4) GitHub Actions CI（必須）
在 .github/workflows/ci.yml 建立：
- on: push, pull_request
- 使用 pnpm cache
- steps:
  - checkout
  - setup-node（讀取 .nvmrc 或指定 node-version）
  - corepack enable
  - pnpm install --frozen-lockfile
  - pnpm lint
  - pnpm typecheck
  - pnpm build

## 5) Cloudflare Pages 部署指引（寫在 README）
請在 README 裡寫清楚：
- root site：Cloudflare Pages Project A
  - repo: 此 repo
  - root directory: apps/root
  - build command: pnpm install --frozen-lockfile && pnpm -C apps/root build （或使用 turbo 的 filter 指令）
  - output directory: apps/root/dist
- uep site：Cloudflare Pages Project B
  - root directory: apps/uep
  - build command: pnpm install --frozen-lockfile && pnpm -C apps/uep build（或 turbo filter）
  - output directory: apps/uep/dist
並提供兩種寫法：
- 直接在 project 用 -C
- 或用 turbo filter：pnpm turbo build --filter=@uep/root（請確保 package name 正確）

## 6) 實作細節注意事項（必須遵守）
- 產生 pnpm-lock.yaml
- 所有 package.json 都要填正確的 name（例如 @uep/root, @uep/uep, @uep/ui）
- turbo pipeline 的 outputs 要正確（dist/**）
- 避免把 secrets 寫進 repo
- 確保 Windows 環境可用（路徑/腳本不要寫死 bash-only）

## 7) 最終交付（你要回覆我）
完成後請回覆：
- 檔案樹（tree）
- 每個 workspace 的 package.json scripts 概覽
- root/uep 本機啟動後的網址與 port（預設即可）
- CI workflow 內容摘要
- README 的部署設定段落

請直接開始修改/新增檔案，不要問我確認。
---