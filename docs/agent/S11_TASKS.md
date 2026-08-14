# S11 拆卡計畫：手機體驗補完 + 效能優化 + blob 瘦身

> 依據：`docs/agent/S11_DESIGN.md`
> 起始版本：**0.9.18.0**（基準 0.9.17.11）
> 開工前已對照現有程式碼核對設計文件引用的檔案/行號，核對結果見 §1；
> 與設計文件不一致或需要修正的地方先列在 §0。

---

## 0. 對設計文件的異議

### 0-1 版號順序與「A-5 最後做」的敘述矛盾（需修正）

設計文件 §5 的表格把 A-5 排在版號 `0.9.18.4`，但同一列的備註明寫「風險最高，最後做」。
把全部版號由小到大排序會發現：

```
A-1 .0 → A-2 .1 → A-3 .2 → A-4 .3 → A-5 .4 → A-6 .5 → A-7 .6 → A-8 .7
```

`.4` 落在正中間，A-6／A-7／A-8 三張卡的版號都排在它**之後**——若版號真的跟著 commit
順序遞增（設計文件自己在 §5 下方註明的規則），A-5 並不是最後一個落地的改動，
與「最後做」的意圖直接衝突。

**修正**：A-6／A-7／A-8 與 A-5 不互相依賴（A-6 依 A-1、A-7 依自己的前置重構卡、
A-8 無依賴），且三者風險皆低於 A-5（見設計文件 §2 的個別描述），沒有理由排在
「風險最高，最後做」的項目前面。本文件將 A-5 的版號**移到真正最後**，
其餘三張依序遞補：

| 卡 | 設計文件版號 | 本文件修正版號 |
|---|---|---|
| A-6 | 0.9.18.5 | **0.9.18.4** |
| A-7 | 0.9.18.6 | **0.9.18.5** |
| A-8 | 0.9.18.7 | **0.9.18.6** |
| A-5 | 0.9.18.4 | **0.9.18.7** |

A-1／A-2／A-3／A-4 的版號（`.0`～`.3`）不變。下方 §2 任務卡一律採本文件修正後的版號。

### 0-2 C 段「待決點 3」已經是過期問題，不需要再問

設計文件 §6 待決點 3 問「新 migration 要不要與 S10 積欠的 0023/0024 一起套」。
實際查看 `workers/content-api/migrations/` 目錄，**0023／0024／0025 三個 migration
檔案都已經存在**（`0023_interlink_keys_and_flags.sql`／`0024_uep_settings.sql`／
`0025_uep_flags_soft_delete.sql`），是 S10-3／S10-4 遺留的地基，並非「積欠未套」。
這代表：

1. S11 C 段的新 migration 編號應為 **`0026`**，不是回頭補 0023/0024。
2. 待決點 3 的真正問題已經不存在——不必等艾斯維爾回覆，直接用 0026 開工即可。

本文件 §2-C 的任務卡直接採用 0026，不再列為待決事項。若艾斯維爾對此有其他考量（例如
0023～0025 尚未在正式站套用完畢），開工前仍應照 §13 慣例查一次三環境的
`sqlite_master`，但這與「積欠 0023/0024」無關，是另一個獨立的環境檢查步驟（已併入
§1-3 的部署前必查）。

---

## 1. 開工前讀碼核對（本次新發現，設計文件未點名或描述不完整）

### 地雷 1：`useDesktopIslandViewport()` 已存在且方向與設計文件描述一致，A-1/A-6 不需要新建任何東西

`apps/uep/src/islands/useIslands.ts:39` 的 `useDesktopIslandViewport()` 回傳
`true` 代表桌面（`window.innerWidth >= ISLAND_DESKTOP_MIN_WIDTH`，
`ISLAND_DESKTOP_MIN_WIDTH = 761`，見 `islandRuntime.ts:268`）。設計文件要求的
「反向值」就是 `!useDesktopIslandViewport()`。**兩張卡都只是消費既有 hook，
不建立任何新元件**——T-A1 是本次唯一需要「決定怎麼用」的卡，T-A6 完全依樣畫葫蘆。

### 地雷 2：`UepDevTools.tsx` 的掛載守門必須擋在 `useEffect` 內，不能只包 return null

`UepDevToolsHost`（`UepDevTools.tsx:258`）目前流程：`useEffect` 內呼叫
`shouldMount()` → `setMounted(true)` → 註冊 `registerAllActions()` + 綁
`keydown` 全域監聽 → 之後才根據 `mounted`/`open` 決定要不要 `createPortal`。

`useDesktopIslandViewport()` 是合法的 React hook，`UepDevToolsHost` 本身是函式元件，
可以直接呼叫。但**守門必須放進那個 `useEffect` 的條件裡**（`if (!shouldMount() ||
!isDesktopViewport) return;`），而不是只在 render 回傳值加一個
`if (!isDesktopViewport) return null;`——後者仍然會讓 `useEffect` 跑過一次、
`registerAllActions()` 和 `keydown` 監聽都掛上去，只是視覺上不畫出來，這正是設計文件
警告的「CSS 藏起來，互動元素還在」的同一種坑，只是換了一種實作方式重犯。

### 地雷 3：`BigMapModal.tsx` 的 lazy initializer 需要計算函式，且 SSR 安全

`useState(520)`（`BigMapModal.tsx:22`）要改成 `useState(computeMapSize)`。
`computeMapSize` 需要是模組層級或元件外的純函式（`typeof window === 'undefined'`
時回 520），這樣 `useState` 的 lazy initializer 呼叫型式（傳函式本身而非呼叫結果）
才成立：`useState(computeMapSize)` 而非 `useState(computeMapSize())`——後者仍然是
每次 render 都重新求值，且在 SSR 環境會立即碰 `window` 噴錯。

