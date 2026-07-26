# S10-1 設計文件：跨區互聯（entityKey / storyKey 命名空間 + 反向索引）

> 起草基準：0.9.15.0（feature/epic2-progress-foundation，S10-0 小地圖歸位已完成待驗收）
> 範疇：S10-1「浮島在 History 以外的交互」——第二套 key 命名空間、全站唯一性把關、
> History 三種標記的反向索引、storyKey 吃掉 illustrationId、觸發模型（不動渲染管線）、
> 便條擴充。編輯 UI（S10-3）不在本文件範圍，僅預留資料欄位。
> 作者：奈留 × 奈也（架構師）
> 日期：2026-07-26（初稿）／2026-07-26 二輪修訂——艾斯維爾就 §10（原待決點）四項全數回覆後更新：
> storyKey 改選填、劇情歌收藏旗標全面改看 storyKey（`song:{songId}` 判斷資格收回）、
> 新增 §8 json_extract SQL 端防禦補強、01-06 clue 同步不再追蹤。

---

## 0. 定案彙整（艾斯維爾 2026-07-26，本文件的邊界條件）

| 項目 | 定案 |
|---|---|
| 第二套命名空間 | `storyKey` — Echoes 劇情歌／Visuals 插圖／History echo spot·visual clue 共用 |
| illustrationId | **被 storyKey 吃掉**，非並存（諾薇亞方案已否決） |
| 一個劇情點 | 可同時掛一首歌 + 一張插圖（共享 ID 的初衷） |
| History 錨點 | 劇情點盡量單錨點，但**允許多個**；多個時列多條，**不加 main flag** |
| 劇情點標題／說明 | 可以有，欄位留在 S10-1，**編輯介面屬 S10-3** |
| 註冊制 | 自動註冊 + 擋重複（存檔時掃出 key 寫索引，撞名擋存檔），entityKey 一併補上同等把關 |
| entityKey/storyKey 唯一性 | Concepts＝每個 stack 內一次；Echoes/Visuals/History＝每個區塊內一個實例；跨 zone 完全允許 |
| 反向索引 | 一張表吃掉 echo spot / visual clue / entity mark 三種標記，History 頁存檔時重建 |
| 索引設計基準 | **必須同時撐住 S10-1（查 key→錨點）與 S10-3（查 key→用在哪，含編輯管理）** |
| 渲染管線 | **不動**——`renderInteractiveHtml` 不推廣到其他 Reader，其餘四 Reader 仍走 `renderHtmlWithUep` |
| 觸發模型 | Echoes/Visuals 進頁自動發事件；Concepts 條目旁掛按鈕手動發；History 島以「書籤區覆蓋」呈現，接 `ISLAND_RELATED_EVENT` |
| 便條擴充 | entity 拖入＝純文字快速填入（不存 ref）；新增地點／時間兩個逐張快照小標，**必須展開才能接拖曳** |
| Echoes 分類 | 改唯讀，cluster 為唯一來源（**已驗證零轉換成本**，見 §1-4） |

---

## 1. 現況接點（已查證）

### 1-1 key 格式與現有 embed 系統

`apps/uep/src/embed/marks.ts` 是 entity/cue 標記的唯一格式定義來源：

- `ENTITY_KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/`（kebab-case）——本文件的 storyKey **沿用同一 pattern**，理由與替代方案見 §2-1
- `entity:{entityKey}` 是 S7-C 引入的新格式 ref 前綴，`parseEntityRef()` 統一新舊格式解析出口
- `EntityKeyField.tsx` 是**唯一**的 key 輸入元件，`collectEntityKeyIssues()` 是存檔前硬驗證，**但只驗到「單頁 / 單 variant」**，不是「單 stack」——這是 S10-1 明確要補的缺口（見 §3）

### 1-2 History 三種標記現況（皆單向，無法反查）

| 標記 | TipTap Node | 屬性摘要 | 目前指向 |
|---|---|---|---|
| entity mark | `embed/marks.ts` 的 mark（非獨立 Node） | `data-uep-entity`、`data-ref` | Concepts entityKey（`entity:{key}`）或舊格式路徑 |
| echo spot | `EchoSpotNode.ts` | `spotId`／`songId`／`songUrlKey`／`entityKey?`／`songType?` 等 | Echoes 歌曲頁（`songId` 為主鍵，`entityKey` 是角色/區域歌才有的附屬欄位） |
| visual clue | `VisualClueNode.ts` | `clueId`／`edge`／`targetType: 'entity'\|'illustration'`／`targetKey`／`galleryId?` | Visuals gallery（`targetType='entity'` 走 entityKey 反查、`'illustration'` 走 illustrationId 反查） |

三者都在**存檔時**做過**單頁內**的完整性檢查（`collectEchoSpotIssues`／`collectVisualClueIssues`），但完全不知道「這個 key 在其他頁面／其他 zone 也被用到」。

### 1-3 illustrationId 現況

只存在於 Visuals gallery 頁（`page_type='gallery'`）的 `metadata.illustrationId`，**限「鑲框室」（illustrations）分館**顯示欄位（`VisualsEditorBody.tsx` 的 `showIllustrationId`，與「陳列走廊」profiles 分館的 `entityKey` 欄位**互斥顯示**，同一頁只會有其中一個）。`VisualClueNode` 的 `targetType='illustration'` 分支即指向此欄位。

### 1-4 Echoes 分類 vs cluster（一併修的前提）

`EchoSongPicker.tsx:64-76` 目前 `category || 依 clusterId 推導`，要反轉為 cluster 唯一來源。**已實測**：正式 D1 全站 107 首歌，category 與 cluster 推導值 **100% 吻合、零衝突**（areas/area 30、characters/character 16、special/special 51、stories/story 10）。**S10-1 這部分是純白工改動，不需要轉換規則**——只需把 `EchoSongPicker.tsx` 的判斷順序反轉、`EchoesEditorBody.tsx` 的分類下拉改唯讀展示。

### 1-5 現有跨 zone 索引端點（live-scan 模式，非持久化表）

`concepts-index.ts` / `echoes-index.ts` / `visuals-index.ts` 是三個**存在性驗證**用的 live-scan 建構器：每次呼叫都掃全表、逐列 `try/catch` 解析 metadata JSON（S8 驗收 #2 教訓：json_extract 掃全表遇壞 JSON 會炸整條 SELECT，因此**只在 SQL 篩穩定欄位，JSON 解析放應用層**）。三者目前只回傳 entityKey 摘要，不含 storyKey，也不做唯一性比對——單純的「這個 key 存不存在」查詢。

### 1-6 反向廣播的既有契約（S6 先定契約，S8 首個生產者，零消費者）

`islands/types.ts` 的 `ISLAND_RELATED_EVENT` / `IslandRelatedDetail`：來源端 dispatch（`sourceZone` + `historyPageIds[]` + `label`），History 島「動態展示對應章節」。**唯一生產者**是 `islands/visuals/phantomBridge.ts:pushPhantomGallery()`（映照/嵌入/clue 展示時廣播），**至今零消費者**。History 島的續讀區塊（`HistoryIsland.tsx` 「回到上次的位置」按鈕，約 L166-175）是本次要疊加覆蓋層的掛點。

### 1-7 便條資料模型現況

`progress/types.ts` 的 `StorageNote`（`{id, text, tilt, createdAt, updatedAt}`），cap 常數 `STORAGE_NOTE_MAX=30`／`STORAGE_NOTE_TEXT_MAX=200` 在 `progressStore.ts:423` 與 `adapters.ts:117-118` 兩處強制。`StorageIsland.tsx` 的「當前位置條」已經是 `zone + pageLabel`（**不是 pageTrail**，pageTrail 陣列只用於 tooltip 的完整階層展示，不落地存儲）——這正是 S10-1「地點快照」要複用的既有模式，零發明。

