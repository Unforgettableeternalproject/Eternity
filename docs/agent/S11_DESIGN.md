# S11 設計文件 — 手機體驗補完 + 效能優化 + blob 瘦身

> 起草基準 **0.9.17.11**（S10-4 + Codex 修補 + 閒置／教學收尾後）。S11 從 **0.9.18.0** 起算。
> S11 是 Epic 2 的最後一個里程碑。收官版號待艾斯維爾定（候選：0.9.20.0 / 1.0.0.0-rc）。

---

## 1. 範疇

| 段 | 內容 | 性質 |
| --- | --- | --- |
| **A** | 手機體驗補完（艾斯維爾 2026-08-05 手機實測八項） | 修正 + 兩個小新機制 |
| **B** | 首屏效能（PageSpeed 行動版 55 分） | 優化 |
| **C** | ProgressState blob 瘦身（便條搬出） | 技術債，S10-4 遺留 |

### 1-1 為什麼手機這輪才做

Epic 1～2 的所有機制（掃描線、迷霧、浮島、教學、閒置）都是先在桌面成形。
浮島從 S6 起就明確**只在 ≥761px 掛載**（`useDesktopIslandViewport`），
於是「手機版是什麼樣子」一直沒有被當成一個完整的產品面來設計，
只在各元件內零散加了 `max-width: 760px` 斷點。

八項回報裡有三項（齒輪、登出、回到導覽）根因相同：**桌面才有的東西在手機留下了殘骸，
或桌面獨有的替代路徑在手機沒有對應物**。這不是排版問題，是資訊架構缺口。

### 1-2 明確不做

- **手機版浮島**。維持桌面限定。拖曳視窗 + 聚光燈教學 + dock chip 這整套語彙在
  390px 寬度上沒有立足空間，硬塞會同時毀掉閱讀區與浮島本身。手機的定位是
  **閱讀 + 導覽**，互動層留在桌面。
- **手機版 DevTools 面板**。連按鈕都要藏（見 A-1），面板本體自然不用適配。
- **重寫首頁捲動模型**。A-5 只調整轉場的觸發表現，不動 `activeScene` /
  `previousSceneRef` 的分工（2026-05-18 定下的不變式仍然有效）。

---

## 2. A 段：手機體驗補完

### A-1 手機不掛 DevTools 按鈕　`0.9.18.0`

**根因確認。** `devtools/UepDevTools.tsx:38` 的 `shouldMount()` 三個條件
（`import.meta.env.DEV` / `isTestMode()` / force flag）**沒有任何寬度守門**。
staging 綁 test worker → `isTestMode()` 恆真 → FAB 必然出現。
390px 實測：`document.querySelector('.uep-devtools-fab')` 存在，且是 `<body>` 的最後一個子節點。

**修法。** `shouldMount()` 加一道視窗寬度守門，斷點沿用全站的 **760px**
（浮島 / Minimap / 島 bottom sheet 都用這個值，不另立第四個數字）。

⚠️ 不要只用 CSS `display: none` 藏。面板會綁 `keydown` 全域監聽並在開啟時
接管 focus，藏起來的按鈕仍是可被 tab 到的互動元素。要在掛載層擋掉。

⚠️ 守門要能對 resize 反應（桌面縮窗到手機寬度時消失），沿用
`useDesktopIslandViewport` 的 matchMedia 訂閱模式，不要一次性讀 `innerWidth`。

### A-2 大地圖展開第一幀超出畫面　`0.9.18.1`

**根因確認。** `components/ui/BigMapModal.tsx:22`：

```ts
const [mapSize, setMapSize] = useState(520);   // ← 寫死
useEffect(() => { syncMapSize(); ... }, []);   // ← mount 後才修正
```

第一次 render 一律用 520px 畫盤面，effect 要到 commit 之後才把它改成
`min(520, innerWidth - 36, innerHeight - 170)`。390px 裝置上，
**第一幀就是一個 520px 寬的地圖溢出畫面**，第二幀才縮回 354px。

