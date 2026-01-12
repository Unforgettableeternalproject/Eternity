# Eternity - Bernie 的個人網站 Monorepo

### 本專案提供多語言 README

[![Static Badge](https://img.shields.io/badge/lang-zh--tw-yellow)](./README.zh-tw.md) [![Static Badge](https://img.shields.io/badge/lang-en-red)](./README.md)

## U.E.P 和 Exera 的對話

「這次又在做些什麼?」

「嘿! Bernie 似乎想要弄一個完整的平台，之後把所有東西都放上去! 包含...」

「包含你的小空間? 那也是挺大的志向了，真的搞得起來嗎?」

「嗯...但 Bernie 總是有辦法的! 他說他會一步步來，先把基礎架構搭起來。」

「希望如此吧...」

## 專案概述

Eternity 是 Bernie 的個人網站 monorepo 專案，使用 pnpm workspaces + TurboRepo 來管理多個站點與共用套件。整合了個人介紹、創作展示與知識庫等功能。

## 主要功能

🌟 **主站點 (apps/root)**

- 網域: unforgettableeternalproject.com
- 個人簡介與聯絡資訊
- 專案作品集展示
- 技術棧與技能展示

📚 **文件站點 (apps/uep)**

- 網域: uep.unforgettableeternalproject.com
- 個人創作文章與知識庫
- 技術筆記與教學
- 專案文件整理

## 專案結構

```
Eternity/
├── apps/
│   ├── root/                # 主站點 (unforgettableeternalproject.com)
│   │   ├── src/
│   │   │   ├── layouts/
│   │   │   └── pages/
│   │   ├── public/
│   │   ├── astro.config.mjs
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── uep/                 # 文件站點 (uep.unforgettableeternalproject.com)
│       ├── src/
│       │   ├── layouts/
│       │   └── pages/
│       ├── public/
│       ├── astro.config.mjs
│       ├── package.json
│       └── tsconfig.json
├── packages/
│   ├── config/              # 共用設定
│   │   ├── eslint/
│   │   ├── prettier/
│   │   ├── tsconfig/
│   │   └── package.json
│   └── ui/                  # 共用 UI 元件
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── .github/
│   └── workflows/
│       └── ci.yml           # GitHub Actions CI
├── .nvmrc                   # Node 版本 (20)
├── pnpm-workspace.yaml      # pnpm workspace 設定
├── turbo.json               # TurboRepo 設定
├── package.json             # Root package.json
└── README.md
```

## 技術棧

- **框架**: [Astro](https://astro.build) - 靜態站點生成器
- **Monorepo**: pnpm workspaces + TurboRepo
- **語言**: TypeScript
- **樣式**: CSS（內建於 Astro 元件）
- **程式碼品質**: ESLint + Prettier
- **CI/CD**: GitHub Actions
- **部署**: Cloudflare Pages

## 開發指令

### 安裝依賴

```bash
# 確保 Node 20+
node --version

# 啟用 Corepack (pnpm)
corepack enable

# 安裝所有依賴
pnpm install
```

### 開發模式

```bash
# 同時啟動所有站點（root: port 4320, uep: port 4321）
pnpm dev

# 僅啟動主站點
pnpm --filter @uep/root dev

# 僅啟動文件站點
pnpm --filter @uep/uep dev
```

### 建置

```bash
# 建置所有站點
pnpm build

# 僅建置主站點
pnpm --filter @uep/root build

# 僅建置文件站點
pnpm --filter @uep/uep build
```

### 程式碼品質

```bash
# 執行 lint
pnpm lint

# 執行型別檢查
pnpm typecheck

# 格式化程式碼
pnpm format

# 檢查格式
pnpm format:check
```

## 開發狀態

### ✅ 第一階段：Monorepo 架構建置（已完成）

- ✅ pnpm workspace + TurboRepo 設定
- ✅ 共用設定套件（@uep/config）
- ✅ 共用 UI 元件套件（@uep/ui）
- ✅ 主站點基礎（apps/root）
- ✅ 文件站點基礎（apps/uep）
- ✅ GitHub Actions CI 設定
- ✅ ESLint + Prettier + TypeScript 設定

### 📅 第二階段：內容開發（進行中）

- ⏳ 豐富主站點內容
- ⏳ 撰寫文件站點內容
- ⏳ 響應式版面設計
- ⏳ SEO 優化

### 📅 第三階段：部署與優化（規劃中）

- ⏳ Cloudflare Pages 部署
- ⏳ 網域設定
- ⏳ 效能優化
- ⏳ 監控與分析

## Workspace 套件

### @uep/root

主站點，位於 `apps/root`。

### @uep/uep

文件站點，位於 `apps/uep`。

### @uep/config

共用設定套件，包含：

- ESLint 設定（base + astro）
- Prettier 設定
- TypeScript 設定

### @uep/ui

共用 UI 元件套件（目前為骨架，含範例 Button 元件）。

## 貢獻者

❦ **Bernie** - 專案建立者與主要開發者

- GitHub: [@unforgettableeternalproject](https://github.com/unforgettableeternalproject)

## 授權

Copyright © 2025 Bernie. All rights reserved.

本專案採用 MIT 授權。詳見 [LICENSE](./LICENSE)。

---

_最後更新: 2025 年 12 月_