---

## 2. Key 模型設計

### 2-1 storyKey 是否共用 `ENTITY_KEY_PATTERN`

**決策：共用同一個 pattern，不新開 `STORY_KEY_PATTERN`。**

- 奈也：兩種 key 的「長相」使用者體感應該一致——都是簡短好記的 kebab-case 短語，分開定義只會讓編輯器兩套輸入元件的錯誤文案不一致，徒增困惑。
- 奈留：格式驗證與**命名空間**（namespace）是兩件事，不該混在一起管。`ENTITY_KEY_PATTERN` 只驗「合不合法」，不驗「屬於哪個空間」——後者由**呼叫端傳入的 `keyType` 參數**決定（見 §3），不需要靠正則本身區分。若兩者格式不同，`EntityKeyField` 元件（S10-1 沿用它承載 storyKey 輸入）就要接受兩種 pattern，元件複雜度不必要地增加。

**替代方案（否決）**：`STORY_KEY_PATTERN` 獨立正則、甚至要求 storyKey 帶固定前綴（如 `story-xxx`）以肉眼區分。否決理由：前綴污染使用者輸入的語意（「rain-sea-finale」讀起來就是一個劇情點名稱，加前綴變成「story-rain-sea-finale」反而累贅），且 S10-1 的 key 是否互相碰撞由**顯式的 keyType 欄位**把關（見下），不需要靠字串外觀分辨。

### 2-2 entityKey 與 storyKey 是否互相禁止撞名

**決策：允許重疊，不強制互斥。**

兩者在系統中永遠是**顯式攜帶 keyType** 出現的（`VisualClueNode.targetType`、`EchoSpotNode` 分成 `entityKey`/`storyKey` 兩個獨立欄位、embed ref 的 `entity:` 前綴），任何一次查詢都已知道自己要找哪個命名空間，不存在「拿到一個字串不知道是哪種」的情境。因此技術上沒有必須互斥的理由。

若要求互斥，代價是：每次寫入 entityKey 都要多查一次「storyKey 有沒有人用過同名」，反之亦然——兩個原本獨立的驗證管線被迫耦合，且沒有對應的產品收益。**不強制互斥**，但編輯器提示文案上會建議設計者避免刻意撞名（純 UX 建議，非硬規則）。

### 2-3 storyKey 的產生時機、選填語意與降級行為（2026-07-26 二輪定案修訂）

**決策（艾斯維爾 2026-07-26 二輪定案）：storyKey 全面選填，不做必填驗證。** 原話：「劇情 key 是選填的，但基本上也只有有填 key 才能被對應/解鎖」——未填 key 不影響頁面存檔，但會讓該內容**無法被互聯反查、也無法被對應解鎖**，這是自然的功能降級，不需要編輯器阻擋存檔。

| 掛點 | 欄位位置 | 選填 | 未填時的行為 |
|---|---|---|---|
| Echoes 劇情歌 | 歌曲頁 `metadata.storyKey`（取代該分類下原本可誤填的 `entityKey`） | 選填 | 仍可透過 Echo Spot 插播聆聽（播放只依賴 `songId`/`songUrlKey`，與 storyKey 無關）；但**無法產生收藏旗標**（見 §2-3-a），永遠不進收藏池，也不會出現在反向索引裡 |
| Visuals 插圖 | gallery 頁 `metadata.storyKey`（**直接取代** `metadata.illustrationId` 欄位名） | 選填（沿舊 illustrationId 語意不變） | 無法被 History visual clue 指向（既有行為，未變） |
| History echo spot | `EchoSpotNode.storyKey`（`songType==='story'` 時使用） | 選填，隨對應歌曲是否有 storyKey 而定 | 對應歌曲沒有 storyKey 時，Picker 沒有值可帶入，欄位留空；該 spot 不產生反向索引列（§4-2） |
| History visual clue | `VisualClueNode.targetKey`（`targetType` 由 `'illustration'` 改名 `'story'`） | **clue 本身仍必須指向某個目標** | 這是「clue 必須指向某個東西」的既有規則，與「目標 gallery 是否設定了 storyKey」是兩件事——Picker 只列出**已設定 storyKey** 的 gallery 供選擇，未設定的 gallery 本來就不在候選清單裡（沿既有 illustrationId 行為） |

**編輯器提示（軟性，不阻擋存檔）**：`EchoesEditorBody.tsx` 分類為 `story` 時，`storyKey` 欄位旁沿用 `illustrationId` 現有的 hint 文案風格新增提示：「未設定 storyKey 的劇情歌只能透過 Echo Spot 插播聆聽，無法進入收藏池、也無法與插圖互聯」。純提示，不做必填驗證。

#### 2-3-a 收藏解鎖旗標改用 storyKey（2026-07-26 二輪定案，取代原「不變量」設計）

**決策：劇情歌的收藏旗標命名慣例全面改為看 storyKey，`song:{songId}` 不再是判斷依據。**

- 有 storyKey 的劇情歌：解鎖旗標為 `{storyKey}:song`——與非劇情歌的 `{entityKey}:song` 命名慣例統一，全站只剩一套「`{key}:song`」規則，不再有 `song:{songId}` 這條獨立分支
- **沒有 storyKey 的劇情歌：無法產生解鎖旗標**——`deriveSongUnlockFlag()` 對這種情況回傳 `null`，呼叫端見 `null` 就不執行 `grantFlags`，`isSongCollected` 也永遠評估為 `false`。這首歌仍可被 Echo Spot 插播（播放路徑不依賴旗標），但**永遠不會進入收藏池**，每次都只能透過 spot 現場插播聆聽，不會出現在 Echoes 已收藏列表或 EchoesIsland 佇列裡

這是艾斯維爾原話「只有有填 key 才能被對應/解鎖」的直接落地。

`deriveSongUnlockFlag` 簽名調整：

```typescript
// 原：deriveSongUnlockFlag(songId: string, entityKey?: string): string
// 新：
function deriveSongUnlockFlag(
  songType: string,
  entityKey?: string,
  storyKey?: string
): string | null {
  if (songType === 'story') return storyKey ? `${storyKey}:song` : null;
  return entityKey ? `${entityKey}:song` : null; // character/area，既有邏輯不變
}
```

**為什麼這次能無痛全面改名（一次性視窗，過期即關閉）**：

2026-07-26 實測 `SELECT COUNT(*) FROM uep_users` 於正式 D1 回傳 **0**——正式環境目前**零筆註冊使用者**，代表沒有任何人的 ProgressState 裡存在需要保護的 `song:{songId}` 旗標。這次改名**不需要**補授予腳本、不需要雙寫、不需要任何遷移，單純改程式碼裡的命名規則即可。

⚠️ **這個視窗是一次性的，寫給未來的人看**：一旦有真實使用者註冊並透過 `{key}:song` 累積了解鎖旗標，未來任何類似的「改旗標命名慣例」都**不能再用這次的做法**（單純改名），而必須：

1. 新命名與舊命名**雙寫**（`grantFlags` 同時授予新舊兩個旗標字串）
2. 讀取判定（`isSongCollected` 等）**同時接受新舊兩種格式**，逐步淘汰
3. 或者寫一次性的「舊旗標→新旗標」補授予腳本，掃描每個帳號的 `flags[]` 補上新格式旗標，保留舊格式（不能刪除，避免其他仍在讀舊格式的路徑失效）

這次之所以可以跳過以上三步，純粹是因為**改動發生在正式環境還沒有真實使用者的階段**——這個視窗一旦關閉（有人註冊），就永久關閉。

### 2-4 劇情點標題／說明欄位放哪

