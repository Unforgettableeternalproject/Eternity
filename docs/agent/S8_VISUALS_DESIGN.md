# S8 Visuals 設計文件：浮動幻影 Viewer Island（下半場）

> 起草基準：0.9.13.10 + staging 併回（merge `82119be`，feature/epic2-progress-foundation）
> 版號範疇：S8 下半場續掛 **0.9.13.11 起**
> 目標里程碑：Visuals 收完即 S8 完成點 → **0.9.14.0**（Storage 便條紙屬下一階段，不在 S8 範疇——艾斯維爾 2026-07-19 定案）
> 作者：諾薇亞（依艾斯維爾 2026-07-18~19 四輪口述定案整理）
> 日期：2026-07-19
> 狀態：**定案（2026-07-19 三輪收斂）**——交戴爾細拆分期

---

## 總覽

Visuals 是資源最少的 zone，但它補上內容訊號系統的最後一塊拼圖。三大 zone 的內容訊號至此平行成形：

| Zone | 訊號系統 | 觸發哲學 |
|---|---|---|
| Concepts | Entity（互動嵌入） | 讀者主動點擊已解鎖的 entity 字詞 |
| Echoes | Echo Spot | 掃描線經過**自然發生**（插播） |
| Visuals | **Visual Clue** | 掃描線經過後**浮現一個選擇**——按不按由讀者決定 |

S8 下半場交付四件事：

1. **per-image 三態解鎖模型**——解鎖粒度從 gallery 下放到單張圖片（Reader 與島同步生效）
2. **Visuals 編輯器擴充**——gallery 閘 + entityKey／插圖 ID + 每張圖的三態條件
3. **浮動幻影島**（原「掌上畫廊」改名）——事件驅動的典型圖片檢視器，無佇列
4. **Visual Clue**——字裡行間的書籤式插圖入口，快照/復原語意沿用 audioStore 前例

精靈圖（isSpriteSheet）的編輯器較特殊，**本輪明確排除**，不做 per-image 條件。

---

## 一、資料模型

### 1-1 Gallery 層

沿用 Echoes 模式：gallery 有整體**解鎖閘**（GateCondition，走既有 gating 語意）。

分區差異（四分區僅前兩者進島，見 §3-3）：

| 分區 | pageType 樣式 | 識別欄位 | 用途 |
|---|---|---|---|
| 陳列走廊（profiles / corridor） | 設定圖檔 | **entityKey**（可綁定，同 zone 唯一） | Interactive Embedding 反查 |
| 鑲框室（illustrations / museum） | 劇情插圖 | **插圖 ID**（獨特 ID，同 zone 唯一） | Visual Clue 引用 |
| 抽象萃取間（sketchs / pinboard） | 草稿 | 無 | 不進島 |
| 基底實驗室（pixel） | 精靈圖 | 無 | 不進島，編輯器本輪不動 |

entityKey 欄位與唯一性硬驗證直接沿用 Echoes 的 `EntityKeyField` 模式；插圖 ID 是新欄位，驗證規則同構（同 zone 唯一、查核失敗阻擋存檔可重試）。

### 1-2 圖片層：三態模型（取代 spoiler 降級鏈）

**艾斯維爾定案：L0~L3 降級鏈不進 Visuals。** Echoes 的降級鏈是為 partial 敘述展開而生；Visuals 用「不同圖片作為階段鎖」已把 partial 職責接走，改用三態：

- **A 鎖定**：鎖定樣式整張擋住（佔位可見）
- **B 部分解鎖**：可見但被模糊或其他效果遮住（看得到輪廓/局部）
- **C 解鎖**：完整顯示

每張圖片三個資料欄位：

```typescript
interface ImageGateData {
  /** 初始狀態 */
  initialState: 'locked' | 'partial' | 'unlocked';
  /** 鎖定條件：離開 A 態的閘 */
  lockGate?: GateCondition;
  /** 部分鎖定條件：離開 B 態的閘 */
  partialGate?: GateCondition;
}
```

掛載位置：`ImageItem`（`VisualsEditorBody.tsx`）已有頁面內唯一 `id`，三態資料以既有 `id` 為錨點擴充欄位，不動圖片識別底層。

