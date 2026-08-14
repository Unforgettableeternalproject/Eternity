# S9-A Storage 便條島設計（2026-07-21）

> 範疇：S9 第一階段「Storage 便條島」。解鎖儀式（S9 第二階段，全 zone 專屬儀式）待本階段完成後由艾斯維爾詳述，本文件不含。

## 0. 定案彙整（艾斯維爾 2026-07-21）

| 項目 | 定案 |
|---|---|
| 便條本體儲存 | **ProgressState 跨裝置同步**（走 progressStore + serverAdapter write-through） |
| 便條 cap | **30 條 / 每條 200 字**，超限擋新增並提示 |
| 便條操作 | 建立後可**編輯 + 刪除**；刪除確認 dialog **只在浮島層**（不做全螢幕 overlay，故**不可**用 `window.__uepDialogManager`） |
| 排序 | `updatedAt` desc，**最近編輯排最上、視覺稍微放大** |
| 島 header | 左上顯示**使用者當前所在 zone + 頁面位置**（不是單張便條上標） |
| 釘選（拖出到頁面） | 釘選態存 **localStorage 本地單裝置**；即使浮島收合仍在，可隨時拆除；釘選便條可**直接編輯**（寫回 ProgressState 本體） |
| 釘選唯一性 | 一張便條**全站最多一個釘選實例**；釘出後浮島內該便條**暗掉、不可再拉**，點暗掉便條 → **導向釘選頁 + 捲到位置** |
| 釘選座標 | **錨定內容元素 + 偏移**（RWD 最穩） |
| 釘選範圍 | **文字頁精準 + 互動頁降級**：History / Echoes-content / Storage-content 錨定內容元素；Visuals / Concepts 降級為**頁面級**（可釘、導向到頁、不定位到元素） |
| 登出/清快取 | 場上釘選（localStorage）清除；便條本體**跟 ProgressState 走**（登出回訪客空狀態、同帳號重登 server 同步回來） |
| 跨區作用 | **預留事件合約不實作**（沿 S6 慣例） |
| 實作節奏 | **一次做滿選定範圍**（非只 History） |

## 1. 現況接點（已查證）

- **島定義已就位**：`ISLAND_DEFINITIONS.storage`（title「便條紙」、icon ✎、`center-left`、width 320）、`ISLAND_IDS` 含 storage、`UNLOCK_HINTS.storage`（一疊泛黃的便條）。
- **解鎖入口已支援**：`IslandUnlockObject` 已含 storage 分支；`ZoneEntryPage` / StorageReader landing 需確認掛載點（見 §7）。本階段**沿用現成 IslandUnlockObject**，專屬儀式屬 S9 第二階段。
- **島註冊**：`IslandHost.ISLAND_COMPONENTS` 加 `storage: React.lazy(() => import('./storage/StorageIsland'))` 即可（註解已預留 S9 位）。
- **設計稿原型**：`Eternity-Design/components/storage-base.jsx:244 Scratchpad`（便條紙語彙：膠帶條、傾斜、`#FCF5DE`/`#FFF1BA`/`#FBEFCB`）。
- **錨點範本**：History 續讀 `resolveResumeMarkerIdx` + `resolveMarkerResumeTop`（progress/markers.ts、HistoryReader.tsx L1034-1048）＝「錨定內容元素 + 索引 → 重算 scrollTop」，釘選定位直接沿用此思路。
- **既有段落 id 先例**：HistoryReader L872-880 對 `h2,h3` slugify 補 id 的 `useEffect`——擴大成通用 `ensureContentAnchors`。
- **dialog**：`window.__uepDialogManager`（UepDialog.tsx）是**全螢幕**，刪除確認**不可用**，改島內局部確認 UI。

## 2. 資料模型（雙層儲存）

### 2-1 便條本體 — ProgressState（跨裝置）

```ts
// progress/types.ts，平鋪進 ProgressState
export interface StorageNote {
  id: string;         // 建立時生成（時間戳 + 序號，避免 Math.random 於 SSR）
  text: string;       // cap 200 字（trim 後）
  tilt: number;       // 建立時算一次存下（不每次 render 亂數，SSR/測試穩定）
  createdAt: string;  // ISO 8601
  updatedAt: string;  // ISO 8601，排序鍵
}
// ProgressState 新增：
storageNotes: StorageNote[];  // cap 30 條
```

