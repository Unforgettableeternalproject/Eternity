-- Admin 重置進度的樂觀鎖戳記（2026-07-26）
--
-- 問題：admin 在後台把 progress 設為 NULL 之後，若該使用者當下還開著分頁，
-- ServerAdapter 的 debounce PUT 或 pagehide flush 會把重置前的本地鏡像整包
-- 寫回來，admin 的重置被悄悄復原且雙方都不知情。原本的程式碼註解只承認
-- observerEver 有此風險，實際上整個 progress blob 都有。
--
-- 解法：記錄最後一次 admin 重置的時刻。讀者端 PUT 進來時，比對 blob 內的
-- updatedAt——凡是重置時刻之前產生的快照一律拒收（409），由客戶端改為重新
-- 從伺服器 hydrate。沒有這個戳記的舊資料為 NULL，比對自動略過，向後相容。

ALTER TABLE uep_users ADD COLUMN progress_reset_at TEXT;
