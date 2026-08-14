# S10-2 設計文件：漸進式戰爭迷霧（Rush Prevention）

> 起草基準：0.9.15.26（`feature/epic2-progress-foundation`，S10-1 互聯已完成待驗收；
> `progress/types.ts`／`adapters.ts`／`progressStore.ts` 已有諾薇亞的 `fogRatio` 地基，
> 尚未接上任何消費端，工作樹目前為未 commit 狀態）
> 範疇：History 讀者頁的漸進式迷霧遮蔽——凍結迷霧線以下的事件觸發器、堵住掃描線
> 哨兵的「捲到底即完成」後門、進度顯示與續讀改讀 ratio、迷霧的分層渲染。
> 不含：admin 編輯器改動、Concepts/Echoes/Visuals 其他 zone（迷霧僅適用於 History）。
> 作者：奈也 × 奈留（架構師）
> 日期：2026-07-27（初稿）

---

## 0. 定案彙整（艾斯維爾拍板，本文件的邊界條件）

| # | 項目 | 定案 |
|---|---|---|
| 1 | 迷霧推進方式 | 跟著掃描線（讀者視線）連續推進；往下跳躍迷霧不動 |
| 2 | 適用範圍 | 只罩尚未 `completed` 過的文章；重讀已完成文章無迷霧 |
| 3 | 凍結範圍 | 迷霧線以下**所有**事件觸發器（echo spot／visual clue／授旗 marker／完成度）全部視為不存在 |
| 4 | 凍結的時效 | 只凍結到迷霧線推進過去為止，不是「rush 一次永久失效」——重新從迷霧線前往下讀，事件照常觸發 |
| 5 | 進度資料模型 | 捨棄 hr 分隔線／marker-index 當刻度；改用 per-pageId 的連續 ratio（0~1），跨裝置同步，可多頁並存 |
| 6 | 跳躍處理 | 往下跳才擋，往回捲永遠自由 |
| 7 | 視覺分層 | 活躍帶（靠近讀者）簡易動畫、lazy mount；遠場靜態遮罩；快速捲動不渲染動畫，停滯後才渲染附近的霧；可讀性＝「依稀看到形狀，看不出是字」 |
| 8 | reduced-motion | 暫時仍保留動畫，之後視情況再修 |
| 9 | 已排除顧慮 | 選取複製繞過（正式站 content-protection 恆開）；既有使用者資料遷移（正式 D1 零註冊使用者，無需遷移策略） |

本文件在上述邊界內新增的**架構定案**（非艾斯維爾原話，架構師依既有約束推導，見對應章節的 ADR）：

| # | 項目 | 定案 | 章節 |
|---|---|---|---|
| A | 事件凍結的樓層 | 採納諾薇亞建議：統一在 `scanline.ts` 內 gate，不讓各消費端各自查 ratio | §5 |
| B | 哨兵後門 | 完成判定改依附 `fogRatio[pageId] >= 1`，不再是「哨兵進視窗」單一條件 | §6 |
| C | 已完成頁豁免用哪個判定 | 用 `completedPageIds`（原始旗標），不用 `isEffectivelyCompleted`（依賴鏈判定） | §7 |
| D | 跳躍門檻的度量單位 | vh（相對視窗高度），非固定 px 或固定 ratio | §4 |

---

## 1. 現況接點（已查證，含本次新增查證）

### 1-1 諾薇亞已落地的地基（直接採用，不重新設計形狀）

`apps/uep/src/progress/types.ts:99-110` 新增 `ProgressState.fogRatio: Record<string, number>`；
`types.ts:222-232` 定義 `FOG_RATIO_PRECISION=3`（千分位）、`FOG_RATIO_WRITE_STEP=0.005`（0.5% 級距，避免每個 scroll tick 都整包 PUT）。

`progressStore.ts:603-617` 的 `advanceFog(pageId, ratio)` 已完整實作三道約束：
1. 單調遞增（`next <= current` 直接 no-op）
2. 量化級距（`next - current < FOG_RATIO_WRITE_STEP` 且 `next < 1` 時 no-op）
3. 推到 1.0 不受級距限制（避免最後一段因不足級距被吞掉，永遠差臨門一腳無法解除保護）

`progressStore.ts:182-191` 的 `mergeMaxByKey()` + `progressStore.ts:201` 的 `mergeHydrated()` 已把 `fogRatio` 接進 hydrate 收斂邏輯，**per-key `Math.max`**（不像 `pageMarkers` 那樣整包覆蓋）——這是刻意選擇（`progressStore.ts:177-181` 註解已寫明理由）：多裝置同時讀不同頁時，`pageMarkers` 覆蓋會讓 A 裝置的進度蓋掉 B 裝置正在進行的頁面，但迷霧的語意是「這段保護已解除」，蓋掉等於讀者路白走。

`adapters.ts:85-101` 的 `normalizeState()` 已對 `fogRatio` 做逐項防禦：非 `0~1` 之間的有限數直接剔除該 key（不是整個欄位退回空表）。

**本次要做的，是在這個地基上接消費端**：目前 `fogRatio` 完全沒有任何寫入呼叫（`advanceFog` 零呼叫端）也沒有任何讀取呼叫端——地基完整但空轉。

### 1-2 掃描線核心（`progress/scanline.ts`）

`createScanline()`（`scanline.ts:80-214`）維護兩個 `IntersectionObserver`：
- 內容標記 observer（`scanline.ts:147-188`）：`rootMargin: '0px 0px -20% 0px'` → 掃描線在視窗高度 80% 處，標記通過即 `store.grantFlags(grantsFlags)` + `onMarkerPassed` 回呼
- 哨兵 observer（`scanline.ts:191-198`）：`rootMargin: 0`，文末哨兵進視窗即觸發 `passSentinel()`

`passSentinel()`（`scanline.ts:121-144`）**無條件**執行三件事：`markPageCompleted(pageId)`、`grantFlags([completionFlag])`、以及**兜底補授「所有」內容標記的旗標**（`allFlags = markers.flatMap(m => m.grantsFlags)`）。這段兜底原意是「高速滾動時 IO 可能漏報中途標記」，但同一段邏輯也是 rush 的萬能後門——**這是本次必須堵的核心洞**（§6）。

`markerObserver` 目前對每個 entry **無任何位置判斷**，只要 IO 回報 `isIntersecting` 就立刻 `grantFlags` + `onMarkerPassed`（`scanline.ts:151-178`）——沒有任何機制檢查「這個標記是不是被跳著滾過去的」。

### 1-3 IntersectionObserver 對「跳著滾」的實際行為（本次查證，設計依據）

瀏覽器的 `IntersectionObserver` 只保證回報**取樣當下**的交叉狀態變化，不保證「元素被捲過的路徑上一定會被看見」。一次 `scrollTop` 瞬間大跳躍（拖曳捲軸滑塊、按 End 鍵、`scrollIntoView` 直接跳頁）若在單一渲染幀內完成，跳躍途中的標記可能完全不會觸發 IO callback（沒有中繼影格可供取樣），只有**最終落點附近**（在 80% 線觀察帶內的元素）才會回報。這正是 `scanline.ts:19-21` 註解裡「高速滾動時 IntersectionObserver 可能漏報中途標記，讀到文末時兜底補齊」這句話背後的真實機制。

