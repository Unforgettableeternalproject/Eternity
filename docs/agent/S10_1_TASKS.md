# S10-1 拆卡計畫：跨區互聯（entityKey / storyKey 命名空間 + 反向索引）

> 依據：`docs/agent/S10_INTERLINK_DESIGN.md`（二輪定案，無待拍板問題）
> 起始版本：**0.9.15.0**（S10-0 已完成待驗收）
> 拆卡：戴爾維斯（planner）
> 開工前已完成程式碼實測（本文件所有「地雷」段落皆為實際讀碼結果，非設計文件推測）

---

## 0. 版號預算（艾斯維爾 2026-07-26 已拍板：方向 1 — 標準拆法 18 版次）

**定案：採標準拆法，S10-1 單獨用掉 0.9.15.1~0.9.15.18，完整 9 個工作面一次做完，不砍範疇。**
S10-2／S10-3／S10-4 的版號預算另行重估，不再要求整個 S10 塞進 10 版次以內（比照 S8 先例）。
下方「壓縮拆法」與「可移出的延後候選」標注**保留作為記錄**，本次不採用——若實作中途需要重新評估，
再回頭看這兩份對照，不要因為看到它們存在就以為範疇仍有彈性。

以下為拍板前的原始分析，保留供追溯。

### 0-1 原始張力分析（拍板前）

設計文件 §11-1 列了 9 個工作面：①SQL 防禦 ②地基（migration+索引擴充）③illustrationId 遷移 ④唯一性把關+旗標新簽名+分類唯讀 ⑤反向索引寫入 ⑥查詢端點 ⑦觸發模型 ⑧便條擴充 ⑨（併入④）。

依實際檔案邊界拆卡後：

| 拆法 | 版號數 | 範圍 |
|---|---|---|
| **標準拆法**（每個檔案群一個 commit，可溯源、可獨立 revert） | **18**（0.9.15.1~0.9.15.18） | 完整 9 個工作面 |
| **壓縮拆法**（同工作面內大膽合併，犧牲部分可溯源性） | **12**（0.9.15.1~0.9.15.12） | 同上，範圍不減，只減 commit 數 |

兩者都**明顯超過**艾斯維爾「5-6 個版次，可能到 10 個」的預期。這不是拆卡技巧能解決的——S10-1 本身涵蓋 5 個 zone（Concepts/Echoes/Visuals/History/Storage）+ worker + 便條系統，工作面數量（9 個）已經和 S8（雙島全鏈，20 版次）同量級。**不建議為了湊數字把不相關的檔案硬塞進同一 commit**（那只會製造難以 revert 的巨石 commit，且 code review 品質會下降）。

**當時提出的兩個方向（艾斯維爾已選 1）**：

1. **接受 S10-1 單獨用掉 12-18 個版次**（比照 S8 先例：S8 單一 session 就用了 20 版次，本次範疇不比它小），S10-2/S10-3/S10-4 另外重新估算版號預算，不要求整個 S10 塞進 10 版次以內。
2. **真正縮小 S10-1 範疇**（不是壓縮 commit 數，是砍工作項）：把下列三項移出 S10-1、順延 S10-4（技術債）或 S11：
   - §7 便條擴充（H 段，3-4 版次）——與其餘 8 個工作面耦合度最低，最適合單獨延後
   - §6 的 Concepts 觸發按鈕（G-6，設計文件本身也建議「最後做」）——不做的話 Concepts 條目暫時沒有跨區互聯入口，但 Echoes/Visuals 自動觸發 + History 島消費仍可獨立驗收
   - §1-4 Echoes 分類唯讀——純白工但不影響互聯核心功能，可獨立於任何時候補
   移出後 S10-1 核心（①②③④⑤⑥ + G-1~G-5）約 **11-13 個版次**，仍超過 10 但已是能做到的下限。

本文件下方**同時提供兩種拆法的版號對照**，並在標準拆法基礎上標注哪些卡屬於「可移出」的延後候選。

---

## 0-2 開工前環境實測（2026-07-26，設計文件 §11-2 必查項，全數通過）

| 必查項 | 實測結果 | 意義 |
|---|---|---|
| `SELECT COUNT(*) FROM uep_users`（正式 D1） | **0** | §2-3-a 的旗標無痛改名視窗**仍然開著**，D 段不需要雙寫／補授予腳本 |
| 下一個 migration 編號 | **0022**（已套用至 `0021_users_progress_rev.sql`） | 與設計文件 §5-3 假設一致 |
| `pnpm check` 基線 | **exit 0，全綠**（30.4s） | 0.9.15.0 基線乾淨，沒有既有問題要先另開 `fix:` commit |
| 正式 D1 History 標記總量 | 全站僅 `chpt.01/01-06-同病相憐` 一頁（2 echo-spot／1 visual-clue／1 entity mark） | 設計文件 §9 R2（整頁重建 batch 筆數）在當前資料量下不構成風險 |
| `storyKey` 現存筆數 | 正式／測試 D1 **皆 0** | 純新建欄位，無遷移對象 |
| `illustrationId` 現存筆數 | 正式 **0**、測試 **1**（`visuals/illustrations/era_u/測試畫廊` → `test-id`） | C 段遷移腳本只需處理測試 D1 那 1 筆 |