**決策：新增一張獨立小表 `story_points`，不掛在任何單一定義頁的 metadata 上。**

```sql
CREATE TABLE IF NOT EXISTS story_points (
  story_key   TEXT PRIMARY KEY,
  title       TEXT,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
```

- 奈也：劇情點的標題其實是「這個故事片刻叫什麼」，比較像獨立的小卡片資料，不屬於某一首歌或某一張圖——掛在任一邊都會有「另一邊沒有這個資訊」的尷尬。
- 奈留：技術上更關鍵的理由——劇情點的三個可能掛點（歌、插圖、History 錨點）**沒有一個是必然存在的定義頁**。歌曲和插圖都是選填的（可能只掛歌不掛圖、只掛圖不掛歌），甚至理論上一個 storyKey 可能先出現在 History 的 echo spot / visual clue 裡，稍後才補歌或補圖。若標題掛在「歌曲頁 metadata」，沒有歌曲的劇情點就沒有地方放標題。獨立表格用 `story_key` 作為身分錨點，與任何一邊掛不掛內容無關。

**寫入時機（S10-1 只建表，不做編輯 UI）**：任何寫入路徑第一次遇到某個 storyKey（Echoes 歌曲頁存 storyKey、Visuals gallery 頁存 storyKey、History echo spot/visual clue 存 storyKey）都執行 `INSERT OR IGNORE INTO story_points (story_key, title, description, created_at, updated_at) VALUES (?, NULL, NULL, ?, ?)`——確保 S10-3 要做編輯 UI 時，這張表已經有殼可以 `UPDATE`，不需要另外設計「首次建檔」邏輯。`title`/`description` 在 S10-1 全程是 `NULL`，沒有任何讀取端消費它們。

**替代方案（否決）**：
1. 掛在歌曲頁或插圖頁 metadata——上述「不是必然存在」問題無法解。
2. 掛在 History echo spot / visual clue 的 Node 屬性裡——同一個 storyKey 若有多個 History 錨點（定案允許），標題會分散在多個 Node 上，寫入時要跨錨點同步，且 Node 屬性本質是「插入當下的快照」語意（如 `title`/`imageTitle` 皆是），不適合承載跨頁面的權威資料。

### 2-5 `VisualClueNode.targetType` 的演化

**決策：`'entity' | 'illustration'` → `'entity' | 'story'`，二分結構不變，只改第二個值的名稱與語意來源。**

理由：`targetType` 的職責從一開始就是「這個 clue 要去哪個命名空間找 targetKey」，這個職責在 storyKey 引入後**完全沒變**——只是「插圖」這個命名空間本身被改名成「劇情點」。不需要三分（`'entity' | 'illustration' | 'story'`）保留舊值做過渡，理由見 §5（遷移成本趨近於零，直接切換比留相容分支乾淨）。

`collectVisualClueIssues()` 中所有 `targetType === 'illustration'` 的判斷（gate 一致性檢查等）原樣改字串即可，邏輯完全不變——這是本次遷移中風險最低的一塊。

### 2-6 EchoSpotNode 屬性演化

現有 `entityKey?: string` 單一選填屬性（語意含糊：可以是角色/區域歌的實體識別碼，也可能被誤填在劇情歌上）拆成兩個**由 `songType` 決定互斥使用**的屬性：

```typescript
export interface EchoSpotAttributes {
  spotId: string;
  songId: string;
  songUrlKey: string;
  entityKey?: string;   // songType === 'character' | 'area' 時使用
  storyKey?: string;    // songType === 'story' 時使用（新增）
  title?: string;
  clusterId?: string;
  songType?: string;
  duration?: number;
  spoilerLevel?: number;
  spoilerRevisions?: unknown[];
}
```

Song Picker 選中歌曲時依 `songType` 自動決定寫哪一格（既有邏輯：Picker 已經知道 songType，只是分流輸出屬性，不新增判斷分支）。

---

## 3. 全站唯一性把關機制

### 3-1 為什麼不做「集中式 key registry 表」

考慮過的方案：建一張 `interlink_keys(key_type, key_value, scope, page_id, ...)` 表，作為唯一性判斷的**權威資料**，每次頁面存檔時同步寫入/刪除對應列，唯一性查詢改成查這張表而非掃 `pages`。

**否決**，理由（奈留主導）：

1. **多一份需要保持同步的衍生資料 = 多一種資料飄移風險**。若某次寫入路徑忘記同步這張表（例如未來新增第三種定義 key 的地方、或既有寫入路徑被重構時漏改），這張表會悄悄與 `pages.metadata` 的實際內容脫節，且**沒有自我修復機制**——不像 `concepts-index.ts` 這類 live-scan 建構器，每次呼叫都直接讀 `pages` 現況，天生不會過期。
2. 現有的三個 entity-index 建構器（§1-5）已經證明 live-scan 模式在目前的資料規模下（concepts 20 頁、echoes 142 頁、visuals 26 頁）效能可接受，且已有處理壞 JSON 的成熟寫法可以直接複用。
3. S8 驗收 #2 的教訓明確指向「**讀時**用 live-scan + 應用層容錯」是這個專案已驗證過的安全模式；新增一張需要**寫時同步**的表，反而引入了 S8 教訓沒有觸及過的全新風險類別。

**決策：唯一性檢查在存檔當下做「即時 live-scan」，不落地成獨立表。**

擴充 `echoes-index.ts` / `visuals-index.ts`，讓它們的回傳型別多帶 `storyKey?: string`（與 `entityKey` 平行的欄位，沿用同一套壞 JSON 容錯邏輯）。新增 `workers/content-api/src/interlink.ts`：

```typescript
/** 唯一性衝突檢查的請求形狀 */
export interface KeyConflictQuery {
  keyType: 'entity' | 'story';
  keyValue: string;
  area: 'concepts' | 'echoes' | 'visuals';
  /** Concepts 用：'dossier:{variantId}' | 'browser:{pageId}' | 'chrono:{pageId}' | 'diff:{pageId}'
   *  Echoes/Visuals 用：固定 'zone'（整個區塊一個實例，見定案表） */
  scope: string;
  /** 排除自身（更新既有頁面時，同一個 key 出現在自己身上不算衝突） */
  excludePageId: string;
}

/** 回傳 null = 無衝突；否則帶出衝突方的頁面資訊供錯誤訊息使用 */
export async function findKeyConflict(
  db: D1Database,
  query: KeyConflictQuery
): Promise<{ pageId: string; pageTitle: string } | null>;
```

`findKeyConflict` 內部依 `area` 分派：Concepts 呼叫 `buildConceptsEntityIndex(db)`（既有函式，全表 live-scan）過濾 `stack+scope` 相符者；Echoes/Visuals 呼叫擴充後的 `buildEchoesEntityIndex`/`buildVisualsEntityIndex` 過濾 `keyType` 相符者。**不新增 SQL 層級的 json_extract 過濾**，維持「SQL 只篩穩定欄位，JSON 解析在應用層」的既有安全模式。

### 3-2 寫入路徑的擋重複掛點

`upsertPage()`（`workers/content-api/src/index.ts:286`）目前是**單一函式處理所有 area 的通用 upsert**，沒有 area 專屬的前置驗證關卡。S10-1 在此函式**寫入 DB 之前**插入一段：

```
if area in ('concepts', 'echoes', 'visuals'):
    candidateKeys = extractCandidateKeys(area, body)   // 見下
    for each candidate in candidateKeys:
        conflict = await findKeyConflict(db, { ...candidate, excludePageId: id })
        if conflict: return 409 with { field, key, conflictingPageId, conflictingPageTitle }
    proceed to existing upsert logic
    // 寫入成功後，若 storyKey 出現，順手 INSERT OR IGNORE INTO story_points（§2-4）
```