**這件事有兩層含意**：
1. `passSentinel()` 的兜底補授正是利用「漏報」設計出來的合理性補償——但同一個機制被 speedrunner 逆用即是後門。
2. 除了哨兵後門，**若跳躍後的落點恰好讓某個 marker／echo-spot／visual-clue 落在 80% 觀察帶內，該筆標記會照常單獨觸發**——這不經過哨兵，因此哨兵層級的堵法**不足以**涵蓋這個情境，`markerObserver` 本身也必須有位置閘門（§5）。

### 1-4 消費端現況：觸發即去重，沒有「事後失效」機制

`useEchoSpots.ts:328-334`：`onMarkerPassed` 一收到 `role==='echo-spot'` 的事件，**立刻**把 `spotId` 寫進 `triggeredRef`（記憶體 Set）與 `sessionStorage.setItem(...)`，去重判定發生在這之後，且**沒有任何路徑會把這筆記錄撤銷**。若掃描線把跳躍途中恰好命中的 spot 事件放行，這個 spot 會被永久記成「本次頁面活動已觸發」，即使之後迷霧真正推進到它也不會再響——直接違反定案 §0-4。

`useVisualClues.ts:119-180` 的 `useVisualClues()` **不經過** `onMarkerPassed`：它是獨立的 `scroll` + `rAF` 節流迴圈，每次取樣直接用 `getBoundingClientRect()` 判斷「起訖區間是否跨越 80% 線」（`useVisualClues.ts:146-155`），純幾何、無記憶。只要區間跨越 80% 線它就會出現在回傳的 `active` 清單中，`HistoryReader.tsx:624-626` 再用 `dismissedClueIds` 過濾。這代表：**visual clue 書籤的「是否可見」完全不受 `onMarkerPassed` 閘門影響**——即使把 `scanline.ts` 的 `markerObserver` 閘門做好，跳躍到迷霧線以下時 `useVisualClues` 仍會照常把書籤顯示出來、可以正常點擊觸發（`HistoryReader.tsx:415-500` 的 `handleVisualClueClick`）。**這是唯一一個「gate 統一在 scanline」覆蓋不到的消費端，必須額外處理**（§8-2）。

`visual-clue-gate` / `visual-clue-end` 兩個 role**有**經過 `onMarkerPassed`（`HistoryReader.tsx:504-538` 的 `onVisualClueMarkerPassed`），會被 scanline 閘門涵蓋。

### 1-5 進度百分比的唯一生產端

全站唯一讀取 `maxMarkerIdx/totalMarkers` 算百分比的生產程式碼是 `HistoryIsland.tsx:138-145`：

```ts
const lastMarker = lastRead ? progress.pageMarkers[lastRead.id] : undefined;
const lastPct = lastMarker && lastMarker.totalMarkers > 0
  ? Math.min(100, Math.round((lastMarker.maxMarkerIdx / lastMarker.totalMarkers) * 100))
  : null;
```

已用 `grep totalMarkers|maxMarkerIdx` 掃過 `apps/uep/src` 全站，其餘命中檔案只有 `progressStore.ts`／`types.ts`（欄位定義本身）與四份測試檔（`markers.test.ts`／`scanline.test.ts`／`progressStore.test.ts`／`useEchoSpots.test.ts`／`historyIslandData.test.ts`）——沒有其他生產程式碼讀這兩個欄位算百分比。`ChapterTimeline.tsx:63` 用的是 `isEffectivelyCompleted()`（依賴鏈判定，不是百分比），不受影響。

`resolveResumeMarkerIdx()`（`markers.ts:129-140`）與呼叫端 `resolveMarkerResumeTop()`（`HistoryReader.tsx:1084-1098`）是「回到上次位置」的**唯一**定位路徑，用 `lastMarkerIdx` 換算 DOM 元素位置。

### 1-6 完成判定的兩層語意（沿用既有查證）

`completedPageIds`（`progressStore.ts:367-373` `markPageCompleted`）是「這頁曾經讀完過」的原始事實旗標，一旦寫入不會被清除。`isEffectivelyCompleted()`（`gating.ts:269-` ）是遞迴驗證依賴鏈是否仍成立的**解鎖**判定，可能因為 `sweepOrphanCompletions`（`progressStore.ts:390-`）清掉孤兒旗標而讓某頁「曾經完成」但「現在不算數」。§7 說明迷霧豁免要用前者的理由。

### 1-7 CSS／DOM 結構

`.history-content`（`HistoryReader.css:520-527`）是可捲動容器（`overflow-y:auto; position:relative`），對應 `scrollRef`；文章本體渲染在 `contentRef` 包的 div（`HistoryReader.tsx:1747-1761`，內容由 `renderInteractiveHtml` 產出 `.history-prose` 結構），`scanSentinelRef` 是緊接在文章內容後的哨兵 div（`HistoryReader.tsx:1764-1768`，對應 CSS `.history-scan-sentinel { height:1px }`，`HistoryReader.css:545-547`）。`.history-prose hr`（`HistoryReader.css:1076-1088`）目前是一條漸層分隔線的純視覺樣式，本來就不依賴 `data-role` 屬性——移除 hr 的 scanline 追蹤**不需要動這段 CSS**。

`document.body.classList.toggle(...)` 的 body-class 開關先例已存在於 `useEntityDragSource.tsx:77-80`（`setDragBodyClass`，entity 拖曳態）與 `PinnedNoteLayer.tsx:211-213`（便條島 unpin hover 態）——本次捲動降級開關直接沿用同一模式，不新發明機制。

---

## 2. 迷霧線位置的量測（ratio 公式）

### 2-1 為什麼不量測「內容高度」而是量測「捲動容器」

**決策**：ratio 的分母是 `scrollRef`（`.history-content`）的 `scrollHeight`，不是文章本體 `contentRef` 的高度。

- 奈也：讀者體感的「讀到哪裡了」就是「這個可以捲動的框框，捲了多少」——不需要額外去區分文章本文跟前後綴（header、ChapterTimeline 目錄）算不算進度，捲動條本身已經是最直覺的度量。
- 奈留：技術理由更關鍵——`scrollRef` 才是掃描線 IntersectionObserver 的 `root`（`scanline.ts` 的 `root` 參數即呼叫端傳入的 `rootRef?.current`，見 `HistoryReader.tsx:582`），用同一個容器當 ratio 分母，才能保證「迷霧線」與「掃描線 80% 位置」share 同一套座標系，不會有兩套換算各自誤差。若改用 `contentRef.scrollHeight`，還要另外處理 `contentRef` 相對 `scrollRef` 的 offset，徒增一次可能出錯的座標轉換。

**公式**：

```
currentRatio = clamp01(
  (scrollRef.scrollTop + scrollRef.clientHeight * 0.8) / scrollRef.scrollHeight
)
```

