# S10-4 設計文件 — 閱讀節奏機制 + 浮島教學 + 技術債

> 起草基準 **0.9.16.41**（S10-3 收尾 + Codex 五項全數修補後）。S10-4 從 **0.9.16.42** 起算。
> 承 [[S10 開工定案（2026-07-26）]]：S10-4 原定義為「技術債修正」，2026-08-02 由艾斯維爾追加三個前台機制。

---

## 1. 範疇

| 段 | 內容 | 性質 |
| --- | --- | --- |
| **A** | AFK 探測（五區 Reader 通用） | 新機制 |
| **B** | 休息提醒（只 History） | 新機制 |
| **C** | 浮島教學（聚光燈 overlay） | 新機制 |
| **D** | 技術債修正 | 收拾 |

### 1-1 明確不做

- **首頁 zone 區塊的解鎖提示欄位**——2026-08-02 艾斯維爾撤銷。理由：首頁編輯的 `body`
  區塊本來就是自由 TipTap HTML，要提示自己寫進去即可，不值得為此在
  `ZoneSectionContent` 開新欄位、改 `SiteHomepageEditor`、再改 `HomePage.tsx` 的版面。
  **這是「不要重複造輪子」的正確判斷**：既有機制已經涵蓋需求。
- **教學文案的後台編輯（原規劃的 settings 第五 tab）**——同日撤銷，文案硬編碼。
  文案改動頻率低（一島 2–3 句，寫定就不太動），為此開一張表 + 一個分頁 +
  一組 CRUD 端點不划算。
- **AFK 期間凍結進度推進**——掃描線／迷霧線本來就要有捲動才會推進，閒置時它們
  自然不動。加一道凍結閘只是製造一個永遠不會被觀察到的分支。
- 其他優化與 UI 調整維持順延 S11。

---

## 2. A 段：AFK 探測

### 2-1 為什麼不是既有的內容保護

`scripts/content-protection.ts` 的 `setupVisibilityProtection()` 監聽
`visibilitychange` / `blur` / `focus`——它回答的是「**這個頁面還在不在前景**」。

AFK 要回答的是它的補集：**頁面在前景、focus 沒掉，但人沒有動作**。兩者的定義域
不重疊，不能共用判定，但**必須共用時間軸**（見 2-3）。

### 2-2 活動事實來源

新增 `apps/uep/src/lib/activityWatch.ts`——模組級單例，全站唯一的「使用者活動
時間軸」來源。它同時維護最後活動時間、idle 狀態與單調遞增的累積活躍毫秒數；
消費端不得各自另開計時器重算一份。

**監聽事件**：`pointermove`、`pointerdown`、`keydown`、`wheel`、`touchstart`，
以及 capture 階段的 `scroll`。全部 `{ passive: true }`。

**⚠️ 事件只寫模組變數，不寫 React state。** `pointermove` 一秒可以觸發數十次，
每次 setState 等於把整棵 Reader 重渲染幾十次。實際判定由一個 1 秒的 interval tick
比對 `now - lastActivityAt`，只有**跨越閾值的那一刻**才通知訂閱者。

```
lastActivityAt ──(事件)──> 更新（純變數寫入，零渲染）
                 └─(1s tick)─> 跨越閾值? ──> notify(idle: true/false)
```

內部**不保存無上限的活躍區間陣列**，改維護：

- `sealedActiveMs`：已封存區間的累積值
- `activeStartedAt`：目前活躍區間的起點；idle／hidden／blur 時為 `null`
- `lastActivityAt`：最後一次真實活動時間

`getActiveTotalMs()` 回傳 `sealedActiveMs + 當前尚未封存的區間`。消費端在開始時取
一個數值快照，結束時用新值減快照，不用 timestamp 反查歷史清單。這讓長時間開頁
的記憶體用量維持 O(1)。

`useIdleState()` hook 訂閱這個單例，回傳 `{ idle, idleSince }`。AFK nudge 是否顯示
只看 `reader.idleNudgeMode`；活動分類與計時永遠以
`reader.activityIdleThresholdSec` 為準。

### 2-3 ⚠️ 與觀測失效的時間軸協調（本段最重要的一條）

**頁面 hidden 或 window blur 時，AFK 計時必須暫停；只有 visible 且重新取得 focus
後才恢復，並把 `lastActivityAt` 重設為當下。**

