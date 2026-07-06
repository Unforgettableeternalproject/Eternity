# S7 Concepts 設計文件

> 版本：0.9.12.10（feature/epic2-progress-foundation）
> 作者：奈留（架構師）
> 日期：2026-07-06

---

## 總覽

S7 上半場核心命題：**Concepts 從靜態百科升格為隨讀者認知演進的活檔案**。
機制主軸是「條目級 Revision 鏈」——同一條目依旗標持有狀態呈現不同版本，並以 Terminal Island 作為互動查詢介面。

本文件涵蓋七個區域：Revision Schema、Effective View Resolver、ConceptsReader 整合、編輯器設計、embed/interactive 改造、Terminal Island、資料遷移。

---

## 一、Revision Schema 最終形狀

### 1-1 核心設計原則

Revision 是 **patch 不是 append**：後續解鎖可整段替換（set）或移除（remove）既有欄位。
Effective view = 按宣告順序，對所有 gate 通過的 revision 依序套用 patch，結果確定性。

### 1-2 共用 Revision 型別

```typescript
// apps/uep/src/components/concepts/revision.ts（新建）

import type { GateCondition } from '../../progress/gating';

/** 單一 Revision 的 patch 操作 */
export interface RevisionPatch {
  /** 欄位級整段替換（key = 欄位路徑，value = 新內容） */
  set?: Record<string, unknown>;
  /** 欄位刪除（key 陣列）*/
  remove?: string[];
}

/** 單一 Revision 條目 */
export interface ConceptsRevision {
  /** 版本辨識（建議用旗標慣例，如 'xavier:01'） */
  id: string;
  /** 解鎖條件；null = 無條件（base，視為 revision[0]）*/
  gate: GateCondition | null;
  /** 本 revision 對 base 或前次通過 revision 的 patch */
  patch: RevisionPatch;
}

/** 帶 entityKey 與 revision 鏈的條目包裝 */
export interface WithRevision {
  /**
   * 跨 stack 統一實體身分識別碼（kebab-case，小寫英文）。
   * 範例：'xavier-colsono'、'rain-sea-tower'、'essence'
   * 用途：embed ref 簡化、terminal 解析、旗標命名慣例
   */
  entityKey?: string;
  /** Revision 鏈（順序宣告，解鎖後依序累積套用） */
  revisions?: ConceptsRevision[];
}
```

### 1-3 四種 Stack 的具體擴充

#### 1-3-a Dossier（records stack）

```typescript
// 擴充 DossierEntry（apps/uep/src/components/concepts/types.ts）
export interface DossierEntry extends WithRevision {
  name: string;
  content_html?: string;
  spoiler?: number;
  // WithRevision 貢獻：entityKey, revisions
}

// patch 可操作的欄位 key：
// 'name'          → string
// 'content_html'  → string（HTML）
// 'spoiler'       → number
```

**Variants 層與 Revision 的關係（奈留設計決策）**：

Variants（era u/e/p）和 Revision 是正交的兩個維度：
- Variant = 由**讀者主動切換**的故事時代視角（U/E/P），是編輯端預設的時代內容分割。
- Revision = 由**進度旗標解鎖**的認知版本演進，在單一 Variant 內累積 patch。

因此 entityKey 和 revisions 掛在 `DossierEntry` 層，與 Variant 無關——同一個角色（xavier-colsono）在 Variant U 和 Variant E 下各自有獨立的 revisions 鏈，分別對應不同時代劇情的認知更新。

**重要含意**：如果一個角色只存在於 U 時代，其 revisions 只需掛在 Variant U 的 entry；如果跨時代，每個 Variant 的 entry 維護自己的 revisions。不需要跨 Variant 合併 patch。

```typescript
// 可操作欄位路徑示意（patch.set key）：
// 'name'         → 替換條目名稱
// 'content_html' → 替換描述 HTML

// 範例：xavier 在旗標 xavier:01 解鎖後更新描述
const revision: ConceptsRevision = {
  id: 'xavier:01',
  gate: { requiresFlags: ['xavier:01'] },
  patch: {
    set: { content_html: '<p>現已揭露：艾斯維爾的真實身份…</p>' }
  }
};
```

#### 1-3-b Browser（browser stack）

Browser 的 `CharacterProfile` 結構較巢狀，patch 需支援 `sections` 陣列操作。

```typescript
// 擴充 CharacterProfile
export interface CharacterProfile extends WithRevision {
  name: string;
  categories?: string[];
  placeholder?: boolean;
  avatar?: string;
  basic?: Record<string, string>;
  sections?: ProfileSection[];
  spoiler?: number;
  // WithRevision 貢獻：entityKey, revisions
}
```

**巢狀 sections 的 patch 設計（奈留決策）**：

sections 是有序陣列，直接用 `set.sections` 整段替換整個陣列，不做 element-level merge。理由：sections 數量少（通常 3-6 個）、語意是「完整的認知視窗」，局部替換某個 section 的 content_html 比 element diff 更可預期。

```typescript
// patch 可操作的欄位 key：
// 'name'             → string
// 'placeholder'      → boolean（false = 解鎖條目）
// 'avatar'           → string（R2 key）
// 'basic'            → Record<string, string>（整段替換）
// 'basic.種族'       → string（單欄位替換，dot notation）
// 'sections'         → ProfileSection[]（整段替換整個 sections 陣列）
// 'sections.0.content_html' → string（替換第 0 個 section 的 content_html）

// 建議的 patch 粒度策略：
// - 初解鎖（placeholder → 有內容）：set.placeholder=false + set.basic + set.sections
// - 後續揭露：set['sections.N.content_html'] 或 set.sections（整段）
// - 刪除某欄位（如 spoiler）：remove: ['spoiler']
```