`* 0.8` 對齊掃描線既有的 80% 線語意（`rootMargin: '0px 0px -20% 0px'`）——迷霧線與掃描線**是同一條線**，不是兩條需要分別調校的參考線。這回答了「文件必須釘死的決策 §1」：迷霧線就是掃描線本身的連續量化版本，兩者永遠重合，不存在「迷霧線落後掃描線」或「迷霧線超前掃描線」的獨立漂移問題。

### 2-2 內容重排的自我修正

`scrollHeight` 每次取樣都即時讀取，不快取——文章載入後圖片非同步載入撐高版面、或未來 admin 編輯內容改變長度，都會讓同一個 `fogRatio` 值對應到不同的絕對像素位置，但這正是選擇「儲存 ratio 而非儲存 px」的設計初衷：**下次讀取時重新用當下的 `scrollHeight` 換算，永遠自我修正，不需要遷移或修補歷史資料**。這與 `pageMarkers` 用 index 定位（內容編輯後 index 位移、`resolveResumeMarkerIdx` 需要 guard「索引失效即放棄提示」）形成對比——ratio 天生沒有這個問題。

### 2-3 短文（不可捲動）的邊界

**風險（本次查證新發現）**：若文章夠短、`scrollHeight <= clientHeight`（完全不需要捲動），套公式會得到 `currentRatio ≈ 0.8`（`clientHeight*0.8 / scrollHeight ≈ 0.8`，因為兩者幾乎相等），而不是預期的「一進頁就等於讀完」。若初始 `fogRatio` 是 0，這個 0.8 的落差可能被 §4 的跳躍門檻判定為「非法跳躍」而整篇被凍結，且讀者完全沒有捲動空間可以「重新靠近」——變成無法解除的死鎖。

**決策**：`createScanline`／迷霧模組初始化時檢查 `scrollHeight <= clientHeight + 1`（1px 容忍浮點誤差），成立則**直接視為無需迷霧**（等同 `fogRatio` 立即為 1，不套用 §4 的跳躍閘門），迷霧覆蓋層也不掛載。短文本來就一眼可以看完全部內容，套用「防止 speedrun」的機制沒有意義，也不該讓讀者因為文章太短而被卡住。

---

## 3. 事件觸發器的位置換算

markerObserver 每個 entry 觸發時，若需要判斷「這個標記的位置是否在迷霧可及範圍內」，用同一套 §2-1 公式對**該標記元素**（而非目前捲動位置）換算 ratio：

```
markerRatio = clamp01(
  (markerEl.getBoundingClientRect().top - scrollRef.getBoundingClientRect().top
    + scrollRef.scrollTop) / scrollRef.scrollHeight
)
```

這個換算只在標記**真的觸發 IO callback 時**才計算一次（`getBoundingClientRect()` 呼叫成本可忽略，因為頻率等同標記通過次數，不是每幀都算），不會造成額外的效能負擔。

---

## 4. 跳躍判定（rush 偵測）

### 4-1 核心規則：跟「目前已站穩的迷霧線」比，不跟「上一次取樣位置」比

**決策**：判斷「這個 ratio 是否合法可推進」的比較基準是**目前持久化的 `fogRatio[pageId]`**（迷霧線的既有位置），不是「上一次捲動事件取樣到的位置」。

```
isWithinFogReach(candidateRatio, storedFogRatio, viewportHeightPx, scrollHeightPx):
  thresholdRatio = (FOG_JUMP_THRESHOLD_VH * viewportHeightPx) / scrollHeightPx
  return candidateRatio - storedFogRatio <= thresholdRatio
```

只要 `isWithinFogReach` 成立，就呼叫 `advanceFog(pageId, candidateRatio)`（單調遞增與量化級距已在 store 內處理，這裡不重複判斷）；不成立則整個取樣被忽略，`fogRatio` 原地不動。

- 奈也：這樣設計最省事的地方是——不用另外記一份「上次滾到哪」的暫存狀態去判斷「這一步是不是跳的」，永遠只看「跟我已經解除保護的地方比，我現在站得夠近嗎？」，邏輯讀起來就是一句話。
- 奈留：更重要的是這個比較基準**天然滿足定案 §0-4「凍結只到迷霧線推進過去為止」**——不管讀者用什麼路徑（連續捲、多次小跳、掛機不動）抵達某個位置，只要那個位置離既有迷霧線夠近就會被接受並把迷霧線推過去；不管讀者曾經跳到多遠，只要他退回迷霧線附近再重新往下讀，下一次取樣自然會再次滿足 `isWithinFogReach`，因為比較基準永遠是「迷霧線現在在哪」而不是「你上一秒在哪」。不需要另外設計「rush 後重新定位」的判準——它是同一條規則的自然推論，不是額外分支。

**替代方案（否決）**：比較「這次取樣」與「上次取樣」的差值（delta-based 跳躍偵測）。否決理由：若採此法，一旦讀者 rush 到某個新位置後，*下一次*正常小幅捲動（delta 很小）會被誤判為「合法推進」，因為它只跟「上一次取樣位置」（也就是 rush 落點）比較，而不是跟「迷霧線」比較——等於 rush 一次之後，後續只要不再做大幅度單次跳躍，迷霧線會被悄悄拖著往前追上讀者目前位置，完全違反 §0-4。這是本次設計最容易踩的陷阱，必須明確記錄避免誤植。

### 4-2 門檻的度量單位：vh，不是固定 px 或固定 ratio

**決策**：`FOG_JUMP_THRESHOLD_VH`（建議值 1.5，即 1.5 個視窗高度）是相對視窗高度的常數，每次計算 `thresholdRatio` 時用**當下文章的 `scrollHeight`** 動態換算成 ratio 空間的門檁，而不是直接寫死一個 ratio 常數（如「5%」）。

- 固定 ratio 門檻的問題：同樣 5% 的 ratio，在一篇 2,000px 的短文裡只等於 100px（不到半屏），但在一篇 50,000px 的長文裡等於 2,500px（超過一整屏）——長文會變得比短文更容易被判定為「非法跳躍」，門檻的實際嚴格度隨文章長度劇烈漂移，不合理。
- 固定 px 門檻的問題：手機與桌面的視窗高度差異巨大，同樣 800px 的門檻在手機上可能等於三屏、在桌面大螢幕上不到一屏，體感嚴格度隨裝置漂移。
- vh 相對值同時解決兩個問題：「一次連續捲動大約能推進多少個視窗高度」是跟裝置與內容長度都無關的體感常數，這才是「什麼算跳躍」的正確度量基準。

### 4-3 取樣頻率與 fling 式快速閱讀

門檻比較發生在**每次 rAF 節流後的 scroll 取樣**（沿用 `useVisualClues.ts:163-165` 的 `schedule/raf` 節流模式），不是每個原始 `scroll` 事件。快速但連續的滾輪/觸控板 fling（讀者只是讀得快，不是刻意跳過）在單一 rAF 影格（約 16ms，含節流間隔通常落在 50~100ms 量級）內移動的距離，即使很快也很少超過 1~1.5 個視窗高度——這正是 §4-2 門檻建議值取 1.5vh 的依據：夠寬容連續快速捲動，夠嚴格擋下捲軸滑塊瞬間拖曳／End 鍵／錨點跳轉這類「單一取樣間隔內位移數個螢幕」的動作。