不做這件事的後果是可預期的故障：使用者切出去十分鐘 → 觀測失效遮罩接手 → 回來時
遮罩正在跑 1400ms 的「重新接上訊號」還原動畫 → AFK 判定發現已經十分鐘沒動作 →
AFK 提示直接疊在還原動畫上。**兩層遮罩打架，而且都是我們自己叫出來的。**

只處理 `visibilitychange` 不夠：切到另一個應用程式時，document 可能仍是 visible，
但 content-protection 已因 `window.blur` 顯示遮罩。若 activityWatch 繼續走，回到
頁面仍會發生兩層提示打架。

實作：`activityWatch` 自己監聽 `visibilitychange`、`window.blur`、`window.focus`：

- hidden 或 blur：立刻封存目前活躍區間、停 tick、清掉 AFK nudge
- visible + focus：`lastActivityAt = Date.now()`、開新活躍區間、再啟動 tick
- focus 事件抵達但 document 仍 hidden 時不得恢復

不需要與 content-protection 互相 import——兩邊各自對同一組瀏覽器事實反應即可。

### 2-3-a 設定就緒時序

現有 `initUepSettings()` 首訪時是非同步 fetch，DesignLayout 不 await；若 ReaderShell
mount 當下只讀一次，第一頁可能吃到 fallback。`activityWatch.start()` 必須等待
`initUepSettings()` resolve 後才鎖定本頁設定。為避免 DesignLayout 與 ReaderShell
重複 fetch，`initUepSettings()` 要加模組級 in-flight Promise，成為可重入且去重的初始化。

fetch 失敗仍 resolve，activityWatch 使用程式碼預設值；不可讓 AFK 因設定 API 掛掉
而完全不啟動。

### 2-4 掛載點

`components/zone/ReaderShell.tsx`——**五個 Reader 全部走它**（已驗證：
Concepts / Echoes / History / Storage / Visuals 五支都 import）。不必各 Reader
各接一份。

### 2-5 readingStats 從「一次差值」改成「活躍區間累加」

現況 `HistoryReader.tsx:903-913`：

```ts
const start = Date.now();
return () => {
  const elapsed = Math.min(Date.now() - start, READING_TIME_CAP_MS); // 30 分鐘上限
  getProgressManager().addReadingTime(elapsed);
};
```

這段扣不掉閒置，那個 30 分鐘上限只是掛機灌水的粗糙補丁——掛機 25 分鐘照樣全額計入。

改法：HistoryReader 進入文章時保存 `getActiveTotalMs()` 快照，cleanup 時計算差值並交給
`addReadingTime`。進入 idle、hidden 或 blur 都會封存當前區間；恢復活動時開新區間。

**`READING_TIME_CAP_MS` 隨之退休**——它存在的唯一理由被真正的閒置扣除取代了。
留著會變成第二套判定，而且是比較笨的那套。

### 2-6 提示的形狀

**中央淡入的低調卡片，`pointer-events: none`，任何活動事件即消失。**

刻意**不放「我還在」按鈕**：使用者要證明自己在，最自然的動作就是動一下滑鼠或
捲動一下，而那正是 `activityWatch` 已經在聽的東西。加按鈕等於要求使用者用一個
特定動作去回答一個任何動作都能回答的問題。

不擋捲動、不擋點擊——AFK 不是懲罰，是提示。

---

## 3. B 段：休息提醒（只 History）

### 3-1 為什麼只 History

「獲得很多進度」這件事只有 History 有具體定義（`completedPageIds`、掃描線、
迷霧線）。其餘四區的 Reader 停留形態不同（聽歌／看圖／查條目），硬套「讀太多」
的語意不成立。

### 3-2 兩條線，先到先觸發

| 判準 | 說明 |
| --- | --- |
| **本輪累積活躍時長** | 用 2-5 的活躍毫秒數，不是牆鐘時間。中途 AFK 十分鐘不算進去；每次確認提醒後重設 baseline |
| **視窗內完成頁數** | 滾動視窗（預設 30 分鐘）內新增的 `completedPageIds` 筆數 |

**兩條各自有盲點**：只看時長會漏掉「四十分鐘掃完十篇短文」的人；只看頁數會漏掉
「在一篇長文卡兩小時」的人。取聯集才覆蓋兩種讀法。