`extractCandidateKeys` 依 area 各自實作：
- **Echoes/Visuals**：單頁最多一個 entityKey 或一個 storyKey，直接讀 `body.metadata`
- **Concepts**：一頁可能巢狀出多個 entityKey（`variants[*].subcategories[*].groups[*].entries[*].entityKey` 等四種 stack 形狀）——移植 `EntityKeyField.tsx` 的 `collectEntityKeyIssues()` 遍歷邏輯到 worker 端（前端與後端各自一份遍歷器是**既有慣例**，`concepts-index.ts` 的 `collectFromPage()` 已經是同一套遍歷邏輯的第三份實作——不追求三處共用，因為前端/worker/index 建構器三個執行環境的型別系統與匯入邊界互不相通，是本專案一貫的取捨）

**軟刪除路徑也要接**：頁面軟刪除（`deleted_at` 寫入）目前的處理路徑要一併呼叫等效的「釋放 key」流程——否則已刪除頁面的 key 會繼續佔用命名空間，之後任何人想用同名 key 都會被誤擋。由於唯一性檢查是 live-scan（不是同步表），只要 index 建構器的 SQL 有 `deleted_at IS NULL` 條件（現況已有），**軟刪除後 key 自動從候選集消失，不需要額外程式碼**——這是選擇 live-scan 而非同步表的附帶好處之一。

### 3-3 前端即時提示 vs 後端最終防線

| 層 | 職責 | 資料來源 | 何時擋 |
|---|---|---|---|
| 前端 `EntityKeyField` 即時警告 | 打字當下給視覺提示，不阻擋輸入 | 呼叫端傳入的 `existingKeys: Set<string>` | 從不擋——純提示 |
| 前端存檔前警告 | 阻擋送出（`collectEntityKeyIssues` 等） | 同上 `existingKeys` | 送出前 |
| **後端 409（本文件新增）** | **最終防線，唯一保證資料一致性的關卡** | `findKeyConflict` 即時 live-scan | 寫入前 |

**§3 要補的實際缺口**——`EntityKeyField.tsx` 的 `existingKeys` 目前由呼叫端（各 EditorBody）自行組裝，Concepts 端**只組裝了同頁面/同 variant 的 key**，沒有把其他頁面的同 stack key 一併算入。修法**不需要新端點**：`GET /api/concepts/entity-index` 既有回應已經帶 `stack` + `variantId`/`pageId`，前端只要把「排除自身頁面後、依 `(stack, variantId 或 pageId)` 過濾」的邏輯做對，`existingKeys` 就能正確涵蓋跨頁同 stack 的既有 key。這是**純前端修正**，且與後端 409 是獨立的兩道防線——前端修正讓使用者在存檔前就看到警告（體驗），後端 409 保證即使前端邏輯有漏洞也不會真的寫入衝突資料（正確性）。

Echoes/Visuals 兩邊的 `existingKeys` 組裝方式**已經是正確的**（`otherEntityKeys`/`otherKeys` 皆從對應 zone 的 entity-index 端點取得整個 zone 範圍的既有 key），S10-1 只需要把這兩個端點的回應**多帶 storyKey 欄位**，前端據此多組一份 `otherStoryKeys` Set 即可，UI 邏輯零改動。

---

## 4. 反向索引表 schema（History 三種標記）

### 4-1 範疇界定：這張表只管 History 的三種標記，不吃唯一性判斷

呼應 §3-1 的取捨：唯一性判斷是**讀時 live-scan**（掃 Concepts/Echoes/Visuals 的定義頁），這裡要做的**反向索引**是完全不同的問題——「給我某個 key 的所有 History 錨點」這件事**沒有 live-scan 的等價解法**，因為 History 的三種標記埋在 TipTap 序列化後的 HTML 字串裡（`content` 欄位的 JSON blocks 中夾雜 `<div data-role="echo-spot" ...>` 等），要找出「所有提到某個 storyKey 的 History 段落」，若不建索引就得**每次查詢時把全站 History 內容抓下來做字串/DOM 掃描**——這正是題目原文指定「做一張反向索引吃掉三種標記」的根本原因，也是本文件與 §3 採不同解法的分界點。

### 4-2 Schema

```sql
CREATE TABLE IF NOT EXISTS history_interlink_index (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  page_id     TEXT NOT NULL,          -- History 文章頁 id（重建索引的粒度單位）
  anchor_kind TEXT NOT NULL CHECK (anchor_kind IN (
                'entity-mark', 'echo-spot',
                'visual-clue-start', 'visual-clue-gate', 'visual-clue-end'
              )),
  anchor_id   TEXT,                   -- echoSpot.spotId / visualClue.clueId；entity-mark 無穩定 id，NULL
  key_type    TEXT NOT NULL CHECK (key_type IN ('entity', 'story')),
  key_value   TEXT NOT NULL,
  label       TEXT,                   -- 顯示快照（歌名／圖說／entity 顯示文字），過期只影響顯示不影響查找
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_hii_key  ON history_interlink_index(key_type, key_value);
CREATE INDEX IF NOT EXISTS idx_hii_page ON history_interlink_index(page_id);
```

**欄位對應三種標記**：

| 標記 | anchor_kind | anchor_id | key_type/key_value 來源 |
|---|---|---|---|
| entity mark | `entity-mark` | `NULL`（span 無穩定 id） | 只收 **新格式** `entity:{entityKey}` ref（`parseEntityRef` 回傳 `type==='entity-key'`）；舊格式路徑 ref（`{area}/{slug}#entry:{id}`）是 S7-C 前的過渡格式，**不進反向索引**——它本來就不是 key-based 系統的一部分 |
| echo spot | `echo-spot` | `spotId` | `entityKey` 或 `storyKey`（依 `songType` 二擇一，皆有值才進索引；storyKey 未填的劇情歌 spot 不產生索引列，見 §2-3） |
| visual clue | `visual-clue-start` / `-gate` / `-end` | `clueId` | `targetType`（`'entity'`→entity、`'story'`→story）+ `targetKey` |

**同頁多次提及同一 entityKey 的去重**：entity mark 沒有穩定 id，同一篇文章提到「艾斯維爾」十次不該產生十筆索引列。重建時對 entity-mark 類型以 `(page_id, key_type, key_value)` 去重，只留一筆（`label` 取第一次出現的文字快照）。echo spot / visual clue 因為有 `spotId`/`clueId` 保證同文件內唯一（`collectEchoSpotIssues`/`collectVisualClueIssues` 已在 History 編輯器存檔前擋掉重複 id），天然不需要去重。

### 4-3 寫入時機與冪等性

掛在 History 頁的 `upsertPage()` 路徑（`area === 'history'` 分支）：內容寫入成功後，**同一個請求內**：

```
1. 解析剛寫入的 body.content，跑一次「三種標記掃描」（複用 History 編輯器
   既有的 collectEchoSpotIssues / collectVisualClueIssues 同款遍歷邏輯的
   worker 端版本，輸出改成「收集」而非「驗證」）
2. db.batch([
     DELETE FROM history_interlink_index WHERE page_id = ?,
     ...INSERT 新掃描出的每一列
   ])
```

`db.batch()` 是既有慣例（`upsertPage` 內 `reindexChildren` 已用同樣手法做 sort_order 重排，見 `index.ts:408-415`），保證 DELETE+INSERT 在同一個隱含交易內完成，不會出現「刪了但插入失敗」的半殘狀態。**每次存檔整頁重建**（而非逐條 diff）——History 頁面通常標記數量是個位數到十幾個，全量重建的成本遠低於維護 diff 邏輯的複雜度，且天然冪等：同一份內容重複存檔會產生完全相同的索引列。