**修法。** 初始值改 lazy initializer，第一次 render 就是正確尺寸：

```ts
const [mapSize, setMapSize] = useState(computeMapSize);
```

`computeMapSize()` 在 `typeof window === 'undefined'` 時回 520（SSR 安全）。
effect 只留 resize 訂閱。這比改 `useLayoutEffect` 好——後者仍會多跑一輪 layout。

**同類巡查（同一張卡順手做）**：任何「初始值寫死 + effect 修正尺寸」的模式都有同樣的
第一幀破綻。`IntroOverlay`、`PieMap3D` 的呼叫端、`Minimap` 都要看一次。

### A-3 手機入場儀式沒出現　`0.9.18.2`（診斷卡）

**現況與回報不一致，先診斷再修。**

390px 實測：身分選擇儀式**有正常掛載並顯示**（`body.uep-onboarding-active`，
遮罩 384×876 覆蓋全屏，雙卡與「直接登入」都在）。艾斯維爾回報初次進入時沒看到，
判斷是快取殘留。

**要驗的三件事：**

1. `OnboardingGate.tsx:126` 的判定是 `localStorage.getItem(ONBOARDED_KEY) !== null`。
   key 在 test 模式是 `uep.onboarded.v1:test`、正式是 `uep.onboarded.v1`——
   若某次瀏覽帶著另一組 key 的殘留值，判定會靜默走「已完成儀式」。
   要確認 **正式站與 staging 的 key 隔離在真實裝置上確實成立**。
2. 儀式「非主頁導回主頁」的路徑（實測會把 `/history` 導回 `/`）在手機是否有
   race——若使用者是從外部連結直接進 zone 頁，導回主頁 + 儀式掛載的時序要確認。
3. Cloudflare Pages 的 HTML 快取：舊版 HTML 配新版 JS 的組合會不會讓
   `uep-welcome-pending` 這類 head inline script 掛的 class 對不上。

**若三項都清白**就結案為快取殘留，不改程式；若第 1 項成立，那是真 bug（正式站
使用者可能因為逛過 staging 而永遠看不到入場儀式）。

### A-4 手機掃描線不動作　`0.9.18.3`（診斷卡，**blocker**）

**尚未重現，優先級最高。** 掃描線推不動 = 讀完不算完成、旗標不授予、迷霧不散、
浮島解鎖鏈整條斷掉——手機使用者的進度系統等於不存在。

已排除的假設：

- ~~滾動容器在手機被改成整頁滾動~~ → 實測 `.history-content` 在 390px
  仍是 `overflow-y: auto`（789 / 2434），IO root 的前提成立。
- ~~`100vh` 被 iOS 工具列吃掉~~ → `HistoryReader.css:156` 已用 `100dvh`。

待驗的三個假設：

1. **`rootMargin: '0px 0px -20% 0px'` 在動態工具列下的實際落點**。dvh 會隨
   Safari 工具列收合改變，但 IntersectionObserver 的 root 尺寸是它自己算的；
   工具列收合的那一刻 root 高度變化，觀察閾值可能落在使用者永遠捲不到的位置。
2. **觸控慣性滾動期間的回報頻率**。iOS 在慣性動量期間會壓抑部分回呼；
   `last` 的 800ms 節流疊上去可能整段吃掉。
3. **標記元素的零面積策略在行動 Safari 的行為**。S2 的踩坑記錄寫明不能用
   `display: none`，改用 `height: 0 + visibility: hidden`——這個技巧在
   行動 Safari 上是否同樣回報 `isIntersecting` 未驗證過。

**診斷手段**：DevTools 面板已有 rhythm/progress 群組，加一個「掃描線即時狀態」
action（顯示 totalMarkers / maxIdx / lastIdx / 每個 marker 的 boundingClientRect），
用 Chrome 遠端偵錯連真機看。**這張卡的產出是根因，不是修法**——修法依根因另開。