⚠️ **與 PM 舊筆記的落差（C／D 段驗收必讀）**：舊盤點筆記記載「visuals entityKey = 0」，
**現況為 2 筆**——`uep` @ `profiles/characters/unknown`、`xavier-colsono` @ `profiles/characters/area_3`。
連同 concepts×2、echoes×1，`xavier-colsono` 目前橫跨**四處**且**全部合法**（艾斯維爾 07/26 裁定：
跨 zone 完全允許，那正是互聯的基礎）。D 段的 409 唯一性驗證**必須確保這四處不會被誤擋**，
建議直接寫成回歸測試案例。測試 D1 另有 `a-man` 同時掛 echoes song + visuals gallery，同樣合法。

---

## 1. 開工前必查（三個地雷，皆為本次讀碼新發現，設計文件未點名或描述不完整）

### 地雷 1：`deriveSongUnlockFlag` 呼叫端比設計文件描述的更多、且不是「加參數」這麼簡單

設計文件 §2-3-a 只給了函式簽名變更，但實際呼叫端有 **6 處非測試程式碼**：

| 檔案 | 呼叫方式 | 問題 |
|---|---|---|
| `apps/uep/src/components/echoes/echoesVisibility.ts:58` | `progress.flags.includes(deriveSongUnlockFlag(node.id, entityKey))` | **內聯判斷式**，新簽名回傳 `string \| null` 時不能直接塞進 `flags.includes()`——`null` 要先短路跳過整個判斷分支，不能只是換參數 |
| `apps/uep/src/components/history/useEchoSpots.ts:325-330` | `deriveSongUnlockFlag(effective.songId, effective.entityKey)` → `grantFlags([unlockFlag])` | 同上，`unlockFlag` 為 `null` 時 `grantFlags([null])` 會壞資料，必須加 guard |
| `apps/uep/src/devtools/actions/echoesActions.ts:49,63,77` | 三個 DevTools action 呼叫 `deriveSongUnlockFlag(identity.songId, identity.entityKey)` | `promptSongIdentity()` 只問 songId+entityKey，沒有 songType/storyKey 概念，三個 action 的 prompt 流程都要擴充 |

**額外缺口**：`EntitySongPayload`（`workers/content-api/src/echoes-song.ts`）目前**沒有 `storyKey` 欄位**——`useEchoSpots.ts` 要判斷劇情歌旗標時，`effective`（反查回來的現行資料）根本拿不到 storyKey。這個後端欄位缺口設計文件完全沒提到，是本次讀碼新發現，D-6a 卡必須先補這個欄位。

`echoesActions.ts` **沒有對應測試檔案**（純 DevTools 手動工具），改動後不會被自動測試擋住，需要手動驗證三個 action。

### 地雷 2：History 反向索引的「移植」不是複製貼上，是重寫

設計文件 §4-3「複用 History 編輯器既有的 `collectEchoSpotIssues`／`collectVisualClueIssues` 同款遍歷邏輯的 worker 端版本」這句話容易被誤讀成「把這兩個函式搬進 worker」。**實際上不可能直接搬**：這兩個函式簽名是 `(doc: PMNode) => ...`，`PMNode` 來自 `@tiptap/pm/model`，是瀏覽器端 ProseMirror 專用型別，Cloudflare Worker（V8 isolate，無 DOM）沒有這個執行環境，且 `content` 欄位存的是**序列化後的 HTML 字串**（`ContentBlock[]` 中 `rich_text` block 的 `content` 是 HTML string），不是 PMNode 樹。

**既有精確前例**：`workers/content-api/src/assets.ts` 的 `extractAssetKeysFromContentBlock()` 已經在解同樣的問題——對 HTML 字串做 **regex 掃描**（`assetUrlRegex.exec`），遞迴處理 JSON 巢狀結構。History 反向索引掃描器必須照這個模式重新寫一套 regex-based 掃描（比對 `data-role="echo-spot"`、`data-role="visual-clue-*"`、`data-uep-entity="entity"` + `data-ref="entity:{key}"` 等屬性），**不是移植既有函式**，是仿其「掃描意圖」重寫一份。工時估算要按「新寫一個 HTML 屬性掃描器」而非「搬程式碼」計算。

### 地雷 3：`upsertPage()` 目前完全沒有 area 專屬前置關卡

