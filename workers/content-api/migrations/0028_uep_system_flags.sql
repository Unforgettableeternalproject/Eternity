-- UEP 系統旗標預註冊
--
-- `uep-` 開頭的旗標與其他自訂旗標不同：它們不是某一篇文章授予的劇情標記，
-- 而是「讀者與 UEP 之間發生過什麼」的系統級狀態——由站台行為（進站、走完
-- 五區、解鎖浮島、遇上 AFK 迷霧、參加茶會、從主站穿過 portal）授予，
-- 供 Storage 的對話 gate 消費。
--
-- 為什麼要預註冊而不是沿用「自由填 → 存檔建殼列」（見 FlagPicker 的說明）：
-- 那個模式適合劇情旗標——名字由寫的人當場決定，事後補說明即可。系統旗標
-- 反過來，名字是程式碼裡的常數，編輯端只能引用不能發明。先把清單放進註冊表，
-- 編輯器才有辦法把 gate 的候選限縮成這一份（打錯一個字的症狀是永久靜默鎖死）。
--
-- 授予端一律在 apps/uep：`progress/uepFlags.ts` 是名稱的唯一事實來源，
-- 這張表只是給編輯器 picker 與巡查儀表板看的說明。改名要兩邊一起改。
--
-- ⚠️ `uep:teatime` 早於本 migration 就存在並且已在授予（茶會彩蛋），
-- 整個系列的 `uep:` 前綴就是沿用它——不要「順手」改成 `uep-`，那會讓
-- 已經去過茶會的讀者手上那支旗標失效。
--
-- 冪等：INSERT OR IGNORE，重跑不覆蓋已編輯過的 label/description。

INSERT OR IGNORE INTO uep_flags (name, label, description, category) VALUES
  (
    'uep:intro',
    '初次照面',
    '進過這個網站就給予。其他 uep 旗標的共同前提。',
    'system'
  ),
  (
    'uep:all-zone',
    '走遍五區',
    '造訪過 history / echoes / visuals / concepts / storage 全部五個區域後解鎖。',
    'system'
  ),
  (
    'uep:all-island',
    '浮島盡出',
    '五座浮島全數解鎖後給予。',
    'system'
  ),
  (
    'uep:afk',
    '迷霧之中',
    '見過 AFK 迷霧後解鎖。',
    'system'
  ),
  (
    'uep:teatime',
    '茶會座上',
    '見過有 UEP 的茶會後解鎖。',
    'system'
  ),
  (
    'uep:from-far',
    '自遠方而來',
    '已持有 uep:intro 的讀者，再從主站經 portal 進入文件站時獲得。',
    'system'
  );
