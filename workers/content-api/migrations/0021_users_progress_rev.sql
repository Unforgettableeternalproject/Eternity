-- 進度同步的 server-issued revision（compare-and-swap）（2026-07-26）
--
-- 0020 的 progress_reset_at 是**時間戳**而非版本，擋不住真正的衝突：
-- admin 改寫進度後，使用者還開著的舊分頁只要再發生任何 mutation（滑一下
-- 觸發 marker-update 就夠），blob 的 updatedAt 便刷新成當下時間、比
-- progress_reset_at 新，於是整份舊 state 照樣通過檢查覆蓋掉 admin 的編輯。
-- 換句話說樂觀鎖只擋得住「完全沒動作的過期分頁」，形同虛設。
--
-- 改用伺服器發放的單調遞增版本號做 compare-and-swap：
-- - GET 回傳目前 rev，客戶端記住
-- - PUT 帶 X-Progress-Rev，UPDATE ... WHERE progress_rev = ? 才寫入並 +1
-- - 版本不符 → 409，回傳最新 rev 與 progress 供客戶端直接收斂
-- - admin 寫入同樣 +1，一次讓所有在飛的舊版本失效
--
-- progress_reset_at 保留不刪：尚未更新的前端不會送 rev header，那條路徑
-- 仍走舊的時間戳檢查（弱鎖聊勝於無）。待兩站前端全面上線後可改為強制。

ALTER TABLE uep_users ADD COLUMN progress_rev INTEGER NOT NULL DEFAULT 0;