`workers/content-api/src/index.ts:286-448` 的 `upsertPage()` 是純粹的通用 upsert（existing/insert 判斷 → UPDATE/INSERT → sort_order 重排 → 回傳），**沒有任何 area 分支**。§3-2 的 409 擋重複與 §4-3 的 History 反向索引重建都是**全新插入的 area-specific 邏輯**，會讓這個函式明顯變大變複雜，不是在既有分支上加條件。同理 `deletePage()`（L451-471）也是純通用軟刪除，History 索引清理是全新分支。這不影響「能不能做」，但估工時要把「在通用函式裡插入 area 分派」的重構成本算進去，不能假設有現成掛點。

---

## 2. 任務拆解（標準拆法，18 版次）

### S10-1-A — SQL 端防禦補強（§8）
無依賴，風險最低，**最先做**。

#### T-A1（0.9.15.1）SQL 端 json_extract 防禦補強
- **範圍**：
  1. `workers/content-api/src/echoes-song.ts` `findEntitySong`：SQL 改回只篩 `area/page_type/deleted_at`，`entityKey`/`hidden` 判定搬進應用層 try/catch；順手擴充支援 `storyKey` 反查
  2. `workers/content-api/src/visuals-gallery.ts` `findEntityGallery`：同上，擴充支援 `storyKey`
  3. `workers/content-api/src/concepts-index.ts` `buildConceptsEntityIndex` 的 `publicOnly` 分支：拿掉 SQL `visibleClause`，`hidden`/`locked` 判定搬進既有逐列 try/catch（`collectFromPage` 呼叫前的迴圈）
- **輸入/輸出**：純函式內部重構，對外行為不變（除新增 storyKey 支援）
- **驗收標準**：
  - `workers/content-api/src/__tests__/echoes-song.test.ts`、`visuals-gallery.test.ts`、`concepts-index.test.ts` 既有斷言全綠（先讀一遍確認無 SQL 層過濾順序依賴）
  - 新增：壞 JSON 一列不影響其餘列的查詢結果（現況全站 0 筆壞資料，但要補防禦性測試案例）
  - 新增：`findEntitySong`/`findEntityGallery` 以 storyKey 命中的測試案例
- **依賴**：無
- **風險**：低
- **預估**：3 小時

---

### S10-1-B — 地基（migration + entity-index 擴充 + findKeyConflict）

#### T-B1（0.9.15.2）Migration 0022 + 三個 entity-index 建構器擴充 storyKey
- **範圍**：
  1. 新建 `workers/content-api/migrations/0022_interlink_index.sql`：`history_interlink_index` 表（含 `idx_hii_key`/`idx_hii_page`）+ `story_points` 表（見設計文件 §2-4/§4-2 完整 schema）
  2. `workers/content-api/src/echoes-index.ts`：`EchoesEntityIndexEntry` 加 `storyKey?: string`，`buildEchoesEntityIndex` 收集 `meta.storyKey`
  3. `workers/content-api/src/visuals-index.ts`：同上
  - Concepts 不動（storyKey 命名空間不含 Concepts）
- **驗收標準**：
  - `pnpm --filter content-api-worker db:migrate:local` 成功套用，`sqlite_master` 可查到兩張新表
  - `echoes-index.test.ts`/`visuals-index.test.ts` 新增 storyKey 命中/未命中案例
- **依賴**：無（可與 T-A1 並行）
- **風險**：低
- **預估**：2.5 小時

#### T-B2（0.9.15.3）`interlink.ts` — `findKeyConflict()`
- **範圍**：新建 `workers/content-api/src/interlink.ts`：`KeyConflictQuery` 型別 + `findKeyConflict(db, query)`。內部依 `area` 分派：
  - Concepts → 呼叫 `buildConceptsEntityIndex(db)`，過濾 `stack + scope（variantId/pageId）` 相符者
  - Echoes/Visuals → 呼叫擴充後的 `buildEchoesEntityIndex`/`buildVisualsEntityIndex`，過濾 `keyType` 相符者（entity 比對 entityKey 欄位、story 比對 storyKey 欄位）
  - 排除 `excludePageId`
- **驗收標準**：新增 `workers/content-api/src/__tests__/interlink.test.ts`：涵蓋三個 area 各自的衝突/無衝突/排除自身案例；entity/story 兩種 keyType
- **依賴**：T-B1（storyKey 欄位需先存在）
- **風險**：低（純函式，邏輯已在設計文件寫死）
- **預估**：3 小時

---

### S10-1-C — illustrationId → storyKey 遷移（§5）