**`basic` 的 dot-notation 支援**：resolver 需支援 `'basic.種族'` 格式，用 lodash-style `_.set(obj, path, value)` 邏輯處理。避免為此引入 lodash，實作一個輕量的 `applyDotPath` 純函式（< 20 行）。

#### 1-3-c Chrono（oscillator stack）

```typescript
// 擴充 ChronoPeriod
export interface ChronoPeriod extends WithRevision {
  era: ChronoEra;
  yearNum: number;
  year: string;
  title?: string;
  fields: Record<string, ChronoField>;
  // WithRevision 貢獻：entityKey, revisions
}
```

**Chrono 的 patch 粒度（奈留決策）**：

Patch 粒度為 period 層（整個時間點）。Fields 的 event 是 string[]，不做 element-level diff；若需新增/修改，整個 `fields.fieldId.items` 替換。理由：chrono 是「知識累積」型，後續解鎖通常是「這個年份揭露了更多事件」，整段替換比精確 diff 更直觀。

```typescript
// patch 可操作的欄位 key：
// 'title'                    → string
// 'fields.main.items'        → string[]（替換 main field 的事件列）
// 'fields.character.groups'  → ChronoFieldGroup[]
```

#### 1-3-d Diff（translation stack）

```typescript
// 擴充 DiffEntry
export interface DiffEntry extends WithRevision {
  term: string;
  values: string[];
  spoiler?: number;
  hidden?: boolean;
  locked?: boolean;
  // WithRevision 貢獻：entityKey, revisions
}
```

```typescript
// patch 可操作的欄位 key：
// 'values'  → string[]（整段替換譯名/定義陣列）
// 'hidden'  → boolean（false = 解鎖條目）
// 'locked'  → boolean
// 'term'    → string（修正術語名稱）
```

### 1-4 向下相容 Normalize

**規則**：舊格式（無 `revisions` 欄位）= 單一無 gate 的 base revision，effective view 等同原始資料。Normalize 在 Resolver 的輸入端處理，Reader 和 Editor 感知到的永遠是已 normalized 的資料。

```typescript
// 無 revisions = 視為 [{id:'base', gate:null, patch:{set: 整個條目欄位}}]
// 不需要在 D1 補欄位，在 resolver 的讀取端動態處理
```

---

## 二、Effective View Resolver

### 2-1 模組位置與 API

```
apps/uep/src/components/concepts/
  revision.ts       ← 型別定義 + applyRevisions 純函式（新建）
  revisionCache.ts  ← 快取層（新建）
```

### 2-2 核心純函式

```typescript
// revision.ts

/**
 * 對單一條目計算 effective view。
 * 純函式——不訂閱 progress，不快取，方便測試。
 *
 * @param base     條目的原始資料（不含 revisions 欄位的純資料部分）
 * @param revisions revision 鏈（按宣告順序）
 * @param progress  目前 ProgressState
 * @returns         套用所有通過 gate 的 revision patch 後的結果
 */
export function applyRevisions<T extends Record<string, unknown>>(
  base: T,
  revisions: ConceptsRevision[] | undefined,
  progress: ProgressState
): T;

/**
 * 輔助：dot-notation 路徑設定值（如 'basic.種族' → obj.basic['種族']）。
 * 僅支援物件/陣列，不支援 prototype 污染路徑（有防禦）。
 */
function applyDotPath(obj: Record<string, unknown>, path: string, value: unknown): void;

/**
 * 輔助：判斷條目是否已解鎖（有任何 gate 通過，或 base 無 gate）。
 * 用於「未解鎖條目 = 隱藏」的守門邏輯。
 *
 * 觀測者 bypass requiresFlags（沿用 evaluateGate 語意）。
 */
export function isEntryUnlocked(
  revisions: ConceptsRevision[] | undefined,
  progress: ProgressState
): boolean;
```

**`applyRevisions` 實作邏輯**：

```
1. 複製 base（shallow clone，確保不修改原始資料）
2. 若無 revisions，直接回傳 clone
3. 遍歷 revisions（宣告順序）：
   a. evaluateGate(progress, revision.gate) → 不通過則跳過
   b. 處理 patch.remove：刪除指定 key（支援 dot-notation）
   c. 處理 patch.set：設定指定 key 的值（支援 dot-notation）
4. 回傳結果
```

**亂序防禦**：按宣告順序套用，不排序。艾斯維爾需確保 D1 中 revisions 陣列的宣告順序是語意上正確的累積順序。Resolver 不重新排序（有排序需求的情境——不存在，因為 revisions 就是「依劇情進度的認知更新」，順序等同時間順序）。

**`isEntryUnlocked` 邏輯**：

```
- 無 revisions 或 revisions 為空陣列 → true（無限制）
- revisions[0].gate === null → true（base 無 gate，條目初始即可見）
- 否則：any revision 的 gate 通過 → true
```

### 2-3 快取策略

```typescript
// revisionCache.ts

/**
 * 以 (pageId, entryKey, flagsFingerprint) 為快取 key。
 * flagsFingerprint = flags 陣列排序後 join(',')。
 *
 * 快取在記憶體（Map），頁面離開時清空（ConceptsReader unmount）。
 * 不做 LRU，因為 Concepts 條目數量有限（< 500 條）。
 */
export function getCachedEffectiveView<T>(
  pageId: string,
  entryKey: string,
  progress: ProgressState,
  compute: () => T
): T;

/** 清空特定 page 的快取（page 切換時呼叫） */
export function invalidatePageCache(pageId: string): void;
```

**觸發重算的時機**：
1. `flags` 陣列有變化（新旗標解鎖）→ fingerprint 變化 → 快取 miss → 重算
2. `view` 切換（observer/explorer）→ 重算（observer bypass requiresFlags）
3. 換頁 → `invalidatePageCache`