### 3-3 冷卻

冷卻從使用者按下「知道了」時開始（預設 60 分鐘），不是從卡片出現時開始；
否則卡片若停留很久，冷卻可能在背後先過期。冷卻狀態**存在記憶體不進
ProgressState**——「剛剛提醒過」是本次閱讀 session 的狀態，跨裝置同步它沒有意義，
而且會讓 blob 因為一個純瞬時狀態而反覆寫入。

確認提醒時同步做兩件事：

1. `restActiveBaseline = getActiveTotalMs()`，下一輪重新累積活躍時長
2. `lastRestAcknowledgedAt = Date.now()`；頁數視窗只計算晚於此時間的新完成事件

完成頁面的時間戳不進 ProgressState。HistoryReader 只監聽
`PROGRESS_CHANGE_EVENT` 且 `detail.source === 'page-completed'` 的事件，記在記憶體
queue；hydrate、跨裝置既有完成與重讀都不得算成本次大量閱讀。每次判定前剔除
`restWindowMinutes` 之外的舊項。

### 3-4 提示的形狀

與 AFK 共用同一層（`ReaderNudge`），但休息提醒**有按鈕**（「知道了」）且會停留——
它要求的是一個決定，不是一個動作。

資料流用 `ReaderNudgeProvider`：Provider 掛在 `ReaderShell`，AFK 直接由 Provider 消費；
HistoryReader 透過 `useReaderNudge()` 提交／撤銷休息提醒。不要為此新增 window event bridge。

同一時間只顯示一張：idle 時 AFK nudge 優先，pending 的休息提醒暫存；使用者恢復活動、
AFK 卡消失後再顯示休息提醒。休息提醒顯示中不被一般 pointermove 自動關閉。

---

## 4. 站台設定新增參數

全部進 `uep_settings`（`/admin/settings` 站台分頁）。這些都是「mount 時一次性讀取」
型，不進單拍計算路徑，符合 S10-3 D-4 對這張表的定位。

| key | 預設 | 合法範圍 | 意義 |
| --- | --- | --- | --- |
| `reader.activityIdleThresholdSec` | 180 | 30–3600 整數 | 無動作幾秒後封存活躍區間；統計與休息提醒的共同事實來源，不可停用 |
| `reader.idleNudgeMode` | `enabled` | `enabled` / `disabled` | 是否顯示 AFK 提示；只控制 UI，不停用活動量測 |
| `reader.restActiveMinutes` | 45 | 0，或 1–480 整數 | 本輪累積活躍幾分鐘觸發休息提醒；**0 = 停用這條線** |
| `reader.restPageCount` | 5 | 0–100 整數 | 視窗內完成幾頁觸發；**0 = 停用這條線** |
| `reader.restWindowMinutes` | 30 | 1–240 整數 | 頁數判準的滾動視窗長度 |
| `reader.restCooldownMinutes` | 60 | 1–1440 整數 | 確認提醒後的冷卻 |

活動量測與 AFK 提示必須分開。若只用同一個 `idleThresholdSec = 0` 關閉探測，
`readingStats` 與休息提醒會一起失去排除掛機的依據。

其餘兩條觸發線維持 `0 = 停用`，不另開布林開關。`validateSetting` 的白名單、
字串 enum／逐鍵整數範圍、worker 預設值、前端 fallback、`NUMERIC_KEYS`、表單與
兩端測試要同一張卡一起更新，避免跨 package 複本漂移。`idleNudgeMode` 不可誤列入
`NUMERIC_KEYS`。

---

## 5. C 段：浮島教學

### 5-1 形式定案：聚光燈 overlay

2026-08-02 艾斯維爾定案。三個候選的權衡記錄如下（避免日後重提）：

| 方案 | 否決理由 |
| --- | --- |
| 島上一次性訊息 | **要改五次**。島寬只有 300–380px，且五座島內部版面各自為政（回聲的水池、終端的 CRT、幻影的投影格局），塞一塊訊息等於改五個島的版面，還要跟島自己的內容搶空間 |
| 純全螢幕 overlay | 得另外畫島的示意圖，而示意圖與真島必然漂移。「介紹的東西不在畫面上」 |
| **聚光燈 overlay** | ✅ 外掛一層、五島共用一份實作、指向由 `getBoundingClientRect` 天然正確 |