**軟刪除 / 頁面刪除**：需要在 History 頁的軟刪除路徑同樣執行 `DELETE FROM history_interlink_index WHERE page_id = ?`，否則已刪除文章的錨點會繼續出現在反查結果裡，誤導使用者點進不存在的頁面。

### 4-4 孤兒錨點的容錯

反向索引**不驗證引用的 key 是否真的在 Concepts/Echoes/Visuals 有對應定義**——這是刻意設計，不是遺漏：

- History 編輯者可能先寫好 echo spot／visual clue 引用一個「還沒有歌/還沒有插圖」的 storyKey（§2-4 已說明劇情點的三個掛點皆非必然存在），此時索引仍應正確記錄這個錨點，等歌曲/插圖之後補上時，`story_points` 表與反向索引已經就位，不需要回頭補資料
- 前台實際觸發時（島展示、觸發按鈕查詢）走**即時反查**現行資料（`/api/echoes/entity-song`、`/api/visuals/gallery`），這層本來就有「找不到就靜默忽略」的既有容錯（沿 `refreshEchoSpot`/`fetchClueGallery` 定案），反向索引的查詢結果只是「有哪些 History 頁提到這個 key」的**線索清單**，不代表這些頁面上的觸發**現在**一定能成功
- 反向索引表本身**沒有外鍵約束**指向任何定義頁，`page_id` 對應的 History 頁若被刪除，由 §4-3 的軟刪除清理負責；`key_value` 對應的定義頁若被刪除或改名，索引列會變成「有錨點但查不到內容」的孤兒——這與現有 `VisualClueBookmarks` 的孤兒容錯是同一個問題等級，不需要額外機制

### 4-5 查詢端點設計

**S10-1 用（觸發模型消費）**：

```
GET /api/interlink/anchors?keyType={entity|story}&key={value}

回應：
{
  ok: true,
  data: {
    anchors: {
      pageId: string;
      pageTitle: string;
      anchorKind: 'entity-mark' | 'echo-spot' | 'visual-clue-start' | 'visual-clue-gate' | 'visual-clue-end';
      label: string | null;
    }[]
  }
}
```

Echoes 歌曲頁 / Visuals gallery 頁進頁時、Concepts 條目觸發按鈕按下時呼叫此端點，取得的 `pageId`（去重）交給 `ISLAND_RELATED_EVENT` 的 `historyPageIds`。SQL 直接 `SELECT DISTINCT page_id, ... WHERE key_type = ? AND key_value = ?`，走 `idx_hii_key` 索引，效能無虞。

**S10-3 預留（反查管理 UI 用）**：

```
GET /api/interlink/usage?keyType={entity|story}&key={value}

回應：
{
  ok: true,
  data: {
    definitions: {           // 定義端（live-scan 現查，見 §3-1）
      area: 'concepts' | 'echoes' | 'visuals';
      pageId: string;
      pageTitle: string;
      scope: string;         // Concepts 才有意義，其餘固定 'zone'
    }[];
    anchors: HistoryAnchor[]; // 錨點端（讀 history_interlink_index，同 §4-5 上半）
    storyPoint?: { title: string | null; description: string | null }; // 僅 keyType='story'
  }
}
```

這個端點是 §4-2 提到「同時撐住 S10-1 與 S10-3」的具體落地：**定義端**現查（複用 §3-1 的 `findKeyConflict` 同款 index 建構器，只是這裡不比對衝突、單純列出）、**錨點端**讀持久化表，兩路資料在同一個 handler 內組裝，S10-3 做編輯 UI 時只需要在既有的 `story_points` UPDATE 之外，直接消費這個端點作為「用在哪裡」清單，不需要重新設計查詢路徑。

### 4-6 為什麼不讓 §3 的唯一性檢查也讀這張表

刻意分開：`history_interlink_index` 記錄的是「錨點」（reference），語意上 History 對 storyKey/entityKey **從不是定義者、永遠是引用者**——即使 §2-4 允許 storyKey 先在 History 出現、後補歌/圖，History 端仍然只是「提到了」而非「定義了」這個 key。§3 的唯一性規則（「每個區塊內一個實例」）管的是**定義端**互撞，兩者天然是不同的資料集合，混在一張表裡反而需要額外的 `role` 欄位去區分「這行是定義還是引用」，徒增複雜度而無實益。

---

## 5. storyKey 吃掉 illustrationId 的遷移策略

### 5-1 現況盤點（已實測，見 notebook「S10-1 開工前資料盤點」）

- 正式 D1：13 個 gallery，`illustrationId` **全部 null**
- 測試 D1：**1 筆** `visuals/illustrations/era_u/測試畫廊` → `illustrationId = "test-id"`
- 對應的 History visual clue：正式 D1 **0 筆**，本地/測試環境各有零星測試資料

### 5-2 決策：直接斷開，不留向後相容 read path

**不做**「`targetType` 三態相容（`'entity'|'illustration'|'story'`，讀到舊值時當 `'story'` 處理）」或「`metadata.illustrationId` 保留讀取 fallback」這類相容分支。

理由：

1. **成本-效益嚴重不對稱**。全站僅 1 筆真實資料受影響，且落在測試環境（本來就是拋棄式資料，可重建）。維持相容分支的程式碼要**永久**留在程式庫裡（`targetType` 判斷邏輯此後所有地方都要多處理一種情況、`VisualsGalleryPicker.tsx` 讀取欄位要判斷兩種來源），為了保護一筆測試資料付出的是無限期的認知負擔。
2. 這正是艾斯維爾在 S10 定案時否決「illustrationId 與 storyKey 並存」的同一個理由的延伸——並存已經被否決，若改用「單向相容讀取」換皮，本質上是同一種「兩條路同時活著」的設計，只是把並存的位置從「寫入」搬到「讀取」，風險性質不變。
3. 若未來（假設性）真的需要遷移大量既有資料，一次性腳本（見 §5-3）本來就是可重複執行的工具，不需要靠「維持相容分支」來緩解——相容分支解決的是「來不及遷移」的問題，而這裡的資料量小到可以**立即**遷移完畢，沒有「來不及」的情境。

### 5-3 落地步驟

1. **Migration**：新增 `0022_interlink_index.sql`，包含 §4-2 的 `history_interlink_index` 表與 §2-4 的 `story_points` 表（兩張表一起在同一個 migration 中新增，減少 migration 檔案數）。**不需要**針對 `illustrationId` 欄位本身的 schema migration——它一直是 `metadata` JSON 裡的自由欄位，不是實體 column，改名只是應用層的讀寫欄位名稱變更。
2. **一次性資料腳本**（`scripts/archive/`，任務完成後歸檔，比照專案既有慣例）：
   - 掃描 `area='visuals' AND page_type='gallery'` 且 `metadata.illustrationId` 存在的頁面，寫入 `metadata.storyKey = metadata.illustrationId`、刪除 `metadata.illustrationId` 鍵
   - 掃描 `area='history'` 內容中 `data-target-type="illustration"` 的 visual clue，取代為 `data-target-type="story"`（`targetKey` 值不變）
   - 涵蓋正式 + 測試兩個 D1（測試 D1 那 1 筆也一併轉，而非重建——轉換腳本本身就是最簡單的「重建」方式）
3. **程式碼變更**（與遷移腳本同一批次落地，避免資料格式與程式碼認知的欄位名稱不同步的空窗期）：
   - `VisualClueNode.ts`：`targetType` 型別與 `parseHTML`/`renderHTML` 的 `'illustration'` 字面值改 `'story'`
   - `VisualsEditorBody.tsx`：`illustrationId` 欄位改名 `storyKey`，`EntityKeyField` 的 `label`/`placeholder`/`duplicateMessage` 更新
   - `VisualsGalleryPicker.tsx`：讀取欄位改 `meta.storyKey`，寫入 `targetKey` 改對應
   - `visualClueGallery.ts` 的 `ClueGalleryPayload.illustrationId` 欄位改名，`fetchClueGallery` 的 `targetType==='entity'` 分支不變、非 entity 分支查詢端點與參數名稱同步（`/api/visuals/gallery?illustration=` → `?story=`，後端 Worker 對應路由同步改名）