### 2-4 SSR 防禦

比照 `decorateInteractiveHtml` 的手法：Resolver 在純函式層不碰 DOM，不需要 DOMParser 防禦。`applyRevisions` 可在 SSR 環境安全呼叫。

但 Reader 消費端（React component）在 SSR 時不訂閱 progress（`useProgress()` hook 在 SSR 回傳 `createInitialState()`），effective view 會是 base 狀態——這是正確行為（SSR 結果不顯示 gated 內容，CSR hydrate 後才顯示使用者的個人化狀態）。

---

## 三、ConceptsReader 整合

### 3-1 整合策略

ConceptsReader 目前完全不感知 progress。整合目標：

1. **stack 列表頁**（renderStack）：依 gate 篩選顯示的子頁面（未解鎖的頁面隱藏，不顯示 LOCK 佔位）
2. **reading 頁面**（renderReading）：四個 sub-reader 接收 effective view 後的資料
3. **訂閱 progress 變化**：旗標改變時重算

### 3-2 progress 訂閱

```typescript
// ConceptsReader.tsx 新增
import { useProgress } from '../../progress';

export default function ConceptsReader() {
  const progress = useProgress(); // 訂閱 ProgressState，旗標變化觸發重渲
  // ...
}
```

`useProgress()` 已是現有 hook（HistoryIsland 等已使用），不需要新建。

### 3-3 Stack 列表頁的條目過濾

```typescript
// renderStack 中，過濾子頁面：
const visibleChildren = children.filter((child) => {
  if (isHidden(child)) return false;
  // 新增：頁面層的 gate 判定（metadata.gate + progress）
  const gate = parseGateCondition(child.metadata);
  return evaluateGate(progress, gate);
});
```

注意：頁面層的 gate（`metadata.gate`）判定沿用 `evaluateGate`（不走 `evaluateEffectiveGate`，因為 Concepts 沒有 progressPage chain 語意——History 才有）。

### 3-4 四個 Sub-Reader 的資料接法

```typescript
// renderReading 中，在 parsed 解析後，套用 effective view：
import { resolveEffectiveViewForPage } from './revision';

// parsed = 原始 JSON（DossierContent / BrowserContent / ChronoContent / DiffContent）
// effectiveParsed = 套用進度 patch 後的結果

const effectiveParsed = resolveEffectiveViewForPage(parsed, progress, readingPage.id);
```

`resolveEffectiveViewForPage` 是頁面級函式，負責遍歷頁面資料結構的所有條目，對每個有 revisions 的條目呼叫 `applyRevisions`，並過濾掉未解鎖的條目（`isEntryUnlocked` 回傳 false 的條目不進 effective 結果）。

```typescript
// revision.ts 新增
export function resolveEffectiveViewForPage(
  data: ConceptsData,
  progress: ProgressState,
  pageId: string
): ConceptsData;
```

各 stack 的遍歷路徑：
- dossier：`variants[*].subcategories[*].groups[*].entries`
- browser：`profiles`
- chrono：`periods`
- diff：`subcategories[*].sections[*].entries`

### 3-5 進度變化重算

`useProgress()` 在 `flags` 或 `view` 變化時觸發重渲。`resolveEffectiveViewForPage` 在 `useMemo` 中計算，deps 包含 `[parsed, progress.flags, progress.view]`。快取在 `revisionCache.ts` 由 fingerprint 控管，避免每次 render 重跑完整 patch 邏輯。

---

## 四、編輯器設計

### 4-1 整體架構

Revision 編輯 UI 嵌入現有的 `ConceptsEditorBody` 的條目層，不新建獨立編輯頁面。編輯器分兩層：

1. **entityKey 管理**：條目層的頂端輸入欄，全局唯一性驗證
2. **Revision 時間線 UI**：條目層展開後顯示 revision 鏈，每個 revision 可編輯 gate 和 patch

### 4-2 entityKey 管理

```typescript
// 新增在各條目編輯介面（DossierEntry、CharacterProfile 等）的頂端

interface EntityKeyFieldProps {
  value: string | undefined;
  onChange: (key: string | undefined) => void;
  /** 所有已用 entityKey（用於唯一性即時校驗） */
  existingKeys: Set<string>;
  /** 同頁面的條目 key（排除自身）*/
  selfKey?: string;
  accent: string;
}
```

格式規則（即時校驗）：
- 僅允許 kebab-case 小寫英文、數字、連字號
- 不可與同頁面其他條目的 entityKey 重複（頁面內唯一）
- 警告（非阻擋）：若已有同 key 的 embed ref 在 History HTML 中存在但格式不同

**跨 stack 一致性**：設計不提供跨 stack 自動驗證（需查 D1），改為在 Terminal Island 查詢時回報重複/衝突，由艾斯維爾手動修正。自動驗證的成本高且場景罕見（entityKey 由設計者統一命名，人工協調即可）。

### 4-3 Revision 時間線 UI

```
[ entityKey: xavier-colsono ]

▸ Revisions（2 個）
  ┌─────────────────────────────────────────────────┐
  │ base（無條件）                                   │
  │ [patch: 無操作，base 資料即顯示內容]               │
  └─────────────────────────────────────────────────┘
  ┌─────────────────────────────────────────────────┐
  │ revision: xavier:01                              │
  │ [Gate 條件編輯器]  ← 復用 GateConditionEditor    │
  │ Patch：                                          │
  │   set.content_html  [TipTap 編輯區]              │
  │   set.name          [文字輸入]                   │
  │   remove: []        [key 列表，可刪除]           │
  │ [模擬預覽按鈕]                                    │
  └─────────────────────────────────────────────────┘
  [+ 新增 Revision]
```