**pristineOnly**（艾斯維爾 2026-07-19 定案）：比照其他區塊——它本來就是 `GateCondition` 的一維，gallery 閘與圖片的 lockGate/partialGate 三處條件皆為完整 GateCondition，因此 **gallery 層與圖片層都可設定 pristineOnly**，不需額外欄位。求值語意沿既有 gating（觀測者不 bypass）。

### 1-3 三態狀態機（艾斯維爾 2026-07-19 逐案定案）

| # | 初始狀態 | lockGate | partialGate | 行為鏈 |
|---|---|---|---|---|
| 1 | A 鎖定 | ✓ | ✓ | A →(lockGate)→ B →(partialGate)→ C |
| 2 | A 鎖定 | ✓ | ✗ | A →(lockGate)→ C（跳過 B） |
| 3 | A 鎖定 | ✗ | ✗ | 永遠 A（未釋出內容） |
| 4 | B 部分 | ✓ | ✓ | B →(partialGate)→ C（lockGate 無視） |
| 5 | B 部分 | ✓ | ✗ | B →(lockGate 視為 partialGate)→ C |
| 6 | B 部分 | ✗ | ✗ | 永遠 B |
| 7 | C 解鎖 | 任意 | 任意 | 永遠 C（條件全無視） |
| 8 | A 鎖定 | ✗ | ✓ | 永遠 A——無 lockGate 即無條件離開鎖定，partialGate 形同虛設（艾斯維爾 07/19 三輪定案；編輯器可對此組合給提示但不阻擋） |

語意補充（諾薇亞整理，比照 Echoes 慣例）：

- **單調性**：狀態只降不升（不重新上鎖），求值即時從旗標推導、不儲存進程
- **AND 鏈**：到達 C 需通過鏈上所有前置閘（案 1 中 C = lockGate ∧ partialGate）
- **觀測者**：條件走既有 `evaluateGate` 語意——requiresFlags 被觀測者 bypass、pristineOnly 不 bypass。觀測者無浮島，但 Reader 中的三態求值照此語意

### 1-4 兩個不變量

1. **總 AND 鏈**：圖片實際可見狀態 = gallery 閘 ∧ 圖片自身鏈。gallery 閘未過時一切不可見（連鎖定佔位都沒有——整個 gallery 呈鎖定態）
2. **第一張圖恆等式**：sortOrder 第一張圖固定為「gallery 閘通過即 C」，不設自身條件（編輯器鎖定其三態欄位）。因此「gallery 解鎖 ⇔ 第一張圖可見」恆成立，「無任何圖片解鎖 → gallery 鎖定」自動滿足。**編輯器重排圖片時，約束跟著新的第一張走**

---

## 二、Reader 展示變更（VisualsReader）

- **未解鎖（A）圖片：佔位可見**——鎖定樣式整張擋住，但格子存在。使用者從一開始就知道 gallery 總張數。**這與 Echoes「未解鎖完全隱藏」刻意相反**，是引導設計：讓讀者知道還有東西沒開
- 部分解鎖（B）：模糊/遮罩效果，可窺不可視
- gallery 鎖定判定 = gallery 閘（等價於第一張不可見）；鎖定的 gallery 在列表呈鎖定態（樣式待設計）
- lightbox 尊重三態：A 不可放大、B 放大仍遮罩
- 既有 spoilerFilter / gate 警告字串機制的去留：per-image 三態上線後舊 gallery 級 spoiler 欄位如何遷移，實作時盤點（資料相容比照 Echoes D 段 `spoilerGate` 讀取相容手法）

---

## 三、浮動幻影島

### 3-1 定名與定義更新

- `ISLAND_DEFINITIONS.visuals.title`：「掌上畫廊」→「**浮動幻影**」；icon 改**畫框或畫筆 placeholder**（07/19 定案，現 ❏ 替換）
- 視覺語彙：無設計稿原型（同 History 島前例），**諾薇亞自行設計、艾斯維爾驗收時調**。另艾斯維爾預告：**除 Concepts 外所有浮島的設計後續都會重新調整、更 immersive**——故第一版以功能骨架優先，視覺不過度打磨
- 預設錨點 top-left、寬 360 沿用
- 解鎖要素：沿用 IslandUnlockObject 小物件，**掛在 VisualsReader 內（landing view），不放 zone entry landing**——同 concepts/echoes 的 Reader 掛載方式（07/19 定案）；各 zone 的專屬解鎖儀式統一屬 **S9 範疇**