#### T-C1（0.9.15.4）欄位改名 + 一次性遷移腳本（同批次落地）
- **範圍**（設計文件明確要求「一次性腳本 + 程式碼變更同批次」，避免欄位名稱認知空窗）：
  1. `apps/uep/src/components/editor/VisualClueNode.ts`：`VisualClueTargetType` 型別 `'entity'|'illustration'` → `'entity'|'story'`；`parseHTML`/`renderHTML` 的 `'illustration'` 字面值改 `'story'`
  2. `apps/uep/src/components/editor/VisualsEditorBody.tsx`：`illustrationId` 欄位改名 `storyKey`；`showIllustrationId` 沿用（分館判斷不變）；`collectOtherKeys` 回傳型別 `illustrationIds` 改名 `storyKeys`；`EntityKeyField` 的 label/placeholder/duplicateMessage 文案同步
  3. `apps/uep/src/components/editor/VisualsGalleryPicker.tsx`：讀取欄位改 `meta.storyKey`
  4. `apps/uep/src/components/history/visualClueGallery.ts`：`ClueGalleryPayload.illustrationId` 改名 `storyKey`
  5. `workers/content-api/src/visuals-gallery.ts`：`findGalleryByIllustrationId` 改名 `findGalleryByStoryKey`（查詢 `json_extract(metadata, '$.storyKey')`）；`EntityGalleryPayload.illustrationId` 改名 `storyKey`
  6. `workers/content-api/src/index.ts`：對應路由參數 `/api/visuals/gallery?illustration=` 改 `?story=`
  7. 新建一次性腳本 `scripts/archive/migrate-illustration-id-to-story-key.mjs`：
     - 掃 `area='visuals' AND page_type='gallery'` 且 `metadata.illustrationId` 存在的頁面 → 寫 `metadata.storyKey`、刪除 `metadata.illustrationId`
     - 掃 `area='history'` 內容中 `data-target-type="illustration"` → 取代 `data-target-type="story"`（`targetKey` 不變）
     - 涵蓋正式 + 測試兩個 D1（`--remote` flag 切換，比照既有 archive 腳本慣例）
- **驗收標準**：
  - `VisualClueNode.test.ts` 更新斷言（`targetType` 值改 `'story'`）
  - `VisualsEditorData.test.ts`、`visuals-gallery.test.ts` 更新
  - 腳本 dry-run 模式（不帶 `--write`）先確認候選筆數：正式 D1 應為 0 筆 gallery（全站 illustrationId 皆 null）+ 0 筆 history clue；測試 D1 應為 1 筆 gallery（`測試畫廊`）+ 視當下 history 測試資料而定
  - 腳本 `--write` 執行後，測試 D1 該筆 gallery 的 `metadata.storyKey === 'test-id'` 且無 `illustrationId` 鍵
- **依賴**：T-B1（`buildVisualsEntityIndex` 已擴充 storyKey，此卡完成後該擴充才有真實資料可查）——技術上可對調順序，但依設計文件建議順序（越早遷移越少橫跳）維持 C 在 B 之後、D 之前
- **風險**：低（全站僅 1 筆真實資料受影響，且是測試資料）
- **預估**：4 小時（腳本 + 5 個檔案改名 + 測試更新）

---

### S10-1-D — 唯一性把關落地 + 旗標新簽名 + Echoes 分類唯讀（範疇最大，5 個版次）

#### T-D1（0.9.15.5）`upsertPage()` 409 擋重複 + `extractCandidateKeys` + `story_points` 建檔
- **範圍**：`workers/content-api/src/index.ts` 的 `upsertPage()`：
  - 寫入 DB 之前，area in (`concepts`/`echoes`/`visuals`) 時呼叫 `extractCandidateKeys(area, body)` → 逐一 `findKeyConflict()` → 有衝突回傳 409 `{ field, key, conflictingPageId, conflictingPageTitle }`
  - `extractCandidateKeys`：Echoes/Visuals 直接讀 `body.metadata.entityKey`/`storyKey`；Concepts 移植 `EntityKeyField.tsx` 的 `collectEntityKeyIssues()` 遍歷邏輯到 worker 端（四種 stack 形狀，**注意這是第三份同邏輯實作**，比照 `concepts-index.ts` `collectFromPage()` 的既有慣例，不追求三處共用）
  - 寫入成功後，若偵測到 storyKey，`INSERT OR IGNORE INTO story_points (story_key, title, description, created_at, updated_at) VALUES (?, NULL, NULL, ?, ?)`
- **驗收標準**：`workers/content-api/src/__tests__/api.test.ts` 新增案例：
  - Echoes/Visuals 同 zone 撞名 entityKey/storyKey → 409
  - Concepts 同 stack 撞名 → 409；不同 stack 或不同 variant 不衝突
  - 更新自身頁面（`excludePageId` 生效）不誤擋
  - 軟刪除頁面的 key 被釋放（不佔用命名空間）
  - storyKey 首次出現寫入 `story_points`，重複出現不覆蓋既有 title/description
- **依賴**：T-B2、T-C1（Concepts 遍歷邏輯需先確認欄位結構；Echoes/Visuals 已是 storyKey 命名）
- **風險**：中（worker 端要重新實作一份 Concepts 四種 stack 遍歷器，容易與前端版本語意漂移）
- **預估**：4 小時