**GateConditionEditor 復用**：每個 revision 的 gate 直接使用現有的 `GateConditionEditor`，傳入：
- `value={revision.gate}`
- `onChange={(gate) => updateRevisionGate(revIdx, gate)}`
- 不傳 `onProgressPageChange` / `onGateExemptChange`（Concepts revision 不使用 progressPage chain 語意）

**Patch 欄位的動態渲染**：根據 stack 類型決定可用的 patch 欄位。dossier 顯示 `content_html`（TipTap）和 `name`（文字）；browser 顯示 `sections`（Section 陣列編輯）和 `basic`（key-value）等。實作時各 stack 有對應的 `PatchEditor` 子元件。

### 4-4 進度模擬預覽（必要功能）

```typescript
interface RevisionSimulatorProps {
  /** 頁面的完整資料（含所有 revisions） */
  data: ConceptsData;
  /** 模擬用的旗標集合（使用者手動輸入或選擇） */
  simulatedFlags: string[];
  onClose: () => void;
}
```

UI 設計：
1. 右側 Inspector 或 modal 展開「模擬視窗」
2. 旗標輸入欄（comma-separated），下方列出可用旗標（從各 revision.gate.requiresFlags 彙整）
3. 預覽區顯示 effective view 的渲染結果（呼叫 `applyRevisions`，傳入模擬 ProgressState）
4. 提示「亂序狀態暴露」：若勾選某旗標組合下，有 revision 的 gate 通過但前置 revision 的 gate 未通過，顯示警告（可能的跳躍問題）

模擬 ProgressState 構造：

```typescript
function buildSimulatedProgress(flags: string[]): ProgressState {
  return { ...createInitialState(), flags };
}
```

---

## 五、embed/interactive.ts 改造

### 5-1 新 ref 格式

**舊格式**：`data-ref="concepts/xxx#entry:{entryId}"`（entryId = 數字陣列索引）
**新格式**：`data-ref="entity:{entityKey}"`（entityKey = 穩定字串識別碼）

向後相容：`isValidRef` 和 `parseRef` 需同時支援兩種格式。

```typescript
// marks.ts 新增

/** 解析 entity ref 格式（新舊格式相容） */
export function parseEntityRef(ref: string): EntityRefResult;

export type EntityRefResult =
  | { type: 'entity-key'; entityKey: string }         // 新格式 entity:{key}
  | { type: 'concepts-entry'; pageId: string; entryId?: string }  // 舊格式 concepts/xxx#entry:*
  | { type: 'page'; pageId: string }                   // 一般頁面 ref
  | { type: 'invalid' };
```

### 5-2 解鎖語意改造

**舊語意**：`isEntityUnlocked = 持有 met:{ref}` 旗標
**新語意**：`isEntityUnlocked = 持有該 entityKey 任一階段旗標`（`{entityKey}:*` 格式）

```typescript
// interactive.ts 修改

/**
 * entity 是否已解鎖（新語意）：
 * - 新格式 ref（entity:{entityKey}）：持有任一 {entityKey}:* 旗標
 * - 舊格式 ref（concepts/xxx#entry:*）：持有 met:{ref}（向後相容）
 * - 觀測者視角：bypass
 */
export function isEntityUnlocked(state: ProgressState, ref: string): boolean {
  const parsed = parseEntityRef(ref);
  if (parsed.type === 'entity-key') {
    return (
      state.view === 'observer' ||
      state.flags.some((f) => f.startsWith(`${parsed.entityKey}:`))
    );
  }
  if (parsed.type === 'concepts-entry') {
    // 向後相容：met:ref 舊語意
    return evaluateGate(state, { requiresFlags: [metFlag(ref)] });
  }
  return false;
}
```

**EntityActivateDetail 更新**：

```typescript
export interface EntityActivateDetail {
  kind: string;
  ref: string;
  // 新增：解析後的 entityKey（新格式 ref 才有）
  entityKey?: string;
  pageId: string;
  entryId?: string;
  text?: string;
  sourcePageId?: string;
}
```

### 5-3 既有 met:* 的過渡策略

既有 History HTML 中可能已有 `met:{ref}` 格式的 FlagMarker 標記。過渡策略：

1. `isEntityUnlocked` 的舊格式分支繼續支援 `met:` 旗標（向後相容，不破壞已存在的 embed）
2. 新增 embed 時，編輯器 picker 輸出 `entity:{entityKey}` 格式
3. 不強制批次遷移舊 embed（量少，遷移時機由艾斯維爾決定）
4. `met:*` 在 Concepts 線退役的宣告僅意味著不新增，不刪除既有的

---

## 六、Terminal Island

### 6-1 定位與職責

Terminal Island 是純查詢介面，不持有資料，所有內容基於 Concepts effective view。

```
職責：
  - 關鍵字查詢（人物名/地名/術語名）
  - 列出 stack 條目（ls）
  - 導向 records（永續紀錄主機）或 translation（認知對照平台）落點
  - 條目點擊可深連 browser（個性瀏覽器）詳細頁
  - 更動通知（旗標觸發的 revision 解鎖提示）

不做：
  - 直接顯示 Echoes/Visuals/Storage 內容
  - 持有或快取 Concepts 資料（查詢時即時呼叫 API）
  - 編輯功能
```

### 6-2 掛載模式

比照 HistoryIsland 模式：

```typescript
// apps/uep/src/islands/concepts/TerminalIsland.tsx（新建）
// 掛在 IslandHost 下，由 shouldMountIsland(progress, 'concepts') 守門

// IslandHost.tsx 現有結構：
// case 'history': return <DraggableIsland ...><HistoryIsland /></DraggableIsland>
// 新增：
// case 'concepts': return <DraggableIsland ...><TerminalIsland /></DraggableIsland>
```