### 3-2 UI：典型圖片檢視器

- 大區塊展示當前圖片
- 左右箭頭切換 gallery 內圖片
- 下方敘述區（caption）
- 縮圖快切列（依 per-image 三態呈現：A 鎖定格、B 模糊縮圖、C 正常）

### 3-3 行為原則（艾斯維爾定案）

1. **一次展示一個、且為一整個 gallery**；內容依內部各圖片解鎖狀況；**只展示已解鎖的 gallery**
2. 範圍：**只有鑲框室 + 陳列走廊**進島；抽象萃取間、基底實驗室屬額外內容不列入
3. **無佇列**（與流浪回聲的根本差異）；在 Visuals zone 內**預設閉幕**
4. 內容來源僅三種，全部事件驅動：
   - **映照**：Reader 內某 gallery 可選「映照」，直接投射到島
   - **Entity 嵌入**：Interactive Embedding 以 entityKey 呼叫對應 gallery，**先以提示為主**（比照 Echoes D 段 SongPreviewCard／island 內提示模式，不直接彈開）
   - **Visual Clue**：強制展示 + 快照復原（§4）

---

## 四、Visual Clue

### 4-1 概念

在一個橋段中提供一個**選擇**，讓讀者直接看到對應場景的插圖。與 Echo Spot 的對照：

| | Echo Spot | Visual Clue |
|---|---|---|
| 觸發 | 掃描線經過即發生（插播） | 掃描線經過後**浮現書籤按鈕**，讀者自行決定 |
| 位置粒度 | 單點 | **起訖區間**（該圖 relevant 的橋段範圍） |
| 目標 | 歌曲頁 | gallery（經 entityKey 或插圖 ID） |
| 島未掛載 | 提示卡降級 | **完全不出現**（含觀測者、未解鎖島） |

### 4-2 編輯器

- History RichEditor 插入 Clue 於字裡行間，指定目標圖片來源：**entityKey**（陳列走廊）或**插圖 ID**（鑲框室）
- Clue 可設定**起始位置與結束位置**；每個 clue 可設獨特 id（渲染便利用）
- 實作提案（諾薇亞，待實審）：**成對錨點 node**——同 clueId 的 start/end 兩個隱形 block 標記，沿 ProgressMarker 體系；編輯器需配對驗證（孤兒錨點警告/阻擋）

### 4-3 前台書籤按鈕

- Reader 中 Clue 標籤**不可見**；掃描線經過起點錨點 → 側邊浮現**書籤/圖標狀按鈕**，有一條連接線指向內容但**不碰字**；經過訖點後離場
- 掃描線的 role + element callback（S8-C 已擴充）直接驅動浮現/消失與定位
- **多 clue 區間重疊**：書籤要能跟著堆疊擴展（多顆書籤並列/展開）
- 視覺可參考「遺落的書籤」既有語彙（同為書籤隱喻）

### 4-4 生命週期（艾斯維爾 2026-07-19 定案）

| 情境 | 行為 |
|---|---|
| clue 被點擊 + 通過結束錨點 | 本次頁面活動**不再出現**（session dedupe，同 echo spot 手法；重新造訪頁面可再現） |
| clue 未被點擊 | 回捲進區間即**重新顯示** |
| 島被收合（dock） | 不顯示書籤按鈕；**dock chip 閃爍提示** |
| 區間內島被展開 | 書籤按鈕重新顯示 |
| 島未解鎖 / 觀測者 | 書籤完全不出現 |

### 4-5 點擊行為與快照

- 點擊 → 發信號給浮動幻影，**強制展示**該 gallery
- 若讀者原本正在檢視別的 gallery：**快照保存，clue 結束後復原**——語意完全沿用 audioStore 的 interruptionSnapshot 定案（含「插播中手動接管 = 快照丟棄」等 S8 已定細則，「其餘快照同 echo 語意」為艾斯維爾原話）
- **經 clue 展示 gallery 時，若該 gallery 原未解鎖則同時解鎖 + 提示通知**（對位 echo spot 的推導旗標授予）——需要 gallery 解鎖旗標推導函式（對位 `deriveSongUnlockFlag`，命名暫定 `deriveGalleryUnlockFlag`）

---

## 五、編輯器彙總