#### T-D2（0.9.15.6）前端 `EntityKeyField` Concepts existingKeys 跨頁修正
- **範圍**：`apps/uep/src/components/editor/ConceptsEditorBody.tsx` 四處 `usedEntityKeys` 組裝（dossier/browser/chrono/diff，L615/L1057/L2003/L2876）：改為排除自身頁面後，依 `(stack, variantId 或 pageId)` 過濾 `/api/concepts/entity-index` 回應，取代目前「只算同頁面/同 variant」的範圍
- **驗收標準**：新增/更新對應編輯器測試（跨兩個頁面同 stack 同 key 應警告；跨 stack 不應警告）
- **依賴**：無新後端需求（`entity-index` 回應已帶 `stack`/`variantId`/`pageId`）
- **風險**：低（純前端邏輯修正）
- **預估**：2.5 小時

#### T-D3（0.9.15.7）Echoes/Visuals storyKey 前端整合 + Echoes 分類唯讀（同批次，同檔案）
- **範圍**：
  1. `apps/uep/src/components/editor/EchoesEditorBody.tsx`：`EchoesData` 新增 `storyKey?: string` 欄位（`parseEchoesData`/`serializeEchoesData` 同步）；JSX 依 `category==='story'` 互斥顯示 `storyKey` 欄位（否則顯示既有 `entityKey` 欄位，仿 `VisualsEditorBody` 的 `showEntityKey`/`showIllustrationId` 模式）；新增 `otherStoryKeys` state（同 `otherEntityKeys` 模式，抓 `/api/echoes/entity-index` 回應新的 `storyKey` 欄位）；`category==='story'` 時軟性 hint 文案（§2-3：「未設定 storyKey 的劇情歌只能透過 Echo Spot 插播聆聽，無法進入收藏池、也無法與插圖互聯」），**不做必填驗證**
  2. 同檔案：`EchoSongPicker.tsx:64-76` 判斷順序反轉（cluster 優先於 category）；`EchoesEditorBody.tsx` 分類下拉改唯讀展示（disabled，值由 cluster 推導顯示，欄位保留）
  3. `apps/uep/src/components/editor/VisualsEditorBody.tsx`：`otherKeys` 補上抓取 `storyKeys`（T-C1 已改名，此處補齊組裝邏輯若 T-C1 未含此段）
- **驗收標準**：
  - `EchoesEditorData.test.ts`：storyKey 序列化/反序列化、`category!=='story'` 時 storyKey 不輸出
  - `EchoSongPicker.test.ts`：cluster/category 不一致時以 cluster 為準
  - 手動驗收：分類下拉在編輯器中唯讀（無法手動改變）
- **依賴**：T-B1（storyKey 索引欄位）、T-C1（欄位命名已定）
- **風險**：低-中（EchoesEditorBody.tsx 是大檔案，改動面廣但邏輯清楚）
- **預估**：4 小時

#### T-D4（0.9.15.8）`deriveSongUnlockFlag` 簽名調整 + 後端 storyKey 欄位補齊
- **範圍**：
  1. `apps/uep/src/audio/spoilerResolver.ts`：`deriveSongUnlockFlag` 簽名改為 `(songType: string, entityKey?: string, storyKey?: string) => string | null`（見設計文件 §2-3-a 程式碼）
  2. `workers/content-api/src/echoes-song.ts`：`EntitySongPayload` 新增 `storyKey: string | null` 欄位，`buildSongPayload` 補上解析（**本次讀碼新發現的缺口，設計文件未提及**）
  3. `apps/uep/src/components/editor/__tests__/EchoSpotNode.test.ts`：確認 `storyKey` 屬性新增後既有斷言是否需同步更新
- **驗收標標準**：
  - `apps/uep/src/audio/__tests__/spoilerResolver.test.ts`（若無則新建）：`songType==='story' && !storyKey` → `null`；有 storyKey → `{storyKey}:song`；character/area 沿舊行為不變
  - `workers/content-api/src/__tests__/echoes-song.test.ts` 新增 storyKey 欄位斷言
- **依賴**：T-D3（EchoesEditorBody 已能寫入 storyKey）
- **風險**：低（純簽名調整+補欄位，呼叫端改造獨立在 T-D5）
- **預估**：2 小時

#### T-D5（0.9.15.9）`deriveSongUnlockFlag` 呼叫端全面改造（地雷 1 的落地）
- **範圍**（見上方「地雷 1」清單）：
  1. `apps/uep/src/components/echoes/echoesVisibility.ts` `isSongUnlockedInZone`：讀 `node.metadata.category`（songType）+ `node.metadata.storyKey`；呼叫新簽名；回傳 `null` 時整段旗標檢查短路跳過（不進 `flags.includes(null)`）
  2. `apps/uep/src/components/history/useEchoSpots.ts:325-330`：`effective.storyKey` 傳入新簽名；`unlockFlag` 為 `null` 時不呼叫 `grantFlags`、`isSongCollected` 也不求值
  3. `apps/uep/src/devtools/actions/echoesActions.ts`：`promptSongIdentity()` 擴充問 `songType`（`character`/`area`/`story`）與可選 `storyKey`；三個 action（grant/relock/derive）呼叫新簽名並處理 `null` 回應（提示「此組合無法產生旗標」）