**待拍板**：`FOG_JUMP_THRESHOLD_VH` 的精確數值建議先用 1.5 落地，正式上線前需要艾斯維爾或米勒（tester）實測不同滾動裝置（滑鼠滾輪／觸控板慣性/觸控螢幕甩動）的實際單幀位移分佈，校準到「不會誤傷正常快速閱讀，但擋得住刻意 rush」的平衡點。這是體感參數，無法純靠邏輯推導出「正確」數值。

---

## 5. 事件凍結的樓層：統一在 `scanline.ts` gate（ADR）

**背景**：echo spot（`useEchoSpots.ts`）、visual clue 的 gate/end（`onVisualClueMarkerPassed`）、授旗 FlagMarker（`grantsFlags`）三種事件消費端目前都掛在 `scanline.ts` 的 `onMarkerPassed` 回呼上，各自處理自己的業務邏輯，但都共用同一個 `markerObserver`。

**決策：閘門邏輯寫在 `scanline.ts` 的 `markerObserver` 與 `passSentinel` 內部，消費端不重複判斷。**

- 奈也：三個消費端各自加一份「這個位置合不合法」的判斷，維護起來很累人——同樣的公式要抄三次，以後改門檻常數要記得三個地方一起改，很容易漏掉一處變成不同步的破口。
- 奈留：更嚴重的是正確性風險，不只是維護成本。三個消費端各自拿到的「目前 ratio」若各自即時計算（各自呼叫 `getBoundingClientRect`／各自讀 store），中間隔著非同步的 React render 或不同的取樣時機，理論上就有極小機率算出不同的值——不會是大差距，但「同一條迷霧線」出現三種讀法本身就是架構上的異味。單一 gate 保證**同一個事件、同一次判斷**，其餘消費端拿到的永遠是「已經通過閘門」的乾淨事件流，行為上等同「凍結線以下的東西根本不存在」（定案 §0-3 的字面意思），不是「存在但被擋下」。

**落地方式**：
1. `markerObserver` 的 callback（`scanline.ts:147-188`）在 `for (const entry of entries)` 迴圈內，對每個 `isIntersecting` 的 entry，先用 §3 公式算出 `markerRatio`，呼叫 `isWithinFogReach(markerRatio, fogRatio, ...)`（§4-1）。**不通過就 `continue`**——不寫入 `lastIdx`/`maxIdx`、不呼叫 `grantFlags`、不呼叫 `onMarkerPassed`。通過則先 `advanceFog(pageId, markerRatio)` 再照常執行原有邏輯。
2. `passSentinel()`（`scanline.ts:121-144`）見 §6，用 `fogRatio` 本身（不是單次 markerRatio）判斷是否放行。
3. 迷霧完全**跳過**（§2-2 短文情境、或頁面已 `completedPageIds` 涵蓋）時，`markerObserver`／`passSentinel` 回到今天的無閘門行為——不新增分支複雜度，用同一個「是否啟用迷霧」布林值控制整段閘門邏輯是否介入。

**替代方案（否決）**：各消費端（`useEchoSpots`／`useVisualClues`／`onVisualClueMarkerPassed`）各自查 `progress.fogRatio[pageId]` 判斷是否放行。否決理由已見上（維護成本 + 正確性風險），且這個方案完全解決不了 §1-4 提到 `useEchoSpots` 的「觸發即去重」陷阱——若閘門設在消費端內部，消費端仍然會先收到 `onMarkerPassed` 事件（只是內部判斷後不出手），但 `triggeredRef.current.add(spot.spotId)` 這類副作用如果寫在判斷之前執行，一樣會造成「假觸發即去重」；若把判斷插在副作用之前，等於在每個消費端都重新設計一次「先查再動」的順序保證，比起直接不讓事件發生更容易出錯。統一在 `scanline.ts` gate 讓消費端維持「收到事件＝可以安心處理」的簡單心智模型，不需要重新稽核每個消費端的執行順序。

**唯一例外（`useVisualClues` 的獨立幾何迴圈）見 §8-2**——它不經過 `onMarkerPassed`，是本次設計中唯一需要在 `scanline.ts` 之外額外處理的消費端，且**只影響「書籤是否顯示」這一個讀取面**，不影響任何寫入或授旗邏輯。

---

## 6. 哨兵後門的堵法

### 6-1 現況问题的精確定位

`passSentinel()`（`scanline.ts:121-144`）目前的觸發條件**只有一個**：哨兵 DOM 元素進入 `sentinelObserver` 觀察到的視窗範圍（`rootMargin: 0`）。這個條件與「讀者是否真的讀過中間內容」完全無關——哨兵是文章結尾一個 1px 高的空 div，任何方式（連續讀完、拖曳捲軸到底、按 End 鍵、`scrollIntoView`）只要讓它進入可視範圍，都會觸發完全相同的 `passSentinel()` 邏輯，包含**兜底補授所有標記旗標**這一步（`scanline.ts:126-129`）。

### 6-2 決策：完成判定改為「哨兵進視窗」**且**「迷霧已推進到底」的合取

**決策**：`passSentinel()` 觸發時，先重新讀一次目前的 `fogRatio[pageId]`（在 §5 的閘門邏輯已於同一輪事件處理過的前提下，這個值是最新的），只有 `fogRatio[pageId] >= 1` 才執行完成三件套（`markPageCompleted` + `completionFlag` + 兜底補授）；否則**整個 `passSentinel()` 提前 return，什麼都不做**——不完成、不補授、`onMarkerPassed` 也不對外發送 `isSentinel: true` 事件。

- 奈也：讀者體感上不會覺得奇怪——他捲到底了，畫面看起來是文章結尾，但如果他知道自己是用捲軸滑塊直接拖到底、根本沒細看內容，「還沒完成」其實是合理的結果，不算突兀的卡關。
- 奈留：這個合取條件精準對應 §1-3 分析出的兩種洩漏路徑——單靠「哨兵進視窗」擋不住任何形式的跳躍完成，因為哨兵事件本身就是跳躍後最終落點最容易命中的目標（它在文章最後面，任何「跳到底」的動作幾乎必然命中它）；而 `fogRatio >= 1` 這個條件**只可能經由 §4 的連續推進規則自然達成**——不管讀者用什麼手法讓哨兵進視窗，只要他沒有真的連續讀過中間內容，`fogRatio` 就不可能推到 1，完成判定就不會通過。這是唯一同時堵住「哨兵單獨後門」與「§1-3 提到的中途 marker 巧合命中」兩種洩漏面的作法，因為兩者都收斂到同一個 `fogRatio` 數值上。

### 6-3 「卡在哨兵但迷霧沒追上」時，讀者要怎麼真正讀完

不需要額外設計——這是 §4-1「凍結只到迷霧線推進過去為止」規則的自然推論：讀者只要**捲回迷霧線附近，往下正常讀**，`fogRatio` 就會逐步推進；當它推到 1 的那一刻，**下一次**哨兵的 `isIntersecting` 事件（不論是使用者當下仍停在底部、還是重新捲回底部觸發）會通過 §6-2 的合取條件，正常完成。若讀者在 rush 到底之後完全不再滾動、停留在原地不動，`passSentinel` 也不會被重複呼叫（IO 只在狀態變化時觸發 callback），系統不會主動幫他把迷霧追上——這正是防刷的核心，讀者必須做出「回頭正常讀」的動作。