---

## 6. 觸發模型（不動渲染管線）

### 6-1 三種進入點的事件生產

| Zone | 觸發方式 | 掛點 |
|---|---|---|
| Echoes | 歌曲詳情頁 mount 時自動查詢 | `EchoesReader.tsx`，讀取當頁 metadata 的 `entityKey`／`storyKey`（有其一即查） |
| Visuals | gallery 頁 mount 時自動查詢 | `VisualsReader.tsx`，同上 |
| Concepts | 條目旁新增觸發按鈕，使用者點擊才查詢 | `ConceptsReader.tsx` 各 stack 視圖，僅對有 `entityKey` 的條目顯示按鈕 |

三者共用同一段邏輯（新建 `apps/uep/src/islands/interlinkTrigger.ts`，沿既有 bridge 模組慣例）：

```typescript
/** 查詢反向索引並廣播 ISLAND_RELATED_EVENT；查無結果不廣播（避免空覆蓋層）。 */
export async function triggerHistoryRelated(args: {
  apiBase: string;
  sourceZone: Exclude<IslandId, 'history'>;
  keyType: 'entity' | 'story';
  key: string;
  label: string; // 曲名／gallery 標題／條目名稱
}): Promise<void>;
```

Echoes/Visuals 呼叫時機是 **React `useEffect` mount**，Concepts 呼叫時機是**按鈕 `onClick`**——兩者共用同一個 `triggerHistoryRelated`，差異只在「誰觸發呼叫」，不需要額外分支。

### 6-2 History 島的消費：書籤區覆蓋

`HistoryIsland.tsx` 的續讀區塊（「回到上次的位置」按鈕所在區塊）新增訂閱：

- 訂閱 `ISLAND_RELATED_EVENT`，收到後在該區塊**上方覆蓋**一張卡片：「《{label}》相關的段落：」+ 錨點清單（`pageTitle`，點擊導向對應 History 頁，若有 `anchor_id` 可進一步捲到該標記位置——複用 §4 索引列的 `anchor_id` 對應 §3 便條島已有的 `findNearestAnchor`／`resolveAnchorRect` 同款「定位不到就退化到頁首」容錯鏈，不重新發明）
- **一次只顯示一個**：新事件進來直接取代舊的覆蓋內容（不排隊）
- **消失時機**：使用者主動點掉（關閉鈕）／整頁重整（MPA 天然消失，state 不持久化，不寫 localStorage）／離開頁面。三者對應「不持久化的 React state + 訂閱 cleanup」，不需要額外程式碼處理「離開頁面」——MPA 換頁本來就會 unmount 整個 island bundle

**島未展開時**：不強行展開島（比照 Echo Spot 收合態的既有先例），改為 dock chip 亮框強調——沿用 `setClueWaitingCount`／IslandDock 既有的「pending 數字驅動 chip 閃爍」機制，新增等效的 `setRelatedPendingFlag(zone: IslandId, hasPending: boolean)`（沿 `phantomBridge.ts` 的 window bridge 寫法），History chip 收到後加 highlight class。使用者展開島時消費 pending、渲染覆蓋卡片。

### 6-3 為什麼不需要碰 `renderInteractiveHtml`/`renderHtmlWithUep`

這一整段觸發模型**完全發生在 React 層**（Reader mount / 按鈕 click），不涉及 HTML 內容本身怎麼被渲染成 DOM——`renderInteractiveHtml` 只有 HistoryReader 用，负责把 entity/cue 標記轉成可互動元素；`renderHtmlWithUep` 是其餘四個 Reader 的通用 HTML 渲染，完全不認識這些標記。S10-1 的自動觸發不需要「讓 Echoes/Visuals/Concepts 也認得 entity 標記」，只需要「這一整個頁面本身（不是頁面裡的某段文字）對應哪個 key」，這個資訊來自**頁面 metadata**，不來自 HTML 內容解析——因此渲染管線維持現狀是自洽的，不是妥協。

---

## 7. 便條 schema 擴充

### 7-1 新增欄位

```typescript
/** 便條「地點」小標的快照內容 */
export interface StorageNoteLocationSnapshot {
  /** zone id 字串快照（來源頁面事後可能不存在，不做 IslandId 型別綁定） */
  zone: string;
  /** 來自 Reader 路由發佈的 pageContext.pageLabel（不是 document.title），cap 見下 */
  pageLabel: string;
}

export interface StorageNote {
  id: string;
  text: string;
  tilt: number;
  createdAt: string;
  updatedAt: string;
  /** 逐張小標「地點」，undefined = 使用者未勾選記錄地點 */
  location?: StorageNoteLocationSnapshot;
  /** 逐張小標「時間」，使用者時區 ISO 8601（含時區偏移），undefined = 未勾選 */
  capturedAt?: string;
}

export const STORAGE_NOTE_LOCATION_LABEL_MAX = 60;
```

`normalizeState`（`adapters.ts`）與 `progressStore.ts` 的驗證比照既有 `text` 截斷模式，對 `location.pageLabel` 做 `slice(0, STORAGE_NOTE_LOCATION_LABEL_MAX)`；`location`/`capturedAt` 型別不符直接丟棄該欄位（保留便條本體，只是小標消失，同「錨點失效退化」的容錯哲學，不整條便條作廢）。

**明確不存 `pageTrail`**——沿用 §1-7 已查證的 StorageIsland 既有模式（位置條只顯示 `zone + pageLabel`，`pageTrail` 只在既有 tooltip 用一次就丟），這正是題目提醒的「pageTrail 是不定長陣列可能失控」的迴避方式：**根本不落地存儲**，需要完整階層時（若 S10-3 需要）由 `pageLabel` 反查即時取得，不需要在便條建立當下就把整條麵包屑序列化進去。

### 7-2 位元組帳（128KB 額度）

沿用既有便條的 worst-case 估算方式（UTF-8、CJK 3 bytes/char）：

| 欄位 | worst case |
|---|---|
| 既有欄位（id/text/tilt/createdAt/updatedAt + JSON 結構開銷） | ≈ 720 bytes（現況基準，未變動） |
| `location` 結構開銷（key 名稱 + 巢狀括號） | ≈ 33 bytes |
| `location.zone` 值 | ≈ 10 bytes（如 `"storage"`） |
| `location.pageLabel` 值（cap 60 CJK 字） | ≈ 182 bytes（60 × 3 + 引號） |
| `capturedAt` 欄位（key + ISO 8601 含時區） | ≈ 44 bytes |
| **單則便條 worst case 合計** | **≈ 989 bytes（約 1 KB）** |

× `STORAGE_NOTE_MAX = 30` ≈ **29.7 KB worst case**（新增部分約 8 KB，較現行約 21.6 KB 上升）。

**結論：不調降 `STORAGE_NOTE_MAX`，不需要精簡編碼（短碼查表等）**——單一欄位增量（約 8KB）相對 128KB 總額度是小量佔比，且 `pageLabel` 已有 60 字 cap 做防禦性上界，`zone`／`capturedAt` 天生是短字串。

