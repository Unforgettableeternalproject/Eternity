# S10-3 拆卡計畫：Admin 行為設定與 key／flag 管理

> 依據：`docs/agent/S10_3_ADMIN_DESIGN.md`（艾斯維爾 2026-07-29 全數定案 D-1~D-5，無待拍板問題）
> 起始版本：**0.9.15.46**（S10-2 迷霧與旅程之書打磨收在 0.9.15.45，待驗收）
> 拆分：依艾斯維爾定案 D-5，拆 **S10-3a（key／flag 管理）** ／ **S10-3b（進度頁總覽＋巡查＋說明消費）** 上下兩段
> 拆卡：戴爾維斯（planner）
> 開工前已完成程式碼讀碼核對——本文件所有「落差／地雷」段落皆為實際讀碼結果，非設計文件推測，詳見 §1、§6

---

## 0. 版號預算

**不設上限，理由如下：**

設計文件 §12 給的 14 步建議順序，本文件依「每個檔案群一個 commit、可獨立 revert」的標準拆法（同 S10-1 慣例）展開為 **15 張任務卡**（S10-3a 8 張 + S10-3b 7 張，其中最後一張可延後）+ **2 個獨立部署步驟**（migration 0023／0024 各自的三環境套用，不佔版號）。

艾斯維爾已定調「本 session 複雜度僅次於 S10-1」（S10-1 標準拆法 18 版次、實際收斂成 9 個 commit）。S10-3 的範疇雖然工作面較少（沒有 S10-1 的 5 個 zone × 反向索引那種橫向擴散），但**單張卡的縱深更深**——尤其 `/admin/behavior` 的全樹進度頁總覽（T-B2）與旗標掃描器（T-A3）都是新寫的複雜邏輯，不是接線工作。預估總工時約 58-63 小時（見 §5 逐卡工時），版次數量落在 14-15（不含延後項則 14），與 S10-1 的 18 標準拆法同量級，屬合理範圍，不建議為了湊少版次犧牲可 revert 性。

實作中預期會像 S10-1 一樣發生「同一組重命名牽連過多檔案，中間狀態無法編譯」而合併 commit 的狀況——本文件已在 §4 提前標出最可能發生的合併點，實作 session 若真的合併，直接對照 §4 即可，不必重新分析。

---

## 0-1 開工前環境實測（諾薇亞 2026-07-29，設計文件 §13，本次拆卡沿用不重查）

| 必查項 | 實測（2026-07-29） |
|---|---|
| `story_points` 殼列 / 已填說明 | 0 / 0 |
| `uep_users` | 0 |
| 帶 `data-grants-flags` 的頁面 | 0 / 244 |
| 設了 `requiresFlags` 的頁面 | 5（全為 `completed:*`） |
| 帶 `storyKey` 的頁面 | 0 |
| 帶 `entityKey` 的頁面 | 4 |
| History 頁 / 反向索引錨點 | 44 / 0 |
| 下一個 migration 編號 | 0023 |
| `pnpm check` 基線 | 未跑，開工前必跑 |

⚠️ 全站零 key／零 flag 是刻意的一次性視窗（見設計文件 §11-1），且**驗收必須在 test 環境做**——正式站沒有任何資料可供反查 UI 顯示。test 環境需要造的樣本見 §5-2。

---

## 1. 開工前讀碼核對（本次新發現，設計文件未點名或描述不完整）

### 地雷 1：`GateConditionEditor.tsx:138` 的 `inheritedProgressPage` 只是單層繼承的「接收端」，不是真正的多層祖先鏈邏輯

設計文件 §4-2 要求「繼承態唯讀…與 `GateConditionEditor.tsx:138` 的 `inheritedProgressPage` 語意完全一致——這裡不重寫繼承規則，共用同一份判定」。

實際讀碼發現：`GateConditionEditor.tsx:138` 的 `inheritedProgressPage = parentIsProgressContainer && !isGateExempt` 只是把一個外部傳入的布林值做一次 AND 運算，真正算出 `parentIsProgressContainer` 的邏輯在呼叫端 `RichEditor.tsx:233-253`——**只 fetch 直接父頁一次、只檢查父頁自己的 raw `metadata.progressPage`**，完全不會往上多層走訪。設計文件 §4-2 的範例表格：

```
├ ch  第一章                            ☑
│ ├ arc 相遇                            ☑(繼承)
│ │ ├ sect 01-01                        ☑(繼承)
```

`sect 01-01` 顯示「繼承」的前提是它能追溯到**祖父層** `ch`（`arc` 自己並未 raw 標記 `progressPage`，只是被動繼承）。若總覽頁直接照抄 `RichEditor.tsx` 現有的「fetch 直接父層一次」寫法逐列套用，`sect 01-01` 會查到 `arc`（其 raw `progressPage` 為 false）就判定「未繼承」，與範例表格要求的顯示結果不符。

真正做多層祖先鏈判定的程式碼是 `apps/uep/src/progress/gating.ts` 的 `effectiveGate()`——它內部有一個 `while (cursorId)` 迴圈，逐層檢查每個祖先的 `isProgressPage(parent.metadata)`／`isGateExempt(parent.metadata)`，直到遇到有效祖先或 `gateExempt` 切斷點為止。但這個函式是**前台 Reader 專用**，依賴 `ProgressTreeAdapter` 介面與使用者 `ProgressState`，不是為了「靜態算出整棵樹每個節點是否繼承」而設計的。

**結論（T-B2 的具體要求）**：不要複製 `RichEditor.tsx` 的單層 fetch 寫法，也不需要整套搬 `effectiveGate`（那是給旗標鏈條件用的，總覽只需要「是不是進度頁」這個布林）。正確做法是拿到全樹（`GET /api/content/history/tree` 已回傳每頁 `metadata`）後自行做 **top-down 遞迴**：

```
effectiveProgressPage(node) =
  isProgressPage(node.metadata)
  || (!isGateExempt(node.metadata) && effectiveProgressPage(parent(node)))
```

`isProgressPage` / `isGateExempt` 兩個純函式可直接從 `progress/gating.ts` import（無 side effect，不依賴 tree adapter），複用的是「判斷規則」而非「整套查詢機制」，這才是設計文件「共用同一份判定」的正確理解方式。