### 6-4 對既有「防刷／最短停留時間未做」已知限制的影響

Epic 2 S2 完成記錄（`note:x06embsi92tof9zr1wou`）曾記錄「防刷（最短停留時間）未做——目前跳到文末即完成，計劃註明可後補」——**本次 S10-2 正是那個「後補」**，用迷霧線的連續推進取代單純的時間停留門檻，且比「最短停留時間」更精準（時間門檻擋不住開兩倍速捲動器材，ratio 推進門檻天生跟裝置無關）。

---

## 7. 已完成頁面的迷霧豁免：用 `completedPageIds`，不用 `isEffectivelyCompleted`

**決策**：迷霧是否啟用的判斷式是 `!progress.completedPageIds.includes(pageId)`，**不是** `!isEffectivelyCompleted(pageId, progress, tree)`。

- 奈也：讀者曾經老老實實把一篇讀完，這件事本身不會因為別的頁面發生什麼事而變成「沒讀過」——迷霧是給「還沒讀過的內容」用的保護，不是給「權限判定」用的。
- 奈留：技術理由是兩者的職責完全不同。`isEffectivelyCompleted()`（`gating.ts:269-`）是**遞迴驗證依賴鏈是否仍成立**的解鎖判定，會因為 `sweepOrphanCompletions()` 清除孤兒旗標、或上游依賴頁面被靜態鎖定等原因，讓一篇「曾經合法完成」的文章事後被判定為「不算完成」。若迷霧豁免綁在這個判定上，會出現「讀者讀完一篇文章後，因為完全無關的另一個進度變化（例如管理員改了某個上游頁面的鎖定狀態），這篇文章重新被迷霧罩住」——這對讀者來說是無法理解、也無法自行修復的體驗（他該怎麼「重新解迷霧」？迷霧的推進機制要求連續閱讀，但内容他已經讀過，逼他重讀一遍不合理，讓迷霧永久消失又違背了迷霧「只保護未讀內容」的初衷，兩難無解）。`completedPageIds`（`progressStore.ts:367-373`）是不可逆的原始事實旗標，一旦寫入永遠成立，用它當豁免判準完全避開這個死結。

**與 S10-1 一次性視窗提醒的差異**：S10-1 文件（`docs/agent/S10_INTERLINK_DESIGN.md` §2-3-a）的「一次性視窗」警語是指「正式環境零使用者，這次可以直接改名不用雙寫，但以後有使用者了就不能再這樣做」——那是**遷移策略**的時效性提醒。本項決策不屬於同一類別：`completedPageIds` vs `isEffectivelyCompleted` 的選擇是**架構不變量**，不因使用者數量增減而改變正確性，未來任何時間點都應該維持這個選擇，不需要「視窗關閉後改用別的方法」。

---

## 8. 消費端影響分析

### 8-1 `useEchoSpots.ts`：零修改，被動受益

§5 的統一閘門落地後，`useEchoSpots.ts:322-427` 回傳的 handler **只有在事件真的通過迷霧閘門時才會被 `onMarkerPassed` 呼叫**——`triggeredRef.current.add(spot.spotId)`（`useEchoSpots.ts:328-329`）與 `sessionStorage.setItem`（`useEchoSpots.ts:331`）這兩行去重副作用，天然只會在合法觸發時執行。§1-4 描述的陷阱（「rush 經過時 spot 被記成已觸發，迷霧推進後不再觸發」）在事件源頭就被消除，**這個檔案不需要任何修改**。這是選擇「統一 gate」而非「消費端各自判斷」的直接紅利——如果閘門寫在消費端內部，這裡就必須額外調整去重寫入的時機。

### 8-2 `useVisualClues.ts`：需要新增 `fogRatio` 讀取（唯一需要主動修改的消費端）

§1-4 已指出：`useVisualClues()` 的區間偵測（`useVisualClues.ts:128-177`）是獨立於 `onMarkerPassed` 之外的幾何迴圈，§5 的閘門完全覆蓋不到它。書籤的「是否可見」若不處理，會讓迷霧線以下的 Visual Clue 起訖區間照常被判定為「進入區間」、書籤照常顯示、使用者照常可以點擊觸發 `handleVisualClueClick`（`HistoryReader.tsx:415-500`，會進一步授旗、推送 gallery 展示）——完整繞過迷霧保護。

**決策**：`useVisualClues()` 新增一個唯讀輸入 `fogRatioRef: MutableRefObject<number>`（呼叫端 `HistoryReader.tsx` 用 `useEffect` 同步 `progress.fogRatio[currentId]` 進這個 ref，沿用 `useEchoSpots.ts:223-224` 的 `progressRef.current = progress` 同款寫法，避免把易變的 ratio 值放進 `useEffect` 的 deps 陣列造成整個 scroll listener 重掛）。`evaluate()`（`useVisualClues.ts:146-162`）內對每個候選 `entry`，額外用 §3 公式算出 `entry.startEl` 的 ratio，過濾條件從單純的「區間跨越 80% 線」（`useVisualClues.ts:154`）改為**額外要求** `startRatio <= fogRatioRef.current`——書籤的起點如果還在迷霧線以下，這個 clue 整個不進入 `active` 清單，等同「當作不存在」。

這是**唯讀**過濾，不涉及任何 `advanceFog` 呼叫（寫入只發生在 `scanline.ts` 一處，維持單一寫入者），且只影響「哪些書籤可見」，不需要動 `handleVisualClueClick`／授旗邏輯本身——書籤不出現，使用者自然點不到，觸發鏈路從源頭被掐斷。

### 8-3 `visual-clue-gate` / `visual-clue-end`：被 §5 涵蓋

這兩個 role 走 `onMarkerPassed`（`HistoryReader.tsx:504-538`），會被 §5 的統一閘門攔住，不需要額外處理。但要注意一個時序細節：一個 Visual Clue 若**起點**（`visual-clue-start`）被 §8-2 擋下不顯示書籤，使用者根本點不到它，`clickedCluesRef`（`HistoryReader.tsx:367`）就不會記錄這個 `clueId`，`onVisualClueMarkerPassed` 內對 `visual-clue-gate`/`visual-clue-end` 的處理本來就有 `!clickedCluesRef.current.has(clueId)` 的前置判斷（`HistoryReader.tsx:513-517`、`535`）會自然短路——**兩層防護天然一致，不需要額外同步**。

### 8-4 授旗 FlagMarker（`progress-marker` role）

被 §5 涵蓋，`grantsFlags`（`scanline.ts:165-168`）在閘門內執行，`continue` 掉的 entry 不會授旗。

---

## 9. 進度 UI 的改讀路徑

### 9-1 呼叫端清單（已全站掃過，見 §1-5）