### 5-2 結構

新增 `apps/uep/src/islands/guide/`：

```
IslandGuideOverlay.tsx   遮罩 + 挖空 + 說明卡
guideSteps.ts            五島的步驟骨架與文案（硬編碼）
```

**遮罩挖空用 `box-shadow: 0 0 0 9999px rgba(...)` 打在高亮框上**，不切四塊 div。
四塊 div 的做法在視窗 resize 或島被拖曳時要重算四次，且接縫會有次像素裂縫。

步驟形狀：

```ts
interface GuideStep {
  /** 指向的元素；回不到元素時該步降級為無聚光燈的置中卡 */
  anchor: () => Element | null;
  title: string;
  body: string;
}
```

`anchor` 是**函式不是 selector 字串**——島可拖曳，位置要在每步進場時現算。

overlay 是 modal 教學，不讓滑鼠事件穿過挖空處直接操作島：根層攔截 pointer，
說明卡提供「上一步／下一步／略過教學」，使用 `role="dialog"`、
`aria-modal="true"`、可讀的步驟計數，並將焦點限制在教學控制項內。Escape 只關閉
本次自動播放、不寫 seen；「略過教學」與完成最後一步才寫 seen。

### 5-3 骨架寫死、文案硬編碼

兩者都在 `guideSteps.ts`，但概念上分層：**哪幾步、指向哪個元素**屬於程式結構
（那是 DOM 事實）；**說什麼**是文案。同檔案不代表可以混寫——文案改動不該需要
碰 `anchor`。

每島 2–3 步。

### 5-4 觸發：由 IslandHost 衍生，不新增 bridge

「已看過的教學」存進 `ProgressState.islandGuidesSeen: string[]`——與
`islandsUnlocked` 同層級，換裝置不該重看。五個字串對 128KB 額度可忽略。

這是**單調集合**，完整接線不可只做 adapter：

- `ProgressState` 型別與 `createInitialState()` 補空陣列
- `normalizeState()` 對舊 blob 補空陣列並只保留非空字串；不要讓 progress 反向
  import islands 只為驗證 id
- progress store 提供冪等 `markIslandGuideSeen(id: string)`
- `mergeHydrated()` 像 `islandsUnlocked` 一樣用 `unionAdded()` 合流
- reset 回到空陣列；登出既有的 progress reset 路徑自然清除

漏掉 `mergeHydrated` 會重演既有 hydration race：遠端 GET 尚未回來時看完教學，
稍後抵達的舊快照會把 seen 覆蓋，下一頁再次播放。

於是觸發條件是一個**純衍生**：`islandsUnlocked` 有它、`islandGuidesSeen` 沒有
→ 列入待播。`IslandHost` 直接算得出來，**不需要任何 bridge 或事件**。

> 這是刻意的選擇。專案裡已經有 `terminalBridge` / `echoSuggestionBridge` /
> `relatedBridge` 三套島訊號，再加一套的門檻應該很高。這裡的資訊本來就在
> ProgressState 裡，跨元件傳遞是多餘的。

### 5-4-a 自動播放佇列與中止規則

hydrate 後舊帳號可能五島全部 unlocked、全部 unseen，不能同一頁連播五套。規則定為：

1. 每個 tab session 最多自動播放**一座島**；sessionStorage key：
   `uep-island-guide-auto-shown`
2. IslandHost 將 seen 與 unlocked 都和自己的 `ISLAND_IDS` 取交集，再依該陣列的
   穩定順序取第一個；不依物件列舉或非同步抵達順序
3. 只挑當下 `canUseIslands`、desktop、已解鎖、未停用、未 seen 的島
4. 自動播放前先 `runtime.open(id)`，等島根節點 mount 且至少過兩個
   `requestAnimationFrame` 再量 anchor；不是讓舊帳號因島原本收合而全部降級置中卡
5. 解鎖儀式觸發者仍延遲 `AWAKEN_MS`（1400ms）後才開始；延遲結束時重驗全部守門
6. overlay 顯示前若登出、切 observer、縮成手機、停用／重新上鎖該島或換頁，取消
   且不寫 session key／seen，條件恢復後可重新排；overlay 已顯示後發生同類事件，
   關閉並寫 session key，本 session 不再自動打擾