**殘留風險（誠實揭露，非本次可解）**：128KB 額度是**整個 `ProgressState` blob**，不是 `storageNotes` 專屬——`flags[]`、`pageMarkers{}`（每個造訪過的 History 頁一筆，含 4 個欄位）、`conceptsReadLevel{}` 等欄位會隨使用者進度累積增長，一個「全站完成度很高」的重度使用者（走完全部 44 History 頁、86 個 Concepts 條目、142 首 Echoes 歌）的 blob 實際總大小**目前沒有實測數據**。本次擴充造成的增量（約 8KB）本身風險可控，但這是提醒：**若未來要對 128KB 額度做真正的餘裕評估，需要對「重度使用者」的完整 ProgressState 做一次實測快照**，不是本文件範圍內能回答的問題，列入 §9 風險清單。

### 7-3 entity 拖入不需要 schema 變更

「entity 拖入＝快速填入名稱純文字」直接複用**既有的** `addStorageNote(text)` / `updateStorageNote(id, text)`——拖曳來源（History 互動式嵌入 + 各 zone 條目卡）解析出顯示文字後，呼叫既有 API 建立/更新便條，`text` 欄位裝的就是這段純文字，**不存任何 ref**（符合「不可點」的定案）。唯一新增的是**拖曳觸發的來源端**與**便條島作為拖放目標**的互動邏輯（§7-4），不涉及資料模型。

### 7-4 拖曳互動的架構落點（延續既有 pointer-drag 模式）

沿用便條島既有的拖曳釘選機制（S9 已建立：pointer capture + `DRAG_THRESHOLD` + ghost，非 HTML5 DnD）。S10-1 新增的是**拖曳來源**從「便條本身」擴大到「History 互動式嵌入 span + 各 zone 條目卡」，新增一個 window bridge（沿 `phantomBridge`/`echoSuggestionBridge` 慣例）供拖曳來源與便條島（不同 React root/bundle）溝通：

```typescript
// islands/storage/entityDropBridge.ts（新建，架構草圖）
export function isStorageIslandOpenAndExpanded(): boolean;  // 收合態直接回 false，不接拖曳
export function dropEntityText(displayName: string): boolean; // 成功建立便條回 true（可能因 cap 滿而失敗）
```

「必須展開才能接」在架構上體現為：拖曳來源端在 `pointerup` 時先查 `isStorageIslandOpenAndExpanded()`，收合態直接不呼叫 `dropEntityText`（連 ghost ／連線視覺都不出現，明確拒絕早於使用者放開手指）。「拖曳中顯示連線＋ghost」是既有便條拖曳視覺的延伸，不需要新的資料契約。

---

## 8. 既有 json_extract SQL 端防禦補強（S10-1 一併收斂，艾斯維爾 2026-07-26 二輪定案納入範疇）

盤點筆記標記的三處「未修」防禦性問題，目前無壞資料不會觸發，但屬於 S8 驗收 #2 教訓（json_extract 掃全表遇壞 JSON 會炸整條 SELECT）尚未收斂完的缺口。本次一併處理，修法沿用同一套既有解法：**SQL 只篩結構性欄位（area/page_type/deleted_at 等），JSON 內容判定與壞 JSON 容錯下放到應用層**。

### 8-1 `findEntitySong` / `findEntityGallery`（echoes-song.ts / visuals-gallery.ts）

現況：兩函式的 SQL 直接用 `json_extract(metadata, '$.entityKey') = ?` 與 `COALESCE(json_extract(metadata, '$.hidden'), 0) = 0` 過濾，任何一列 metadata 是壞 JSON 就會讓整條 SELECT 報錯（SQLite 的 `json_extract` 對非法 JSON 拋錯而非回傳 NULL），與 `echoes-index.ts` 等既有建構器刻意避開的地雷完全相同——差別只在於這兩個函式目前**還沒踩過雷**。

修法：

```sql
-- SQL 只篩結構性欄位：
SELECT id, title, metadata FROM pages
WHERE area = 'echoes' AND page_type = 'song' AND deleted_at IS NULL
```

回傳所有候選列後，在應用層逐列 `try { JSON.parse(row.metadata) } catch { continue }`，比對 `(entityKey === key || storyKey === key) && hidden !== true`，命中即提前回傳（不必等迴圈跑完）。`findEntityGallery` 同理，`storyKey` 取代原本只查 `entityKey` 的邏輯（S10-1 新增 storyKey 反查能力，供 §6 觸發模型使用）。

**效能取捨（誠實記錄）**：這把「單筆索引式查詢」變成「掃描整個 area 後在應用層比對」，成本從 SQL 索引查找上升到 O(n) 應用層迴圈。目前 echoes 142 頁／visuals 26 頁的規模下可忽略——既有的 entity-index 建構器已經在做同等規模的全表掃描，且這兩個函式呼叫頻率更高（entity 嵌入點擊、echo spot 反查現行資料，可能每次頁面互動都觸發），是本次取捨中真正的成本，但在目前規模仍在可接受範圍內。若未來 echoes/visuals 頁數大幅成長，屬於獨立的效能優化題目，不阻塞 S10-1。

### 8-2 `concepts-index.ts` 的 `publicOnly` 分支

現況：`buildConceptsEntityIndex` 的 `opts.publicOnly` 分支把 `hidden`/`locked` 判定直接寫進 SQL 的 `WHERE` 子句（`visibleClause`），與同檔案其餘部分「SQL 只篩穩定欄位」的原則不一致——這是該檔案內唯一一處例外。

修法：拿掉 `visibleClause`，SQL 回到只篩 `area = 'concepts' AND deleted_at IS NULL`；`publicOnly` 判定搬進既有的逐列 `try/catch` 迴圈（該迴圈已經在解析 `metadata` 供 `stack` 判斷使用，多加兩個布林條件不需要新的解析成本）：

```typescript
if (opts.publicOnly && (metadata?.hidden === true || metadata?.locked === true)) {
  continue;
}
```

此修法**不改變函式對外行為**（回傳的條目集合完全相同），純粹是把判定時機從「SQL 執行前」搬到「JSON 已安全解析後」，消除壞 JSON 炸整條查詢的風險。

---

## 9. 風險與技術債

| # | 風險 | 影響 | 緩解 |
|---|---|---|---|
| R1 | 未填 storyKey 的劇情歌永久無法被收藏（§2-3-a），內容者可能忘記填而不自知 | 部分劇情歌長期停留在「只能插播、進不了收藏池」的隱性未完成狀態 | 屬於 S10-3 反查 UI 的自然延伸——`/api/interlink/usage` 或簡單過濾擴充後的 `echoes-index` 回應即可拼出「已有音檔但未綁定 storyKey」巡查清單，本次不特別開發，留待 S10-3 或後續小修 |
| R2 | `history_interlink_index` 整頁重建策略在 History 頁標記數量異常多（理論上限不明）時，單次存檔的 batch 操作筆數會等比增加 | 極端情況下存檔延遲增加 | 現行 History 頁標記數量是個位數到十幾個量級，暫不視為阻塞；若未來出現百筆等級的單頁標記，需重新評估 diff-based 更新 |
| R3 | live-scan 唯一性檢查（§3-1）在 Concepts 資料量成長後，每次存檔都要掃全 Concepts 表 | 存檔延遲隨 Concepts 頁數線性增加 | 目前 20 頁量級可忽略；`buildConceptsEntityIndex` 已是既有函式，效能特性已知（Terminal Island 啟動時也會呼叫），沒有引入新的效能特性 |
| R4 | ProgressState blob 總大小缺乏實測基準（§7-2 殘留風險） | 無法量化「還能加多少欄位」的真實餘裕 | 需要一次獨立的重度使用者 blob 實測任務，不在本次範圍 |
| R5 | entity mark 的反向索引去重（§4-2）依賴「同頁同 key 只留一筆」，若編輯器允許同一 entity 在文中以不同顯示文字出現（如「艾斯維爾」與「他」都標記同一 ref），`label` 快照只會留第一次出現的文字 | label 顯示可能與使用者實際看到的某次提及不完全對應 | 純顯示層小瑕疵，不影響查找正確性，不阻塞 |
| R6 | `findKeyConflict` 與 `history_interlink_index` 是兩套完全獨立的機制（§4-6），未來若有人誤以為兩者是同一份資料源，可能寫出錯誤假設的程式碼 | 認知負擔 | 本文件 §4-6 已明確記錄分界理由，實作時對應模組加註解引用本文件章節 |

