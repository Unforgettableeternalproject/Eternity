# Release 工作流程

> 本文件描述 Eternity 專案從開發到正式上線的完整 release 流程。

## 流程總覽

```
develop → release/vX.Y.Z → staging 自動部署 → 驗證
        → 正式 D1 migration → Worker 部署 → main（Pages 自動部署）→ smoke
```

> ⚠️ **merge 到 main 不等於全站上線。** Cloudflare Pages（兩個前端站）由 main
> 自動部署，但三個 Worker 一律是手動 `pnpm deploy:*`，D1 migration 也不會跟著
> 跑。只 merge 不部署 Worker，等於把新前端接到舊 API 上——本輪 v1.0.0 就發生過
> 「正式 migration 0026 已套、新版 content-api 未部署」的狀態。詳見階段 7。

```mermaid
graph LR
    A[develop] -->|建立 release 分支| B[release/vX.Y.Z]
    B -->|每次 commit| C[staging 自動部署]
    C --> D{驗證階段}
    D -->|文件更新| E[README / CLAUDE.md]
    D -->|自動化測試| F[Vitest + Playwright]
    D -->|Code Review| G[關鍵元件審查]
    D -->|自動化壓測| H[深度 E2E 測試]
    D -->|手動壓測| I[公測 / 使用者測試]
    E & F & G & H & I -->|全部通過| P[正式 D1 migration]
    P --> Q[部署三個 Worker]
    Q --> J[PR → main]
    J --> K[Pages 自動部署]
    K --> L[正式 smoke 驗證]
```

## 階段詳細說明

### 階段 0：準備 Release 分支

從 `develop` 建立 release 分支，命名規則：`release/vX.Y.Z`

**版本號慣例：**

- 一般版本：`vX.Y.Z`（如 `v0.9.8`）
- 小型更新：`vX.Y.Z.N` 四段流水號（如 `v0.9.8.2`），用於 UI 微調、功能小改等不足以進位 Z 的更新
- 後綴（`-stable`、`-hotfixN`）由 CI 自動加上，不要手動寫進 package.json
- ci.yml 的 release/hotfix 偵測 regex 已支援可選第四段（`v[0-9]+\.[0-9]+\.[0-9]+(\.[0-9]+)?`）

```bash
git checkout develop
git checkout -b release/vX.Y.Z
git push origin release/vX.Y.Z
```

**注意：** 推送到 release 分支會觸發 staging 自動部署（與推送到 `staging` 分支效果相同）。

此階段需完成：
- [ ] `package.json` 版本號 bump
- [ ] 確認環境變數設定完整

### 階段 1：系統文件更新

更新所有面向開發者的文件，確保反映當前系統狀態。

#### 清單

| 文件 | 說明 | 更新方式 |
|------|------|----------|
| `README.md` | 英文版根目錄 README | 手動更新 |
| `README.zh-tw.md` | 繁體中文版 | 與英文版同步 |
| `apps/uep/README.md` | 文件站專屬說明 | 手動更新 |
| `.claude/CLAUDE.md` | AI 工作指引 | 確認反映新增功能 |

#### 更新重點

- 技術棧變更
- 新增的功能 / zone / 元件
- 新的開發指令（如測試指令）
- 開發狀態（已完成 / 進行中 / 計劃中）
- 部署架構變更

### 階段 2：自動化測試基礎設施

確保測試基礎設施完整且全部通過。

#### 三層測試架構

| 層級 | 工具 | 指令 | 說明 |
|------|------|------|------|
| 前端單元 | Vitest + jsdom | `pnpm test` | hooks、工具函式、元件邏輯 |
| Worker | Vitest + cloudflare pool | `pnpm test:workers` | D1 API、KV 操作、CORS |
| E2E 煙霧 | Playwright | `pnpm test:e2e` | 頁面載入、白屏防護、API 健康 |

```bash
# 一次全跑
pnpm test:all     # 單元 + Worker
pnpm test:e2e     # E2E（需要 dev server 在運行）
```

#### 新增測試的原則

- **P0 關鍵路徑優先**：首頁捲動、Zone 轉場、Reader 資料載入
- **回歸測試**：每次修 bug 都補一個對應的測試案例
- **Worker API**：每新增端點都補整合測試