### 地雷 2：`PATCH /api/content/:area/:slug/metadata` 若照設計文件字面路徑掛載，會被既有 `contentMatch` 正規式吞掉

`workers/content-api/src/index.ts:2135` 的內容 CRUD 路由：

```js
const contentMatch = path.match(/^\/api\/content\/([a-z]+)(?:\/(.+))?$/);
```

`slug` 群組是貪婪 `(.+)`，會把 `/api/content/history/chpt.01%2F01-06/metadata` 這種 URL 整段吃掉，`slug` 變成 `chpt.01/01-06/metadata`（含尾碼），而不是預期的 `chpt.01/01-06` + 獨立的 `metadata` 子路徑。更嚴重的是：即使 slug 解析恰好正確，`contentMatch` 內的 `switch (request.method)` 只列了 `GET`／`PUT`／`DELETE` 三個 case，`PATCH` 會落入 `default: 405 Method not allowed`——不是 404，是完全進不去新端點的邏輯。

設計文件完全沒提到路由掛載順序。T-B1 必須新增一個**更精確、且排在 `contentMatch` 判斷之前**的正規式（比照 `/api/interlink/anchors`／`/api/interlink/usage` 的既有做法：獨立前綴、在 switch 之前攔截），例如：

```js
const metadataPatchMatch = path.match(/^\/api\/content\/([a-z]+)\/(.+)\/metadata$/);
if (metadataPatchMatch && request.method === 'PATCH') { ... }
```

且此檢查必須放在 `contentMatch`（index.ts:2135）**之前**執行。這是本次讀碼新發現的地雷，任何未來想用路徑後綴當子資源（`.../metadata`、`.../xxx`）的端點都要留意同樣的坑。

### 地雷 3：`/api/flags/audit` 的授予端掃描不能只掃 History，`ProgressMarkerNode` 是全區域共用元件

設計文件 §3-1 只寫「掃 `content` 欄位裡的 `data-grants-flags` 屬性」，沒有明講掃描範圍。實際讀碼：`ProgressMarkerNode`（`apps/uep/src/components/editor/ProgressMarkerNode.ts`）只掛載在共用的 `RichEditor.tsx`，而 `RichEditor.tsx` 是**所有 zone 的 `rich_text` 內容區塊共用的編輯器**（不像 `EchoSpotNode`／`VisualClueNode` 只在 History 頁使用）。也就是說授予端旗標理論上可以出現在 Storage 的對話劇本、Concepts 的說明段落等任何用到 `rich_text` block 的頁面，不只是 History。

`GET /api/flags/audit` 的 `grantedBy` 掃描器（T-A3）必須掃**全站** `pages`（`SELECT id, title, area, content FROM pages WHERE deleted_at IS NULL`），不能沿用 `history_interlink_index` 那種「刻意只認 History」的範圍限制——兩者職責不同：History 反向索引管的是「跨區互聯」（entity mark／echo spot／visual clue），旗標授予是「內容閘門系統」，全站通用。

### 地雷 4：`story_points` → `interlink_keys` 改名的實際牽連檔案比設計文件描述的更廣，且牽出一個隱性依賴

全文搜尋 `story_points`／`storyPoint`／`findStoryPoint`／`ensureStoryPoints`／`backfillStoryPoints`，命中檔案：

| 檔案 | 需要的變更 |
|---|---|
| `workers/content-api/src/interlink.ts` | 三個函式改名＋擴充 entity keyType |
| `workers/content-api/src/index.ts` | `upsertPage` 呼叫端、`/api/interlink/usage` 回應欄位 `storyPoint`→`keyMeta` |
| `workers/content-api/src/__tests__/interlink.test.ts` | 斷言改名 |
| `workers/content-api/src/__tests__/api.test.ts` | `storyKey 首次出現寫入 story_points` 案例改名 |
| `workers/content-api/src/__tests__/sync-import-interlink.test.ts` | 三處 SQL 斷言改名 |
| `scripts/reindex-interlink.mjs` | 註解與版本相容提示字串引用 `story_points` |
| **`workers/content-api/src/test-seed.ts`** | ⚠️ 見下方 |
| **`workers/content-api/src/__tests__/test-reset.test.ts`** | ⚠️ 見下方 |

⚠️ **隱性依賴**：`test-seed.ts:157-169` 的 `BUSINESS_TABLES` 常數把 `story_points` 與 `history_interlink_index` 並列為「reset 時必須一起清空的衍生表」，檔案內註解明寫：「新增從 `pages` 衍生的資料表時**必須**列進來，否則重置後會留下已不存在頁面的錨點」。這條清單如果沒有同步把 `story_points` 改成 `interlink_keys`，`pnpm test:reset` 之後 `interlink_keys` 表不會被清空，殘留的舊 storyKey 說明會在 reseed 後被錯誤 join 回新內容上。`test-reset.test.ts:304/318/331` 也有直接斷言 `tables` 陣列包含 `'story_points'` 與對應的 SQL 查詢，同樣要改名。

**額外判斷（T-A1 需要決定並記錄）**：新的 `uep_flags` 表要不要也加入 `BUSINESS_TABLES`？`uep_flags` 本質上是**直接由管理者輸入**的註冊表，不是「從 pages 衍生」，不完全符合該常數註解描述的風險模式（stale anchor 誤 join）。但為了 test:reset 後環境的一致性（不留上一輪測試殘留的旗標註冊），建議一併加入。此為本文件建議，非設計文件定案，實作時若艾斯維爾有不同意見以其為準。

上述 8 個檔案的改動彼此緊耦合（改表名不改函式呼叫端就是編譯錯誤、改函式名不改測試斷言就是測試失敗），**必須同一個 commit**，見 §4-1。

### 地雷 5（非落差，讀碼確認一致）：`interlink.ts` 現有 `findStoryPoint`／`ensureStoryPoints`／`backfillStoryPoints`／`/api/interlink/usage` 皆與設計文件描述完全吻合

