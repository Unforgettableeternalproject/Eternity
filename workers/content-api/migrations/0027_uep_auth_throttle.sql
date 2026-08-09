-- 讀者認證節流（register / login）
--
-- 原本只有「失敗時固定延遲 200ms」，那擋不住並行——同時發出的請求各自
-- 睡自己的 200ms，密碼字典可以整批試。公開註冊也沒有任何上限，能直接灌爆
-- uep_users。
--
-- 計數走 D1 而非 KV：content-api 沒有 KV binding，新增等於多一個要建立與
-- 綁定的資源，而 auth 端點的流量本來就低，D1 的一次 UPSERT 綽綽有餘。
-- 關鍵是那個 UPSERT 必須「先計數再判斷」（見 uep-throttle.ts），read-then-write
-- 在並行下和原本的 200ms 一樣形同虛設。
CREATE TABLE IF NOT EXISTS uep_auth_throttle (
  -- 'ip:<ip>:login' / 'ip:<ip>:register' / 'user:<identifier>'
  bucket_key TEXT PRIMARY KEY,
  -- 目前窗口內的嘗試次數
  count INTEGER NOT NULL DEFAULT 0,
  -- 窗口起點（epoch seconds），過期即整筆重置
  window_start INTEGER NOT NULL,
  -- 連續失敗達門檻後的鎖定到期時間（epoch seconds），null 表示未鎖定
  locked_until INTEGER
);

-- cron 清理過期桶用
CREATE INDEX IF NOT EXISTS idx_uep_auth_throttle_window
  ON uep_auth_throttle(window_start);