### 階段 3：Code Review

由 reviewer 對關鍵元件進行系統性審查。

#### 審查範圍

- **P0 風險點**：首頁捲動狀態機、Zone boot 轉場、Reader 資料載入
- **資料一致性**：D1 API 的 CRUD 和同步邏輯
- **安全性**：Admin 認證 middleware、API token 驗證
- **效能**：大量資料的 tree 建構、圖片載入策略
- **行動裝置**：響應式佈局、觸控互動

#### 審查產出

- 問題清單（依嚴重度分級：P0 / P1 / P2）
- 修復建議
- 可選的重構建議（標記為「正式機後」）

### 階段 4：自動化壓力測試

用 Playwright 撰寫深度互動測試，模擬真實使用者行為。

#### 測試場景

| 場景 | 描述 |
|------|------|
| 首頁完整旅程 | 載入 → Lobby 動畫 → 向下捲動 → 進入各 Zone |
| Zone Reader 載入 | 進入 Zone → 等待 boot 動畫 → 展開內容 → 導航頁面 |
| 編輯器操作 | 開啟 Admin → 選擇區域 → 編輯內容 → 儲存 |
| 行動版互動 | 觸控捲動 → Zone 切換 → Reader 使用 |
| 極端情況 | 快速連續 Zone 切換、返回再前進、深層 deep link |

### 階段 5：手動壓力測試（公測）

開發者 / 測試者在 staging 環境親自操作，記錄問題。

#### 測試清單

```markdown
## 桌面版
- [ ] 首頁載入完整，Lobby 動畫正常
- [ ] 向下捲動：所有 Zone 進場動畫正常觸發
- [ ] 向上捲動：不會卡在任何位置
- [ ] 3D 地圖：點擊各 Zone 可正確導航
- [ ] 每個 Zone 的 Reader 可正常載入內容
- [ ] Admin 後台可登入、編輯、儲存
- [ ] 媒體庫可上傳、刪除圖片

## 行動版
- [ ] 首頁觸控捲動流暢
- [ ] Zone 切換不卡頓
- [ ] Reader 內容正常顯示
- [ ] 文字不溢出、圖片不超框

## 效能
- [ ] 首次載入 < 3 秒（Desktop LTE）
- [ ] Zone 切換轉場 < 1 秒
- [ ] Reader 內容載入 < 2 秒

## 邊界情況
- [ ] 重新整理任何頁面不會白屏
- [ ] Deep link 直接進入 Zone 頁面可正常載入
- [ ] 瀏覽器返回/前進按鈕行為正確
```

### 階段 6：修復與收斂

根據 Code Review + 自動化測試 + 手動測試的結果，修復所有問題。

#### 優先順序

1. **P0（阻塞上線）**：白屏、資料遺失、安全漏洞
2. **P1（必須修復）**：互動中斷、動畫故障、行動版嚴重排版問題
3. **P2（應該修復）**：文案錯字、微小的樣式不一致、非關鍵路徑的 bug
4. **標記為「正式機後」**：可改善但不影響上線的項目

#### 修復流程

每次修復都在 release 分支上進行：

```bash
# 修復 → commit → 自動部署 staging → 驗證
git add .
git commit -m "fix: 修復首頁捲動卡死問題"
# staging 自動更新，去 staging URL 驗證
```

### 階段 7：正式環境部署（Worker 與 D1）

**在 merge 到 main 之前完成。** 前端由 Pages 隨 main 自動部署，Worker 與 D1 不會——
順序顛倒的話，新前端會打到舊 API。

#### 7-1 版本相容檢查

先確認這一輪的 Worker 改動是否向後相容（新 API 要能被舊前端呼叫，新 schema 要能被舊
Worker 讀）。任一項不相容就必須排出停機窗口或改成兩階段發布（先加後刪）。

| 檢查 | 怎麼看 |
|------|--------|
| 新增 migration | `git diff main -- workers/*/migrations/` |
| 端點簽章變更 | `git diff main -- workers/*/src/` 找 `path ===` 與回應欄位 |
| 移除欄位／端點 | 舊前端仍在正式站跑，移除一律要兩階段 |
| 新增必要 secret / var | 部署前先 `wrangler secret put`，否則新版一上線就 fail closed |

#### 7-2 套用正式 D1 migration