7. session key 在 overlay 真正顯示時寫入。Escape／一般關閉只做「本 session 不再
   自動打擾」，不寫 seen；完成最後一步或按
   「略過教學」才 `markIslandGuideSeen(id)`

sessionStorage 只控制「這個 tab 今天已自動彈過」，真正的跨裝置完成事實仍只有
`islandGuidesSeen`。

### 5-5 回顧入口

`IslandSettingsPanel.tsx` 每列加一個回顧鈕。

- **未解鎖的列不加**——面板現況顯示「未知的浮島／尚未喚醒」，刻意不透露解鎖方式，
  這條原則維持不變。
- **已停用（`islandsDisabled`）的列不加**——停用的語意就是「我現在不要這個東西」，
  為了回顧硬把島掛回來與那個表態相衝突。
- 按下去先確保島是開的（`runtimeState.windows[id].open`），再走同一套 overlay。
- 回顧模式不受 `uep-island-guide-auto-shown` 限制，也不改寫 seen；它只是重播。

### 5-5-a 聚光燈幾何更新

「每步進場量一次 + window resize」不夠。現行島的拖曳中狀態只存在
`DraggableIsland` 內，島內容也會經 ResizeObserver 改變外殼尺寸與位置。overlay 在
顯示期間必須：

- 監聽 window resize
- 對目前 anchor 掛 ResizeObserver
- 訂閱 island runtime；目標島收到 `move/open/close` 時重算或取消
- 拖曳中（根節點 `.uep-island--dragging`）暫時隱藏聚光框，pointerup／runtime
  `move` 後下一個 animation frame 重算
- anchor unmount 時降級置中卡；再次出現時恢復聚光，不保留舊 rect

### 5-6 reduced-motion

`prefers-reduced-motion: reduce` 下取消淡入淡出與聚光燈的位移補間，直接切換。
（同 content-protection 的既有處理方式：**不依賴 `animationend`**，動畫停用時
那個事件永遠不會來。）

---

## 6. D 段：技術債盤點

### 6-1 🚨 test 環境首頁資料整批缺失（2026-08-02 實測確認）

```
prod  200  sections=9  hero,atlas,journey,zone-history…zone-storage,verse
test  200  sections=0
```

test D1 的 `site_homepage` 完全是空的，staging 首頁五個 zone 區塊全走 fallback 常數。
**兩個獨立的洞，缺一不可修：**

**洞 1 — homepage PUT 的授權契約與其他寫入端點不一致。**
`PUT /api/homepage/:sectionId`（`workers/content-api/src/index.ts:2796`）是全部寫入
端點裡**唯一在 `isWriteMethod` 的 `isAuthorized` 之外，額外要求 `requireJwt` 的**。
`scripts/seed-test-env.mjs` 自 07/16 起就有 `fetchSeedSiteHomepage` / `writeSiteHomepage`
（不是漏寫），但只要那次 seed 用 `API_TOKEN` 環境變數跑而非互動登入拿 admin JWT，
pages / cards / links / projects / updates 全部成功、**只有 site_homepage 整批 401**。

**現況更正：寫入 401 並不會 exit 0。** seed 自 2026-07-16 的 `446c50fc` 起已把
`homepageFail` 納入總失敗數，任何 homepage 寫入失敗都會 `process.exit(1)`。
真正仍會假成功的是來源讀取：`fetchSeedSiteHomepage`（以及其他 `fetchSeed*`）
catch 後回空陣列，讓「prod 讀取失敗」與「prod 合法為空」不可區分。

*修法（三者都要）*：

1. 讓該端點接受 `isAuthorized`（與其餘寫入端點一致），或明確記錄它為何必須更嚴。
   傾向前者——目前的不一致沒有設計理由，只是實作先後造成的。
2. 所有 `fetchSeed*` 的 HTTP／解析失敗都要 throw 到 main，不能 catch 後回 `[]`。
   合法空集合仍可回 `[]`；錯誤與空資料必須是不同型別／控制流。
3. `site_homepage` 是 test 首頁的必要骨架，prod 回 0 筆也要 fail-fast；不要把
   「成功讀到空表」當成可完成的 seed。寫入端維持既有「任何 fail 即 exit 1」。

**部分 seed 偽裝成完整 seed，比缺資料本身更危險。**