1. **Gallery 層**：解鎖閘（GateCondition editor 沿用）+ entityKey（僅陳列走廊）或插圖 ID（僅鑲框室），唯一性硬驗證比照 Echoes
2. **圖片層**：初始狀態選擇（A/B/C）+ lockGate + partialGate 兩個條件編輯器；第一張圖欄位鎖定；案 8 組合允許儲存（語意=永遠 A），編輯器給提示即可
3. **History RichEditor**：Visual Clue 工具（成對錨點插入 + 目標指定 + clueId）
4. **精靈圖編輯器**：本輪不動
5. **PROGRESS GATE 面板分級**（艾斯維爾 07/19 定案）：
   - Concepts / Storage 編輯器：**整塊移除**
   - Echoes / Visuals：**只留必要條件欄位**（requires completion / custom flag / pristine only），移除 progress page 與 exempt from container（tree 專屬欄位，對媒體 zone 無意義）
   - History：保留全套
   - 實作走 editorModeRegistry 模式分派；**僅動 UI**，各 Reader 對既有 `metadata.gate` 資料的求值行為不變（Concepts 頁面級 gate 既有資料仍生效）

Echoes 的 Spoiler Gate Level 卡（分類/Level 左、條件區右）是現成參考，但 Visuals 是三態不是四級，卡片形式需重新設計而非照搬。

---

## 六、進度系統接點與既有問題

### 6-0 Progress Gate 面板實效考據（2026-07-19，諾薇亞查核）

`GateConditionEditor`（Inspector 的 PROGRESS GATE 面板）掛在共用 RichEditor，所有 zone 的頁面編輯器都會顯示，但各 zone Reader 的實際消費程度差異極大：

| Zone | 求值方式 | 面板實效 |
|---|---|---|
| History | `isLocked(page, progress, page.id, progressTree)` — tree-aware | **全功能**（唯一 progress page / exempt from container 有作用的 zone） |
| Echoes | `isSongUnlockedInZone` → `isLocked(node, progress)` — 僅本頁 gate | **部分有效**：requires completion / custom flag / pristine only 確實控制歌曲解鎖；progressPage／容器繼承欄位無效（07/13 finding，**本日確認仍未修**） |
| Concepts | 頁面級直接 `evaluateGate(progress, parseGateCondition(metadata))`；條目級走 baseGate | 頁面 gate 有效（非 tree-aware）；條目 baseGate 另有專屬編輯器 |
| Visuals | `isLocked(sc)` **不帶 progress** | **完全無效**——只判靜態 `metadata.locked`，面板資料存了但沒人讀 |
| Storage | `isLocked(entry)` **不帶 progress** | **完全無效**——同上 |

（`getLockKind` 的向後相容設計：無 progress 參數時只判靜態鎖；其 doc 註解「Visuals/Echoes 尚未接進度系統」對 Echoes 已過時，順手修。）

### 6-1 本場工作項

1. **Visuals 接上 gating 且一開始就 tree-aware**（effectiveGate）——V-A/V-B 完成後上表 Visuals 列自動修正
2. **Echoes tree-aware 補修**：已確認 C/D 後仍未修，依「發現既有問題就要修」原則納入本場（獨立 fix commit）
3. gallery 解鎖旗標與三態條件全部走既有 gating 求值（evaluateGate / effectiveGate），不另發明求值器
4. `ISLAND_RELATED_EVENT`（`uep:island-related`，S6 預留）：**本場接通基礎版**（艾斯維爾 07/19 定案「試著接」）——clue／映照展示時廣播來源 gallery 與關聯 History 頁。艾斯維爾預告後續會用更多篇幅處理此島的事件，本場先讓合約有第一個真實生產者/消費者，不過度設計

---

## 七、風險

1. **書籤側邊定位**：與 scroll marker（「上次位置」書籤）、Minimap 等既有側邊元素的空間衝突；重疊堆疊的佈局複雜度。書籤「連接線不碰字」需在不同視窗寬度下穩定
2. **成對錨點的配對穩定性**：編輯操作（刪除、複製貼上）可能產生孤兒錨點——編輯器驗證 + 前台容錯（孤兒錨點視為無效 clue）雙層防禦
3. **快照 × session dedupe × 島開合**的組合狀態機——狀態多，測試矩陣要先設計（比照 audioStore 測試技法：vi.resetModules + window bridge 清理）
4. **三態求值測試矩陣**：8 案 × 觀測者/探索者 × gallery 閘開關，用表驅動測試展開
5. 第一張圖約束與編輯器重排的互動——重排後原第一張的既有條件如何處理（清空？保留但失效？）實作時定

