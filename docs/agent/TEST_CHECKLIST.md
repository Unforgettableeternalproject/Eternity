# Eternity 手動驗收清單（S1 ~ S11）

> 對應 `docs/release-workflow.md` 階段 5「手動壓力測試（公測）」。
> 本清單涵蓋 Epic 2（進度系統）全段交付，範圍是 **自動化測不到的部分**——
> 需要真人操作、真實瀏覽器、或跨 session／跨裝置才能觀察到的行為。
>
> 已有自動化覆蓋的項目在各節標註 `[E2E]` 或 `[unit]`，不必手動重測，
> 列出只是為了讓清單完整可對照。

## 為什麼這份清單存在

Epic 2 有數個缺陷是**只有真人操作才會發現**的，寫進這裡當作前車之鑑：

- **「掛載 ≠ 展開」**：Echo Spot 在浮島收合時照樣播音樂，而島是唯一的
  播放控制入口。自動化測試把島 mock 成恆為 `mounted + open`，這個中間態
  永遠測不到（S8，2026-07-21 發現）。
- **非同步的 supersede race**：兩個 echo spot 相繼觸發時，前者的
  `play()` 被後者 abort，失敗回滾把後者踩掉。真實瀏覽器的 `play()` 在
  音檔載入期間是 pending，這個窗口很寬；jsdom 下幾乎不會重現（S10）。
- **行動版動態工具列**：掃描線的 `rootMargin` 落點在 iOS Safari 工具列
  收合時會偏移。Chrome DevTools 裝置模擬與 Playwright viewport resize
  都無法重現，**需要真機**（S11）。

> 通則：凡是牽涉 **時序、音訊、真實捲動、跨 session、跨裝置** 的行為，
> 一律以手動驗收為準。

---

## 環境準備

### 目標環境

| 環境 | 網址 | 資料來源 |
| --- | --- | --- |
| staging（uep） | `https://staging.eternity-uep.pages.dev/` | test worker + test D1 |
| staging（root） | `https://staging.eternity-root.pages.dev/` | test worker + test D1 |
| 正式（uep） | `https://uep.unforgettableeternalproject.com` | 正式 worker |
| 正式（root） | `https://unforgettableeternalproject.com` | 正式 worker |

> ⚠️ staging 正確網址是 `staging.eternity-uep.pages.dev`，
> **不是** `staging-uep.pages.dev`。

### 切到 test 環境

三種方式擇一：

1. 兩站 `/admin` dashboard 的 `AdminTestModeControl` 一鍵切換
2. uep 站 DevTools（`Ctrl+Shift+D`）內的對應 action
3. DevTools console：
   ```js
   document.cookie = 'uep-test-api-url=https://eternity-content-api-test.ptyc4076.workers.dev; path=/';
   ```

切換成功的標誌：每個 layout 頂端出現 **TEST MODE banner**。

### 常用開關

```js
// 跳過入場儀式（test 與正式是兩個 key，別搞混）
localStorage['uep.onboarded.v1:test'] = '1';   // test 環境
localStorage['uep.onboarded.v1'] = '1';        // 正式環境

// 掃描線即時狀態 HUD
// 網址加 ?scanline-hud=1
```

> ⚠️ test 環境沒設 onboarded key 的話，**任何 zone 頁都會被導回 `/`**。
> 這個症狀很容易被誤讀成「路由壞了」。

### 需要準備的帳號

- 一個**全新註冊**的探索者帳號（驗證入站儀式、代稱 roll、初始進度）
- 一個**已有進度**的帳號（驗證同步、續讀、gate 解鎖）
- 一個**觀測者**視角的狀態（驗證 bypass 與印記）
- 未登入的**訪客**（進度只在 localStorage）

---

## S1 — 雙視角系統 + Progress Store

### 視角切換

- [ ] 識別證面板底部可切換探索者／觀測者（**不在 TopBar**，S5 已撤下）
- [ ] 切到觀測者時出現劇透警告，需明確確認才生效
- [ ] 一旦當過觀測者，`observerEver` 印記**永久保留**——切回探索者後印記仍在
- [ ] 觀測者視角下所有 gate 內容直接可讀（`pristineOnly` 除外，見 S3）
- [ ] 觀測者切回探索者後，entity 啟用狀態正確收回（不殘留可點樣式）

