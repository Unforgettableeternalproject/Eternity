# 查看 Cloudflare Pages Functions 日誌

## 方法 1: Cloudflare Dashboard（推薦）

1. 前往 https://dash.cloudflare.com
2. 選擇帳號
3. 進入 **Workers & Pages**
4. 選擇 **eternity-8v7** 專案
5. 點擊 **View details**
6. 選擇 **Functions** 標籤
7. 點擊 **Begin log stream** 或 **Real-time logs**
8. 回到測試機網站發送郵件
9. 即時觀察日誌輸出

## 方法 2: 使用 Wrangler CLI（需要安裝）

```powershell
# 安裝 Wrangler
npm install -g wrangler

# 登入
wrangler login

# 查看即時日誌
wrangler pages deployment tail --project-name=eternity-8v7 --environment=preview
```

## 方法 3: 瀏覽器 Network 標籤（最快）

1. 打開測試機網站
2. F12 打開開發者工具
3. 切換到 **Network** 標籤
4. 勾選 **Preserve log**
5. 發送郵件
6. 點擊失敗的 **contact.json** 請求
7. 查看 **Response** 標籤的詳細錯誤訊息

## 檢查事項

從錯誤回應中確認：
- `statusCode`: MailChannels API 返回的狀態碼
- `details`: MailChannels 的詳細錯誤訊息
- 如果是 401: DNS 記錄問題
- 如果是 403: 域名授權問題
- 如果是 400: 請求格式問題
