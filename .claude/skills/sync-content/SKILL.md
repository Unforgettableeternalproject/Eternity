---
name: sync-content
description: 互動式內容同步工作流——自動預覽差異、確認後執行，支援指定方向和區域
disable-model-invocation: true
---

# 內容同步工作流

## 前提

- 本地 content-api worker 必須在運行中（port 8788）
- 如果 worker 沒在運行，告知使用者而非自行啟動

## 參數

- `push` — 本地 → 遠端（本地贏）
- `pull` — 遠端 → 本地（遠端贏）
- `area <name>` — 只同步指定區域（history、echos、visuals、concepts、storage、portal）
- 無參數時進入互動模式

## 步驟

1. **檢查 worker 狀態**：`curl -s http://localhost:8788/api/content/history` 確認 worker 是否在線
   - 如果失敗，告知使用者需要啟動 worker 並停止

2. **Dry Run 預覽**：根據參數執行 `node scripts/sync-content.mjs --dry-run [--push|--pull] [--area <name>]`
   - 展示將變更的項目清單

3. **等待使用者確認**：顯示差異摘要，詢問是否繼續

4. **執行同步**：確認後執行實際同步指令

## ⚠️ 安全規則

- **絕不使用** `migrate-history.mjs --clean`，除非使用者明確要求且已二次確認
- `--clean` 會覆蓋所有手動編輯的 metadata 和 icon
- 建議用 `sync-content.mjs` 做增量同步取代 clean 匯入

## 範例用法

```
/sync-content push area history
/sync-content pull
/sync-content               # 互動模式
```
