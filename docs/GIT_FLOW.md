# Git Flow 與 CI/CD 規範

> 本文件記錄 Eternity 專案的分支策略、PR 規範、CI 自動化流程。
> 可作為其他 U.E.P 專案的參考基礎。

## 分支策略

```
main (production)     ← 只接受 release/* 和 hotfix/* 的 squash merge
  ↕ CI auto-sync
develop (日常開發)    ← 接受 feature/*、fix/* 的 squash merge
  ↕ PR
staging (測試部署)    ← 接受 develop、feature/* 的 squash merge；release 後自動 force-reset 對齊 main
```

### 分支類型

| 分支 | 從何處建立 | 合併目標 | 用途 |
|------|-----------|---------|------|
| `feature/*` | develop | develop, staging | 新功能開發 |
| `fix/*` | develop | develop | 小修復，不需要走 staging |
| `release/vX.Y.Z` | develop | main | 版本發佈準備 |
| `hotfix/vX.Y.Z` | main | main | 緊急修復正式環境 |

### 生命週期

- **feature/fix 分支**：開發完成 → PR 到 develop（或 staging 測試）→ squash merge → 刪除分支
- **release 分支**：從 develop 建立 → 在 staging 測試 → PR 到 main → squash merge → CI 自動打 tag、sync develop、force-reset staging → 刪除分支
- **hotfix 分支**：從 main 建立 → 修復 → PR 到 main → squash merge → CI 自動打 tag、sync develop → 刪除分支

## PR 規範

### 合併方式

**一律使用 Squash and merge**，確保每個 PR 在目標分支上只有一個 commit。

### PR 標題格式

| 路徑 | 標題格式 | 範例 |
|------|---------|------|
| develop → staging | `Regular develop to staging #N. MM/DD` | `Regular develop to staging #11. 06/03` |
| feature/* → staging | `Feature/<name> to staging. MM/DD` | `Feature/main site redesign to staging. 05/30` |
| feature/* → develop | `Feature/<name> to develop. MM/DD` | `Feature/storage implementation to develop. 05/18` |
| fix/* → develop | `Fix/<name> merge back to develop. MM/DD` | `Fix/ci lint issue merge back to develop. 12/23` |
| release/* → main | `Release version vX.Y.Z deploy to main. MM/DD` | `Release version v0.9.8 deploy to main. 06/01` |
| hotfix/* → main | `Hotfix vX.Y.Z batch #N: <描述>. MM/DD` | `Hotfix v0.9.6 batch #1: Fixed editor issue. 05/20` |

> ⚠️ **release 和 hotfix 的標題格式是 CI 偵測的依據**，不要隨意修改。

### PR 模板

建立 PR 時可在 URL 加上 `?template=<名稱>.md` 使用專用模板：

- `?template=release.md` — release → main
- `?template=hotfix.md` — hotfix → main
- `?template=staging.md` — develop/feature → staging
- `?template=feature.md` — feature → develop
- `?template=fix.md` — fix → develop

### PR 前檢查清單

在提交 PR 前，依序在 repo root 執行：

```bash
pnpm check        # lint → typecheck → format:check → build（一條指令全搞定）
```

**Release 到 main 額外要求：**

```bash
pnpm test:all     # 單元測試 + Worker 整合測試
pnpm test:e2e     # E2E 煙霧測試（需 dev server 運行中）
```

## CI/CD 自動化

### 觸發矩陣

| 事件 | 分支 | CI Job | 動作 |
|------|------|--------|------|
| push / PR | main, develop, staging | `ci` | lint + typecheck + format + build |
| push | develop | `tag-develop` | 版本變動時自動打 `vX.Y.Z` tag |
| push | main | `tag-production` | 偵測 release/hotfix → 打 tag → sync → GitHub Release |
| push (paths: workers/**) | main, staging | `deploy-workers` | 自動部署變更的 Worker |

### tag-production 流程（main 分支）

當 squash commit 進入 main 時，CI 會依標題偵測類型：

```
Release version vX.Y.Z deploy to main. MM/DD
  → 打 vX.Y.Z-stable tag
  → merge main 回 develop（附 [skip ci]）
  → force-reset staging 對齊 main
  → 建立 GitHub Release

Hotfix vX.Y.Z batch #N: <描述>. MM/DD
  → 打 vX.Y.Z-hotfixN tag
  → merge main 回 develop（附 [skip ci]）
  → staging 不動
  → 建立 GitHub Release（標記為 prerelease）
```

### Tag 命名規範

| 類型 | 格式 | 範例 |
|------|------|------|
| 開發版本 | `vX.Y.Z` | `v0.9.8` |
| 正式發佈 | `vX.Y.Z-stable` | `v0.9.8-stable` |
| 緊急修復 | `vX.Y.Z-hotfixN` | `v0.9.6-hotfix1` |

### Commit 訊息

使用 [Conventional Commits](https://www.conventionalcommits.org/)：

- `feat:` — 新功能
- `fix:` — 修復
- `refactor:` — 重構（不改變行為）
- `docs:` — 文件
- `chore:` — 維護性工作
- `test:` — 測試

## Cloudflare 部署

詳見 [CLAUDE.md](../CLAUDE.md) 的「Cloudflare 部署」章節。

推送到 staging 測試：

```bash
git push origin develop:staging    # 快速推送（如果 staging 已是 develop 的子集）
# 或建立 PR：develop → staging
```

## 未來考慮

- [ ] Discord Webhook 通知（release/hotfix 時推送到伺服器）
- [ ] 自動 Changelog 生成（參考 Core 的 `update-version-history.yml`，或改用 `changesets` / `release-please`）
- [ ] 將此 Git Flow 抽象為 Claude Code skill，新專案可快速初始化