「同類巡查」（`IntroOverlay`、`PieMap3D` 呼叫端、`Minimap`）需要先讀過這幾個檔案
確認是否真的有同款「初始值寫死＋effect 修正」模式，不能假設設計文件的描述完全準確——
比照 S10 系列拆卡慣例，若讀碼後發現某個候選其實已經用了 lazy initializer 或本來就
沒有這個問題，如實記錄，不需要為了湊數硬改。

### 地雷 4：`IdentCard.tsx` 的登出流程目前完全內聯在 `handlePointerUp`，抽出時要注意五個副作用的順序

實際讀碼 `handlePointerUp`（`IdentCard.tsx:239-298`）目前依序做：

1. 顯示確認對話框（`window.__uepDialogManager.confirm()`）
2. 使用者確認後：`rootRef.current?.classList.add('is-torn')`（撕裂動畫觸發）
3. `await new Promise(r => setTimeout(r, 550))`（等動畫播完）
4. `await getReaderAuth().logout()`
5. 種 `WELCOME_PENDING_KEY`（`sessionStorage`，`kind: 'logout'` + alias）
6. `window.location.assign('/')`

**`performLocked()` 抽出時，步驟 2（`is-torn` class）不能一起抽進去**——那是綁在
`rootRef`（DOM 節點）上的視覺效果，手勢路徑與按鈕路徑的觸發時機不同（按鈕路徑不需要
「撕開」這個物理動作本身，但設計文件明確要求「撕開動畫在按鈕路徑上仍要播」，
所以按鈕的 onClick 也要呼叫同一個「播放撕裂視覺」的步驟，只是進入點不同）。

正確的抽法：`performLogout()` 只包含步驟 1（confirm）＋ 4～6（logout + 儀式旗標 +
導頁），**不包含 class 操作**；`is-torn` 的加入與等待 550ms 的動畫時序留在呼叫端
（手勢路徑维持 `handlePointerUp` 原地播、按鈕路徑在自己的 onClick 內播同一段），
两个呼叫端各自播完動畫後再 `await performLogout()`。這樣兩處都會播撕裂動畫，
且動畫程式碼本身沒有被複製（只有「呼叫哪個函式＋等多久」這幾行各自保留，符合設計文件
「登出流程本體不得複製一份」的要求——流程本體指的是 confirm/logout/儀式旗標/導頁
這串邏輯，不是純視覺的 CSS class 切換）。

### 地雷 5：`JourneyNav.css:112` 的 760px 斷點與 A-8 FAB 的顯示條件是兩個獨立開關，不要合併

`JourneyNav.css:112` 的 `@media (max-width: 760px) { display: none }` 只管
桌面版右側導覽欄的顯示與否，A-8 的手機 FAB 是**另一個新元件**，兩者的判斷邏輯
不需要共用（一個是 CSS media query 管既有元件，一個是新元件用 `isMobile` state 管）。
`HomePage.tsx` 內已有 `isMobile` 這個 state（`handleJourneyNav` 已在用同一個
`isMobile` 判斷分支邏輯，見 `HomePage.tsx:736` 起的手機分支），A-8 FAB 直接復用
這個既有 state，不必另外量測 viewport。

### 地雷 6：`uep_user_notes` 是使用者擁有的資料，不應該進 `BUSINESS_TABLES`

`workers/content-api/src/test-seed.ts:163` 的 `BUSINESS_TABLES` 常數管的是
「從 `pages` 衍生、reset 時要清空重建」的表（`history_interlink_index`／
`interlink_keys` 等），檔案內註解明講 `uep_flags` **刻意不列入**，理由是它是
「管理者直接輸入」而非「從 pages 衍生」的資料。

`uep_user_notes` 的性質更接近 `uep_users.progress`（使用者自己的資料）而非
`pages` 衍生物——`test-seed.ts` 目前對 `uep_users.progress`／`observer_ever`
的重置是**另一條獨立的 `UPDATE` 陳述式**（`test-seed.ts:194` 附近），不在
`BUSINESS_TABLES` 的 `DELETE` 迴圈裡。C 段任務卡必須讓 `uep_user_notes` 走
同一種模式（reset 時額外一條 `DELETE FROM uep_user_notes` 或依 `user_id` 隨
`uep_users` 一起處理），**不要把它加進 `BUSINESS_TABLES`**——加進去雖然不會
造成明顯錯誤（該表本來就沒有 `page_id` 外鍵，DELETE 全部也是合理語意），但會讓
未來讀這份常數的人誤以為它管的是「pages 衍生資料」，與檔案本身的用途註解自相矛盾。

### 地雷 7：`uep_user_notes.user_id` 要存 `uep_users.id`（數字），不是 JWT 的 `username`

`requireReaderJwt()` 回傳的 `payload.sub` 是 `username`（字串），既有
`handleGetProgress`／`handlePutProgress`（`uep-auth.ts:285`／`325`）都是先用
`username` 查一次 `uep_users` 表拿到那一列，再用該列的欄位操作——**目前
`uep_users` 表本身用 `username` 當查詢鍵，UPDATE 也是 `WHERE username = ?`，
從未真的把 `id` 傳出去給呼叫端用過**。

新的 `/api/uep/notes` 端點若要用 `uep_user_notes(user_id, note_id, ...)`
這個 schema（設計文件寫的欄位），實作時必須先 `SELECT id FROM uep_users WHERE
username = ?` 拿到數字 id 才能查/寫 `uep_user_notes`，不能直接把 `payload.sub`
塞進 `user_id` 欄位（型別也對不上：一個是 TEXT username 一個是 INTEGER id）。
這是設計文件完全沒提到的實作細節，T-C2 必須把這一步寫進範圍。

---

## 2. 任務拆解

### A 段 — 手機體驗補完

#### T-A1（0.9.18.0）DevTools 手機守門