**洞 2 — 首頁的 SSR 不吃 test cookie。**
`apps/uep/src/pages/index.astro:12` 是 `getApiBase()`，**沒傳 cookie**。其餘四個 SSR
頁（admin index / media / site / edit）全都傳了 `Astro.cookies.get(...)`。
所以在本地或正式站掛 test cookie 打 `/`，首頁仍讀正式資料——文件宣稱的
「cookie 決定 API base」對首頁不成立。

### 6-2 部署債

migration **0023 / 0024 / 0025** 三環境**皆已套用**（艾斯維爾 2026-08-02 確認）。
S10-3 各筆記中「migration 部署債累積到三筆」的待辦到此結清，後續 session 不必再追。

僅餘 `pnpm interlink:reindex:*`（三環境）待確認是否已跑——套完 0022 之後的補建是
一次性的，跑過就不必再跑，冪等重跑也無害。

### 6-3 測試覆蓋缺口

| # | 缺口 | 代價 |
| --- | --- | --- |
| 1 | `HistoryIsland` 線索卡**零 render 測試** | 0.9.16.36 的命名鏈斷線正好落在這一段：純邏輯測試全綠、資料正確、端點正確，唯一壞掉的是最後那一行顯示。要補得先替它建 render harness |
| 2 | `scripts/*.mjs` 只有 `sync-utils` 的純函式進得了 vitest（根 `vitest.config.ts` 的 `scripts` project） | `sync-content.mjs` / `seed-test-env.mjs` 的主體只有型別與人工閱讀把關。6-1 洞 1 能潛伏兩個多月，這是直接原因 |

### 6-4 零星

- `apps/uep/src/pages/admin/login.astro:45` 的 `redirectTo` 被 astro check 報
  ts(6133) unused——實為同檔 84 行模組級同名變數造成的 shadowing 誤判，行為正確。
  warning 等級不擋 `pnpm check`。把 POST 區塊內那個改名即可消掉。
- `GateConditionEditor` 缺「頁面被其他頁的 `requiresFlags` 引用為 completed 依賴，
  卻勾了 `gateExempt`」的警告。這個組合幾乎必是誤設（2026-07-06 的浮島計數診斷
  就是踩到它），目前無任何防呆。
- `ProgressState` 整體 blob 缺乏重度使用者的實測基準（128KB 額度）。
  S10-1 便條擴充時就標為殘留風險，至今沒有實測任務。
- test `reset` 目前只處理 `pages` + 五張 `root_*` + 衍生表，**不清 test R2、
  資產刪除紀錄、讀者進度**。這些的保留／重置政策仍未定案。

### 6-5 本 session 必須新增的測試

新機制不可只靠 `pnpm check`。每張實作卡要附同層測試，至少涵蓋：

| 區域 | 必測契約 |
| --- | --- |
| activityWatch | fake timers；活動→idle 邊界；任一活動恢復；hidden／blur 封存；visible 但未 focus 不恢復；focus 重設時間；start/destroy 不重複 listener；累積毫秒 O(1) 且差值正確 |
| ReaderNudge／休息 | AFK 與休息不疊卡；rest pending 在恢復活動後顯示；確認才開始 cooldown；baseline 重設後不立即重觸發；只計本 session 的 `page-completed`；0 停用單條線 |
| settings | 六個 key 的預設、字串 enum、合法邊界、小數／負值／越界；`idleNudgeMode` 不進 `NUMERIC_KEYS`；`initUepSettings` 並行呼叫只 fetch 一次；fetch 失敗 fallback |
| ProgressState | 舊 blob 補 `islandGuidesSeen=[]`；非字串／空字串剔除；IslandHost 與 `ISLAND_IDS` 取交集；mutation 冪等；hydrate pending 期間 local seen 與 remote seen 取聯集；reset 清除 |
| IslandGuide | 多島 unseen 只排一座且順序決定性；自動開島後才量 anchor；取消守門；完成／略過／Escape 的 seen 差異；anchor 缺失、resize、runtime move、拖曳、reduced-motion；焦點圈與 Escape |
| homepage／seed | API_TOKEN 與 admin JWT 可 PUT、匿名仍 401；首頁 SSR test cookie 選 test API；來源 fetch 失敗 exit 1、homepage 空表 exit 1、任一寫入失敗 exit 1、全成功 exit 0 |