- **驗收標準**：
  - `echoesVisibility.test.ts` 新增：無 storyKey 的劇情歌永遠 `isSongUnlockedInZone === false`（除非 gate 通過）
  - `useEchoSpots.test.ts`：mock `deriveSongUnlockFlag` 新簽名，驗證 `null` 時不觸發 `grantFlags`
  - `echoesActions.ts` **無自動測試**，手動驗收：DevTools 三個 action 對劇情歌（有/無 storyKey）行為正確
- **依賴**：T-D4
- **風險**：中（多處呼叫端改造，`echoesActions.ts` 無測試網保護，需手動驗收）
- **預估**：3.5 小時

---

### S10-1-E — 反向索引寫入（§4-3，含地雷 2 的掃描器重寫）

#### T-E1（0.9.15.10）History 三種標記掃描器（worker 端新寫，非移植）
- **範圍**：新建 `workers/content-api/src/history-interlink.ts`：`scanHistoryInterlinkAnchors(content: string): HistoryInterlinkAnchor[]`——regex-based 掃描（比照 `assets.ts` `extractAssetKeysFromContentBlock` 模式，**不是移植 `collectEchoSpotIssues`/`collectVisualClueIssues`**，見「地雷 2」）：
  - `data-role="echo-spot"` → 取 `data-spot-id`/`data-entity-key`/`data-story-key`（依 EchoSpotNode 新屬性）
  - `data-role="visual-clue-start/gate/end"` → 取 `data-clue-id`/`data-target-type`/`data-target-key`
  - `data-uep-entity="entity"` + `data-ref` → 僅收 `entity:{key}` 新格式（`data-ref` 值以 `entity:` 前綴判斷），同頁同 key 去重（保留第一次出現的顯示文字為 label）
- **驗收標準**：新建 `workers/content-api/src/__tests__/history-interlink.test.ts`：涵蓋三種標記各自的擷取、entity mark 去重、舊格式 ref 不進索引、壞/缺屬性容錯
- **依賴**：T-B1（表結構已定義，本卡先只是純函式，不寫 DB）
- **風險**：中-高（regex 對 HTML 屬性掃描要處理跳脫字元、屬性順序不定等邊界情況，且 History 目前含 CJK 文字，正則要小心邊界）
- **預估**：4 小時

#### T-E2（0.9.15.11）`upsertPage`/`deletePage` History 分支接線
- **範圍**：
  1. `upsertPage()` 新增 `area === 'history'` 分支：內容寫入成功後呼叫 `scanHistoryInterlinkAnchors(body.content)`，`db.batch([DELETE FROM history_interlink_index WHERE page_id=?, ...INSERT])`（比照既有 `reindexChildren` 的 batch 手法）
  2. `deletePage()` 新增 `area === 'history'` 分支：軟刪除成功後 `DELETE FROM history_interlink_index WHERE page_id = ?`
- **驗收標準**：`api.test.ts` 新增：History 頁存檔後 `history_interlink_index` 有對應列；重複存檔相同內容索引列不變（冪等）；軟刪除後索引列清空
- **依賴**：T-E1
- **風險**：低（接線邏輯，掃描器已獨立測過）
- **預估**：2.5 小時

---

### S10-1-F — 查詢端點（§4-5）

#### T-F1（0.9.15.12）`/api/interlink/anchors` + `/api/interlink/usage`
- **範圍**：
  - `GET /api/interlink/anchors?keyType=&key=`：`SELECT DISTINCT page_id, page_title(join pages), anchor_kind, label FROM history_interlink_index WHERE key_type=? AND key_value=?`
  - `GET /api/interlink/usage?keyType=&key=`：定義端 live-scan（複用 `findKeyConflict` 同款 index 建構器，列出而非比對衝突）+ 錨點端讀表 + `storyPoint`（僅 `keyType='story'`，查 `story_points`）
  - 路由掛在 `workers/content-api/src/index.ts` 的 fetch 分派（獨立前綴，避開 contentMatch regex，比照 `/api/concepts/entity-index` 慣例）
- **驗收標準**：新增測試涵蓋兩端點的正常回應、查無資料回空陣列、`keyType` 非法值 400
- **依賴**：T-E2（anchors 表已有資料可查）、T-B2（`findKeyConflict` 邏輯可複用其 index 建構器）
- **風險**：低
- **預估**：3 小時

---

### S10-1-G — 觸發模型（§6）【G-3 可移出至延後清單，見 §0】

