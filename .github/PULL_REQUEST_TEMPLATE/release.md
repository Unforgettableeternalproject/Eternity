## Release version vX.Y.Z deploy to main. MM/DD

<!-- ⬆️ 請直接修改上方標題作為 PR 標題 -->

### 版本資訊

- **Release 版本**: vX.Y.Z
- **對應 branch**: `release/vX.Y.Z`
- **package.json version**: <!-- 確認已更新 -->

### 變更摘要

<!-- 列出此版本的主要變更，可以用 commit group 整理 -->

#### 新功能

-

#### 修復

-

#### 重構 / 其他

-

### 部署確認

- [ ] `package.json` 版本號已更新至 vX.Y.Z
- [ ] `pnpm check` 通過（lint → typecheck → format:check → build）
- [ ] `pnpm test:all` 通過（單元 + Worker 測試）
- [ ] `pnpm test:e2e` 通過（E2E 煙霧測試）
- [ ] staging 已驗證通過
- [ ] Worker 如有變更已部署至 staging 環境測試

### 合併方式

> ⚠️ 請使用 **Squash and merge**
> CI 會自動：建立 `vX.Y.Z-stable` tag → sync back to develop → force reset staging