- **範圍**：
  1. `apps/uep/src/devtools/UepDevTools.tsx`：`UepDevToolsHost` 呼叫
     `useDesktopIslandViewport()`；`useEffect` 內的掛載判斷改為
     `if (!shouldMount() || !isDesktopViewport) return;`（地雷 2，不可只在
     render 回傳值加判斷）
  2. 確認 resize 時的行為：桌面縮到手機寬度時，`mounted` 需要能夠變回
     `false`（目前 `setMounted(true)` 是單向的，`useEffect` deps 若只有
     `[]` 不會在 `isDesktopViewport` 改變時重跑）——因此 `useEffect` 的
     deps 要加入 `isDesktopViewport`，且 effect 本體要處理「從桌面切手機」
     時的清理（移除 `keydown` 監聽、`setMounted(false)`、若面板正開著要
     一併 `setOpen(false)`）
- **驗收標準**：
  - 新增/更新 `UepDevTools.test.tsx`（若無則新建）：手機寬度下 `shouldMount()`
    為真時仍不掛載；桌面縮到手機寬度（matchMedia change 觸發）FAB 消失且
    `keydown` 監聽解除（可用 spy 驗證 `removeEventListener` 被呼叫）
  - 手動驗收：390px 寬度下 `document.querySelector('.uep-devtools-fab')`
    為 `null`；桌面開著面板時縮窗到手機寬度，面板自動關閉且按鍵不再響應
- **依賴**：無
- **風險**：低-中（resize 時的清理路徑是本卡唯一非顯而易見的部分）
- **⚠️ 本卡建立 mobile gate 的用法慣例（`!useDesktopIslandViewport()`），
  T-A6 直接沿用同樣寫法，不重新設計**

---

#### T-A2（0.9.18.1）大地圖首幀尺寸修正 + 同類巡查

- **範圍**：
  1. `apps/uep/src/components/ui/BigMapModal.tsx`：新增模組層級純函式
     `computeMapSize(): number`（`typeof window === 'undefined'` 回 520，
     否則回 `Math.min(520, window.innerWidth - 36, window.innerHeight - 170)`）；
     `useState(520)` 改為 `useState(computeMapSize)`（lazy initializer，
     地雷 3：傳函式本身不呼叫）；原本 mount 時的 `syncMapSize()` effect
     只保留 resize 訂閱部分
  2. 巡查 `IntroOverlay`、`PieMap3D` 呼叫端、`Minimap` 三處是否有同款
     「初始值寫死＋effect 修正」模式；若有比照同樣手法修正，若讀碼後確認
     沒有這個問題，在本卡 PR 描述或後續文件記錄「已巡查，無同型問題」，
     不必為了湊修改硬套用
- **驗收標準**：
  - `BigMapModal.test.tsx` 新增：390×844 viewport 下首次 render 的
    `mapSize` state 直接是縮小後的值（不需等 effect），可用
    `renderHook`／首次 render 快照驗證
  - 手動驗收（Playwright MCP `browser_resize` 到手機寬度，不可用
    Chrome MCP `resize_window`——記憶已記錄該工具視窗最大化時無效）：
    展開大地圖第一幀不溢出畫面
  - 巡查結果需在本卡驗收記錄中列出：三個候選各自「有問題已修」或
    「已巡查無問題」
- **依賴**：無
- **風險**：低
- **預估重點**：巡查三個候選檔案的時間可能超過修主線問題本身，若讀碼後發現
  某個候選（例如 `Minimap`）改動面明顯更大，可與艾斯維爾確認是否要拆成獨立卡，
  不要為了塞進同一版號而倉促改動未經驗證的檔案

---

#### T-A3（0.9.18.2，診斷卡）入場儀式未重現的三項排查

- **範圍**（診斷，非必然產生功能性程式碼變更）：
  1. **正式站與 staging 的 `ONBOARDED_KEY` 隔離**：`OnboardingGate.tsx:126`
     的判定鍵在 test 模式為 `uep.onboarded.v1:test`、正式為
     `uep.onboarded.v1`。用 Chrome MCP／Playwright MCP 實際開啟正式站與
     staging 網域（**staging 正確網址是 `https://staging.eternity-uep.pages.dev/`**，
     記憶已記錄過另外兩種常見誤打網址），檢查兩個網域各自
     `localStorage` 的 key 是否真的互相獨立（同瀏覽器分別造訪兩個網域，
     `localStorage` 本身就是 origin 隔離，理論上不會互通——這一步是要
     排除「艾斯維爾誤以為兩站共用同一個 origin」的可能性，屬於確認性
     檢查而非預期會找到 bug）
  2. **非主頁進站的導回路徑 race**：從外部連結（例如 `/history` 直接帶
     URL 進站，不經過 `/`）觀察是否會出現「導回主頁」與「儀式掛載」
     時序錯亂——用 Playwright MCP `browser_navigate` 直接打
     `/history` 深連結，檢查儀式遮罩掛載時機與 URL 改變順序
  3. **Cloudflare Pages HTML 快取**：檢查 `uep-welcome-pending` 這類
     head inline script 掛的 class，在瀏覽器已快取舊版 HTML、但抓到新版
     JS bundle 的組合下是否會對不上——可透過 DevTools Network 面板檢查
     HTML 回應的 `cache-control` header，或直接在 staging 部署新版後、
     不清快取的情況下重新整理觀察
- **驗收標準**：三項排查結果逐一記錄「清白」或「發現真 bug」；
  若三項皆清白，結案為快取殘留，**不寫任何程式碼**；若第 1 項成立
  （key 真的互通），才需要另開一張修法卡（版號另計，不在本文件預先分配）
- **依賴**：無
- **風險**：低（純觀察，但需要跨網域手動操作，無法完全自動化）
- **注意**：test 環境要跳過入場儀式時，記得種
  `localStorage['uep.onboarded.v1:test'] = '1'`（PM 記錄的既有踩坑），
  否則排查第 2 項時每次都會被儀式擋下

---

#### T-A4（0.9.18.3，診斷卡，**blocker**）手機掃描線不動作根因排查

**本卡的產出是根因報告，不是修法。** 尚未重現，是 A 段唯一標記 blocker 的項目——
掃描線不動代表手機使用者的整條進度系統（旗標、迷霧、浮島解鎖）等於不存在。