#### T-G1（0.9.15.13）`interlinkTrigger.ts` bridge + Echoes/Visuals 自動觸發
- **範圍**：
  1. 新建 `apps/uep/src/islands/interlinkTrigger.ts`：`triggerHistoryRelated(args)` 查 `/api/interlink/anchors` → 去重 `pageId` → 廣播 `ISLAND_RELATED_EVENT`（查無結果不廣播）
  2. `apps/uep/src/components/echoes/EchoesReader.tsx`：mount 時讀當頁 `entityKey`/`storyKey`（有其一即查）呼叫 `triggerHistoryRelated`
  3. `apps/uep/src/components/visuals/VisualsReader.tsx`：同上
- **驗收標準**：新增 `interlinkTrigger.test.ts`（純函式）+ 兩個 Reader 的 mount 行為測試（mock fetch）
- **依賴**：T-F1
- **風險**：低
- **預估**：3 小時

#### T-G2（0.9.15.14）History 島書籤區覆蓋 + dock chip pending
- **範圍**：
  1. `apps/uep/src/islands/history/HistoryIsland.tsx`：訂閱 `ISLAND_RELATED_EVENT`，續讀區塊上方覆蓋卡片（一次一個，新事件取代舊的）；關閉鈕、整頁重整、離開頁面消失（不持久化）
  2. 新增等效 `setRelatedPendingFlag(zone, hasPending)`（沿 `phantomBridge.ts` `setClueWaitingCount` 模式）；`IslandDock` 收到後 History chip 加 highlight class
- **驗收標準**：`HistoryIsland` 新增測試：收到事件顯示覆蓋卡、新事件取代舊事件、關閉後不再顯示；`IslandDock` chip highlight 測試
- **依賴**：T-G1
- **風險**：中（跨 React root 的 window bridge + 覆蓋層 UI 狀態機，S9-D 已有前例可循但仍需仔細處理生命週期）
- **預估**：4 小時

#### T-G3（0.9.15.15）Concepts 觸發按鈕【延後候選】
- **範圍**：`apps/uep/src/components/concepts/ConceptsReader.tsx` 各 stack 視圖，僅對有 `entityKey` 的條目顯示觸發按鈕，`onClick` 呼叫 `triggerHistoryRelated`
- **驗收標準**：按鈕僅在有 entityKey 條目顯示；點擊後觸發與 Echoes/Visuals 相同的覆蓋邏輯
- **依賴**：T-G1、T-G2
- **風險**：低（重用 T-G1 邏輯，UI 元件新增）
- **預估**：2.5 小時

---

### S10-1-H — 便條擴充（§7）【整段可移出至延後清單，見 §0】

#### T-H1（0.9.15.16）Schema 擴充 + 容錯
- **範圍**：`apps/uep/src/progress/types.ts` 新增 `StorageNoteLocationSnapshot`、`StorageNote.location?`/`capturedAt?`、`STORAGE_NOTE_LOCATION_LABEL_MAX=60`；`adapters.ts`/`progressStore.ts` 截斷與型別容錯（比照既有 `text` 截斷模式）
- **驗收標準**：`progressStore.test.ts`/`envIsolation.test.ts` 新增：`location.pageLabel` 超長截斷、型別不符欄位單獨丟棄（便條本體不作廢）
- **依賴**：無
- **風險**：低
- **預估**：2.5 小時

#### T-H2（0.9.15.17）拖曳來源 bridge + 整合
- **範圍**：
  1. 新建 `apps/uep/src/islands/storage/entityDropBridge.ts`：`isStorageIslandOpenAndExpanded()`/`dropEntityText()`
  2. 拖曳來源端（History 互動式嵌入 + 各 zone 條目卡）`pointerup` 時查 `isStorageIslandOpenAndExpanded()`，收合態不接拖曳；沿既有 `DRAG_THRESHOLD` + ghost 機制（S9 pointer capture 模式）
- **驗收標準**：`entityDropBridge.test.ts`；收合態拖曳不觸發 ghost/連線視覺
- **依賴**：T-H1
- **風險**：中（多個拖曳來源整合點，需要在不同元件重複掛 pointer 事件，注意事件衝突）
- **預估**：4 小時

#### T-H3（0.9.15.18）逐張小標 UI
- **範圍**：便條島 UI 新增地點／時間兩個逐張小標（checkbox + 顯示，展開才可編輯）
- **驗收標準**：`StorageIsland.test.tsx` 新增小標顯示/編輯測試
- **依賴**：T-H1、T-H2
- **風險**：低
- **預估**：3 小時

---

## 3. 執行順序（硬依賴鏈 + 並行段）