---

## 八、實作分期建議（粗粒度，供戴爾細拆）

| 段 | 內容 | 對應版號（暫） |
|---|---|---|
| V-A | 三態資料模型 + resolver（純函式層）+ gallery 閘/entityKey/插圖 ID 資料就位 | 0.9.13.11~ |
| V-B | Reader 展示改造（per-image 鎖定/模糊/lightbox）+ Visuals 編輯器（三態欄位 + 驗證） | |
| V-C | 浮動幻影島本體（檢視器 UI + 映照 + entity 嵌入提示 + 解鎖通知） | |
| V-D | Visual Clue 全鏈（編輯器成對錨點 + 掃描線書籤 + 快照/復原 + dedupe） | → 0.9.14.0? |

依賴：V-A → V-B/V-C 可並行 → V-D（需 V-C 的島與 V-A 的旗標推導）。

---

## 九、待決問題 → 全數定案（2026-07-19 三輪收斂）

- ~~狀態機案 8~~ → **永遠 A**（無 lockGate 即無法離開鎖定；編輯器提示不阻擋）
- ~~島 icon~~ → 畫框或畫筆 placeholder
- ~~ISLAND_RELATED_EVENT~~ → 接通基礎版（§6-1 第 4 項）
- ~~映照入口位置~~ → 諾薇亞實作時自行定位（對位 Echoes 加入佇列按鈕的慣例位），驗收調整
- ~~島解鎖要素~~ → 沿用 IslandUnlockObject 小物件、掛 Reader 內；各 zone 專屬解鎖儀式屬 S9
- ~~pristineOnly~~ → gallery 與圖片兩層皆可設，走 GateCondition 既有維度（§1-2）
- ~~0.9.14.0 歸屬~~ → Visuals 收完即進位；Storage 屬下一階段
- ~~島視覺語彙~~ → 諾薇亞自行設計、驗收調整；除 Concepts 外各島後續統一重調更 immersive，第一版功能骨架優先
- ~~PROGRESS GATE 面板分級~~ → Concepts/Storage 移除、Echoes/Visuals 留必要條件欄位、History 全套（§五-5）

---

## 十、實作分期細拆（戴爾，2026-07-19）

勘查發現的兩個地雷（拆分已吸收）：`VisualsData.gate` 現為**自由文字欄位**（非 GateCondition，V-A.12 需相容遷移）；`VisualsReader` 四處 `isLocked(sc)` 無 progress 已證實（§6-0）。

### 段落表

| 段 | 範圍 | 版號 | 依賴 |
|---|---|---|---|
| 段 0（fix 不佔號） | Echoes tree-aware 補修 + getLockKind 註解修正 | — | 無，最先做 |
| V-A | 三態 resolver + 資料型別遷移 + 端點 + Visuals tree-aware 接線 | .11~.14 | 段 0 |
| V-B | Reader 三態渲染 + 編輯器欄位 + PROGRESS GATE 面板分級 | .15~.19 | V-A（.17 面板分級可提前並行） |
| V-C | 島本體 + 映照 + entity 提示 + 解鎖要素 + RELATED_EVENT | .20~.24 | V-A（與 V-B 可並行） |
| V-D | Visual Clue 全鏈 | .25~.30 | V-C + V-A |
| 里程碑 | S8 完成 | **0.9.14.0** | V-D |

### Commit 級拆分

**段 0**：`isSongUnlockedInZone` 補 nodeId/tree 走 tree-aware（先勘查呼叫端 ProgressTreeAdapter 來源）+ getLockKind 過時註解修正。新增 tree-aware 迴歸測試。