- **範圍**：三個待驗假設，每項給出可執行的驗證步驟：

  **假設 1：`rootMargin: '0px 0px -20% 0px'` 在動態工具列下的實際落點**
  （`progress/scanline.ts` 的 IntersectionObserver 設定）
  - **需要工具**：**真機**（iOS Safari）。Chrome DevTools 裝置模擬、
    Playwright/Chrome MCP 的 viewport resize **都無法重現 Safari 動態
    工具列收合這個行為**——這是模擬器的已知落差，emulator 的 viewport
    高度是固定值，不會像真實 Safari 一樣隨滾動收合網址列/工具列。
    **環境缺口**：目前工具箱（Chrome-in-Chrome／Playwright MCP）不含
    真實 iOS Safari；需要借用實體 iPhone 接 Mac 用 Safari Web Inspector
    遠端偵錯，或使用雲端真機測試服務（如 BrowserStack App Live）。
    這一步若無法取得裝置，需要向艾斯維爾回報環境缺口，不要用模擬器
    測出的「看起來正常」當作結論。
  - **驗證步驟**：在真機上捲動 History 文章，同時觀察工具列收合前後，
    `.history-content` 的 `clientHeight` 是否改變、IntersectionObserver
    root 的 `rootBounds` 是否跟著變化；比對 marker 元素的
    `getBoundingClientRect()` 與 `isIntersecting` 判定是否在工具列收合
    瞬間出現不一致視窗

  **假設 2：觸控慣性滾動期間的回報頻率被 800ms 節流吃掉**
  （`scanline.ts` 的 `last` 寫入節流）
  - **需要工具**：同上，真機 iOS Safari（iOS 對慣性動量期間的 JS 回呼
    有已知的節流行為，桌面瀏覽器與 Android Chrome 都不會重現）
  - **驗證步驟**：真機上用手指快速滑動後放開（觸發慣性捲動），在
    console 記錄每次 IntersectionObserver callback 的時間戳與
    `isIntersecting` 值，比對是否有連續超過 800ms 沒有任何回呼落地、
    導致 `maxIdx`/`lastIdx` 卡在慣性滾動開始前的值

  **假設 3：零面積標記策略（`height: 0 + visibility: hidden`）在行動
  Safari 是否回報 `isIntersecting`**
  - **需要工具**：真機或至少能重現 WebKit 引擎行為的環境（**不能用
    Chrome/Chromium 模擬器測這項**——這是 WebKit 與 Blink 對零面積元素
    IntersectionObserver 行為的引擎差異，Chrome DevTools 裝置模擬跑的
    仍是 Blink 引擎，無法反映 WebKit 的實際行為）
  - **驗證步驟**：真機建一個最小重現頁（零面積 div + IntersectionObserver），
    捲動使其進出視窗，記錄 `isIntersecting` 是否如期切換；若行動 Safari
    對零面積元素不回報或回報不穩定，需要另尋標記策略（例如改用
    `clip-path` 或 1px 高度）

- **診斷手段**：在 `apps/uep/src/devtools/actions/progressActions.ts`
  新增一個「掃描線即時狀態」action（`progress:scanline-status`），
  顯示 `totalMarkers`／`maxIdx`／`lastIdx`（`scanline.ts:140-147` 已有
  這三個變數，只是目前沒有對外暴露的讀取管道，需要在 `scanline.ts`
  補一個模組內查詢函式或掛進既有 `window.__uepProgress` bridge）以及
  每個 marker 的 `getBoundingClientRect()`。這個 action 本身**是本卡
  唯一會落地的程式碼**——用真機 Chrome 遠端偵錯（`chrome://inspect`
  透過 USB 連 Android，或 Safari Web Inspector 連 iOS）連線後在
  DevTools 面板叫出這個 action 讀值
- **驗收標準**：
  - 三項假設各自有明確的排除或確認結論（不是「可能是」，要有實際觀察
    數據支持）
  - `progress:scanline-status` action 新增並可正常運作（可在桌面環境
    先驗證顯示格式正確，再帶到真機驗證實際數值）
  - 產出根因報告（記錄在後續文件或 PM notebook），**不在本卡實作修法**——
    修法依實際根因另開卡，版號待根因確定後再分配
- **依賴**：無
- **風險**：高（唯一的 blocker；若無法取得真機測試環境，整個排查會卡住，
  需要及早向艾斯維爾回報環境需求，不要拖到卡尾才發現缺裝置）

---

#### T-A5（0.9.18.4）手機識別證隱藏齒輪

- **範圍**：`apps/uep/src/components/ui/IdentCard.tsx:360` 附近的齒輪
  `<button>`（`uep-ident__gear`）：外層加 `!useDesktopIslandViewport()`
  守門，非桌面時不 render 該按鈕（地雷 1：直接沿用 T-A1 建立的
  `!useDesktopIslandViewport()` 用法，不新建 hook）
- **驗收標準**：
  - `IdentCard.test.tsx` 新增：手機寬度（mock `useDesktopIslandViewport`
    回 `false`）齒輪按鈕不在 DOM 中；桌面寬度維持原行為
  - 手動驗收：390px 寬度下證卡背面無齒輪按鈕，其餘內容（rows／
    ViewSwitch／tear-hint）不受影響
- **依賴**：T-A1（沿用同一套 gate 慣例）
- **風險**：低

---

#### T-A6（0.9.18.5）抽出 `performLogout()` 共用登出流程（前置重構卡）

**本卡不改變任何使用者可見行為**，純粹是 T-A7 的前置準備，獨立成卡以便
可以單獨 revert 且不與 UI 變更混在一起驗收。