視覺語彙從 Eternity-Design `concepts-base.jsx` 的 TerminalIsland 直接取用：
- 標題列（`›_` 圖示 + `uep.terminal ~ /concepts/query` 文字 + 最小化按鈕）
- body 輸出區（固定高 220px，行分色：meta/in/ok/err/row）
- 底部 prompt 列（`$` 前綴 + input + `↵`）
- 顏色 token：`CONC_MAIN=#2D6A4F`、`CONC_SOFT=#74C69D`

**拖曳收合完全使用現有 DraggableIsland**，不重新實作拖曳邏輯。

### 6-3 指令集

```
?              → 顯示幫助
help           → 同 ?
query <keyword>  → 關鍵字搜尋（名稱模糊比對）
ls <stack>     → 列出 stack 已解鎖條目
               → stack 簡稱：log / browser / clock / compare
clear          → 清空輸出
```

### 6-4 entityKey 解析流程

```
1. query 命令收到 keyword
2. 呼叫 API：GET /api/content/concepts/records/tree（或類似端點）
3. 在所有已解鎖條目的 name 欄位做 fuzzy match
4. 命中後顯示：
   - 條目名稱
   - 所在 stack（records 或 translation）
   - 所在位置（slug 路徑）
   - 可點擊「開啟 browser 詳細頁」連結（若該 entityKey 存在於 browser profiles）
5. 點擊觸發：window.dispatchEvent(new CustomEvent('uep:entity-activate', { detail }))
   → ConceptsReader 消費（開啟 browser 詳細頁）
```

**entity ref → records/translation 落點的解析**：

Terminal 持有一份「entityKey → stack + slug + entryPath」的索引，在首次查詢時建立（lazy init），flags 變化後 invalidate（可能有新條目解鎖）。

```typescript
interface TerminalEntityIndex {
  // entityKey → 可查詢的落點
  entries: Map<string, TerminalEntityEntry[]>;
  builtAt: string; // flags fingerprint
}

interface TerminalEntityEntry {
  entityKey: string;
  name: string;        // 顯示名稱
  stack: 'records' | 'translation' | 'browser' | 'chrono';
  pageSlug: string;    // Concepts 的 slug
  // 有 browser profile → 可深連
  hasBrowserProfile: boolean;
}
```

索引建立策略：Terminal Island mount 後，以 progress 的 flags fingerprint 為 key，懶載入所有 Concepts 頁面資料，遍歷條目，對有 entityKey 的條目建立索引。資料量不大，不做分頁。

### 6-5 uep:entity-activate 消費

```typescript
// Terminal Island 監聽 uep:entity-activate（來自 History 文章點擊）
window.addEventListener('uep:entity-activate', (e: Event) => {
  const detail = (e as CustomEvent<EntityActivateDetail>).detail;
  if (!detail.entityKey) {
    // 舊格式 ref，降級到普通查詢
    runQuery(`query ${detail.text ?? detail.ref}`);
    return;
  }
  // 直接顯示該 entityKey 的查詢結果
  showEntityResult(detail.entityKey);
  // 若島是收合狀態，自動展開
  getIslandRuntime().open('concepts');
});
```

**浮島未解鎖時的靜默**：History 文章的 entity 點擊仍 dispatch 事件，但 Terminal Island 未掛載時沒有消費者，事件自然消失。這是現有 `shouldMountIsland` 守門的結果，不需要額外防禦。

### 6-6 更動通知（已讀水位）

**已讀水位的儲存位置**：ProgressState 新增欄位。

```typescript
// types.ts 新增欄位（ProgressState 擴充）
interface ProgressState {
  // ... 既有欄位 ...
  /**
   * Terminal Island 已讀水位：各 entityKey 的上次已知 revision 數。
   * key = entityKey，value = 上次確認的已通過 revision 個數
   * 旗標變化 → 計算新通過 revision 數 → 若 > 已讀水位 → 觸發通知
   */
  conceptsReadLevel: Record<string, number>;
}
```

**更動通知流程**：

```
1. ProgressState.flags 變化（新旗標解鎖）
2. Terminal Island 訂閱 progress 變化（useProgress()）
3. 計算所有有 entityKey 的條目：
   新通過 revision 數 = revisions.filter(r => evaluateGate(progress, r.gate)).length
4. 比對 conceptsReadLevel[entityKey]
5. 若 新通過 > 已讀水位 → 在 terminal body 輸出通知行：
   [SYSTEM] xavier-colsono 的資料已更新 (+1 revision)
6. 更新 conceptsReadLevel[entityKey] = 新通過數
7. 寫回 progress store
```

通知輸出格式（終端 meta 色）：
```
[SYS] · xavier-colsono 資料已更新（+1 revision）
[SYS] · 輸入 query xavier-colsono 查看最新內容
```

---

## 七、資料遷移策略

### 7-1 現有 D1 資料狀況

四個 stack 頁面的現有內容：
- `server/records`：character_list（有 variants）、location_list 等，條目無 entityKey
- `server/browser`：profiles 陣列，無 entityKey
- `server/time_logs`：periods，無 entityKey
- `server/translation`：entries，無 entityKey

**跨 stack 命名不一致地雷**：
- dossier character_list entry name：`艾斯維爾·科索諾 Xavier Colsono`（全文）
- browser profile name：`艾斯維爾·科索諾 (Xavier Colsono)`（括號格式）
- entityKey 統一使用英文 kebab-case：`xavier-colsono`

### 7-2 遷移策略

**自動推斷（保守策略）**：不做自動推斷。理由：名字格式不一致，自動比對容易錯配；entityKey 是語意資產，錯誤比缺失更難修復。