### 進度儲存

- [ ] 未登入時進度寫入 localStorage，重新整理後仍在
- [ ] 清除 localStorage 後進度歸零，且不會白屏
- [ ] `[unit]` progressStore 的旗標增刪、去重、sweep

---

## S2 — 掃描線 + ProgressMarker

> 這一段的多數行為依賴 **IntersectionObserver 在真實捲動下的回報**，
> jsdom 只能手動 trigger entries，務必真機驗。

### 掃描線基本行為

- [ ] 捲動 History 文章時，掃描線（視窗 80% 處）通過標記即記錄進度
- [ ] `?scanline-hud=1` 的 HUD 數值隨捲動即時更新
- [ ] 捲到文末（哨兵）觸發完成判定，`completed:{pageId}` 旗標授予
- [ ] **沒有任何 `hr` 的短文**也能判定完成（哨兵設計）

### 跨 session 續讀

- [ ] 讀到一半離開 → 重新進站 → 出現「上次位置」提示，位置正確
- [ ] **已讀完的文章不該出現續讀提示**（即使之後回捲到前段）
- [ ] 文章被編輯過導致標記位移時，提示不會跳到荒謬的位置（索引失效即放棄）

### 高速捲動

- [ ] 快速拖曳捲軸掠過多個 FlagMarker → 中間的旗標**不應漏授**
- [ ] 極速捲動（rush，>1500px/s）時 echo spot **完全不觸發**：
      不授旗、不留等待、右下角不出現任何提示卡

---

## S3 — 內容閘門（Gating）+ 嵌入標記

### 閘門四維條件

> ⚠️ 進度頁、需先讀完、自訂旗標、純潔者限定四者是 **AND 聯集**，
> UI 上絕不可條件隱藏其中任何一項。

- [ ] 編輯器 Inspector 的「進度條件」四項都能設定且能同時生效
- [ ] 「需先讀完」用頁面 picker 選文章（寫入 `completed:{pageId}`）
- [ ] 未滿足條件的頁面在 History 導航樹顯示鎖定樣式且不可點
- [ ] 讀完前置文章後，鎖**即時打開**（不需重新整理）
- [ ] 直接 deep link 到未解鎖頁面 → 停在 landing，不會漏進去
- [ ] `pristineOnly`（純潔者限定）**觀測者也擋得住**

### 嵌入標記（編輯器端）

- [ ] 選字後用 ◈ 工具標記 entity，kind + ref 都能存
- [ ] entity 與 cue 標記互斥（同段文字不能兩者都有）
- [ ] 前台未解鎖時 entity **就是普通文字**，零樣式零行為

---

## S4 — Interactive Embed 前台啟用

- [ ] 在認識點放 FlagMarker（`grantsFlags` = `met:{完整ref}`）
- [ ] 捲過認識點 → entity 立刻變可點（zone 色點狀底線）
- [ ] 點擊 entity → 對應浮島接手（Concepts 開條目 / Echoes 播放 / Visuals 投射）
- [ ] 鍵盤操作：Tab 聚焦 + Enter/Space 等同點擊，focus 樣式可見
- [ ] 無效 ref **一律未解鎖**，觀測者也不例外
- [ ] 觀測者視角下所有 entity 直接可點

---

## S5 — 讀者帳號 + 進度同步

### 入站儀式

- [ ] **完全無身分紀錄**時，從任何頁面進站都會導回主頁並跳出身分選擇
- [ ] 選完身分永久記住，之後 deep link 不再被攔
- [ ] 舊使用者（已有 progress key）靜默補標記，不會被儀式打擾

### 註冊與登入

- [ ] 四步互動註冊：識別名 → 密語 → 信箱（可選）→ roll 代稱
- [ ] 代稱可重擲，roll 在 server 端執行
- [ ] 支援**信箱登入**（不只識別名）
- [ ] 停用帳號：**密碼驗過之後**才回報停用，不可先擋
      （先擋等於不用知道密碼就能問出帳號存在）
- [ ] JWT TTL 30 天，過期後靜默轉訪客不白屏

### 進度同步