```bash
pnpm act db:migrate:remote      # 危險項，需輸入確認字串
```

⚠️ 套完衍生表相關的 migration 要補建索引，否則觸發模型靜默失效：

```bash
pnpm act interlink:reindex:remote
```

#### 7-3 部署 Worker

只部署這一輪有改動的；不確定就三個都部署（冪等）。

```bash
pnpm act deploy:content-api      # 內容 / 進度 / 資產 API
pnpm act deploy:visitor          # 訪客計數
pnpm act deploy:discord-widget   # Discord widget 同步
```

#### 7-4 API smoke 驗證

Worker 部署後、merge 之前先確認 API 活著。以下指令是 bash 語法
（`head`、反斜線續行），在 PowerShell 不能照貼——請開 Git Bash 執行：

```bash
curl -s https://eternity-content-api.ptyc4076.workers.dev/api/content/history | head -c 200
curl -s -o /dev/null -w '%{http_code}\n' \
  https://eternity-content-api.ptyc4076.workers.dev/api/uep/alias/roll
```

- [ ] 內容端點回 `ok: true`
- [ ] 讀者端點回 200（回 503 代表 `JWT_SECRET` 沒設到，認證已 fail closed）
- [ ] 本輪新增／變更的端點各打一次
- [ ] 舊前端（正式站尚未更新）仍能正常讀取

#### 7-5 Rollback

| 出問題的層 | 回復方式 |
|------------|----------|
| Worker | `pnpm --filter <worker> exec wrangler rollback`（Cloudflare 保留前一版；緊急回復是少數直接動 wrangler 的例外），或 checkout 上一個 tag 重新 `pnpm deploy:*` |
| 前端 | Cloudflare Pages dashboard 將前一次 deployment 設為 production |
| D1 migration | **無自動回復**——這是 7-1 要求向後相容的理由。真的要退，只能手寫反向 SQL |

### 階段 8：合併到 main

Worker 與 D1 就緒、smoke 通過後：

```bash
# 確認所有測試通過
pnpm check
pnpm test:all
pnpm test:e2e

# 建立 PR: release/vX.Y.Z → main
# PR 通過後合併，Pages 自動部署前端
```

**⚠️ 合併後不要刪除 release／hotfix 分支，直到 CI 的 sync-back 跑完。**
sync-back 是拿**原分支**（不是 main）合回 develop——merge-base 正是 develop
切出它的那一點，diff 只有這批 commit，develop 直接 ff 且拿到完整歷史。
分支若已不在，job 會退回 `head=main`，那條路徑的 merge-base 會因為 squash
退到上一版，整包 diff 對上 develop 既有的相同變更就是滿版衝突（v1.0.0 卡過）。

分支名由 CI 依 `{branch_type}/v{version}` 推導，所以**分支命名必須守慣例**
（`release/v1.0.0`、`hotfix/v1.0.0`）。命名不合就會走進上述 fallback。

走 fallback 時（或想多一層保險）才需要這個合併前置：

```bash
git checkout develop
git merge --ff-only release/vX.Y.Z   # release 從 develop 切出，必為 ff
git push origin develop
```

做了也無害——develop 已對齊時，sync-back 的 merge 會是 no-op（204）。

合併後的正式驗證：

- [ ] 兩站首頁載入正常、無白屏
- [ ] Admin 可登入（認證未因 secret 缺漏而 fail closed）
- [ ] 讀者註冊／登入／進度同步可用
- [ ] PageSpeed Insights 量測（正式機才有意義）

## 分支清理

合併後清理：

```bash
git branch -d release/vX.Y.Z
git push origin --delete release/vX.Y.Z
```

## 快速參考

```bash
# Release 階段常用指令
pnpm check                    # 全面品質檢查
pnpm test:all                 # 全部單元 + Worker 測試
pnpm test:e2e                 # E2E 煙霧測試
pnpm test:e2e --headed        # E2E 可視化模式
git push origin HEAD:staging  # 推送到 staging 預覽

# 正式部署（階段 7，merge 之前）
pnpm act db:migrate:remote        # 套正式 D1 migration
pnpm act interlink:reindex:remote # 補建衍生表（有相關 migration 才需要）
pnpm act deploy:content-api       # 部署 Worker
```
