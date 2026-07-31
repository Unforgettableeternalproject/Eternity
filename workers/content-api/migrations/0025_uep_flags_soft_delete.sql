-- 旗標註冊表的軟刪除（Epic 2 S10-3 審查修補）
--
-- 硬刪除在雙向同步下不可持久：`pnpm sync` 的 diff 把「單邊不存在」一律
-- 當成「僅存在另一端」複製回去，於是本地刪掉的旗標下一次同步就從遠端
-- 復活，遠端刪的亦然。刪除要能傳播，兩端就必須看得到「這一列被刪了」，
-- 而不是「這一列不在」。
--
-- 做法與主站五張 root_* 表一致（deleted_at + include_deleted 查詢參數 +
-- sync 的刪除傳播），不另創一套語意。
ALTER TABLE uep_flags ADD COLUMN deleted_at TEXT;

-- 一般查詢一律過濾 deleted_at IS NULL，只有同步會帶著墓碑一起讀。
CREATE INDEX IF NOT EXISTS idx_uep_flags_deleted_at ON uep_flags(deleted_at);