### A-5 首頁手機切換區塊突兀　`0.9.18.4`

**根因確認。** 桌面切區塊要先累積 wheel delta 觸發 fade（`fadeDirectionRef` /
`fadeTargetRef` 那一套），使用者看到的是「越滑越淡 → 遮罩 → 落位」的漸進過程。
手機沒有 wheel 事件，`HomePage.tsx:736` 起的 mobile 分支是
**捲進 gate band 就直接 `startZoneTransition`**——遮罩瞬間接管、強制對位，
中間沒有任何漸進段。這就是「突兀」的來源。

**修法。** 手機補一段**捲動位置驅動**的漸進淡出，取代桌面的 delta 累積：

```
fadeProgress = 目標區塊頂緣進入 band 的比例（0 → 1）
             → 直接寫進 fade overlay 的 opacity
band 走完（fadeProgress 達 1）→ 才 startZoneTransition
```

關鍵是**不要引入新的狀態機**。`fadeOverlayRef` 已經存在（`HomePage.tsx:449`
的 mobile 分支就在用它），band 常數 `MOBILE_DOWN_GATE_MIN/MAX` 也已經有。
這張卡只是把「進 band → 立刻轉場」改成「進 band → 依比例淡出 → 出 band 才轉場」。

⚠️ **不得動 `previousSceneRef` 的更新時機**。zone 0～4 只能在
`startZoneTransition` 完成定位時更新它——這是 2026-05-18 定下的不變式，
漸進淡出期間 `previousSceneRef` 必須保持舊值。

### A-6 手機識別證隱藏齒輪　`0.9.18.5`

**根因確認，艾斯維爾定案：直接隱藏。**

齒輪開的 `IslandSettingsPanel` 內容是「浮島開關 + 教學回顧」，
兩者的前提都是浮島已掛載——而手機根本不掛（`useDesktopIslandViewport`，≥761px）。
所以手機上點開必然是一個全空、或全部顯示「未知的浮島·尚未喚醒」的面板。

**修法。** `IdentCard.tsx:360` 的齒輪按鈕加寬度守門，與 A-1 共用同一個
`useIsCompactViewport()` hook（新增，或直接沿用 `useDesktopIslandViewport` 的反向值——
**優先沿用，不要為了語意好聽新開一個做同一件事的 hook**）。

### A-7 手機登出改放證卡內　`0.9.18.6`

**根因確認。** 現行登出是「按住吊牌往下拖曳撕下」（`IdentCard.tsx:217` 的
pointermove，閾值 96px）。在手機上這個手勢與瀏覽器 **pull-to-refresh 直接衝突**——
識別證掛在頂端，往下拉正是觸發重整的區域。艾斯維爾實測會觸發重新整理。

**修法。** 手機分支：

- 停用 tear 手勢（`handlePointerDown` 在窄視窗直接 return）
- 證卡背面底部把 `.uep-ident__tear-hint` 換成一顆**明確的登出按鈕**
- 按下 → 走**同一條登出流程**（confirm dialog → `logout()` → 種
  `WELCOME_PENDING_KEY` 登出儀式 flag → 導回 `/`）

⚠️ 登出流程本體不得複製一份。現行流程寫在 `handlePointerUp` 裡，
要先抽成 `performLogout()`，手勢與按鈕共用。撕開動畫（`is-torn`）在按鈕路徑上
仍要播——那是登出的視覺語彙，不是手勢的裝飾。

### A-8 手機首頁「回到導覽」按鈕　`0.9.18.7`

**根因確認：手機沒有任何回到入口的捷徑。** `JourneyNav.css:112` 把右側導覽欄
在 760px 以下 `display: none`，於是手機使用者往下逛完五個 zone 後，
只能一路往上捲——而往上捲會逐一觸發每個 zone 的 up gate 與轉場。