`workers/content-api/src/interlink.ts` 目前已存在 `findStoryPoint(db, storyKey)`、`ensureStoryPoints(db, candidates)`、`backfillStoryPoints(db)` 三個函式，簽名與行為與設計文件 §11-1 步驟 1 的描述（「`ensureStoryPoints()` 改名為 `ensureInterlinkKeys()`…`backfillStoryPoints()` 同步擴充」）完全吻合，S10-1 留下的地基是可信的，T-A1 是單純泛化改名+擴充範圍，不是從無到有新建。`/api/interlink/usage` 端點（`index.ts:1945-2001`）的 `isAuthorized` 檢查與 `Cache-Control: private, no-store` 也已到位，T-A2 只需新增端點、不需重做既有安全機制。

### 地雷 6：新增的 `GET /api/interlink/keys/public` 千萬不能誤用 `isAuthorized`

`/api/interlink/keys`（管理列表）與 `/api/interlink/usage`（管理反查）都需要 `isAuthorized`，這點設計文件與現有程式碼一致。但 `/api/interlink/keys/public`（§6 前台四個消費點要用的公開端點）**絕不能複製貼上時手滑帶到 `isAuthorized`**——`apps/uep/src/islands/interlinkTrigger.ts` 目前所有前台觸發呼叫（`triggerStoryRelated` 等）都是匿名 `fetch`，不帶 `Authorization` header。若 `/public` 端點誤加驗證，會直接 401，整條「命名可見」的鏈路在前台靜默失效（無報錯、卡片就是不顯示標題）。這點設計文件本身寫對了（§3-2 明確標「公開」），但這裡特別記錄下來給實作者一個明確的驗收檢查點。

---

## 2. 任務拆解

### S10-3a — Key 與旗標管理（0.9.15.46 起）

#### T-A1（0.9.15.46）Migration 0023（`interlink_keys` 泛化 + `uep_flags`）+ `interlink.ts` 改名擴充 + 全部呼叫端同步

- **範圍**：
  1. 新建 `workers/content-api/migrations/0023_interlink_keys_and_flags.sql`：
     - `CREATE TABLE uep_flags (name PK, label, description, category, created_at, updated_at)` + `idx_uep_flags_category`
     - `CREATE TABLE interlink_keys (key_type, key_value, title, description, created_at, updated_at, PRIMARY KEY(key_type, key_value))`
     - `INSERT OR IGNORE INTO interlink_keys (key_type, key_value, title, description, created_at, updated_at) SELECT 'story', story_key, title, description, created_at, updated_at FROM story_points`
     - `DROP TABLE story_points`
  2. `workers/content-api/src/interlink.ts`：`findStoryPoint`→`findInterlinkKeyMeta(db, keyType, keyValue)`；`ensureStoryPoints`→`ensureInterlinkKeys`（擴充：entity 候選也建殼，`title` 固定 NULL）；`backfillStoryPoints`→`backfillInterlinkKeys`（同時掃 concepts/echoes/visuals 三個 entity-index 補 entity 殼列，不只 echoes/visuals 的 storyKey）
  3. `workers/content-api/src/index.ts`：`upsertPage()` 呼叫端改用新函式名；`/api/interlink/usage` 回應欄位 `storyPoint` → `keyMeta`（兩種 keyType 皆可能有值）
  4. 同步更新 §1 地雷 4 列出的全部檔案（`interlink.test.ts`／`api.test.ts`／`sync-import-interlink.test.ts`／`reindex-interlink.mjs`／`test-seed.ts` 的 `BUSINESS_TABLES`／`test-reset.test.ts`）
- **驗收標準**：
  - `pnpm --filter content-api-worker db:migrate:local` 成功套用；`sqlite_master` 可查到 `uep_flags`／`interlink_keys`，查不到 `story_points`
  - 既有 `interlink.test.ts`／`api.test.ts`／`sync-import-interlink.test.ts`／`test-reset.test.ts` 全數更新後綠燈，無殘留 `story_points` 字串（`grep -r story_points workers/` 只剩 migration 0022 的歷史檔案與本文件）
  - `ensureInterlinkKeys` 對 entity 候選建殼時 `title` 欄位為 NULL（回歸測試鎖住）
  - `BUSINESS_TABLES` 含 `interlink_keys`，`uep_flags` 是否併入由實作者記錄決定（見地雷 4 額外判斷）
- **依賴**：無
- **風險**：中（牽連 8 個檔案，任何一處漏改就是編譯或測試失敗；建議先跑一次全域字串搜尋收尾）
- **預估**：5.5 小時

---

#### 部署步驟（不佔版號，T-A1 之後、T-A2 之前）migration 0023 三環境套用 + backfill

- **範圍**：
  1. 本地：`pnpm --filter content-api-worker db:migrate:local`
  2. test worker：`pnpm --filter content-api-worker exec wrangler d1 migrations apply eternity-content-test --remote --env test`
  3. 正式：`db:migrate:remote`
  4. 三個環境各跑一次 `backfillInterlinkKeys`（沿用既有 `scripts/reindex-interlink.mjs`，需要先確認它呼叫的函式名同步更新為新名——`reindex-interlink.mjs` 本身在 T-A1 已改名，這裡只是執行）
- **驗收標準**：三環境的 `interlink_keys` 表都能查到現有 entityKey／storyKey 的殼列（正式站因 §0-1 全站零 key，backfill 後應仍是 0 筆——這是正確狀態）；test 環境應能看到既有 entityKey 殼列
- **⚠️ 不可略過**：與 S10-1 的 `pnpm interlink:reindex:*` 同性質的坑——migration 只搬既有 story 殼列，全站既有 entityKey 一筆殼列都沒有，管理 UI 會看到空清單

---

#### T-A2（0.9.15.47）`/api/interlink/keys` 清單／更新／公開端點

- **範圍**：
  1. `GET /api/interlink/keys`（admin）：三路聯集——三個 entity-index 建構器（`includeHidden: true`）∪ `interlink_keys` 表 ∪ `history_interlink_index` 的錨點端 key 值，回傳每個 key 的 `keyType`／`keyValue`／`title`／`description`／使用計數（定義端筆數＋錨點端筆數）
  2. `PUT /api/interlink/keys/:type/:value`（admin）：更新 `title`／`description`；**`keyType === 'entity'` 時直接忽略請求體的 `title` 欄位**（不寫入，即使前端誤送）
  3. `GET /api/interlink/keys/public?keyType&key`（**公開**，見地雷 6）：只回 `title`／`description`，不回 `definitions`／`anchors`