- `normalizeState` 容舊：無欄位 → `[]`；逐筆補缺欄位。
- `STORAGE_NOTE_MAX = 30`、`STORAGE_NOTE_TEXT_MAX = 200` 常數。

progressStore 新 actions（source `'storage-note'`，走 mutate→persist→server write-through）：
- `addStorageNote(text): boolean` — cap 檢查，滿了回 false（呼叫端提示）
- `updateStorageNote(id, text)` — 更新 text + `updatedAt`（觸發重排 + 同步釘選便條顯示）
- `removeStorageNote(id)` — 刪除；**若該便條已釘選，一併 unpin**（避免孤兒釘選）

### 2-2 釘選態 — localStorage（本地單裝置）

```ts
// islands/storage/pinnedNotes.ts
export interface PinnedNote {
  noteId: string;            // 對應 ProgressState.storageNotes 的 id
  pagePath: string;          // location.pathname（釘在哪頁）
  zone: string;              // 導向 + 島 header 顯示用
  pageLabel: string;         // 頁面標題（暗掉便條顯示「釘在 XXX」）
  anchorKind: 'element' | 'page';
  anchorId: string | null;   // element：內容元素 data-uep-anchor-id；page：null
  offsetX: number;           // 相對錨點（element）/ 相對容器（page）偏移
  offsetY: number;
}
// localStorage key: uep.storage.pinned.v1 → PinnedNote[]
```

`pinnedStore` singleton（沿 audioStore/islandRuntime 慣例 + `window.__uepStoragePins` bridge）：
- `pin(pinned: PinnedNote)` / `unpin(noteId)` / `isPinned(noteId)` / `getPinnedMeta(noteId)`
- `getForPage(pagePath): PinnedNote[]`
- `clearAll()` — 登出/reset 呼叫（**只清釘選，不動便條本體**）
- `subscribe(cb)` — 島 pool 與釘選層兩邊即時同步
- 登出接線：訂閱 `PROGRESS_CHANGE_EVENT` source `'reset'`（CustomEvent 解耦，禁 import islandRuntime，同 audioStore 慣例）→ `clearAll()`

> 設計理由：釘選 = 「這台瀏覽器把便利貼貼在這頁這個位置」的物理概念，本就不跨裝置。裝置 A 釘的便條，裝置 B 上不釘（但便條內容兩邊同步）。「暗掉」判定也是本地的——裝置 A 上暗、裝置 B 上正常。

## 3. 錨點策略

### 3-1 共用工具 `content/contentAnchors.ts`

- `ensureContentAnchors(container)`：render 完成後對容器內段落層級元素（`p, h1-h6, blockquote, li, img, figure, .content-card`）補穩定 `data-uep-anchor-id`。id 來源 = **tag + 文件順序中的同 tag 序號**（如 `p-3`、`h2-1`），重渲染不洗牌。仿 History h2/h3 slugify useEffect 擴大範圍。
- `findNearestAnchor(container, clientX, clientY): string | null`：drop 時 `querySelectorAll('[data-uep-anchor-id]')` + `getBoundingClientRect()` 找最近元素，回其 anchorId + 算相對偏移。
- `resolveAnchorRect(container, anchorId): DOMRect | null`：釘選層定位用，找元素算位置（仿 resolveMarkerResumeTop）。
- **容錯**：`anchorId` 找不到（admin 內容改版後段落順序/數量變）→ 退化「最近鄰同 tag」→ 再不行退頁首（仿 resolveResumeMarkerIdx 過期處理）。

### 3-2 分層

| 頁型 | zone / 子頁 | anchorKind | 內容容器 |
|---|---|---|---|
| 文字頁 | History（全）、Echoes content 子頁、Storage blog/dialogue/log 頁 | `element` | `.history-prose` / `.echoes-prose` / `.sto-prose` |
| 互動頁 | Visuals、Concepts（含各自 song/gallery/tab/timeline 視圖） | `page` | 無（釘在頁面固定側，viewport 相對） |

文字頁 Reader 在內容 render 後呼叫 `ensureContentAnchors(contentRef.current)`（Echoes/Storage 新增，History 擴大既有）。

## 4. UI 元件

### 4-1 `islands/storage/StorageIsland.tsx`（DraggableIsland 殼）