`seed-test-env.mjs` 若難以直接 import，先把「來源結果分類／摘要決定 exit code」抽成
`sync-utils.mjs` 或另一個無副作用 helper 進 scripts vitest project；主入口仍需至少一項
subprocess 級測試證明 exit code 有接上，不接受只測 helper、main 漏接。

---

## 7. 風險

| # | 風險 | 緩解 |
| --- | --- | --- |
| R1 | 全域活動監聽與內容保護的既有 listener 疊加 | 活動事件全部 `passive: true`；高頻 handler 只寫模組變數，不做 DOM 讀取；visibility／blur／focus 走明確狀態機 |
| R2 | `readingStats` 改語意後，既有讀者的 `totalMs` 含掛機時間，新舊資料不同質 | **不做遷移**——舊值就是舊值，這是統計輔助值不是進度事實。平均閱讀時間會隨新資料逐步收斂 |
| R3 | 聚光燈位置在島被拖曳／視窗 resize／內容改尺寸後失準 | 每步進場現算 + window resize + anchor ResizeObserver + island runtime move/open/close；拖曳中暫藏，結束後重算 |
| R4 | AFK 提示在使用者「正在讀但沒動作」時誤觸發（長段落慢讀） | 預設閾值 180 秒偏保守；提示本身 `pointer-events: none` 且任何動作即消失，誤觸發的代價很低 |
| R5 | 6-1 修法動到 `/api/homepage` 授權 | 該端點是 admin 寫入端點，放寬到 `isAuthorized` 仍需 API_TOKEN 或 admin JWT，不存在匿名路徑。要有回歸測試斷言未授權仍 401 |
| R6 | settings 首訪非同步導致第一頁鎖定 fallback | `initUepSettings` Promise 去重；activityWatch 等初始化 resolve，失敗才使用 fallback |

---

## 8. 待決點

**本文件目前沒有阻塞實作的開放問題。** 以下三項可在實作時由實作者決定並記錄：

- AFK 提示卡的具體文案與視覺語彙（建議沿用站上既有的低飽和襯線語彙，但**不要
  沿用觀測失效的 glitch 語彙**——那是「你被擋下了」，AFK 是「你還在嗎」，語氣不同）
- 五島教學各 2 步或 3 步
- 6-4 的四項零星債要在本 session 收哪幾項（建議至少收 `login.astro` 與
  `GateConditionEditor` 警告，另兩項需獨立任務）

---

## 9. 建議實作順序

**A 段（地基，其餘都依賴它）**

1. 六個站台設定 key + `validateSetting`／預設／表單，並讓 `initUepSettings` Promise 去重
2. `lib/activityWatch.ts` + `useIdleState()`，含 visibility／blur／focus 狀態機與
   O(1) 活躍毫秒累加
3. `ReaderNudgeProvider` + `ReaderShell` 接線（先只做 AFK 型）
4. `readingStats` 改用 active-total 快照差，`READING_TIME_CAP_MS` 退休

**B 段**

5. 休息提醒判定（兩條線 + acknowledgement baseline + 冷卻），掛 HistoryReader

**C 段**

6. `ProgressState.islandGuidesSeen` 完整接線（初始值／adapter／mutation／hydrate union／reset）
7. `IslandGuideOverlay` + `guideSteps.ts`（先做 history 一島，連 accessibility 與幾何監聽一起驗形）
8. `IslandHost` 決定性佇列、session 上限、守門取消與延遲 `AWAKEN_MS`
9. 其餘四島步驟 + `IslandSettingsPanel` 回顧鈕

**D 段**

10. 6-1 兩個洞（端點授權一致化 + seed 來源 fail-closed + `index.astro` 傳 cookie）
11. 6-4 選定的零星債

依賴鏈：1→2→3→4；2→5；6→7→8→9；D 段全部獨立，可任意插入。

⚠️ **步驟 4 不可與 2 分開太久**——`activityWatch` 上線但 `readingStats` 還在用舊
差值算法的期間，等於同時有兩套時間觀；步驟 2～4 應視為同一批，不可在中間狀態
合併或交付手動驗收。

每一步完成時先跑 focused tests；全部完成後依 repo 規範跑 `pnpm check` +
`pnpm test:all`。聚光燈定位、focus trap、AFK 與 content-protection 交接仍需真實
瀏覽器手動驗收，綠色 jsdom 測試不能取代。