- **驗收標準**：
  - 清單端點涵蓋「有定義沒說明」「有說明但定義被刪」「只在 History 被引用過」三種狀態各一筆測試案例
  - PUT entity 類型送 `{title: '亂寫'}` 後，DB 該列 `title` 仍為 NULL（回歸測試鎖住，對應地雷 6 附近的「不靠前端自律」）
  - `/public` 端點無 `Authorization` header 也能 200（對應地雷 6），且回應不含 `definitions`／`anchors` 欄位
- **依賴**：T-A1
- **風險**：低
- **預估**：3.5 小時

---

#### T-A3（0.9.15.48）`/api/flags` CRUD + HTML 掃描器（新寫）+ `/api/flags/audit`

- **範圍**：
  1. `GET/POST/PUT/DELETE /api/flags`（admin）：CRUD 對 `uep_flags`；`DELETE` 預設擋有引用旗標（見 T-A3 內含的引用檢查，409 + 引用清單，`?force=true` 強制刪）
  2. 新建 `workers/content-api/src/flags-scan.ts`：仿 `assets.ts` `extractAssetKeysFromContentBlock()` ／ `history-interlink.ts` `scanHistoryInterlinkAnchors()` 的 regex 掃描模式（**這是新寫，不是移植**，工時已按此估）：
     - `scanGrantedFlags(content): string[]`——掃 `data-role="progress-marker"` 的 `data-grants-flags`（逗號分隔），**全站掃描，不限 area**（地雷 3）
     - `scanRequiredFlags(metadata): string[]`——讀 `metadata.gate.requiresFlags` JSON 陣列
     - `classifyFlag(name): 'derived' | 'custom'`——判斷是否符合 A 類自動旗標的**形狀**（`completed:*`、`met:*`、`zone:visited:*` 前綴；`*:song`、`*:gallery`、`*:image:*` 尾碼/中綴形狀），這個函式**必須匯出、供 T-A4 的 409 檢查共用**，不可各自寫一份（否則 audit 儀表板標的「derived」與存檔時的「豁免」判定會漂移）
  3. `GET /api/flags/audit`：`SELECT id, title, area, content, metadata FROM pages WHERE deleted_at IS NULL` 全表逐列掃描，彙整 `flags[]`（`name`／`source`／`grantedBy[]`／`requiredBy[]`／`orphan`／`unused`），`source` 依 `classifyFlag` + 是否存在於 `uep_flags` 判定為 `registered`／`derived`／`unregistered`
- **驗收標準**：
  - 新建 `flags-scan.test.ts`：多旗標同 div 逗號分隔解析、壞/缺屬性容錯、`classifyFlag` 對六種 A 類形狀（含邊界案例：自訂旗標剛好以 `:song` 結尾時仍判為 custom 但會被 audit 標記提醒，不視為 bug，寫成已知限制的測試案例）
  - `/api/flags/audit` 測試涵蓋：孤兒／未使用／未註冊三種分類各一筆、`derived` 旗標不可編輯不可刪除
  - `DELETE /api/flags/:name` 有引用時 409 且列出引用清單；`?force=true` 強制刪除後該旗標於下次 audit 顯示 `unregistered`
- **依賴**：T-A1（`uep_flags` 表存在）
- **風險**：中-高（regex 對 HTML 屬性掃描要處理跳脫字元、跨 area 全表掃描的效能與 R3 風險評估、`classifyFlag` 形狀判定的邊界模糊——見上方新增風險）
- **預估**：6 小時

---

#### T-A4（0.9.15.49）`upsertPage()` 存檔前強制擋未註冊自訂旗標

- **範圍**：`workers/content-api/src/index.ts` 的 `upsertPage()` 新增旗標檢查分支（緊接既有 §3-2 key 唯一性檢查之後）：
  - 用 T-A3 的 `scanGrantedFlags`／`scanRequiredFlags`／`classifyFlag` 抽出這次存檔內容涉及的全部旗標
  - 排除 `classifyFlag` 判定為 `derived` 的旗標
  - 剩餘旗標逐一比對 `uep_flags`，任何未註冊 → 409（帶未註冊清單），與既有 key 撞名 409 走同一個前置關卡，不新增第二套攔截機制
- **驗收標準**：
  - 存檔內容帶未註冊自訂旗標 → 409，錯誤訊息含旗標清單
  - 存檔內容只帶 `completed:*` 等 A 類旗標 → 不受影響（回歸測試，確保既有「requires completion…」picker 路徑不被誤擋）
  - 已註冊旗標存檔正常通過
  - 更新既有頁面時，若這次請求沒有帶 `content`／`metadata.gate`，不誤觸發旗標檢查（比照既有 key 檢查的「只在請求真的帶了才查」慣例）
- **依賴**：T-A3
- **風險**：低-中（需要確認不會誤擋 sync/import 批次路徑——若匯入腳本會匯入尚未註冊的旗標，需要另外處理或在匯入前先批次註冊）
- **預估**：3 小時

---

#### T-A5（0.9.15.50）`/admin/keys` 三欄 UI

- **範圍**：
  1. 新建 `apps/uep/src/pages/admin/keys.astro` + `KeysManager.tsx`（`client:only="react"`，比照既有 admin 頁慣例：`getApiBase(Astro.cookies.get(TEST_MODE_COOKIE_NAME)?.value ?? null)`）
  2. 三欄佈局（清單／詳細／用在哪），沿用 `.ned-*` 編輯器視覺語彙：
     - 左欄：`GET /api/interlink/keys` ＋ `GET /api/flags/audit`，分組 entity／story／flags（含未註冊／孤兒子分組）
     - 中欄：key 的 `title`／`description` 編輯（entity 唯讀顯示 `EntityIndexEntry.name` 並標註「來源：Concepts dossier」）；flag 的類別／改名／刪除入口
     - 右欄：`GET /api/interlink/usage`（key）或 audit 的 `grantedBy`／`requiredBy`（flag），「跳到該頁編輯」連 `/admin/edit/{pageId}`
  3. `apps/uep/src/pages/admin/index.astro` dashboard 的既有佔位工具卡（`href="#"`，「設定」／「主題・解鎖規則」）改連 `/admin/keys`