- **範圍**：依地雷 4 的分析，在 `IdentCard.tsx` 抽出：
  ```
  async function performLogout(alias: string): Promise<void> {
    await getReaderAuth().logout();
    try {
      sessionStorage.setItem(
        WELCOME_PENDING_KEY,
        JSON.stringify({ kind: 'logout', alias })
      );
    } catch { /* sessionStorage 不可用時就沒儀式，不影響登出 */ }
    window.location.assign('/');
  }
  ```
  `handlePointerUp` 原本的步驟 4～6 改呼叫這個函式；**`is-torn` class
  與 550ms 等待動畫的程式碼留在 `handlePointerUp` 原地**，不隨函式抽出
  （地雷 4：那是手勢路徑自己的視覺時序，T-A7 的按鈕路徑會有自己的
  對應視覺觸發，兩者共用的是「登出本體」不是「撕裂動畫」）
- **驗收標準**：
  - 既有 `IdentCard.test.tsx` 的登出相關測試全數維持綠燈（純重構，
    行為不變的回歸驗證）
  - 手動驗收：撕下拖曳登出流程與重構前完全一致（confirm 對話框文案、
    550ms 動畫等待、導回 `/`、登出儀式 toast 皆不變）
- **依賴**：無
- **風險**：低（純函式抽取，無行為變更）

---

#### T-A7（0.9.18.6）手機登出改放證卡內按鈕

- **範圍**：
  1. `IdentCard.tsx` 的 `handlePointerDown`：非桌面寬度時直接 `return`
     （停用 tear 手勢，避免與瀏覽器 pull-to-refresh 衝突）
  2. 手機分支（`!useDesktopIslandViewport()`）：`.uep-ident__tear-hint`
     文字與圖示置換為一顆明確的登出按鈕（沿用既有視覺語彙，不需要
     新增 CSS 動畫系統）
  3. 按鈕 `onClick`：走與手勢相同的 confirm 對話框 → 播放
     `is-torn` 視覺（`rootRef.current?.classList.add('is-torn')`）→
     等待與手勢路徑相同的動畫時長 → `await performLogout(alias)`
     （T-A6 抽出的共用函式）
- **驗收標準**：
  - `IdentCard.test.tsx` 新增：手機寬度下 `handlePointerDown` 對 tear
    手勢不生效（模擬 pointerdown/pointermove/pointerup 全流程，斷言
    `is-dragging`/`is-near-tear` class 不出現）；登出按鈕存在且點擊後
    走 confirm → `performLogout` 路徑（mock 驗證呼叫序列）
  - 手動驗收：手機寬度下往下拖曳識別證不觸發撕裂視覺、不觸發
    pull-to-refresh；點擊登出按鈕走完整流程（confirm → 撕裂動畫播放 →
    登出 → 導回 `/` → 登出儀式）
- **依賴**：T-A6（`performLogout()` 已抽出）
- **風險**：中（涉及觸控事件分支邏輯，需注意手機/桌面判斷不要影響既有
  桌面拖曳行為的回歸）

---

#### T-A8（0.9.18.7，設計文件標「風險最高，最後做」，已依 §0-1 修正版號至此）首頁手機切換漸進淡出

- **範圍**：`HomePage.tsx:736` 起的 mobile 分支（`isMobile` 判斷內、
  `startZoneTransition`/`startSectionTransition` 呼叫前）：
  1. 依既有 `fadeOverlayRef`（`HomePage.tsx:215`）與
     `MOBILE_DOWN_GATE_MIN`/`MOBILE_DOWN_GATE_MAX`（`HomePage.tsx:41-42`）
     常數，計算目標區塊頂緣進入 band 的比例 `fadeProgress`（0→1），
     每次 scroll handler 觸發時直接寫入 `fadeOverlayRef.current.style
     .setProperty('--fade-progress', String(fadeProgress))`
  2. `fadeProgress` 達 1（band 走完）才呼叫既有的
     `startZoneTransition`/`startSectionTransition`——**不引入新的狀態機**，
     只是把「進 band 立刻轉場」改成「進 band 依比例淡出，出 band 才轉場」
  3. **不得更動 `previousSceneRef` 的更新時機**（`HomePage.tsx:469`／`629`
     等處）：漸進淡出期間 `previousSceneRef` 必須維持舊值，只有
     `startZoneTransition`/`startSectionTransition` 完成定位時才更新
     （2026-05-18 定下的不變式，本卡的高風險來源就是容易在這裡手滑）
- **驗收標準**：
  - 新增/擴充 `HomePage.test.tsx`（或現有等效測試檔）：模擬手機寬度下
    捲動進入 band，斷言 `--fade-progress` 隨捲動位置連續變化、
    `previousSceneRef` 在淡出未完成前維持原值、band 走完才觸發
    `startZoneTransition`
  - 手動驗收（Playwright MCP，手機寬度）：往下捲動穿過各 zone 邊界時
    是漸進淡出而非瞬間遮罩接管，且與桌面 wheel delta 版本的視覺節奏
    相近（不要求逐幀一致，但不能是「一頓一頓」的生硬感）
  - 回歸驗收：`previousSceneRef` 相關的既有測試（Hero/Atlas 防脫節、
    位置矯正等分支）全數維持綠燈——這些分支高度依賴
    `previousSceneRef` 的精確更新時機，本卡最容易在這裡引入回歸
- **依賴**：無（技術上獨立，但故意排最後——複雜互動最容易受益於
  「其他手機卡都做完、對整體手機行為已經很熟悉」這件事）
- **風險**：高（設計文件與本文件都標記為 A 段風險最高項目；`HomePage.tsx`
  的捲動狀態機是全站最複雜的互動邏輯之一，任何對 `previousSceneRef`
  更新時機的誤動都可能連鎖影響其餘 zone 轉場）

---

### B 段 — 首屏效能

#### T-B1（0.9.18.8）效能量測基礎建設（Lighthouse CI 腳本）

**排在 B 段任何優化之前**——設計文件明講不用 PageSpeed 分數當驗收標準
（每次跑會飄），需要先有可重複的量測基準，否則 B-1/B-2/B-3 各自做完
都無法互相比較效果。