```
T-A1 ──────────────────────────────────────────────────┐
                                                          │（皆可並行，互不相依）
T-B1 → T-B2 ──────────────────────────────┐              │
              │                            │              │
              ↓                            ↓              │
            T-C1 → T-D1 → T-D2             │              │
                     │                     │              │
                     ↓                     │              │
                   T-D3 → T-D4 → T-D5      │              │
                                           │              │
T-B1 ────────────────→ T-E1 → T-E2 ───────┤              │
                                           │              │
                          T-F1 ←───────────┴── (需 T-B2 + T-E2)
                            │
                            ↓
                T-G1 → T-G2 → T-G3

T-H1 → T-H2 → T-H3  （與上述全段獨立，隨時可插入）
```

**可並行的段落**：
- T-A1（SQL 防禦）與 T-B1/T-B2（地基）完全獨立，可同時進行
- T-H1~T-H3（便條擴充）與其餘所有段落零耦合，可由第二人並行處理，或整段移出獨立於任何時間點插入
- T-D2（Concepts 前端修正）與 T-D3/T-D4/T-D5（Echoes/Visuals+旗標）互不相依，可調換順序或並行

**硬依賴鏈（不可跳過的關鍵路徑）**：
`T-B1 → T-B2 → T-C1 → T-D1 → T-D3 → T-D4 → T-D5`（唯一性把關與旗標系統的主鏈，且 `T-B1 → T-E1 → T-E2 → T-F1 → T-G1 → T-G2 → T-G3`（反向索引與觸發模型主鏈）在 T-F1 處匯合（T-F1 依賴 T-B2 與 T-E2 兩條鏈）。

---

## 4. 版號壓縮對照表（若採 §0 壓縮拆法）

| 壓縮版號 | 合併的標準拆法卡 | 說明 |
|---|---|---|
| 0.9.15.1 | T-A1 | 不變 |
| 0.9.15.2 | T-B1+T-B2 | 地基一次做完 |
| 0.9.15.3 | T-C1 | 不變 |
| 0.9.15.4 | T-D1+T-D2 | 唯一性把關後端+前端一起 |
| 0.9.15.5 | T-D3 | 不變（已是同檔案批次） |
| 0.9.15.6 | T-D4+T-D5 | 旗標簽名+呼叫端一起（風險：兩者耦合本來就緊，可接受） |
| 0.9.15.7 | T-E1+T-E2 | 掃描器+接線一起 |
| 0.9.15.8 | T-F1 | 不變 |
| 0.9.15.9 | T-G1+T-G2 | 自動觸發+島消費一起 |
| 0.9.15.10 | T-G3 | 獨立（新增可見 UI，建議不與 G1/G2 混） |
| 0.9.15.11 | T-H1 | 不變 |
| 0.9.15.12 | T-H2+T-H3 | 拖曳 bridge+UI 一起 |

12 個版次，仍超過「5-6 至多 10」的預期，且部分合併（如 T-D4+T-D5、T-G1+T-G2）會讓 commit 內同時碰觸 3-4 個檔案的不同關注點，code review 與 revert 顆粒度都會變差。**若要真正壓進 10 版次以內，必須採 §0 方向 2（砍工作項），而非繼續合併 commit。**

---

## 5. 測試基準彙整

| 既有測試檔 | 對應卡 | 用途 |
|---|---|---|
| `echoes-song.test.ts` / `visuals-gallery.test.ts` / `concepts-index.test.ts` | T-A1 | SQL 防禦回歸基準 |
| `echoes-index.test.ts` / `visuals-index.test.ts` | T-B1 | storyKey 欄位擴充回歸基準 |
| `api.test.ts` | T-D1、T-E2 | upsertPage/deletePage 行為回歸基準（409、History 分支） |
| `VisualClueNode.test.ts` / `EchoSpotNode.test.ts` | T-C1、T-D4 | Node 屬性改名/新增後必須先讀一遍現有斷言 |
| `EchoesEditorData.test.ts` / `VisualsEditorData.test.ts` | T-C1、T-D3 | 序列化/反序列化回歸基準 |
| `EchoSongPicker.test.ts` | T-D3 | 分類/cluster 判斷回歸基準 |
| `echoesVisibility.test.ts` / `useEchoSpots.test.ts` | T-D5 | 旗標判定回歸基準 |
| `progressStore.test.ts` / `envIsolation.test.ts` | T-H1 | 便條容錯回歸基準 |
| `StorageIsland.test.tsx` | T-H3 | 便條島 UI 回歸基準 |

**新增測試檔**（本次拆卡需要）：`interlink.test.ts`、`history-interlink.test.ts`、`interlinkTrigger.test.ts`、`entityDropBridge.test.ts`，另建議補 `spoilerResolver.test.ts`（若尚不存在，T-D4 要順手建立，`deriveSongUnlockFlag` 目前似乎沒有專屬單元測試檔，只被間接測試覆蓋）。

**目前基線**：前端 1350 全綠（uep+root）+ worker 測試全綠，`pnpm check` 全過（0.9.15.0）。每張卡完成後跑 `pnpm test:all`，最終整段完成後跑 `pnpm check` + `pnpm test:release`。

---

*文件結束。*