- **驗收標準**：
  - 手動驗收：三欄互動（點左欄項目→中欄載入詳細→右欄載入反查）
  - entity 列的標題欄位在 UI 上明確不可編輯（disabled + 說明文字）
  - dashboard 舊佔位卡連結更新，不再是死連結
- **依賴**：T-A2、T-A3
- **風險**：低（UI 組裝，邏輯已在前兩張卡完成）
- **預估**：5 小時

---

#### T-A6（0.9.15.51）`FlagPicker.tsx` 共用元件 + 兩處編輯器接線

- **範圍**：
  1. 新建 `apps/uep/src/components/editor/FlagPicker.tsx`：可搜尋下拉（來源 `GET /api/flags`）＋「＋ 新建旗標」就地小表單（呼叫 `POST /api/flags`）＋ 已選旗標 chip 呈現；**不保留自由輸入逃生口**（依 D-1 強制設計）
  2. `RichEditor.tsx:3386-3394`：`grantsFlags` 的 `<input type="text">` 換成 `<FlagPicker>`
  3. `GateConditionEditor.tsx:246-273`：`customFlag` 的 `<input>` + 加號按鈕換成 `<FlagPicker>`；**`renderTree()`（223-244，「requires completion…」page picker）完全不動**（地雷 §1-1 ⚠️，A 類旗標路徑）
- **驗收標準**：
  - `FlagPicker.test.tsx`：搜尋過濾、選取、就地新建旗標後立刻可選
  - `RichEditor` marker bubble 與 `GateConditionEditor` 自訂旗標區塊的既有互動測試（若有）更新為使用 picker 的操作路徑
  - 手動驗收：兩處都無法再手動打字產生未註冊旗標；「requires completion…」picker 行為與改動前一致
- **依賴**：T-A3（`GET/POST /api/flags`）
- **風險**：低-中（兩處呼叫端各自是不同元件樹，需注意 props 傳遞與既有 `markerDraft`／`customFlag` state 的替換）
- **預估**：5 小時

*（合併理由見 §4-2：兩處編輯器接線與元件本身同一批次做，是討論式合併而非強制合併，見該節說明）*

---

#### T-A7（0.9.15.52）`POST /api/flags/:name/rename` 三段式改名

- **範圍**：`scan`（掃 `pages.metadata.gate.requiresFlags` JSON ＋ `pages.content` 的 `data-grants-flags` HTML）→ `dryRun`（回傳受影響頁面清單與每頁改動筆數）→ `batch` 寫入（`db.batch()` 單一交易改寫全部引用 ＋ 更新 `uep_flags.name`）
- **驗收標準**：
  - `dryRun: true` 只回預覽不寫入
  - 實際寫入後，所有引用頁的 `content`／`metadata` 都反映新名，`updated_at` 隨之更新（提醒：這會讓 sync 狀態標 modified，UI 需提示）
  - 改名不影響 `history_interlink_index`（`data-grants-flags` 不進該表，見設計文件 §3-3 ⚠️）
  - 內容改寫前後比對「該頁 `data-grants-flags` 出現次數」一致（R2 緩解機制落地為自動化斷言）
- **依賴**：T-A3、T-A4（需要旗標已在註冊表中才有得改名）
- **風險**：中-高（regex-based HTML 內容改寫，改壞等於損毀文章；務必先在 test 環境驗證）
- **預估**：4 小時

---

#### T-A8（0.9.15.53）DevTools 旗標群組

- **範圍**：新建 `apps/uep/src/devtools/actions/flagActions.ts`（比照 `protectionActions.ts`／`echoesActions.ts` 的 `getRegistry().register([...])` 慣例），於 `devtools/actions/index.ts` 註冊：
  - 傾印目前持有旗標（分組：自動／自訂／未知）
  - 授予／撤銷任意旗標（picker，來源同 `uep_flags`）
  - 模擬「持有全部註冊旗標」／「清空自訂旗標」
  - 檢查目前頁面的 gate 求值結果（直接複用 `progress/gating.ts` 的 `effectiveGate`／`evaluateEffectiveGate`，列出四維條件各自通過狀態——這是 reader 端 bundle 本來就有的能力，DevTools 面板與 Reader 同一個瀏覽器 bundle，可直接 import，不需要另外實作一份）
- **驗收標準**：四項 action 手動驗收（比照 `echoesActions.ts` 前例，這類純 DevTools 工具視工時決定是否補測試檔——若時間允許，仿 `echoesActions.test.ts` 補一份；至少四項功能要手動走過一次）
- **依賴**：T-A3（旗標清單）、T-A6（picker 元件可重用於此，或另寫簡化版）
- **風險**：低
- **預估**：3 小時

---

### S10-3b — 進度頁總覽、巡查與說明消費（接續 3a）

#### T-B1（0.9.15.54）`PATCH /api/content/:area/:slug/metadata`

- **範圍**：
  - 新增獨立路由（⚠️ **必須掛在 `contentMatch`〔`index.ts:2135`〕之前**，見地雷 2）：`/^\/api\/content\/([a-z]+)\/(.+)\/metadata$/`
  - 白名單只 `progressPage`／`gateExempt` 兩鍵；讀現有 `metadata` JSON，僅覆寫這兩鍵，其餘保留，寫回 `pages.metadata`
  - 不動 `content`，**不觸發** `rebuildHistoryInterlinkIndex`（該索引只認 content 裡的錨點）
  - admin 專用（`isAuthorized`）
- **驗收標準**：
  - 送 `{progressPage: true}` 只改該鍵，`metadata` 其餘欄位（如既有 `gate`／`entityKey`）不受影響
  - 送白名單外的鍵（如 `{entityKey: 'x'}`）被忽略或 400，不寫入
  - History 頁呼叫此端點後，`history_interlink_index` 該頁的列不變（未觸發重建，回歸測試鎖住）
  - 路由順序測試：確認 PATCH 請求沒有被 `contentMatch` 攔截吃掉（地雷 2 的直接回歸測試）
- **依賴**：T-A1（無直接依賴，但排在 S10-3a 之後執行是設計文件建議的順序；技術上可與 3a 全部並行，見設計文件 §12「9→10 獨立於 3a 全部」）
- **風險**：低（邏輯簡單，主要風險是地雷 2 的路由順序，已在驗收標準中鎖住）
- **預估**：2.5 小時