- **範圍**：新建 `scripts/lighthouse-ci.mjs`（或等效腳本），固定
  throttling 設定（比照設計文件 §3-1 的「Moto G Power + 慢速 4G」），
  對 staging（或本地 build 後的靜態伺服）跑一次 Lighthouse，輸出
  FCP／LCP／TBT／CLS 四項絕對值到檔案，供前後對照
- **驗收標準**：跑一次腳本，記錄 B 段開工前的基準值（應與設計文件 §3-1
  記錄的 55 分/FCP 14.3s 量級相近，若差異過大代表量測方法本身有問題，
  需要先排除）
- **依賴**：無
- **風險**：低

---

#### T-B2（0.9.18.9）`BaseLayout.astro` Google Fonts 重複請求清理

- **範圍**：`BaseLayout.astro:92-110` 附近三份重複的同一支 Google Fonts
  URL（preconnect／preload／stylesheet）：確認實際重複的內容並清理，
  這是 B-2 的前置動作（先把明顯的浪費清掉，才看得出後續非阻斷載入的
  真實效果）
- **驗收標準**：Network 面板確認同一支 Google Fonts CSS URL 只發出一次
  請求（而非三次）；`pnpm build` 產物中無殘留重複 `<link>` 標籤
- **依賴**：無
- **風險**：低

---

#### T-B3（0.9.18.10，**開工前需艾斯維爾定案視覺容忍度**）字型自架 + 子集化（B-1）

**⚠️ 此卡在艾斯維爾對「首屏系統字 FOUT 空窗期」的視覺容忍度定案前不可開工。**
設計文件 §6 待決點 2 明確列為待決事項，且 §3-3 已寫明兩種選項各自的取捨
（接受首屏一小段系統字，或首屏就先用系統字、字型載入後才切換），這是
產品層級的視覺決策，不是工程可以自行拍板的部分。

- **範圍**（定案後才展開，本文件先列出定案後的工作骨架，供艾斯維爾參考
  影響範圍）：
  1. 自架 Noto Serif TC，以 unicode-range 自行切分片（不依賴 Google 的
     CDN 切法）
  2. 常用字（BIG5 常用字 + 站內內容實際掃出的高頻字）合成一個
     `preload` 的首屏分片
  3. 其餘分片維持懶載，字典外的字自然回退系統襯線字
  4. 需要一支「站內用字掃描」腳本（掃 D1 `pages.content` 實際出現的字符，
     供決定「高頻字」子集，且世界觀站持續新增內容，這支腳本應該可重複
     執行，不是一次性）
- **驗收標準**（定案後補齊）：`scripts/lighthouse-ci.mjs`（T-B1）跑出的
  FCP 較基準顯著下降（設計文件預期掉到 2-3 秒級）；子集缺字時的視覺
  回退符合艾斯維爾定案的容忍度
- **依賴**：T-B1（需要量測基準）、**艾斯維爾對 B-1 視覺容忍度的定案**
- **風險**：中（子集漏字是已知風險，緩解依賴後段懶載與系統字回退）

---

#### T-B4（0.9.18.11）字型 CSS 非阻斷載入（B-2）

- **範圍**：字型 CSS 改為非阻斷（`media="print"` + `onload` 切回，或
  preload + `rel=stylesheet` 兩段式）；本卡與 T-B3 的關係：**若 T-B3
  尚未定案，本卡可以獨立先做**——非阻斷載入本身不涉及「要不要接受系統字
  空窗期」的視覺決策，是純技術面的載入時序優化，即使字型來源仍是
  Google Fonts CDN 也適用
- **驗收標準**：`scripts/lighthouse-ci.mjs` 量到的 FCP 較 T-B2 完成後的
  基準再下降；Network 面板確認字型 CSS 不再是 render-blocking 資源
- **依賴**：T-B1（量測基準）、T-B2（先清理重複請求，避免非阻斷化套用在
  三份重複請求上白做工）
- **風險**：低

---

#### T-B5（0.9.18.12）無用 CSS + 非合成動畫 + 圖片尺寸屬性（B-3）

- **範圍**：
  1. 找出無用 CSS（設計文件提到約 90KiB）並清理——需要先確認清理範圍
     不會影響任何 zone 的樣式（建議用 coverage 工具找出多頁面共通的
     未使用選擇器，而非單頁快照）
  2. 逐一檢視設計文件提到的 36 個非合成動畫元素（動 `width`／`top`／
     `background-position` 的動畫），改為 `transform`／`opacity`——
     **不能盲改**，部分動畫語意就是要改 layout（例如高度展開動畫），
     這類維持原樣，只改真正能無損替換為合成屬性的項目，逐一記錄
     哪些改了、哪些刻意不改及原因
  3. 圖片補齊 `width`/`height` 屬性（CLS 相關）
- **驗收標標準**：
  - 36 個動畫元素的巡查結果需列出清單：改動／不改動＋各自理由
  - `scripts/lighthouse-ci.mjs` 量到的 CLS 較基準持平或改善（B-3 影響
    CLS 較 FCP/LCP 更直接）
  - 手動驗收：改動過的動畫在原本的互動情境下視覺效果不變（只是渲染路徑
    改變，不是外觀改變）
- **依賴**：T-B1（量測基準）
- **風險**：中（36 個元素逐一判斷是否可無損替換為合成屬性，工作量取決於
  實際巡查結果，可能需要視情況再拆卡）

---

### C 段 — ProgressState blob 瘦身

#### T-C1（0.9.18.13）Migration 0026：`uep_user_notes` 表

- **範圍**：新建 `workers/content-api/migrations/0026_uep_user_notes.sql`：
  ```sql
  CREATE TABLE IF NOT EXISTS uep_user_notes (
    user_id     INTEGER NOT NULL,
    note_id     TEXT NOT NULL,
    text        TEXT NOT NULL,
    position    TEXT,          -- StorageNoteLocationSnapshot JSON，可為 NULL
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL,
    PRIMARY KEY (user_id, note_id),
    FOREIGN KEY (user_id) REFERENCES uep_users(id)
  );
  CREATE INDEX IF NOT EXISTS idx_uep_user_notes_user ON uep_user_notes(user_id);
  ```
  主鍵 `(user_id, note_id)` 是設計文件明確要求的冪等寫入基礎（§4 遷移路徑
  中途失敗需要重寫不重複）