**人工指定（建議流程）**：

1. 輸出 entityKey 候選清單腳本（`scripts/generate-entity-keys.mjs`）：
   - 掃描所有 dossier entries 和 browser profiles
   - 從名稱中提取英文部分（regex 抓括號或空格後的拉丁字符序列）
   - 生成 kebab-case 候選 entityKey，人工確認
   
2. 確認後的 entityKey map（JSON 檔案，如 `scripts/entity-key-map.json`）：
   ```json
   {
     "艾斯維爾·科索諾 Xavier Colsono": "xavier-colsono",
     "諾薇亞": "norvia",
     "雨海塔": "rain-sea-tower"
   }
   ```

3. 批次更新腳本（`scripts/apply-entity-keys.mjs`）：讀 map，更新 D1 對應條目的 entityKey 欄位。

**哪些需要手動指定（艾斯維爾決定）**：
- 有跨 stack 深連需求的條目（角色、重要地名、術語）
- Revision 鏈的第一批候選條目（劇情中最先揭露的人物）
- translation 的術語條目（通常是英文 term，直接 kebab-case 化即可）

**不需要 entityKey 的條目**：列表型條目（如 hostile_creatures 的魔獸條目）、目前無深連需求的條目，保持 entityKey = undefined 即可（不影響現有功能）。

---

## 八、實作分期建議

### Sub-session A：地基（Revision Schema + Resolver）

**目標**：純函式層完整，可跑測試，不接 UI。

工作項目：
1. `revision.ts`：`ConceptsRevision`、`WithRevision` 型別、`applyRevisions` 純函式、`isEntryUnlocked`、`resolveEffectiveViewForPage`
2. `revisionCache.ts`：快取層（Map + fingerprint）
3. 各 Stack 型別擴充（`types.ts` 的 `DossierEntry`、`CharacterProfile`、`ChronoPeriod`、`DiffEntry` extends `WithRevision`）
4. `ConceptsReader` 接上 `useProgress()` 和 `resolveEffectiveViewForPage`（不含編輯器）

**驗收條件**：
- `applyRevisions` 的單元測試通過（base、單 revision、多 revision 累積、remove 操作）
- `isEntryUnlocked` 測試通過（無 revisions = 可見；有 gate 的 revision = 旗標控制）
- ConceptsReader 讀取進度後，模擬旗標環境下隱藏/顯示正確條目（手動測試）

**風險**：`dot-notation` path 的巢狀物件 mutation 需要謹慎實作，防止引用共用。

---

### Sub-session B：編輯器 + 遷移

**目標**：艾斯維爾可以在 Admin 中給條目設 entityKey 和 revision 鏈。

工作項目：
1. `ConceptsEditorBody` 各 stack 的條目編輯區加入 entityKey 輸入欄
2. Revision 時間線 UI（含 GateConditionEditor 復用）
3. Patch 欄位動態渲染（各 stack 的 `PatchEditor` 子元件）
4. 進度模擬預覽（模擬旗標集合 → effective view 渲染）
5. `scripts/generate-entity-keys.mjs` 和 `scripts/apply-entity-keys.mjs`
6. 批次遷移現有條目的 entityKey

**驗收條件**：
- 可在 Admin 給 `xavier-colsono` 設 entityKey 和至少一個 revision，儲存後 Reader 正確顯示
- 模擬預覽在旗標持有狀態下顯示正確的 effective content
- 遷移腳本跑過後，主要人物條目有 entityKey

**風險**：Revision 時間線 UI 的 UX 複雜度高（巢狀 patch 欄位），需要設計決策（艾斯維爾確認 patch 欄位的顯示粒度）。

---

### Sub-session C：Terminal Island + embed 改造

**目標**：Terminal Island 可用，entity ref 導向正確。

工作項目：
1. `embed/marks.ts`：`parseEntityRef` 新增，`isValidRef` 向後相容
2. `embed/interactive.ts`：`isEntityUnlocked` 改造為新語意，`EntityActivateDetail` 新增 entityKey
3. `TerminalIsland.tsx`（新建，視覺取自 Eternity-Design）
4. IslandHost 接 TerminalIsland
5. Terminal 的 entity 索引建立邏輯
6. 更動通知（已讀水位 conceptsReadLevel 寫入 ProgressState）
7. ProgressState schema 更新（新增 conceptsReadLevel）
8. HistoryReader 的 Toast 佔位消費端拆除（UEP_ENTITY_ACTIVATE_EVENT 改由 Terminal 消費）

**驗收條件**：
- History 文章點擊 entity → Terminal Island 開啟並顯示查詢結果
- Terminal `query xavier` 找到 xavier-colsono 的條目
- 新旗標解鎖後，Terminal 顯示更動通知
- `ls log` 列出已解鎖的 records 條目

**風險最高部分**：Terminal 的 entity 索引建立——需要 lazy load 所有 Concepts 頁面資料，在 API 回應慢時用戶體驗差。建議索引建立完成前，查詢指令顯示 `loading index…` 狀態，不阻塞 UI。

---

## 附錄：需要艾斯維爾定奪的問題（最多三個）

### 問題 A：Chrono 的 entityKey 粒度

Chrono（時鐘）的 period 是時間點，不是人物或地名，不太適合 entityKey 的「跨 stack 深連」使用情境。目前設計將 `WithRevision` 掛在 `ChronoPeriod`（時間點），但這意味著一個時間點（如「U.0420」）需要有 entityKey 才能被 Terminal 查詢。