- [ ] 登入後本地進度上傳，跨裝置登入拿得到同一份
- [ ] 離線時仍可閱讀，恢復連線後補送
- [ ] 關閉分頁時（pagehide）未送出的進度用 keepalive flush
- [ ] **跨裝置衝突**：兩台裝置同時改進度，CAS 擋住舊 rev，不會靜默覆蓋
- [ ] 讀者 token **不能**打 admin API（反向也是）

### 識別證

- [ ] 登入後右上出現識別證，可展開看代稱／視角／計數／印記
- [ ] 識別證 portal 到 body，往上捲時**不會被 TopBar 裁掉**
- [ ] 桌面：往下拉撕開登出（閾值 96px）
- [ ] 手機：改用按鈕登出（tear 手勢與 pull-to-refresh 衝突），齒輪隱藏

---

## S6 — 浮島框架 + History Island

- [ ] 浮島僅在**已登入探索者 + 桌面（≥761px）+ 已解鎖 + 未停用**時出現
- [ ] 縮放視窗到 760px 以下 → 浮島相關 UI **即時消失**（不需重整）
      （含互動嵌入、Echo Spot、Visual Clue、加入佇列／映照按鈕）
- [ ] 浮島可拖曳，位置與開合狀態跨頁保留
- [ ] dock chip 可收合／展開各島
- [ ] History Island 顯示導航樹，書籤條目按機率出現
- [ ] 入場動畫期間浮動 UI 正確讓位（`uep-zone-entry-active`）

---

## S7 — Concepts Terminal Island

- [ ] 終端島可輸入指令，輸出歷史跨頁／收合／登出重登都保留
- [ ] entity 啟用時島收合 → **不強制展開**，改 dock chip 閃爍留 pending
- [ ] 展開島後 pending 正確送達
- [ ] 條目「相關」按鈕 hover/focus 顯示說明

---

## S8 — Echoes / Visuals 島

### Echoes（流浪回聲）

- [ ] 跨頁播放不中斷
- [ ] **島收合時 echo spot 不得偷播**——存成 pending + dock chip 閃爍，
      使用者明確展開島才消費
- [ ] 離頁／登出／reset／停用島 → pending 直接丟棄，不跨頁追播
- [ ] **雙 spot 連續插播**：B 應接手播放，結束後恢復使用者原曲
      （這是 supersede race 的回歸點，務必實測）
- [ ] 清除播放：清目前曲／佇列／歷史／插播快照，**保留** volume 與 loop
- [ ] 島的當前色只有一個來源——提示卡出現時，進度條 fill、seek thumb、
      狀態點、循環鍵、插播 banner **全部同色**

### Visuals（浮動幻影）

- [ ] Visual Clue 書籤在掃描線通過後浮現，讀者自行決定按不按
- [ ] 書籤縮圖顯示 Gallery Clue 的預設圖片
- [ ] 多個 clue 折疊錯位成一落，hover/focus 展開
- [ ] 點書籤 → 島強制展示 + 離開後快照復原
- [ ] 未解鎖圖片**佔位可見**（與 Echoes 完全隱藏刻意相反）
- [ ] 區間 Image Gate：掃描線通過切圖點時幻影切換圖片
- [ ] 映照的 gallery 離頁後仍在（持久化），回來時還原

### 兩島共通

- [ ] 已在播／已在投射的項目**不再出提示卡**（來源端與島端各擋一次）
- [ ] 佇列中但還沒播的曲目**照常**提示（排隊 ≠ 正在播）

---

## S9 — Storage Island + 便條

- [ ] 便條可新增／編輯／刪除／釘選
- [ ] 便條跨裝置同步（S11 已改為 worker 內部拆儲存，客戶端協定不變）
- [ ] 拖曳便條：**只有進入拖曳態才 setPointerCapture**
- [ ] 長中文字串不撐破卡片（`overflow-wrap: anywhere`）
- [ ] 便條數量與字數上限依 `/admin/settings` 站台分頁的設定生效
- [ ] 調小上限後，既有超額便條**不會被靜默刪除**（硬上限只擋新增）

---

## S10 — 互聯系統 + 迷霧 + Admin 工具

### 互聯（Interlink）

- [ ] 線索卡優先顯示劇情點名稱（而非頁面標題）
- [ ] 同一 storyKey 跨多個 zone 的錨點都能觸發
- [ ] `/admin/settings` 的 key 分頁可管理劇情點與實體 key
- [ ] flag 分頁：未註冊旗標會擋存檔（409），derived 旗標豁免