| 檔案:行號 | 現況讀法 | 改為 |
|---|---|---|
| `HistoryIsland.tsx:138-145` | `lastMarker.maxMarkerIdx / lastMarker.totalMarkers` | `progress.fogRatio[lastRead.id] ?? 0`（已是 0~1，`Math.round(ratio * 100)` 即可，不需要除法） |

**只有這一處生產程式碼需要改**。`ChapterTimeline.tsx` 用 `isEffectivelyCompleted` 不受影響；其餘命中檔案皆為測試 fixture，隨對應模組的測試改版一併更新（§10）。

### 9-2 續讀定位：依完成狀態分流（艾斯維爾 2026-07-27 拍板）

**技術落地**：新增 `resolveFogResumeTop(pageId, scrollEl)`，取代 `resolveMarkerResumeTop()`（`HistoryReader.tsx:1084-1098`）。用 §2-1 公式的反函式：

```
targetScrollTop = fogRatio[pageId] * scrollHeight - clientHeight * 0.8
```

「不該提示」的排除規則沿用 `resolveResumeMarkerIdx()`（`markers.ts:129-140`）現有邏輯的精神：`completedPageIds` 已包含（§7 同一個判準，兩處天然一致）或 `fogRatio` 不存在／過小（等同「上次位置在開頭」）時回傳 `null`。

**⚠️ 本節的原始草案（單一語意二選一）已被推翻。** 拍板結果是**兩套語意依完成狀態分流**，而不是統一成其中一套：

| 頁面狀態 | 有無迷霧 | 續讀定位 | 資料來源 |
|---|---|---|---|
| **未完成** | 有 | 跳到**迷霧線**（最遠合法進度） | `fogRatio[pageId]` |
| **已完成**（重讀） | 無 | 跳到**上次停在哪**（最後瀏覽位置） | `pageMarkers[pageId].lastMarkerIdx` |

理由：兩者對應到互斥的狀態，不會互相干擾，而且各自都是該狀態下唯一合理的答案——沒讀完的頁面「上次停在哪」沒有意義（讀者要的是繼續往下推進迷霧），讀完的頁面「最遠進度」永遠等於文末（沒有資訊量）。

**⚠️ 現有判斷式是反的，實作時要翻面**：`resolveResumeMarkerIdx()`（`markers.ts:135`）目前寫的是 `if (state.completedPageIds.includes(pageId)) return null`——也就是**已完成的頁面不提示續讀**，正好與拍板相反。`markers.test.ts:188` 有一個 Codex 審核留下的回歸測試在守這個行為（「已完成頁面即使讀完後回捲也不提示」），實作時必須連同該測試一起翻面，並在測試裡註明語意變更的來源，避免下一個人以為是退化。

**技術落地**：未完成走新增的 `resolveFogResumeTop(pageId, scrollEl)`（§2-1 公式的反函式），已完成沿用既有的 `resolveMarkerResumeTop()`（`HistoryReader.tsx:1084-1098`）不動。`lastMarkerIdx` 因此**不退場**，只是服務對象從「未完成」換成「已完成」。

**入口範圍**：「跳到最新進度」先只做 History 浮島的書籤（既有機制改讀 `fogRatio` 即可，§9-1）。頁面內是否另外加一個按鈕，等實際手感驗收後再決定——不預先開一個可能不需要的 UI。

### 9-3 `pageMarkers` 系統的存續範圍

`pageMarkers`（`maxMarkerIdx`／`lastMarkerIdx`／`totalMarkers`）**不刪除**，繼續作為 FlagMarker／echo-spot／visual-clue 的 IO 索引記錄機制（`scanline.ts:96` 的 `maxIdx` 續讀基準線、`indexOf` 映射）——這是掃描線判斷「這個 entry 對應哪個標記」的內部簿記，跟「進度百分比」／「回到上次位置」是兩件事，只是歷史上共用了同一組欄位。§9-1／§9-2 只是把「對外呈現進度」與「續讀定位」這兩個**讀取端**改指到 `fogRatio`，不動 `pageMarkers` 的寫入或內部用途。

---

## 10. hr 退場的影響面

### 10-1 決策：從 `PROGRESS_MARKER_SELECTOR` 移除 `hr`

`markers.ts:31` 目前的選擇器：

```ts
export const PROGRESS_MARKER_SELECTOR = `hr, [data-role="${PROGRESS_MARKER_ROLE}"], [data-role="${ECHO_SPOT_ROLE}"], [data-role="${VISUAL_CLUE_START_ROLE}"], [data-role="${VISUAL_CLUE_GATE_ROLE}"], [data-role="${VISUAL_CLUE_END_ROLE}"]`;
```

改為移除開頭的 `hr, `。`collectMarkers()`（`markers.ts:73-100`）內對應的 `role === 'hr'` 分支（`markers.ts:88`）與型別定義中的 `'hr'`（`markers.ts:61`／`ScanMarker.role`／`MarkerPassedInfo.role`）一併移除。

### 10-2 具體影響

| 影響面 | 說明 |
|---|---|
| `totalMarkers` 分母 | 移除 hr 後，既有文章的 `totalMarkers` 會變小（denominator 只剩功能性標記），但 §9-1 已把百分比顯示改讀 `fogRatio`，**這個分母本來就不再對外呈現**，只影響 §9-3 提到的內部簿記，屬於良性縮減 |
| marker index 重新編號 | 同一篇文章裡 echo-spot／visual-clue／progress-marker 的 DOM 順序 index 會因為 hr 不再佔位而整體位移。對照 §9-3，`pageMarkers` 是每次 `contentKey` 變更就整組重建 observer（`scanline.ts:80` 註解「內容重渲染後必須 destroy 舊實例並重建」），**不存在跨版本的 index 相容性問題**——這本來就是設計上允許重排的資料，不需要遷移 |
| `.history-prose hr` CSS | 不受影響（§1-7 已查證，hr 的視覺樣式本來就不依賴 `data-role` 屬性），hr 繼續是純視覺分隔線，TipTap 編輯器插入 hr 的操作也完全不變 |
| `collectMarkers()` 回傳結果 | 呼叫端（`resolveMarkerResumeTop`／`resolveFogResumeTop`／§3 的 markerRatio 換算）不受影響，因為都是對回傳陣列做遍歷，不依賴特定 index 數值的絕對意義 |

### 10-3 測試面影響（本次已查證，供實作排程參考）

`markers.test.ts` 有 **9 處**使用 `<hr />` 作為測試 fixture（`markers.test.ts:57,61,72,89,105` 等），`scanline.test.ts` 有 **12 處**（`scanline.test.ts:100,116,130,146,159,173,218,236,283,298,315,345`）——絕大多數是拿 `<hr />` 當「隨便一個標記點」的萬用佔位符，不是在測試 hr 特有行為。移除 hr 選擇器後，這些 fixture 用的 `<hr />` 不會再被 `collectMarkers()` 收集到，對應的斷言（例如「插入兩個 hr 應該收集到 2 個標記」）會全部失敗，**需要逐一改用 `[data-role="progress-marker"]` 的 div fixture 替換**。這不是邏輯 bug，是測試資料需要跟著選擇器改版同步更新——列入 §11 實作順序的第一步（在動任何消費端邏輯前，先把 fixture 換好，用綠燈基線隔離「hr 退場」與「迷霧邏輯」兩件事的驗證範圍）。