---

#### T-B2（0.9.15.55）`/admin/behavior` 上半：History 全樹進度頁總覽 + 就地切換

- **範圍**：
  1. 新建 `apps/uep/src/pages/admin/behavior.astro` + `BehaviorManager.tsx`
  2. 拉 `GET /api/content/history/tree`（既有端點），依地雷 1 的做法自建 top-down 遞迴（**不是**複製 `RichEditor.tsx` 的單層 fetch）：
     ```
     effectiveProgressPage(node) =
       isProgressPage(node.metadata)
       || (!isGateExempt(node.metadata) && effectiveProgressPage(parent(node)))
     ```
     `isProgressPage`／`isGateExempt` 從 `progress/gating.ts` import（純函式）
  3. 樹狀表格：深度縮排、`progressPage`／`gateExempt` checkbox（繼承態禁用顯示 `☑(繼承)`）、`gate 條件` 唯讀摘要（複用 `parseGateCondition`）、`標記` 欄位計數（直接查 `history_interlink_index` 依 `anchor_kind` 分組計數，不需要重新掃描——這張表已經有現成資料）
  4. checkbox 切換 → 呼叫 T-B1 的 PATCH 端點；**與編輯器 Inspector 共用同一個端點**（設計文件 ⚠️ 已強調，兩處都改同一件事，不可各自拼 metadata）
- **驗收標準**：
  - 新增純函式單元測試：3 層以上巢狀樹（chapter 標 progressPage=true，中間 arc 層不手動勾選，最底層 section）→ `effectiveProgressPage(section)` 應為 `true`（直接命中地雷 1 的多層繼承場景）；中途插入一個 `gateExempt` 節點 → 該節點與其子樹應全部斷開繼承
  - 手動驗收：勾選/取消 checkbox 後，重新整理頁面狀態持久（PATCH 生效）；編輯器 Inspector 開著時，總覽切換不會用舊快照覆蓋編輯器內容（因為走的是 metadata-only PATCH，不動 content）
  - 標記欄位計數與該頁實際 echo-spot／visual-clue／progress-marker 數量一致
- **依賴**：T-B1
- **風險**：中（樹狀 UI + 遞迴繼承邏輯是本次最複雜的前端邏輯，建議先寫純函式單元測試鎖住語意，再疊 UI）
- **預估**：6 小時

---

#### T-B3（0.9.15.56）Migration 0024（`uep_settings`）+ `/api/settings*`

- **範圍**：
  1. 新建 `workers/content-api/migrations/0024_uep_settings.sql`：`uep_settings(key PK, value TEXT, updated_at)`
  2. `GET /api/settings`（admin，含未設定項的預設值 fallback）／`PUT /api/settings`（admin，批次更新）／`GET /api/settings/public`（公開，前台消費子集）
  3. `/admin/behavior` 中段四個開關 UI（`protection.mode`／`bookmark.baseChancePct`／`note.max`／`note.textMax`）
- **驗收標準**：
  - migration 套用成功；`GET /api/settings` 在表為空時仍回傳四項的程式碼常數預設值（`LOST_BOOKMARK_BASE_PCT` 等，不因表空而報錯或回 null）
  - `PUT` 局部更新一項不影響其餘三項
  - `/public` 只回這四項，不含任何 admin-only 資訊
- **依賴**：無直接依賴（可與 T-B1/T-B2 並行）
- **風險**：低
- **預估**：4 小時

---

#### 部署步驟（不佔版號，T-B3 之後）migration 0024 三環境套用

- **範圍**：三環境各跑一次 `db:migrate:local` / `--env test --remote` / `db:migrate:remote`
- **驗收標準**：三環境 `uep_settings` 表存在且為空（無需 backfill——這張表是設定值不是衍生資料，空表本身就是合法狀態，`GET /api/settings` 會 fallback 常數）

---

#### T-B4（0.9.15.57）進度參數 runtime 接線（四個一次性讀取消費點）

- **範圍**：
  1. `DesignLayout` 掛載時 fetch `/api/settings/public` → `window.__uepSettings` + `sessionStorage` 快取（同一 session 不重取）
  2. 新建 `getSetting(key, fallbackConst)` helper
  3. 四處消費點改讀 runtime 值（皆為一次性讀取，非 tick 熱路徑）：
     - `apps/uep/src/scripts/content-protection.ts` 的 `shouldEnableProtection()`／`isNonProdEnv()` 加入 `protection.mode` 三態判斷（`always`／`never`／`env`，`env` 對應現有的 dev/測試模式邏輯）
     - 便條建立時讀 `note.max`／`note.textMax`（取代 `STORAGE_NOTE_MAX`／`STORAGE_NOTE_TEXT_MAX` 常數）
     - 讀完文章 roll 書籤機率時讀 `bookmark.baseChancePct`（取代 `LOST_BOOKMARK_BASE_PCT`）
- **驗收標準**：
  - `getSetting` 在 fetch 失敗／表為空時正確 fallback 到常數（單元測試）
  - 四處消費點各自的既有測試更新，涵蓋「設定值存在」與「設定值缺失退回常數」兩種情境
  - 手動驗收：`/admin/behavior` 調整某開關後，對應前台行為改變（例如調整 `bookmark.baseChancePct` 後下次讀完文章機率改變）
- **依賴**：T-B3
- **風險**：中（四個消費點分散在不同檔案，需逐一確認真的是「一次性讀取」而非不小心引入每 tick 判斷——若發現任何消費點需要在 scroll/IO callback 內讀，代表設計文件排除的理由不成立，需要停下來回報，不要硬塞）
- **預估**：4 小時

---

#### T-B5（0.9.15.58）內容巡查儀表板（七張卡）

- **範圍**：`/admin/behavior` 下半，七張可展開問題卡：孤兒旗標／未使用旗標／未註冊旗標（皆來自 `/api/flags/audit`）、劇情歌未綁 storyKey（`echoes-index` 掃 `songType==='story' && !storyKey`）、key 無說明（`/api/interlink/keys` 該列 title/description 皆 NULL）、孤兒錨點（`usage` 的 definitions 為空）、未被引用的 key（`usage` 的 anchors 為空）
- **驗收標準**：每張卡顯示計數＋展開列出項目＋可跳轉到修正位置（旗標卡跳 `/admin/keys`，頁面相關卡跳 `/admin/edit/{pageId}`）；七張卡各自至少一筆測試資料驗證非空狀態顯示正確
- **依賴**：T-A3（旗標三張卡）、T-A2（key 相關三張卡）
- **風險**：低-中（七個資料來源要各自串接，UI 展開機制建議抽共用元件）
- **預估**：5 小時

