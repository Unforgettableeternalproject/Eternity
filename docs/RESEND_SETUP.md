# Resend 郵件服務設置指南

## 為什麼選擇 Resend？

- ✅ **免費額度**：每月 3000 封郵件
- ✅ **簡單可靠**：無需複雜的 DNS 配置（SPF、DKIM 自動處理）
- ✅ **現代化 API**：清晰的文檔和錯誤訊息
- ✅ **快速設置**：5 分鐘內完成

## 設置步驟

### 1. 註冊 Resend 帳號

1. 前往 https://resend.com
2. 點擊 **Sign Up**
3. 使用 GitHub 或 Email 註冊

### 2. 獲取 API Key

1. 登入後，點擊左側 **API Keys**
2. 點擊 **Create API Key**
3. 名稱：`Eternity Contact Form`
4. 權限：**Sending access** (預設即可)
5. 點擊 **Add**
6. **複製 API Key**（只會顯示一次！）

### 3. 添加並驗證域名

1. 點擊左側 **Domains**
2. 點擊 **Add Domain**
3. 輸入：`unforgettableeternalproject.com`
4. Resend 會顯示需要添加的 DNS 記錄

#### DNS 記錄（在 Cloudflare 添加）

Resend 會要求添加這些記錄（數值可能不同，以 Resend 顯示為準）：

```
TXT  @ 或 unforgettableeternalproject.com
值: resend-verification=xxxxx

TXT  _dmarc
值: v=DMARC1; p=none;

CNAME  resend._domainkey
值: resend._domainkey.resend.com
```

5. 在 Cloudflare DNS 添加這些記錄
6. 回到 Resend，點擊 **Verify DNS Records**
7. 等待驗證成功（通常幾分鐘）

### 4. 在 Cloudflare Pages 設置環境變數

1. 前往 Cloudflare Dashboard
2. **Workers & Pages** → 選擇 **eternity-8v7**
3. 點擊 **Settings** 標籤
4. 點擊 **Environment variables**
5. 添加新變數：
   - **Variable name**: `RESEND_API_KEY`
   - **Value**: 你的 Resend API Key（re_xxxxxxxxx）
   - **Environment**: 選擇 **Production** 和 **Preview**
6. 點擊 **Save**

### 5. 重新部署

環境變數設置後，需要重新部署：

**選項 A：推送新的 commit**
```bash
git add .
git commit -m "chore: switch to Resend email service"
git push
```

**選項 B：在 Cloudflare 手動觸發部署**
1. **Workers & Pages** → **eternity-8v7**
2. **Deployments** 標籤
3. 點擊最新部署的 **三個點 (⋯)**
4. 選擇 **Retry deployment**

### 6. 測試郵件發送

1. 前往你的網站聯絡頁面
2. 填寫並發送測試郵件
3. 檢查是否成功（應該會看到成功訊息）
4. 查看信箱確認收到郵件

## 查看郵件日誌

在 Resend Dashboard：
- 點擊 **Emails** 查看所有已發送的郵件
- 可以看到狀態、收件人、時間等資訊

## 疑難排解

### 錯誤：`RESEND_API_KEY environment variable not set`
- 確認已在 Cloudflare Pages 設置環境變數
- 確認已重新部署

### 錯誤：`Domain not verified`
- 確認 DNS 記錄已正確添加
- 在 Resend 點擊 **Verify DNS Records**
- 等待 DNS 傳播（最多 24 小時）

### 測試環境 vs 生產環境

如果只想在生產環境使用，Preview 環境可以不設定。
如果 Preview 也要測試，記得兩個環境都要添加 `RESEND_API_KEY`。

## 費用

- **免費額度**：每月 3000 封
- **超過後**：$1.00 / 1000 封
- 對於聯絡表單來說，免費額度綽綽有餘

## 遷移完成！

✅ 程式碼已更新為使用 Resend  
✅ DNS 配置更簡單（Resend 自動處理）  
✅ 更好的錯誤訊息和日誌  
✅ 免費且可靠  

---

**注意**：舊的 MailChannels DNS 記錄可以保留或刪除（不會影響 Resend）。