---

## 11. 迷霧渲染的 DOM 結構與 CSS 策略

### 11-1 掛載時機：lazy，且只在需要時掛

**決策**：迷霧覆蓋層是獨立元件（建議 `apps/uep/src/components/history/HistoryFogOverlay.tsx`），只在下列條件**全部成立**時掛載：

```
!progress.completedPageIds.includes(currentId)
&& !isShortArticle（§2-3 的短文豁免）
&& fogRatio[currentId] < 1
```

三個條件任一不成立就完全不渲染這個元件（不是渲染後隱藏）——呼應決策 §0-7「lazy load」與「效能」的字面要求：已完成、短文、或迷霧已經散盡的文章，連 DOM 節點都不應該存在。

### 11-2 定位策略：內容座標系，不是視窗座標系

**決策**：迷霧覆蓋層用 `position: absolute`，掛在 `scrollRef`（`.history-content`）內、與 `contentRef` 同層的 sibling，`top` 用 §2-1 公式反推的像素值定位（`top: fogRatio * scrollHeight`），**隨內容一起捲動**。

這與既有的 `.history-scroll-marker`（`HistoryReader.css:627-634`，旅程之書續讀標記）以及 Visual Clue 書籤（S8 下半場 V-D 用「viewport 釘位」策略，掛在 `.history-main` 不隨內容捲動）刻意**不同**——那兩者的語意是「捲動軸上的固定參考點」，迷霧的語意是「內容本身從某個位置開始被遮住」，遮罩必須跟著內容捲動，否則讀者往下捲時遮罩會不對齊實際被保護的文字段落。**不要參照 Visual Clue 書籤的定位模式**，兩者解決的是不同問題。

### 11-3 分層：活躍帶 + 遠場靜態遮罩

```
<div class="history-fog-layer" style="top: {fogRatio * scrollHeight}px">
  <div class="history-fog-active">   <!-- 迷霧線起算，約 1~1.5 個視窗高度 -->
  <div class="history-fog-far">      <!-- 活躍帶以下，到內容結尾 -->
</div>
```

- `.history-fog-active`：高度用 vh 相對值（呼應 §4-2 的度量哲學，同一套 vh 常數可以共用或另訂一個獨立的視覺常數），套 `backdrop-filter: blur(...)` 或等效的紋理位移動畫，目標可讀性是「依稀看到形狀但看不出是字」（決策 §0-7 原話）——具體濾鏡參數（模糊半徑、動畫節奏）是視覺設計取捨，本文件不代為決定數值，留給實作時肉眼調校。
- `.history-fog-far`：`.history-fog-active` 以下到內容結尾的所有剩餘高度，**不套用任何動畫或 `backdrop-filter`**，純粹一塊漸層或半透明色塊——這是效能考量的直接落地（§0-7「不要整頁都上動畫」），這一層無論文章多長都只是一個色塊渲染成本，不隨長度增加而變重。

### 11-4 捲動中降級：沿用既有 body-class 開關先例

**決策**：捲動進行中，`.history-fog-active` 的動畫暫停（降級為純靜態遮罩，等同 `.history-fog-far` 的觀感）；捲動停滯（沿用 `HistoryReader.tsx:340-363` 既有的 180ms settle timer 概念，或給迷霧模組自己一個獨立但同構的 debounce）後才恢復動畫渲染。

落地沿用 `useEntityDragSource.tsx:77-80` 的 `setDragBodyClass` 先例：

```ts
document.body.classList.toggle('uep-fog-scrolling', isScrolling);
```

CSS：

```css
body.uep-fog-scrolling .history-fog-active {
  animation-play-state: paused;
  backdrop-filter: none; /* 或降級為固定強度、不隨時間變化的靜態模糊 */
}
```

這個 body class 的開關時機可以直接共用 `HistoryReader.tsx` 現有的滾動速度追蹤 effect（`HistoryReader.tsx:340-363`，`scrollVelocityRef` 與 180ms settle timer 已經在追蹤「是否還在捲動」），不需要迷霧模組自己重新掛一個 scroll listener——在同一個既有 effect 裡多做一步 `classList.toggle` 即可，避免同一個容器上疊加兩個獨立但語意重疊的 scroll listener。

### 11-5 reduced-motion：暫不特殊處理

決策 §0-8 明確要求「先保留動畫，之後看情況修正」——本次**不**加 `@media (prefers-reduced-motion: reduce)` 覆寫規則停用迷霧動畫，這是刻意的暫時決策，實作時應在對應 CSS 區塊留一句註解標明「reduced-motion 待後續評估，非遺漏」，避免之後的程式碼審查誤以為是漏做的無障礙需求。

---

## 12. 介面定義（新增/擴充）

```typescript
// apps/uep/src/progress/fogGate.ts（新檔案，框架無關純函式）

/** 迷霧跳躍門檻——相對視窗高度的倍數，非固定 px／ratio（見 §4-2） */
export const FOG_JUMP_THRESHOLD_VH = 1.5; // 待實測校準，見 §4-3 待拍板

/** 短文（不可捲動）容忍誤差，見 §2-3 */
const SCROLL_EPSILON_PX = 1;

/** §2-1 公式：捲動位置 → 內容 ratio（0~1，掃描線 80% 線語意） */
export function computeContentRatio(
  scrollTop: number,
  viewportHeight: number,
  scrollHeight: number
): number;

/** 是否不需要迷霧（§2-3 短文豁免） */
export function isNonScrollable(
  scrollHeight: number,
  clientHeight: number
): boolean;

/** §4-1 核心跳躍判定：candidateRatio 是否在既有迷霧線的可及範圍內 */
export function isWithinFogReach(
  candidateRatio: number,
  storedFogRatio: number,
  viewportHeight: number,
  scrollHeight: number
): boolean;

/** §9-2 反函式：fogRatio → 續讀目標捲動位置（px） */
export function ratioToScrollTop(
  fogRatio: number,
  viewportHeight: number,
  scrollHeight: number
): number;
```

```typescript
// apps/uep/src/components/history/useVisualClues.ts（擴充，§8-2）

interface UseVisualCluesOptions {
  // ...既有欄位不變
  /** 唯讀迷霧線 ref（0~1）；未提供或 1 時不過濾（沿舊行為，供其他 zone 未來復用時預設不受影響） */
  fogRatioRef?: MutableRefObject<number>;
}
```

```typescript
// apps/uep/src/components/history/HistoryReader.tsx（新增）

/** 取代 resolveMarkerResumeTop，見 §9-2 */
function resolveFogResumeTop(
  pageId: string,
  scrollEl: HTMLElement
): number | null;
```

---

## 13. 風險與技術債