**V-A**
| 版號 | 內容 |
|---|---|
| .11 | `visuals/threeState.ts` 純函式：ImageGateData + resolveImageState（8 案狀態機 + 第一張恆等式）+ deriveGalleryUnlockFlag。表驅動測試：8 案 × 視角 × gallery 閘 |
| .12 | VisualsData.gate `string`→`GateCondition`（舊字串 fallback 為提示文案不求值）+ entityKey/illustrationId 欄位 + ImageItem 三態欄位（**無資料視為 C 解鎖**——防上線全鎖黑）。round-trip 相容測試 |
| .13 | content-api：`GET /api/visuals/entity-gallery?key=` + `GET /api/visuals/gallery?id=`（一次做齊，不重蹈 echo spot 先漏後補）。test:workers 對應測試 |
| .14 | VisualsReader 四處 `isLocked(sc)` 補 tree-aware |

**V-B**
| 版號 | 內容 |
|---|---|
| .15 | gallery 層編輯 UI：GateConditionEditor 取代自由文字 gate + entityKey/插圖 ID 依 division 顯隱 + 唯一性硬驗證 |
| .16 | 圖片層編輯 UI：A/B/C 選擇器 + 兩條件編輯器；第一張欄位鎖定；案 8 提示不阻擋；重排約束跟隨 |
| .17 | PROGRESS GATE 面板分級：editorModeRegistry 加 `gatePanelMode: 'full'\|'minimal'\|'none'`，RichEditor gateFields 單一注入點分派；不影響 Echoes Spoiler Gate 卡/Concepts baseGate 獨立呼叫 |
| .18 | Reader 三態渲染：A 佔位擋住/B 模糊/C 完整 + gallery 鎖定態 + lightbox 尊重三態 |
| .19 | 舊 spoilerLevel/gate 資料相容盤點（仿 Echoes D 段手法） |

**V-C**
| 版號 | 內容 |
|---|---|
| .20 | ISLAND_DEFINITIONS 改名浮動幻影 + icon placeholder（查 hardcode 字串）+ islands/visuals/ 骨架 + IslandHost lazy 註冊 |
| .21 | 檢視器 UI：大圖 + 箭頭 + caption + 三態縮圖列；無佇列、zone 內預設閉幕 |
| .22 | 映照入口（Reader 按鈕 → 開島展示，只收已解鎖 gallery） |
| .23 | entity 嵌入提示：IslandHost visuals consumer（AbortController 防舊回應）→ 島內提示卡 |
| .24 | IslandUnlockObject 掛 Reader landing + ISLAND_RELATED_EVENT 基礎接通（HistoryIsland 最小消費 chip） |

**V-D**
| 版號 | 內容 |
|---|---|
| .25 | markers.ts role 擴充 `visual-clue-start/end` + selector；既有消費端不退化 |
| .26 | VisualClueNode（TipTap 成對錨點，仿 EchoSpotNode）+ 編輯器配對驗證 |
| .27 | 前台書籤按鈕：起訖浮現/消失 + 連接線 + 重疊堆疊 + 孤兒容錯 + 島未掛載/觀測者不出現 |
| .28 | 點擊強制展示 + 快照/復原（沿 interruptionSnapshot 語意） |
| .29 | session dedupe + dock chip 閃爍 + 展開重現 |
| .30 | clue 授旗解鎖 + 提示通知；全站 check + test:all 收尾 |

### 開工前查核

1. Echoes/Visuals 各呼叫端的 ProgressTreeAdapter 來源勘查
2. RichEditor gateFields 注入點分級不誤傷獨立 GateConditionEditor 呼叫
3. ~~VisualsData.gate 舊自由文字資料處置~~ → **已拍板（07/19）：靜默失效**——舊字串 fallback 為提示文案、不參與條件求值，不寫遷移腳本
4. ~~ImageItem 三態預設值~~ → **已拍板（07/19）：無資料一律視為 C 解鎖**
5. markers.ts role 擴充後 exhaustive check 掃描
6. 新端點部署 test worker 供 QA；本場不動 D1 schema、seed 腳本不需改

### 風險對應

🔴 書籤側邊定位（V-D.27，多視窗寬度手測）／成對錨點配對（V-D.26+.27 雙層防禦）／快照×dedupe×島開合狀態機（V-D.28-.29，測試矩陣先行）；🟡 三態測試矩陣（V-A.11 一次做完）、第一張約束×重排（V-B.16）、gate 型別遷移（V-A.12）、面板分級交叉污染（V-B.17）。

---

*設計定案 + 細拆完成（2026-07-19）。待艾斯維爾確認查核 3/4 兩項後即可開工。*
