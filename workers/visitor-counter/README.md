# Cloudflare Workers 訪客計數器部署指南

## 前置需求

1. Cloudflare 帳號
2. 已安裝 Node.js 和 pnpm
3. Wrangler CLI（會自動安裝）

## 部署步驟

### 1. 安裝依賴

```bash
cd workers/visitor-counter
pnpm install
```

### 2. 登入 Cloudflare

```bash
pnpm wrangler login
```

### 3. 創建 KV 命名空間

```bash
pnpm wrangler kv:namespace create VISITOR_STATS
```

這會輸出類似：

```
🌀 Creating namespace with title "visitor-counter-worker-VISITOR_STATS"
✨ Success!
Add the following to your configuration file in your kv_namespaces array:
{ binding = "VISITOR_STATS", id = "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
```

### 4. 更新配置

將步驟 3 輸出的 `id` 複製到 `wrangler.toml` 中：

```toml
[[kv_namespaces]]
binding = "VISITOR_STATS"
id = "你的實際 KV namespace ID"  # 替換這裡
```

同時更新 `ALLOWED_ORIGINS`：

```toml
[vars]
ALLOWED_ORIGINS = "https://你的實際域名.com,http://localhost:4321"
```

### 5. 部署 Worker

```bash
pnpm deploy
```

成功後會顯示 Worker URL，例如：

```
https://visitor-counter.你的子域名.workers.dev
```

### 6. 更新前端環境變數

在 `apps/root/` 目錄創建 `.env` 文件：

```bash
cd ../../apps/root
cp .env.example .env
```

編輯 `.env`，設置 Worker URL：

```env
PUBLIC_VISITOR_API_URL=https://visitor-counter.你的子域名.workers.dev
```

### 7. 在 Cloudflare Pages 設置環境變數

1. 前往 Cloudflare Dashboard
2. 選擇你的 Pages 專案
3. 進入 Settings > Environment Variables
4. 添加：
   - **變數名稱**: `PUBLIC_VISITOR_API_URL`
   - **值**: `https://visitor-counter.你的子域名.workers.dev`
   - **環境**: Production 和 Preview 都選擇

### 8. 測試

開發環境測試：

```bash
cd workers/visitor-counter
pnpm dev
```

訪問 http://localhost:8787/api/visitor/count 應該返回：

```json
{ "totalVisitors": 0 }
```

## API 端點

### GET /api/visitor/count

獲取總訪客數

**回應**:

```json
{
  "totalVisitors": 123
}
```

### POST /api/visitor/track

追蹤新訪客（基於 IP + User Agent 指紋識別）

**回應**:

```json
{
  "totalVisitors": 124,
  "tracked": true
}
```

## 訪客識別邏輯

- 使用 `IP + User Agent` 生成唯一指紋
- 24 小時內同一指紋不重複計數
- 指紋記錄保存 30 天後自動過期

## 開發模式

```bash
# 在 workers/visitor-counter 目錄
pnpm dev
```

本地開發時會在 http://localhost:8787 啟動 Worker。

## 故障排除

### CORS 錯誤

確保 `wrangler.toml` 中的 `ALLOWED_ORIGINS` 包含你的域名。

### KV 數據不同步

KV 有最終一致性，寫入後可能需要幾秒才能在所有邊緣節點生效。

### 計數不準確

這是一個簡單的實現，基於 IP + UA 的指紋識別不是 100% 準確。如果需要更精確的追蹤，考慮使用：

- Cloudflare Web Analytics（官方服務）
- Google Analytics
- Plausible Analytics

## 成本

- Cloudflare Workers: 每天 100,000 次請求免費
- KV Storage: 1GB 儲存空間 + 每天 100,000 次讀取免費

對於個人網站來說完全免費。