---

#### T-B6（0.9.15.59）§6 第 1 項：History 島線索卡顯示劇情點名稱（不可延後）

- **範圍**：`apps/uep/src/islands/interlinkTrigger.ts` 的 `triggerStoryRelated()`（精確定位：第 89 行 `title: anchor.pageTitle || anchor.pageId`）：
  - 與既有 `GET /api/interlink/anchors?keyType=story&key=...` 平行（`Promise.all`）多發一次 `GET /api/interlink/keys/public?keyType=story&key={storyKey}`（storyKey 層級查一次即可，不必逐 anchor 查）
  - 顯示優先序改為 `keyMeta?.title || anchor.pageTitle || anchor.pageId`
- **驗收標準**：擴充既有 `apps/uep/src/islands/__tests__/interlinkTrigger.test.ts`：有 `interlink_keys.title` 時卡片標題顯示該 title；無 title 時 fallback 現行行為（pageTitle→pageId）不變；`/public` 查詢失敗時整體觸發仍照舊運作（不因說明查詢失敗而連累原本的錨點功能）
- **依賴**：T-A2（`/api/interlink/keys/public` 端點）
- **風險**：低（改動集中在單一函式，已有現成測試檔可擴充）
- **預估**：2 小時
- **⚠️ 不可與 T-B7 一起延後**——命名做完卻沒有任何地方顯示名字，整條 storyKey 命名鏈沒有出口（設計文件 §6 明文警告）

---

#### T-B7（0.9.15.60，可延後）§6 其餘三項文案置換

- **範圍**（三項皆為既有 UI 的文案來源置換，互相獨立，合併同一張卡是因為風險低、工作量小，非強制合併）：
  1. Echoes 收藏池：劇情歌以 `interlink_keys` 的 `title` 呈現，取代歌名 fallback
  2. Storage 便條 entity 拖入：改填 entity-index 的 `name`（不是 `interlink_keys` 表裡的 title，entity 列 title 恆為 NULL，見 §2-2）
  3. Concepts 條目「相關」按鈕：hover／點擊顯示 `description` 摘要
- **驗收標準**：三項各自的既有渲染測試更新反映新文案來源
- **依賴**：T-A2（entity/story 說明資料）
- **風險**：低
- **預估**：4 小時
- **可延後**：設計文件明確允許，不阻塞 S10-3 收尾

---

## 3. 執行順序（依賴圖）

```
T-A1 ──→ [部署：migration 0023 三環境 + backfill] ──→ T-A2 ──┬──→ T-A5
                                                              │
                                              T-A3 ──→ T-A4 ──┤
                                                │              │
                                                └──→ T-A6 ──→ T-A7
                                                │
                                                └──→ T-A8

T-B1（可與 3a 全段並行）──→ T-B2
T-B3（可與 3a 全段並行，可與 T-B1/T-B2 並行）──→ [部署：migration 0024] ──→ T-B4
T-A3 ──→ T-B5 ←── T-A2
T-A2 ──→ T-B6（不可延後）
T-A2 ──→ T-B7（可延後）
```

**硬依賴鏈（關鍵路徑）**：`T-A1 → T-A2 → T-A5`（key 管理主鏈）、`T-A1 → T-A3 → T-A4 → T-A6 → T-A7`（旗標管理主鏈，`T-A8` 由 `T-A3`／`T-A6` 匯合）。

**可並行的段落**：
- `T-B1`／`T-B3` 與整個 S10-3a 沒有資料依賴，理論上可由第二人並行處理（設計文件 §12「9→10 獨立於 3a 全部」），但因為 `/admin/keys` 與 `/admin/behavior` 共用不少 UI 語彙與可能的共用元件，實務上建議還是照 3a→3b 順序做，避免兩邊各自長出風格不一致的表格/卡片元件
- `T-B5`（巡查儀表板）依賴 `T-A3` 的 `/api/flags/audit` 與 `T-A2` 的 `/api/interlink/keys`，必須排在兩者之後
- `T-B6`（不可延後）只依賴 `T-A2`，可以在 `T-A2` 完成後立刻插隊做，不必等到 3b 其他卡

---

## 4. 合併理由對照（哪些必須合併、哪些是討論式合併）

### 4-1 強制合併（中間狀態無法編譯／無法獨立 revert）

**T-A1**：migration 0023 的 `DROP TABLE story_points` 與 `interlink.ts` 三個函式改名、`index.ts` 呼叫端改名、以及 §1 地雷 4 列出的 8 個檔案，全部是同一個重命名操作的不同切面。若拆成「先改 migration」「再改 interlink.ts」「再改測試」多個 commit：
- migration 先套用但 `interlink.ts` 還在呼叫已不存在的 `story_points` 表 → 執行期錯誤
- `interlink.ts` 先改函式名但 `index.ts` 還在呼叫舊函式名 → TypeScript 編譯錯誤
- 兩者都改了但測試檔案還在斷言 `story_points` → 測試套件紅燈

這與 S10-1 的 T-D2~T-D5（`deriveSongUnlockFlag` 簽名變更）是同一種「重命名/簽名變更牽連呼叫端」模式，S10-1 當時因此把 4 張規劃卡合併成 1 個 commit。T-A1 提前規劃為單一任務卡，不會重蹈「拆卡拆了但實作時發現拆不開」的覆轍。

### 4-2 討論式合併（風險低、標準拆法可拆但拆開沒有獨立驗收價值）

**T-A6**（`FlagPicker.tsx` + 兩處編輯器接線）：理論上可拆成「新建元件」「接 RichEditor」「接 GateConditionEditor」三個 commit，且不會有編譯錯誤（元件本身可以獨立存在不被任何人呼叫）。但拆成三個 commit 中第一個「只新增元件、沒有任何呼叫端」不具備獨立驗收價值（沒有 UI 可以手動驗收這個元件是否真的可用），故合併為一張卡。若實作時發現兩處編輯器接線的改動量差異很大，可以在保留元件本身為一個 commit 的前提下拆開兩個呼叫端，但不建議。