### 進度迷霧

- [ ] 迷霧線隨閱讀推進，**不會追不到底**
- [ ] 文末不會出現捲不完的空白
- [ ] 迷霧線以下的 echo spot / visual clue 被正確遮蔽
- [ ] DevTools「進度迷霧」群組四個 action 都能用（狀態傾印／散盡本頁／
      推進到讀者位置／重罩重測）

### Admin

- [ ] `/admin/settings` 四分頁（key / flag / 進度 / 站台）都能開
- [ ] 進度總覽可就地切換進度頁標記，三層以上巢狀的繼承判定正確
- [ ] 站台參數改動後，**下一次頁面載入**生效（這是明文契約，不是即時）

---

## S11 — 行動版 + 效能 + 資料瘦身

### 行動版（**需真機，模擬器測不出來**）

- [ ] 手機不掛 DevTools（760px 以下）
- [ ] 大地圖首幀不超框（lazy initializer，第一幀就是正確尺寸）
- [ ] 入場儀式在矮視窗可捲動，進入按鈕不被瀏覽器工具列蓋住
- [ ] 首頁切區塊有漸進淡出，接縫看不到
- [ ] 往上捲到區塊頂端**不會被直接丟進上一個區塊**
- [ ] 「回到導覽」FAB 可用
- [ ] 掃描線在 iOS Safari 動態工具列收合／展開時仍正常回報
- [ ] 觸控慣性捲動期間標記不漏報

### 效能

- [ ] 首頁在慢速 4G 下不白屏（遮罩有純 CSS 保底淡出 2.5s）
- [ ] **停用 JavaScript** 時字型仍載入（noscript 退路）
- [ ] 浮島展開瞬間**不閃無樣式**（S11 CSS 延後注入的回歸點）
- [ ] 識別證、教學導覽、視角切換儀式、區域入場罩、大地圖、內嵌播放器
      首次出現時都**不閃無樣式**
- [ ] 罕用字（不在 core/content 字集內）仍由 Noto Serif TC 繪製，
      不回退系統字

### 資料

- [ ] 舊帳號的便條在下次載入時自動遷移到 `uep_user_notes`，內容不遺失
- [ ] 遷移**不遞增 rev**（手上的 rev 仍有效）
- [ ] 便條與進度同時修改時，兩者不會互相覆蓋

---

## 跨段回歸（每次 release 都要跑）

### 白屏防護 `[E2E]`

- [ ] 重新整理任何頁面不白屏
- [ ] Deep link 直接進 zone 頁可載入
- [ ] 瀏覽器返回／前進行為正確
- [ ] Content API 回傳非 JSON 時頁面不崩潰

### 主站（root）

- [ ] 首頁、專案、更新、連結、關於各頁載入正常
- [ ] Admin 可登入、編輯、儲存
- [ ] 媒體庫可上傳、刪除
- [ ] 聯絡表單可送出（Resend）
- [ ] 訪客計數正常累加

### 雙站一致性

- [ ] 兩站 TEST MODE banner 都會出現
- [ ] `pnpm sync` 雙向同步後兩端內容一致
- [ ] R2 資產刪除有正確傳播

---

## 已知不可自動化的項目（每次都要人工）

| 項目 | 原因 |
| --- | --- |
| iOS Safari 動態工具列下的掃描線落點 | DevTools 模擬與 Playwright 都不重現 |
| 音訊插播的 supersede race | 真實 `play()` 的 pending 窗口在 jsdom 不存在 |
| 浮島「掛載但收合」的中間態 | 自動化 mock 恆為 mounted + open |
| 觸控慣性捲動期間的 IO 回報 | 需要真實觸控事件與慣性物理 |
| 字型子集化的視覺結果 | headless 量不到字型實際繪製 |
| 跨裝置進度衝突 | 需要兩台真實裝置同時操作 |
| 動畫的視覺順暢度 | 只能用眼睛 |

---

## 驗收記錄

| 日期 | 版本 | 環境 | 驗收者 | 結果 |
| --- | --- | --- | --- | --- |
| | v1.0.0 | staging | | |