- **header**：左上 = 當前 zone + 頁面位置標註（讀 useZoneRouter / location）；右 = `{n} notes` 計數 + 收合鈕。
- **body（pool 列表）**：訂閱 `useProgress().storageNotes` + `pinnedStore`，`updatedAt` desc 排序，最新那張加 `.is-latest`（略放大）。每張：
  - text 顯示；點擊進 **inline 編輯態**（textarea，失焦/Enter 存 → `updateStorageNote`）
  - `×` → **島內局部刪除確認**（該便條就地展開「確認刪除？」兩鈕，非全螢幕）
  - **拖曳把手**（拖出釘選，見 §5）
  - 已釘選 → `.is-pinned` 暗掉、拖曳/編輯禁用、點擊 → 導向（見 §6）
- **footer**：輸入框「寫下一個想法…」+「+ 貼上」；達 cap 時 input 禁用 + 顯示「便條已滿（30）」。
- CSS：便條紙語彙移植設計稿；拖曳/收合走現有 `DraggableIsland`（不照抄原型手刻拖曳）。

### 4-2 `islands/storage/PinnedNoteLayer.tsx`（全站釘選層）

- 掛在 IslandHost portal 內，但**獨立守門** `shouldMountIsland(progress, 'storage')`（不受 `activeIds.length===0` 影響——沒開島也要顯示釘選便條）。
- 讀 `pinnedStore.getForPage(currentPath)`，渲染本頁釘選便條：
  - `element`：`resolveAnchorRect` + offset 定位（absolute 相對內容容器，隨捲動）
  - `page`：viewport 固定側定位（互動頁降級）
  - 錨點失效 → fallback 頁首 + 小提示「原位置已變動」
- 釘選便條 UI：inline 編輯（→ `updateStorageNote` 寫回本體）、拆除鈕（→ `unpin`，pool 該便條恢復可用）、可再拖曳調位置（重算 anchor）。
- **跨頁**：MPA 整頁重載每頁重掛，讀 localStorage 過濾當前 path；同 zone `useZoneRouter` pushState 不重載 → 監聽 path 變化重算（sub `useZoneRouter` 或 popstate/自訂事件）。

## 5. 拖曳釘選互動

1. pool 便條拖曳把手 → **pointer drag**（非 HTML5 DnD，跨島邊界到頁面內容較可控）。
2. 拖曳中顯示 ghost，放開時：
   - 命中內容容器（`.history-prose` 等）→ `findNearestAnchor` → `anchorKind='element'` pin。
   - 命中互動頁 / 無內容容器 → `anchorKind='page'` pin（釘該頁固定側）。
3. pin 後 pool 該便條 `.is-pinned` 暗掉。
4. 一張便條已釘 → pool 內不可再拖（暗掉）。

## 6. 導向機制（點暗掉便條）

- `getPinnedMeta(noteId)` → 若 `pagePath !== currentPath`：`useZoneRouter` 導航（跨 zone 整頁 / 同 zone pushState）。
- 到頁後：`element` → `resolveAnchorRect` 捲到位置 + 高亮該釘選便條；`page` → 捲頁首 + 高亮。
- 錨點失效 → 捲頁首 + toast「原位置已變動」。

## 7. 守門矩陣

| 情境 | pool（島） | 釘選層 |
|---|---|---|
| 觀測者 / 未登入 | 不掛 | 不掛 |
| storage 未解鎖 / 已停用 | 不掛 | 不掛 |
| 手機/窄視窗（`isDesktopIslandViewport` false） | 不掛 | **不掛**（釘選便條手機一律隱藏，同浮島相關功能守門） |
| storage 解鎖 + 桌面 + 探索者，島收合 | dock chip | **顯示**（釘選便條與島開合無關） |
| 登出 / reset | 隨 ProgressState 清空 | `clearAll()` 清場上 |

釘選層守門疊 `useDesktopIslandViewport()`（S8 #9 教訓：viewport 判定餵 JSX 要疊此 hook）。

## 8. 難點 / 風險