**修法。** 手機專用 FAB（右下角），點擊直接呼叫既有的
`handleJourneyNav(-1)`（`HomePage.tsx:1444`）——它走的正是
`startSectionTransition(target, -1, 'threshold', 'up')`，
**也就是艾斯維爾要的「回到導覽的動畫」（threshold ring/line/label 那一套）**。

零新機制：既有函式 + 既有動畫，只差一個手機上的觸發點。

顯示條件：`isMobile && activeScene >= 0`（在 zone 區塊或 Verse 時才出現，
Hero/Atlas/入口本身不顯示）。

⚠️ 右下角要與可能同時存在的元件錯位：TEST MODE banner（頂部，不衝突）、
浮島 dock（手機不掛，不衝突）、`ReaderNudge` 側邊卡（Reader 內，首頁沒有）。
目前右下是空的，但要留 `env(safe-area-inset-bottom)`。

---

## 3. B 段：首屏效能

### 3-1 PageSpeed 行動版現況（2026-08-05，staging）

```
效能 55 ｜ 無障礙 96 ｜ 最佳做法 100 ｜ SEO 100

FCP  14.3s   ← 0 分
LCP  15.2s   ← 0 分
SI   14.3s   ← 0 分
TBT  0ms     ← 滿分
CLS  0.039   ← 滿分
（模擬 Moto G Power + 慢速 4G 節流）
```

### 3-2 根因：中文字型，不是 JavaScript

**TBT 0ms 而 FCP 14.3s** 這個組合本身就說明問題不在 JS 執行——
主執行緒是空的，畫面就是沒東西可畫。

實測 staging 的 resource timing，**前 17 大資源全部是 Google Fonts 的
woff2 CJK 分片，每個 79–113KB**：

```
Z0BhnJ....106.woff2   83 KB
Z0BhnJ....107.woff2   91 KB
...（共 17 個分片）...
Z0BhnJ....122.woff2   79 KB
────────────────────────────
合計約 1.5 MB，全部是 Noto Serif TC
```

外加 `fonts.googleapis.com/css2?...` 這支 **render-blocking CSS**（68KB）。
慢速 4G 上，光是「拿到字型 CSS → 解析 unicode-range → 逐一抓十幾個 90KB 分片」
就足以把首次繪製推到十秒之後。`&display=swap` 有下，但阻斷的是 CSS 本身，
不是字型檔。

### 3-3 三個方向（按投報率排序）

| 方向 | 預期效果 | 成本 | 風險 |
| --- | --- | --- | --- |
| **B-1 字型自架 + 子集化** | FCP 掉到 2～3 秒級 | 中 | 子集漏字 |
| **B-2 首屏 CSS 內聯 + 字型非阻斷** | 再省 1～2 秒 | 低 | 低 |
| **B-3 無用 CSS 90KiB / 非合成動畫 36 個 / 圖片缺 width-height** | 分數尾段 + CLS | 中 | 低 |

**B-1 細節。** 站台的中文字集是**有界的**——內容全在 D1，可以掃出實際用字。
但世界觀站會持續新增內容，靜態子集化會漏字。折衷方案：

- 自架 Noto Serif TC，用 unicode-range 分片（自己切，不靠 Google）
- 常用字（BIG5 常用 + 站內高頻字）合成**一個 preload 的首屏分片**
- 其餘分片維持懶載，漏字時瀏覽器自然回退到系統襯線字

⚠️ 這需要艾斯維爾決定**視覺容忍度**：首屏一定會有一小段時間是系統字，
或是首屏就先用系統字、字型載入後才換（FOUT）。目前 `display: swap` 已經是
FOUT 策略，只是 swap 前的空窗期太長。

**B-2 細節。** 字型 CSS 改成非阻斷載入（`media="print"` + `onload` 切回，
或 preload + `rel=stylesheet` 兩段式）。`BaseLayout.astro:98` 附近現在有
三份重複的同一支 Google Fonts URL（preconnect / preload / stylesheet），
要一併整理——重複請求本身也是成本。