---

## 10. 二輪定案記錄（原「待決點」，2026-07-26 艾斯維爾已全數回覆）

原始四項待決點已全數由艾斯維爾拍板，記錄如下供追溯；本文件目前**沒有**待拍板的新開放問題（§10-1 的交會處設計為架構師依艾斯維爾原話直接推導，非另一個待決點——理由見下）。

1. **storyKey 是否強制必填** → **選填**。原文「兩條舊路都收掉」讀作「劇情歌不能再誤填 entityKey，但 storyKey 本身仍可留空」——留空的後果是無法互聯、無法解鎖，不是編輯器擋存檔。完整設計見 §2-3。
2. **`song:{songId}` 解鎖旗標是否維持不變** → **推翻，全面改用 storyKey**（`{storyKey}:song`）。2026-07-26 實測正式 D1 `uep_users` 為 0 筆註冊使用者，本文件第一版「保護既有使用者」的前提在現實中不成立，原本的「不變量」整段作廢，改採 §2-3-a 的新設計。**這是一次性視窗**——一旦有真實使用者註冊，未來任何類似的旗標命名變更都必須走雙寫/補授予腳本，不能再單純改名，完整警語見 §2-3-a。
3. **entity mark 三處防禦性缺口是否納入 S10-1** → **納入**，設計見新增的 §8。
4. **01-06 同病相憐頁的本地 clue 是否 `pnpm sync:push`** → 艾斯維爾自行處理，不影響架構設計，本文件不再追蹤。

### 10-1 第 1、2 項交會處：沒填 storyKey 的劇情歌用什麼當解鎖旗標

第 1 項（storyKey 選填）與第 2 項（旗標全面改看 storyKey）合起來會產生一個交會問題：**沒填 storyKey 的劇情歌，用什麼當解鎖旗標？**

**設計**：沒有 fallback。`deriveSongUnlockFlag` 對這種情況直接回傳 `null`（見 §2-3-a），該歌**永遠無法被授予收藏旗標**，只能透過 Echo Spot 現場插播聆聽，不會進入收藏池。

**為什麼這條由架構師直接設計、不再另列待決點**：艾斯維爾原話「劇情 key 是選填的，但基本上也只有有填 key 才能被對應/解鎖」已經直接回答了這個交會問題——「只有填了才能解鎖」的反面就是「沒填就不能解鎖」，沒有第三條路（例如退回 `song:{songId}`）可選，因為第 2 項已經明確關閉了 `song:{songId}` 這個命名慣例的判斷資格。若保留 `song:{songId}` 作為未填 storyKey 時的 fallback，等於變相讓「不填 storyKey 也能被收藏」，與艾斯維爾的原話直接矛盾——這不是需要產品判斷的開放問題，是把已有的兩句話對齊後的必然結果。

編輯器提示文案見 §2-3。

---

## 11. 實作交接

### 11-1 建議實作順序

1. **json_extract SQL 端防禦補強**（§8）：與其他任務無依賴，風險最低，建議最先做，替後續高頻呼叫的兩個查詢函式先把地雷排除。
2. **地基（不依賴任何 UI）**：`0022_interlink_index.sql`（`history_interlink_index` + `story_points` 兩表）→ `interlink.ts`（`findKeyConflict`）→ 擴充三個 entity-index 建構器加 `storyKey` 欄位。此段可獨立測試，不動任何既有頁面行為。
3. **illustrationId → storyKey 遷移**（§5）：先做這塊而非最後做——後續所有 Visuals/History 的程式碼變更都假設欄位已經叫 `storyKey`，越晚遷移，越多程式碼要在「舊名/新名」之間反覆橫跳。一次性腳本 + 程式碼變更同批次提交。
4. **唯一性把關落地**（§3）：`upsertPage` 的 409 擋重複、`EntityKeyField` 前端 `existingKeys` 修正（Concepts 跨頁）。此時 Echoes `EchoesEditorBody`/Visuals `VisualsEditorBody` 的 storyKey 欄位可以一併切換（`entityKey` 欄位在 `category==='story'` 時改顯示 `storyKey`，**選填 + 軟性提示**，見 §2-3）。旗標命名同批次改用 `deriveSongUnlockFlag` 的新簽名（§2-3-a）。
5. **反向索引寫入**（§4-3）：`upsertPage` 的 History 分支接入索引重建，軟刪除路徑接清理。此時可以先手動用 Worker log / D1 直接查詢驗證索引正確性，不急著接前端。
6. **查詢端點**（§4-5）：`/api/interlink/anchors`、`/api/interlink/usage`（後者雖是 S10-3 用，但既然表已就位，一次寫好比之後回頭補更省事）。
7. **觸發模型**（§6）：Echoes/Visuals 自動觸發 → History 島書籤區覆蓋消費 → dock chip pending → Concepts 觸發按鈕（建議最後做，因為要新增可見 UI 元件，範疇比前面幾項更接近「功能」而非「地基」）。
8. **便條擴充**（§7）：schema 欄位 + normalizeState 容錯 → entity 拖曳來源與 bridge → 逐張小標 UI（checkbox + 顯示）。與前面幾項耦合度低，可以平行拆卡。
9. **Echoes 分類唯讀**（§1-4）：`EchoSongPicker.tsx` 判斷順序反轉 + `EchoesEditorBody.tsx` 下拉唯讀化。純白工，任何時候插入都不影響其他項目，建議與第 4 項（storyKey 欄位切換）同批次一起做，因為都在動 `EchoesEditorBody.tsx` 同一個檔案。

### 11-2 開工前必查

- **`EchoesEditorBody.tsx` 的 storyKey 驗證務必實作成「選填 + 軟性提示」**，不要照抄本文件第一版草稿曾經設計的「必填阻擋」——這是本次二輪定案唯一被推翻方向的產品判斷，若手邊留有第一版草稿或舊筆記，照抄時容易手滑寫錯。
- 動 `deriveSongUnlockFlag` 前，**先確認正式環境使用者數仍是 0**（`SELECT COUNT(*) FROM uep_users`）——§2-3-a 的無痛改名前提是這個數字，若開工時間點與本文件撰寫時間點有落差、且期間有人完成註冊，必須先停下來改用雙寫方案，不能直接套用本文件的簡化設計。
- 開工前跑一次 `pnpm check` 確認 0.9.15.0（S10-0）基線本身是綠的，避免把既有問題誤算進本次改動的驗收範圍。
- 動 `EchoSpotNode.ts`/`VisualClueNode.ts` 前，先確認 `collectEchoSpotIssues`/`collectVisualClueIssues` 的既有測試（`__tests__/EchoSpotNode.test.ts`、`__tests__/VisualClueNode.test.ts`）作為回歸基準，新增 `storyKey` 屬性/`targetType` 改名後這兩份測試必須先跑過一輪確認哪些斷言需要同步更新。
- `workers/content-api/src/__tests__/echoes-index.test.ts`、`visuals-index.test.ts`、`concepts-index.test.ts` 三份既有測試是擴充 `storyKey` 欄位與 §8 json_extract 修法的回歸基準，先讀一遍現有斷言的資料形狀；動 `findEntitySong`/`findEntityGallery` 前一併確認是否已有對應測試檔案，若有先讀一遍斷言是否隱含依賴 SQL 層的過濾順序。

*文件結束。*