**選項 1**（推薦）：Chrono 的 revision 和 entityKey 維持在 period 層，但 Terminal 的 `ls clock` 指令不顯示 period 條目（只顯示 records 和 translation）；chrono 的進度閘僅控制「某個時間點揭露幾個事件」。entityKey 在 chrono 選用，不強制。

**選項 2**：Chrono 不掛 entityKey 和 revisions，進度閘改用「整個 period 的 hidden 欄位」控制可見性（更粗粒度，period 要麼全顯示要麼全隱藏）。

艾斯維爾需決定：Chrono 的進度解鎖是 event 粒度（修改某年份的 items）還是 period 粒度（整個年份揭露）？

---

### 問題 B：Terminal Island 的 Concepts 資料載入策略

Terminal 建立 entity 索引需要載入所有 Concepts 頁面資料（每個 stack 4-8 個頁面，每頁 JSON 可能 50-200kb）。

**選項 1**（推薦）：Terminal mount 時全量預載，建立記憶體索引，查詢即時。代價：首次 mount 有 1-3 秒延遲，顯示 `initializing…`。

**選項 2**：每次查詢即時 fetch（query → API call → 結果）。不需預載，但查詢有延遲且無法做 fuzzy match（只能精確 slug 查詢）。

**選項 3**：後端新增 `/api/concepts/search?q=<keyword>` 端點，全文搜尋交給 D1（`LIKE %keyword%`）。Terminal 只做一次 API call，無需索引。代價：需要修改 content-api Worker。

奈留推薦選項 3 的「半版」：後端只提供 entityKey 索引端點（回傳所有有 entityKey 的條目的摘要清單，不含完整 content），Terminal 以此建立輕量索引（< 20kb），再在前端做 fuzzy match。這是選項 1 的輕量化，首次載入時間從 3 秒降到 0.5 秒以內。

---

### 問題 C：Browser Profile 解鎖語意

Browser（個性瀏覽器）目前已有 `placeholder: true` 機制——placeholder 角色顯示為灰色鎖定，點擊後顯示 `access restricted`。

S7 引入 revision 後，解鎖一個 browser profile 有兩種可能語意：

**選項 1**（奈留推薦）：`placeholder: true` 維持現有視覺（顯示為鎖定），第一個解鎖 revision 的 patch 設 `{ set: { placeholder: false, sections: [...], basic: {...} } }`。讀者觀看時角色從「鎖定」直接跳成「有內容」。effectiveView 看到 `placeholder: false` 就顯示完整角色頁。

**選項 2**：Browser 的「未解鎖角色」直接隱藏（不顯示在列表中），比照 Dossier 的「未解鎖條目 = 隱藏」政策。Browser 的 placeholder 機制退役。

這涉及兩個問題的答案：
1. 讀者知道有哪些「尚未認識的角色」是否是設計意圖？（知道存在 vs 完全不知道）
2. Browser 和 Dossier 的解鎖語意是否需要一致？

---

## 定案記錄（2026-07-06 艾斯維爾拍板）

| 問題 | 決議 |
|------|------|
| A：Chrono 粒度 | **Event 粒度**——revision 掛 period 層，patch 可替換事件列（`fields.xxx.items`）；entityKey 在 chrono 選用不強制；Terminal 的 `ls clock` 不列 period 條目 |
| B：Terminal 載入 | **後端 entityKey 索引端點**——content-api Worker 新增輕量端點（所有帶 entityKey 條目的摘要，< 20kb），前端建索引做 fuzzy match |
| C：Browser 解鎖語意 | **保留 placeholder 鎖定佔位**——未認識角色顯示灰色鎖定，首個 revision patch 設 `placeholder=false` + 完整內容；讀者「知道有尚未認識的角色存在」是設計意圖 |

補充審查備註（諾薇亞）：
- 6-1「不持有資料」與 6-4 索引矛盾由決議 B 解決——Terminal 只持有輕量索引，不快取完整 content
- Dossier patch 欄位清單實作時要照實際型別補齊（`name/alias/title/ability/notes/spoiler`），設計文件範例只是示意
- `conceptsReadLevel` 放 ProgressState = 跟登入同步、跨裝置不重複通知（隱含決定，艾斯維爾已知悉）

---

## 實作進度記錄

### Sub-session A：已完成（2026-07-06，0.9.12.11 ~ 0.9.12.14）

| Commit | 版號 | 內容 |
|--------|------|------|
| 7449ab3 | 0.9.12.11 | Revision schema 型別（WithRevision/ConceptsRevision/RevisionPatch，四 stack extends）|
| db1a1f9 | 0.9.12.12 | `revision.ts` resolver：applyDotPath/applyRevisions/isEntryUnlocked/type guards/resolveEffectiveViewForPage（27 測試）|
| 88c4139 | 0.9.12.13 | `revisionCache.ts`：progressFingerprint 快取（8 測試）|
| 0af89ac | 0.9.12.14 | ConceptsReader 接線：useProgress、stack 列表 gate 過濾、deep link 守門、effective view 套用 |
| 16fb478 | （fix）  | structuredClone eslint global 宣告 |

驗證：`pnpm check` 全過；全站 476 測試全綠（新增 35，零退化）。

與原拆卡的偏移：A-2/A-3 合併為單一 commit（同檔案不拆刀），版號順移；A-6 check 不佔版號。

實作備註：
- type narrowing 實解：dossier 靠 `variants`、browser 靠 `profiles`、chrono 靠 `periods`、diff = subcategories 且非前三者且無 groups
- `patch.set` 的 value 也做 structuredClone（防多條目共用 patch 物件的引用共用）
- 快取同 page 只留最新 fingerprint 一份（進度單調前進）；fingerprint 含 observerEver
- 手動驗收延後：資料端尚無 revision 內容，艾斯維爾將於 Sub-session B 完成後一併測試