| # | 風險 | 影響 | 緩解 |
|---|---|---|---|
| R1 | `FOG_JUMP_THRESHOLD_VH` 是體感參數，無法靠邏輯推導出精確數值 | 上線初期可能偏嚴（誤傷快速閱讀）或偏鬆（rush 仍可鑽空） | 列入 §4-3 待拍板，需要實機測試不同輸入裝置的單幀位移分佈後校準；先用 1.5 落地，非最終值 |
| R2 | `passSentinel()` 的合取條件（§6-2）讓「完成」不再與「捲到底」同步，讀者可能困惑「怎麼捲到底了還沒完成」 | UX 認知落差 | 建議在迷霧視覺（§11）本身就是足夠的線索——遮罩尚未散去，讀者應能理解「還沒讀完」；若驗收後發現困惑明顯，可考慮在迷霧遠場疊加一行提示文字，但本文件不預先設計這個 UI，留待實測後決定是否需要 |
| R3 | §9-2 的「回到上次位置」語意變更（最遠進度 vs 最後瀏覽位置）未經艾斯維爾明確拍板 | 可能與既有使用習慣產生落差 | 已列入 §14 待拍板，需要明確回覆才能實作 |
| R4 | `useVisualClues` 新增 `fogRatioRef` 讀取（§8-2）是本次唯一偏離「統一 gate」原則的例外 | 未來若有第三個「不經過 `onMarkerPassed`」的獨立幾何消費端出現，容易忘記也要接 `fogRatioRef`，形成第二個例外而非收斂回統一模式 | 本文件 §5／§8-2 已明確記錄「唯一例外」與原因，未來新增消費端時應優先設計成走 `onMarkerPassed`（如 echo-spot／visual-clue-gate／visual-clue-end 現有模式），只有像 `useVisualClues` 這種**需要雙向持續狀態**（進入/離開區間，非單向事件流）的情境才考慮獨立迴圈 |
| R5 | 迷霧視覺參數（模糊強度、活躍帶高度、動畫節奏）本文件未給出具體數值，留待實作時肉眼調校 | 可能需要多輪視覺打磨才能達到「依稀看到形狀但看不出是字」的目標可讀性 | 屬正常的視覺實作反覆過程，不阻塞架構落地；建議先用保守的模糊強度上線，再依實際畫面調整 |
| R6 | `scanline.ts` 新增的 §3／§4 位置換算邏輯（`getBoundingClientRect` 呼叫）與既有的 `markerObserver`／`sentinelObserver` 共用同一輪事件處理，若未來標記數量大幅增加（理論上限不明，同 S10-1 R2 的既有風險類別） | 單次 IO callback 的計算量隨當輪觸發的標記數量增加 | 現行 History 頁標記數量是個位數到十幾個量級（同 S10-1 §9 R2 的既有結論），`getBoundingClientRect` 呼叫成本可忽略；若未來出現異常量級需重新評估 |

---

## 14. 待拍板

| # | 問題 | 選項 | 本文件的建議傾向 |
|---|---|---|---|
| 1 | `FOG_JUMP_THRESHOLD_VH` 精確數值 | 需要實機測試不同輸入裝置後校準（§4-3） | 先用 1.5 落地作為起點，非最終值 |
| 2 | ~~「回到上次位置」的語意~~ | **已拍板（2026-07-27）**：兩套並存、依完成狀態分流，非二選一。未完成跳迷霧線、已完成跳最後瀏覽位置，且現有判斷式要翻面 —— 詳見 §9-2 改寫後的內容 | — |
| 3 | `passSentinel()` 卡在「捲到底但迷霧未追上」時，是否需要額外的視覺提示告知讀者「還沒完成」（§13 R2） | (a) 目前不做，迷霧視覺本身已是線索 (b) 額外加一行提示文字 | 傾向 (a)，先上線觀察，需要才加 |

---

## 15. 實作交接

### 15-1 建議實作順序

1. **hr 退場的測試地基**（§10）：先把 `markers.test.ts`／`scanline.test.ts` 裡拿 `<hr />` 當萬用佔位符的 fixture 換成 `[data-role="progress-marker"]`，確認綠燈，再動 `PROGRESS_MARKER_SELECTOR` 本身。這一步刻意跟迷霧邏輯分開提交，方便日後 `git bisect` 隔離問題來源。
2. **`fogGate.ts` 純函式模組**（§2／§4／§12）：`computeContentRatio`／`isNonScrollable`／`isWithinFogReach`／`ratioToScrollTop` 四個函式，無副作用、無 DOM 依賴以外的耦合，最適合先寫、先單元測試，作為後續所有接線的共同地基。
3. **`scanline.ts` 接上迷霧閘門**（§5／§6）：`markerObserver` 的位置閘門 + `passSentinel` 的合取條件，這一步不動任何消費端（`useEchoSpots`／`onVisualClueMarkerPassed`），因為 §8-1／§8-3 已論證它們是被動受益、零修改。用既有的 `scanline.test.ts` 補新案例覆蓋「迷霧線以下的標記不觸發」與「哨兵進視窗但迷霧未到不完成」兩條主線。
4. **`useVisualClues.ts` 加 `fogRatioRef` 過濾**（§8-2）：本次唯一需要主動修改的消費端，獨立提交方便單獨驗收。
5. **`HistoryReader.tsx` 接線**：`advanceFog` 的實際呼叫點（掛在 §5 完成後 `scanline.ts` 內部即可，不需要 `HistoryReader.tsx` 額外呼叫）、`fogRatioRef` 同步 effect（§8-2）、`resolveFogResumeTop` 取代 `resolveMarkerResumeTop`（§9-2，**需先等 §14-2 拍板**）。
6. **`HistoryIsland.tsx` 改讀 `fogRatio`**（§9-1）：單一呼叫點，獨立小提交。
7. **迷霧覆蓋層 DOM/CSS**（§11）：`HistoryFogOverlay.tsx` 新元件 + CSS 分層 + body-class 捲動降級開關。建議放最後——前六步完成後，`fogRatio` 已經是正確推進、正確凍結事件的可信資料源，視覺層只是把這個資料呈現出來，不影響任何邏輯正確性，可以獨立反覆打磨而不阻塞其他步驟的驗收。

### 15-2 開工前必查

- 開工前跑一次 `pnpm check` 確認 0.9.15.26 基線本身是綠的，避免把既有問題誤算進本次改動的驗收範圍（沿專案既有慣例）。
- 動 `scanline.ts` 前，先讀一遍 `scanline.test.ts` 現有全部案例（尤其是哨兵兜底補授的既有測試），確認哪些斷言預期會因 §6-2 的合取條件而改變（例如「哨兵進視窗即完成」的既有測試會需要改成「哨兵進視窗且迷霧到位才完成」的兩步驟版本）。
- `useVisualClues.test.ts` 同理，§8-2 的 `fogRatioRef` 新參數若不提供時的行為（§12 已定義「未提供或 1 時不過濾」）需要有對應測試覆蓋，確保未來 Concepts／Echoes／Visuals 若要複用 `useVisualClues` 的模式（目前沒有，但架構上不排除）不會被強制要求接迷霧邏輯。
- §14 三項待拍板中，**#2（回到上次位置語意變更）會直接決定 §9-2／步驟 5 的實作方式**，建議在動 `HistoryReader.tsx` 續讀邏輯之前先取得回覆，避免做兩次。

*文件結束。*