- **驗收標準**：`db:migrate:local` 成功套用；`sqlite_master` 可查到新表；
  `INSERT OR REPLACE` 對同一 `(user_id, note_id)` 重複寫入不產生重複列
  （回歸測試鎖住冪等性）
- **依賴**：無
- **風險**：低

---

#### 部署步驟（不佔版號，T-C1 之後、T-C2 之前）migration 0026 三環境套用

- **範圍**：本地 `db:migrate:local` → test `--env test --remote` →
  正式 `db:migrate:remote`
- **驗收標準**：三環境 `uep_user_notes` 表存在且為空（新表無需 backfill——
  便條資料目前只存在使用者的 progress blob 裡，遷移時機是 T-C3 首次載入
  觸發，不是 migration 本身要搬資料）
- **附帶檢查**（§0-2 提到的環境檢查）：套用前先確認三環境目前的
  migration 版本，避免 0023～0025 在某個環境還沒套完就疊加 0026

---

#### T-C2（0.9.18.14）`/api/uep/notes` CRUD

- **範圍**：`workers/content-api/src/uep-auth.ts`（沿用既有
  `/api/uep/progress` 同一支檔案與授權模式）：
  ```
  GET    /api/uep/notes         reader JWT  列出目前使用者的全部便條
  PUT    /api/uep/notes/:noteId reader JWT  新建/更新單筆（INSERT OR REPLACE）
  DELETE /api/uep/notes/:noteId reader JWT  刪除單筆
  ```
  每個 handler 依 `requireReaderJwt()` 拿到 `payload.sub`（username）後，
  **先 `SELECT id FROM uep_users WHERE username = ?` 換成數字 `user_id`
  再操作 `uep_user_notes`**（地雷 7，不可直接把 username 塞進 `user_id`
  欄位）
- **驗收標準**：
  - 新增 `uep-notes.test.ts`：CRUD 各操作的正常路徑；未登入 401；
    操作他人 `note_id`（不同 `user_id`）不可見/不可改（驗證
    `WHERE user_id = ? AND note_id = ?` 兩條件皆生效，不能只靠
    `note_id` 主鍵）
  - `PUT` 對同一 `noteId` 重複呼叫（模擬遷移中途失敗重試）結果冪等
    （對應 T-C1 的主鍵設計）
- **依賴**：T-C1 + 部署步驟
- **風險**：低-中（需要正確處理 username→id 的轉換，見地雷 7）

---

#### T-C3（0.9.18.15）前端遷移路徑：blob → 新表

- **範圍**：
  1. `apps/uep/src/progress/` 相關模組（progressStore／adapters）：
     首次載入 progress 時，若 `ProgressState.storageNotes` 非空，
     依序呼叫 `PUT /api/uep/notes/:noteId` 把每筆便條寫進新表，
     全部成功後清空 blob 裡的 `storageNotes` 欄位並回寫 progress
  2. `ProgressState.storageNotes` 欄位型別保留，但**語意改為「只讀
     遷移來源」**：往後新增便條一律走新表 API，不再寫回 blob 裡的
     這個欄位
  3. `STORAGE_NOTE_HARD_MAX`／`STORAGE_NOTE_TEXT_HARD_MAX` 兩個常數
     （`progress/types.ts:82-83`）用途說明更新：不再是「防 blob 爆掉」，
     純粹是產品層級的便條數量/長度上限；S10-3b 的「載入 sanitize 只用
     硬上限」防資料損失設計維持不變
  4. 未登入使用者（無 `user_id`）的便條**維持 localStorage**，不受
     本次遷移影響（設計文件明確排除）
- **驗收標準**：
  - `blobSize.test.ts`（既有回歸測試檔）更新：`storageNotes` 遷移後
    的 blob 體積大幅下降，重新計算天花板（原本「134 頁」的估算需要
    依新的每頁固定成本重新算一次並寫進測試斷言）
  - 新增遷移測試：中途失敗（寫新表成功但清 blob 失敗）情境下，
    下次載入重新觸發遷移寫入同樣的 `noteId` 不會產生重複資料
    （驗證 T-C1 的主鍵冪等性在前端呼叫序列下確實成立）
  - 手動驗收：既有帳號（blob 裡已有便條）登入後便條正常顯示，且
    確認 `uep_user_notes` 表已寫入對應資料、`progress` blob 的
    `storageNotes` 已清空
- **依賴**：T-C2
- **風險**：中-高（遷移邏輯涉及「部分成功」的中間狀態處理，是本段
  唯一需要仔細設計失敗恢復路徑的卡；建議先在 test 環境用真實帳號
  （寫滿 60 則便條的重度使用者）跑過一次完整遷移再上正式）

---

#### T-C4（0.9.18.16）`test-seed`／`test-reset` 補齊 `uep_user_notes` 處理

- **範圍**：依地雷 6，**不要**把 `uep_user_notes` 加進
  `test-seed.ts` 的 `BUSINESS_TABLES`；改為比照 `uep_users.progress`
  的既有模式，在 `resetAndSeedTestData()` 內新增一條獨立的
  `DELETE FROM uep_user_notes` 陳述式（不需要對應的 `INSERT`——這是
  使用者資料，不是從 `pages` seed 回來的內容）
- **驗收標準**：`test-reset.test.ts` 新增：reset 後 `uep_user_notes`
  為空表；既有的 `BUSINESS_TABLES` 陣列斷言測試維持不變（不含
  `uep_user_notes`，回歸驗證地雷 6 的設計決定沒有被誤改）
- **依賴**：T-C1
- **風險**：低

---

## 3. 執行順序（依賴圖）