### Sub-session B 排版定案（2026-07-06，開工前補充）

艾斯維爾反映編輯器現有排版已擠。實查 `ConceptsEditorBody`：dossier/diff 為雙欄
（左 groups/entries 檔案樹 + 右詳情欄），右詳情欄寬度有限，revision 時間線
（gate 編輯器 + patch 欄位 + TipTap）inline 塞入必爆。

**定案：revision 編輯不進右側詳情欄，開獨立 modal。**

1. 右詳情欄只加兩個輕量元素：
   - `entityKey` 單行輸入（一個 ced-field-row，與名稱同規格）
   - 「進度版本 (N)」按鈕——顯示 revision 數量，點擊開 modal
2. Revision 時間線 modal（比照既有 SpriteEditorModal / MediaLibrary 的 modal 慣例）：
   - 左欄：revision 列表（base / r1 / r2…，可增刪排序）
   - 右欄：選中 revision 的 GateConditionEditor + PatchEditor
   - 底部：進度模擬預覽切換（4-4 節的 RevisionSimulator 併入此 modal）
3. TipTap 惰性 mount：只有選中的 revision 才實例化 MiniEditor
   （直接緩解「每 revision 一個 TipTap 實例」的效能風險）
4. browser/chrono 的條目編輯區同樣走此模式——四 stack 共用同一個 modal 骨架，
   PatchEditor 依 stack 動態渲染（4-3 節設計不變，只是容器從 inline 改 modal）

### Sub-session C 開工前定案（2026-07-06，艾斯維爾拍板）

**核心語意變更：嵌入全可點，旗標不卡點擊。**
內容進度一律由 Concepts 條目的 revision 鏈卡控（effective view），嵌入只是導向入口。
本節取代 5-2「isEntityUnlocked = 持有 {entityKey}:* 任一旗標」的設計。

| 議題 | 決議 |
|------|------|
| 嵌入可點守門 | **島掛載才 decorate**——`decorateInteractiveHtml` 的判定從「持有旗標」改為「concepts 島已掛載」（`shouldMountIsland(progress, 'concepts')` 同語意：探索者＋已解鎖＋未停用）。未解鎖／觀測者＝普通文字，避免「可點但點了沒反應」 |
| 未解鎖條目回應 | 內容節奏由劇情推進控制，理論上不會出現「使用者先點到未解鎖名詞」；Terminal 保留 **`access restricted` 作為 fallback**（防資料失誤） |
| 索引端點範圍 | **納入無 entityKey 條目**（name/term-only）——translation 定案不掛 key（S7-B），靠 name 檢索；有 entityKey 的條目才具備深連與更動通知能力 |
| Terminal 顯示深度 | **條目內容直接顯示在 terminal 內**，不做導向頁面的超連結（頂多到列表層沒意義）。dossier / diff 條目的敘述在 terminal 直接查閱（effective view 抽取） |
| 互動範圍 | 互動式嵌入只導向 **dossier（records）與 diff（translation）**；browser 與 chrono 不做嵌入目標，但使用者可在 terminal 獨立查詢（`query` / `ls`） |
| 視覺策略 | 比照 History 島：功能優先，設計稿原型只取語彙參考，視覺驗收時調 |
| 島解鎖入口 | 沿用現成 IslandUnlockObject（zone 首頁小物件）；UnlockRitualGate 通用化仍留白（等整體框架定案） |

**連動效果**：
- `metFlag` / `met:*` 在嵌入判定線完全退役（只停增不刪除，舊旗標無害殘留）
- 觀測者視角無浮島 → 嵌入自然不 decorate，語意一致，不需額外防禦
- 索引端點需含各條目 revision gate 摘要（id + gate，不含 patch 內容）——`ls` 的解鎖計數、
  query 的隱藏過濾、更動通知水位三張嘴共用；條目完整內容按需 fetch 頁面 JSON 後前端以
  revision resolver 抽取（符合 6-1「不持有資料」）

### Sub-session B：已完成（2026-07-06，0.9.12.15 ~ 0.9.12.19）

| Commit | 版號 | 內容 |
|--------|------|------|
| 5ff6b6d | 0.9.12.15 | EntityKeyField：kebab-case 即時校驗 + 唯一性警告，接入四 stack 詳情欄（dossier=同 variant 唯一、其他=同頁唯一）|
| d144760 | 0.9.12.16 | RevisionModal：時間線左欄（增刪/上下移）+ GateConditionEditor 接線 + base 虛擬項說明 + 預設 id 走旗標慣例 |
| c05e4b3 | 0.9.12.17 | PatchEditor：set 欄位八型值編輯器 + remove 路徑列表 + 自訂 dot-notation 欄位；MiniEditor 抽出獨立檔 |
| 9ad5283 | 0.9.12.18 | RevisionSimulator：旗標 chips + 觀測者切換 + 亂序警告 + effective view JSON（modal 底部切換）|
| be058a9 | 0.9.12.19 | generate/apply-entity-keys.mjs 遷移腳本（候選產生 → 人工確認 → 批次寫入，本地實掃 13 頁 59 候選）|
| c3fbd14 | （fix） | MiniEditor 切換條目內容殘留（既有 bug）——call site 補 key 強制 remount + 回歸測試 |

驗證：`pnpm check` 全過；全站 525 測試全綠（uep 476 + workers 49，新增 49 零退化）。

實作備註：
- 清單端點（GET /api/content/:area）不含 metadata——腳本逐頁抓取後判 stack_style
- 已知殘留：browser 區段同角色內拖曳排序仍用位置型 key（section 無穩定 id）
- 手動驗收待做：Admin 實際設 entityKey + revision 存檔 → Reader 前台驗證（連同 A 段一起）

*文件結束。*