1. 🔴 **錨點 id 穩定性**：admin 內容改版後段落順序/數量變 → 錨點失效。靠 §3-1 容錯（最近鄰 → 頁首）。無法保證「原封不動貼回」，設計上接受降級。
2. 🔴 **拖曳跨島邊界**：pointer capture、z-index（釘選層 vs 島 2000-2999）、drop 命中內容容器判定（`elementFromPoint` + `closest('.xxx-prose')`）。
3. 🟡 **跨頁 path 判定**：MPA 重載 + 同 zone pushState 兩種路徑，釘選層都要正確重算當前頁釘選集。
4. 🟡 **pool ↔ 釘選層即時同步**：pinnedStore subscribe 兩邊；`updateStorageNote` 要同時反映 pool 與釘選便條。
5. 🟡 **互動頁降級位置**：Visuals/Concepts page 級便條的固定側位置避免遮擋既有 UI（畫廊/terminal）。

## 9. 拆卡（版號續 0.9.14.0，分支 feature/epic2-progress-foundation）

| # | 版號 | 狀態 | 內容 |
|---|---|---|---|
| 1 | .1 | ✅ `1b2ac93` | 資料層：ProgressState `storageNotes` schema + normalizeState 容舊 + store actions（add/update/remove）+ cap 常數 + 12 測試 |
| 2 | .2 | ✅ `09cbffa` | `StorageIsland` pool：DraggableIsland 殼 + 列表/排序/最新放大 + inline 編輯 + 島內局部刪除確認 + header 區域標註 + `useCurrentLocation` + IslandHost lazy 註冊 + 便條紙 CSS + 22 測試 |
| 3 | .3 | ✅ `0d04a22` | `contentAnchors` 工具（ensureContentAnchors/findNearestAnchor/resolveAnchorRect + 四層容錯鏈 exact→nearest→top→fixed）+ 三文字頁 Reader 接 ensureContentAnchors + 15 測試 |
| 4 | .4 | ✅ `4b76d9c` | `pinnedStore`（localStorage singleton + `window.__uepStoragePins` bridge）+ 登出/reset 清場上（PROGRESS_CHANGE 接線）+ 便條刪除連帶 unpin（sweepOrphans 通用掃描）+ 16 測試 |
| 5 | .5 | ✅ `ae02372` | `PinnedNoteLayer` 全站掛載（獨立守門，storage 島解鎖即掛）+ element/page 定位 + 釘選便條 inline 編輯/拆除 + 錨點失效 top/fixed fallback + 跨頁 path 重算 + `zoneContentTargets` registry + 19 測試 |
| 6 | .6 | ✅（本批） | 拖曳釘選互動（pointer drag + DRAG_THRESHOLD + ghost）+ pool 暗掉同步（is-pinned class）+ 點暗掉便條 → `navigateToPinned` + PinnedNoteLayer jump-to（scrollIntoView + 高亮）+ 15 測試 |
| 7 | .7 | ✅（本批） | 跨區事件合約 `UEP_STORAGE_PIN_EVENT` + `StoragePinChangeDetail`（pin/unpin/clear/sweep）+ islands/index.ts 對外匯出 + 4 測試 |

依賴鏈：.1 → .2（島能記便條，可獨立驗收）；.3 → .4 → .5 → .6（釘選鏈）；.7 收尾。

## 11. 完成總結（2026-07-21）

- **6 commits + 1 fix commit（DevTools.css）+ 1 docs commit**，全在 `feature/epic2-progress-foundation`
- **1050+ 測試全綠**（新增約 103 個），typecheck 綠，pnpm check 綠
- 版號 0.9.14.0 → **0.9.14.7**（S9-A 完成——待 S9-B「各浮島專屬解鎖儀式」）
- 手機守門：`isDesktopIslandViewport` + `@media (max-width:760px) display:none` 雙層
- Visuals/Concepts 降級：`supportsElementAnchor` 判斷、走 page 級 fallback（右下角 viewport 固定）
- 未來擴充鉤子：`UEP_STORAGE_PIN_EVENT` CustomEvent 已預留（消費端待需要時實作）

## 10. 待決 / 預留

- **跨區事件合約**（.7）：定義 `STORAGE_NOTE_EVENT` 常數 + 註解（便條映照文章的未來鉤子），**不實作消費端**。
- **專屬解鎖儀式**：S9 第二階段，本階段沿用 IslandUnlockObject。
- **便條 seed**：首次解鎖從**空白**開始（設計稿三張 seed 僅展示用），空狀態顯示「還沒寫下任何東西。」
- **互動頁 page 級便條的精準化**（語意化狀態錨點）：未來要做再逐 zone 補，本階段降級到頁面級。