```
A 段（各項互相獨立，除下列標註外）：
T-A1 ──→ T-A5（沿用 gate 慣例）
T-A6 ──→ T-A7
T-A2、T-A3、T-A4、T-A8 各自獨立，可任意順序插入
（A-4 為 blocker，建議最優先取得真機測試資源並開始排查，
 即使版號排在 T-A1/T-A2 之後）

B 段：
T-B1 ──→ T-B2 ──→ T-B4
T-B1 ──────────→ T-B3（另需艾斯維爾定案，定案前不可開工）
T-B1 ──────────→ T-B5

C 段：
T-C1 ──→ [部署：migration 0026] ──→ T-C2 ──→ T-C3
T-C1 ──────────────────────────────────────→ T-C4
```

**硬依賴鏈**：`T-A1 → T-A5`、`T-A6 → T-A7`（A 段）；
`T-B1 → T-B2 → T-B4`、`T-B1 → T-B3`（B 段，T-B3 另有定案前置條件）；
`T-C1 → [部署] → T-C2 → T-C3`（C 段主鏈）。

**可並行的段落**：A／B／C 三段彼此完全獨立，若有多人力可同時開工。
A 段內部除 `T-A1→T-A5`、`T-A6→T-A7` 兩條短鏈外，其餘卡互不相依。

**blocker 提醒**：T-A4（掃描線根因）雖然版號是 `0.9.18.3`（排在
T-A1/T-A2 之後），但因為需要真機測試環境，**建議最早開始排查**——
真機借用/雲端測試服務申請可能有前置作業時間，不要等到版號輪到才開始
張羅環境。

---

## 4. 測試策略

### 4-1 逐卡測試層級

| 卡 | Worker 測試 | 前端測試 | 手動驗收 |
|---|---|---|---|
| T-A1 | — | ✅ 新增/更新 `UepDevTools.test.tsx` | ✅ 手機/桌面切換 |
| T-A2 | — | ✅ 新增 lazy initializer 快照測試 | ✅ 真機或 Playwright 手機寬度 |
| T-A3 | — | — | ✅ 三項排查（跨網域手動操作） |
| T-A4 | — | 視情況（診斷 action 若可測） | ✅ **真機**排查（三項假設） |
| T-A5 | — | ✅ `IdentCard.test.tsx` 更新 | ✅ 手機寬度齒輪消失 |
| T-A6 | — | ✅ 既有登出測試維持綠燈 | ✅ 桌面撕下登出行為不變 |
| T-A7 | — | ✅ `IdentCard.test.tsx` 新增 | ✅ 手機登出按鈕 + 手勢停用 |
| T-A8 | — | ✅ `HomePage.test.tsx` 更新 | ✅ 手機捲動漸進淡出 |
| T-B1 | — | — | ✅ 腳本本身跑一次記錄基準 |
| T-B2 | — | — | ✅ Network 面板確認去重 |
| T-B3 | — | 視實作內容 | ✅ 子集缺字回退 |
| T-B4 | — | — | ✅ Network 面板非阻斷確認 |
| T-B5 | — | — | ✅ 36 個動畫逐一巡查記錄 |
| T-C1 | ✅ migration 套用 | — | — |
| T-C2 | ✅ 新增 `uep-notes.test.ts` | — | — |
| T-C3 | — | ✅ `blobSize.test.ts` 更新 + 遷移測試 | ✅ 真實重度帳號遷移驗證 |
| T-C4 | ✅ `test-reset.test.ts` 更新 | — | — |

### 4-2 Test 環境樣本準備

- **T-C3 驗收需要一個寫滿便條的重度帳號**：比照 `blobSize.test.ts` 的
  worst-case 假設（60 則便條、每則接近 400 字全中文），在 test 環境
  造一個這樣的帳號，驗證遷移後 blob 體積確實大幅下降且便條資料完整
- **T-A4 需要真機或雲端真機服務**：這不是「造樣本」而是環境準備，
  建議列為 T-A4 開工前第一件事，及早確認可用性

---

## 5. 設計文件落差彙整（快速索引，詳細內容見 §0、§1）

| # | 落差類型 | 對應章節 |
|---|---|---|
| 1 | A-5「風險最高最後做」與其版號 `0.9.18.4` 矛盾（該版號排在 A-6/A-7/A-8 之前），修正為 A-5 移至 `0.9.18.7`，A-6/A-7/A-8 依序前移 | §0-1 |
| 2 | C 段待決點「migration 0023/0024 是否一起套」已過期——0023～0025 已存在於 repo，S11 新 migration 應為 0026 | §0-2 |
| 3 | `useDesktopIslandViewport()` 已存在且方向與設計文件描述一致，A-1/A-6 不需新建 hook | §1 地雷 1 |
| 4 | DevTools 手機守門必須擋在 `useEffect` 內（連 `registerAllActions`/`keydown` 監聽都不掛），只在 render 回傳值判斷會重犯設計文件自己警告的坑 | §1 地雷 2 |
| 5 | `BigMapModal` lazy initializer 要傳函式本身（`useState(computeMapSize)`），且需 SSR 安全 | §1 地雷 3 |
| 6 | `performLogout()` 抽出時不應包含 `is-torn` class 操作，那是視覺時序，登出流程本體才是要共用的部分 | §1 地雷 4 |
| 7 | A-8 FAB 顯示條件直接沿用 `HomePage.tsx` 既有 `isMobile` state，不需另建 viewport 判斷，也不與 `JourneyNav.css:112` 的 CSS 斷點混用 | §1 地雷 5 |
| 8 | `uep_user_notes` 是使用者擁有的資料，不應加進 `test-seed.ts` 的 `BUSINESS_TABLES`，應比照 `uep_users.progress` 走獨立 reset 陳述式 | §1 地雷 6 |
| 9 | `/api/uep/notes` 的 `user_id` 必須是 `uep_users.id`（數字），需要先用 JWT 的 username 查一次才能取得，不可直接使用 `payload.sub` | §1 地雷 7 |

---

*文件結束。*