**T-B7**（§6 其餘三項文案置換）：三項互相獨立，可以是三張卡，但工作量都小（各自都是「換一個顯示來源」等級的改動），且都可延後、都低風險，合併成一張卡單純是為了不讓版號過度細碎，不是因為技術上綁死。

---

## 5. 測試策略

### 5-1 逐卡測試層級

| 卡 | Worker 測試 | 前端測試 | 手動驗收 |
|---|---|---|---|
| T-A1 | ✅ 既有 4 個測試檔更新 | — | migration 套用結果查表 |
| T-A2 | ✅ 新增 | — | — |
| T-A3 | ✅ 新增（scan + audit） | — | — |
| T-A4 | ✅ 新增（409 + 回歸） | — | 確認不誤擋 sync/import |
| T-A5 | — | 視慣例（admin 頁多半無專屬元件測試） | ✅ 三欄互動 |
| T-A6 | — | ✅ `FlagPicker.test.tsx` + 既有編輯器測試更新 | ✅ 兩處接線 |
| T-A7 | ✅ 新增（三段式 + 內容改寫比對） | — | ✅ 先在 test 環境跑一次真實改名 |
| T-A8 | — | 視工時（比照 `echoesActions.test.ts` 前例） | ✅ 四項 action |
| T-B1 | ✅ 新增（白名單 + 路由順序回歸） | — | — |
| T-B2 | — | ✅ 純函式單元測試（多層繼承場景，鎖地雷 1） | ✅ 全樹 UI + 就地切換 |
| T-B3 | ✅ 新增 | — | — |
| T-B4 | — | ✅ `getSetting` fallback + 四消費點既有測試更新 | ✅ 調整開關後前台行為變化 |
| T-B5 | — | — | ✅ 七張卡各自驗證 |
| T-B6 | — | ✅ 擴充既有 `interlinkTrigger.test.ts` | ✅ 島卡片顯示劇情點名稱 |
| T-B7 | — | ✅ 既有渲染測試更新 | ✅ 三處文案 |

### 5-2 Test 環境樣本準備（驗收在 test worker，正式站零資料）

實作前需在 test 環境（`eternity-content-api-test`）主動造出以下樣本，覆蓋設計文件 §11-1 第 2 點要求的「不要用正式站沒資料當跳過測試的理由」：

1. **多錨點劇情點**：一個 storyKey 同時掛在 Echoes 劇情歌 + Visuals 插圖 + 至少 2 個不同 History 頁的錨點——驗證 `/api/interlink/usage`／`/admin/keys` 右欄反查列表能正確去重並列出多筆
2. **跨 stack entity**：test D1 現有 `a-man`（echoes song + visuals gallery）可以擴充，或另造一個橫跨 Concepts + Echoes + Visuals 三處以上的 entityKey，比照正式站 `xavier-colsono` 的橫跨模式
3. **孤兒旗標／未使用旗標**：先在 `uep_flags` 註冊兩個旗標，其中一個只在某頁 `requiresFlags` 出現（無人 grants →孤兒），另一個只在某頁 `data-grants-flags` 出現（無人 requires → 未使用）——這兩種狀態旗標已註冊過，不會被 T-A4 的 409 擋下，可以直接在編輯器操作產生
4. **未註冊旗標**：直接繞過編輯器（用 API 或 DB 直寫）造一筆 `data-grants-flags` 帶未在 `uep_flags` 出現的自訂旗標名——用來驗證 audit 的 `unregistered` 分類，注意這種資料在 T-A4 上線後無法透過正常編輯器存檔路徑產生，必須用其他方式造（例如在 T-A4 部署前先造，或直接寫 DB）
5. **未綁 storyKey 的劇情歌**：造一首 `songType==='story'` 但 `metadata.storyKey` 為空的歌——觸發巡查項「劇情歌未綁 storyKey」
6. **三層以上巢狀進度頁樹（驗證地雷 1 的多層繼承）**：至少 chapter→arc→section 三層，**只在最頂層（chapter）手動標記 `progressPage=true`，中間層（arc）刻意不勾選**，驗證 `/admin/behavior` 總覽正確顯示 section 為「繼承」狀態；另外造一個在 arc 層插入 `gateExempt=true` 的分支，驗證豁免切斷點正確斷開子樹繼承

---

## 6. 設計文件落差彙整（快速索引，詳細內容見 §1）

| # | 落差類型 | 對應章節 |
|---|---|---|
| 1 | `inheritedProgressPage` 只是接收端，真正多層祖先鏈邏輯在 `progress/gating.ts` 的 `effectiveGate`，兩者非同一份程式碼，複用時要複用「規則」不是「機制」 | §1 地雷 1 |
| 2 | `PATCH .../metadata` 路由若照字面路徑掛載會被既有 `contentMatch` 正規式吞掉，需獨立路由且排在其前 | §1 地雷 2 |
| 3 | `/api/flags/audit` 的授予端掃描範圍是全站，不是 History 專屬（`ProgressMarkerNode` 掛載在共用的 `RichEditor.tsx`） | §1 地雷 3 |
| 4 | `story_points`→`interlink_keys` 改名牽連 8 個檔案，其中 `test-seed.ts` 的 `BUSINESS_TABLES` 與 `test-reset.test.ts` 是設計文件完全沒提到的隱性依賴 | §1 地雷 4 |
| 5 | （確認一致，非落差）`interlink.ts` 現有三函式與 `/api/interlink/usage` 皆與設計文件描述吻合 | §1 地雷 5 |
| 6 | `/api/interlink/keys/public` 不可誤加 `isAuthorized`，否則前台觸發點（皆為匿名 fetch）會靜默 401 失效 | §1 地雷 6 |

設計文件 §12 的 14 步建議順序經本次細化後**順序本身沒有問題**，依賴關係（1→2→3→5、1→4→5、5→6→7、9→10 獨立於 3a、11 依賴 4、12 依賴 3）與本文件 §3 的依賴圖一致，未發現需要調整順序的理由；本文件只是把每一步拆得更細、補上部署步驟與路由順序等實作細節。

---

*文件結束。*
