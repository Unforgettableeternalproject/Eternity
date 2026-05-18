---
name: deploy-check
description: 執行完整的 PR 前品質檢查（lint → typecheck → format:check → build），失敗時嘗試自動修復
disable-model-invocation: true
---

# 部署前品質檢查

## 任務

執行 `pnpm check`（lint → typecheck → format:check → build）的完整品質檢查流程。

## 步驟

1. **Lint 檢查**：執行 `pnpm lint`
   - 如果失敗，嘗試 `pnpm lint --fix` 自動修復後重跑
   - 列出仍無法自動修復的錯誤

2. **TypeScript 型別檢查**：執行 `pnpm typecheck`
   - 如果失敗，列出型別錯誤並嘗試修復明顯的型別問題
   - 注意：Windows 環境下 `apps/root` 可能出現 Vite cache `EPERM` 錯誤，這是檔案系統噪音，非程式碼問題

3. **格式檢查**：執行 `pnpm format:check`
   - 如果失敗，執行 `pnpm format` 自動修正格式

4. **建置**：執行 `pnpm build`
   - 如果失敗，分析建置錯誤原因

## 輸出

回報每個步驟的 ✅ 通過 / ❌ 失敗 狀態，以及自動修復的項目清單。

## 範例

```
✅ Lint — 通過
✅ TypeCheck — 通過（1 個 EPERM 噪音已忽略）
⚠️ Format — 已自動修正 3 個檔案
✅ Build — 通過
```