**B-3 細節。** 「避免非合成動畫，找到 36 個動畫元素」——站內大量動畫在動
`width` / `top` / `background-position`，這些會觸發 layout/paint。
逐一改成 `transform` / `opacity` 是機械工作，但 36 個要一個個看，
不能盲改（有些動畫的語意就是要改 layout）。

### 3-4 效能卡的驗收方式

**不用 PageSpeed 分數當驗收標準**（每次跑都會飄）。建立一個可重複的量測：
`scripts/` 下加一支 Lighthouse CI 腳本，固定 throttling 設定，
記錄 FCP/LCP/TBT/CLS 四項的絕對值，前後對照。

---

## 4. C 段：ProgressState blob 瘦身

S10-4 首次實測的結果（`progress/__tests__/blobSize.test.ts`，已是回歸測試）：

```
44 頁全讀完 + 便條寫滿(60×400 全中文) = 106.6 KB / 128 KB 上限
  storageNotes      86 KB   ← 超過總量三分之二
  pageMarkers      5.8 KB
  flags            ~8 KB
  fogRatio         2.1 KB
  completedPageIds 1.7 KB
天花板 = 134 頁
```

**症狀是靜默的**：寫入超限只讓進度停在某個版本，讀者看不到任何錯誤。

**修法。** 便條搬出 blob 到獨立 D1 表：

- 新 migration：`uep_user_notes(user_id, note_id, text, position, created_at, updated_at)`
- `/api/uep/notes` CRUD（沿用 reader JWT 授權，與 `/api/uep/progress` 同一組守門）
- `ProgressState.storageNotes` 欄位保留但改為**只讀遷移來源**：
  首次載入時若 blob 裡還有便條，寫進新表後清空該欄位
- 未登入使用者的便條仍留 localStorage（沒有 user_id 可掛）

⚠️ **`STORAGE_NOTE_HARD_MAX` / `STORAGE_NOTE_TEXT_HARD_MAX` 兩個硬上限的用途會改變。**
搬出去之後它們不再是「防 blob 爆掉」，而是單純的產品上限。
S10-3b 那個「載入 sanitize 只用硬上限」的防資料損失設計仍要保留。

⚠️ 遷移路徑要能承受**中途失敗**：寫新表成功但清 blob 失敗，下次載入會重複寫入。
新表需要以 `(user_id, note_id)` 為主鍵讓重寫是冪等的。

---

## 5. 版號與順序

| 卡 | 版號 | 依賴 |
| --- | --- | --- |
| A-4 掃描線診斷 | `0.9.18.3` | 無（**最先做**，blocker） |
| A-1 DevTools 守門 | `0.9.18.0` | 無 |
| A-2 大地圖首幀 | `0.9.18.1` | 無 |
| A-6 齒輪隱藏 | `0.9.18.5` | 與 A-1 共用 viewport hook |
| A-7 登出按鈕 | `0.9.18.6` | 需先抽 `performLogout()` |
| A-8 回到導覽 FAB | `0.9.18.7` | 無 |
| A-5 首頁漸進淡出 | `0.9.18.4` | 無（風險最高，最後做） |
| A-3 入場儀式診斷 | `0.9.18.2` | 無 |
| B 段 | `0.9.18.8` 起 | 無 |
| C 段 | 待定 | 需 D1 migration + 部署 |

**A-4 排第一但版號不是第一**——版號跟著 commit 順序遞增，診斷卡本身可能不產生 commit。

## 6. 待艾斯維爾定案

1. **S11 收官版號**：Epic 2 完成要進 `0.9.20.0` 還是 `1.0.0.0-rc`？
2. **B-1 字型策略的視覺容忍度**：接受首屏系統字 FOUT，還是要更保守的方案？
3. **C 段的部署節奏**：新 migration 要不要與 S10 積欠的 0023/0024 一起套？
4. **A-5 的「不突兀」標準**：漸進淡出的長度／曲線要不要跟桌面完全一致？
