# S10-3 設計文件：Admin 行為設定與 key／flag 管理

> 起草基準：0.9.15.45（`feature/epic2-progress-foundation`，S10-2 迷霧與旅程之書打磨已完成待驗收）
> 範疇：旗標註冊表與真 CRUD、entityKey／storyKey 的說明與反查管理 UI、
> 進度系統參數的 admin 化、內容巡查儀表板、DevTools 擴充。
> 不含：新的前台互動機制（除了「說明」欄位的消費點）、S10-4 技術債。
> 作者：諾薇亞
> 日期：2026-07-29

---

## 0. 定案彙整（艾斯維爾 2026-07-29 拍板，本文件的邊界條件）

| # | 項目 | 定案 |
|---|---|---|
| 1 | 旗標管理深度 | **真 CRUD + 註冊表**——新建一張 flags 表，旗標先註冊才能用，編輯器改成從清單選；可改名（連動更新所有引用）、可刪除 |
| 2 | 設定卡涵蓋範圍 | 內容巡查儀表板 ＋ 進度系統參數 ＋ 劇情點編輯 ＋ **entity／storyKey 的編輯與說明** ＋ flag 控管 ＋ 「這個 key 用在哪」追查 ＋ **其他零散尚未統整的機制一併收進設定卡** |
| 3 | 說明欄位的用途 | 「幫劇情點與實體設置說明等等，**在其他地方會用到**」——說明不是純管理備註，是會被前台消費的內容資料 |
| 4 | 開工方式 | 先出設計文件 → 艾斯維爾審 → 拆卡 → 實作 |

**第二輪定案（同日，就 §11 的 D-1~D-5 全數回覆）**：

| # | 定案 |
|---|---|
| D-1 | 旗標**強制註冊**；FlagMarker 的頁內粒度確定會用，`uep_flags` 照做 |
| D-2 | 進度參數表**整張不做**（「不希望太多東西被暴露控制」）；改為 History 全樹進度頁總覽 + 就地切換 |
| D-3 | 說明的主用途 = **為 storyKey 命名供 History 浮島顯示**；entity 名稱已有 dossier canonical name，不重複填 |
| D-4 | 零散機制照建議收四項 |
| D-5 | 拆 S10-3a／3b 上下兩段 |

⚠️ 全站零 key／零 flag 是**刻意的**——艾斯維爾原話：「原本就打算把這些東西都完成之後
再實際填入，不然會需要遷移很麻煩」。詳見 §11-1。

本文件在上述邊界內新增的**架構定案**（諾薇亞依既有約束推導，非艾斯維爾原話，逐項附 ADR）：

| # | 項目 | 定案 | 章節 |
|---|---|---|---|
| A | `story_points` 泛化為 `interlink_keys`，entity 與 story 共用一張說明表 | §2-2 | |
| B | 註冊表只管**自訂旗標**；規則生成的自動旗標不進表，但巡查清單看得到 | §2-1 | |
| C | 改名走「掃描 → dry-run 預覽 → batch 寫入」三段式，不做即時連動 | §3-3 | |
| D | 進度參數存 D1、前端啟動時一次取，程式常數降級為 fallback 預設值 | §2-3、§5 | |
| E | 新 admin 頁面切成兩張卡：`/admin/keys`（key 與 flag）、`/admin/behavior`（參數與巡查） | §4 | |

---

## 1. 現況接點（已查證）

### 1-1 旗標生態全圖

這是本次設計最關鍵的現況：**旗標分成兩類，來源與可控性完全不同。**

**A. 規則生成（編輯器不手填，程式推導）**

| 旗標形狀 | 產生者 | 檔案 |
|---|---|---|
| `completed:{pageId}` | 掃描線通過文末哨兵 | `progress/markers.ts:121` `completionFlag()` |
| `met:{ref}` | S4 entity 嵌入（**已退役，停增不刪**） | `embed/marks.ts:67` `metFlag()` |
| `{storyKey}:song` | echo spot 插播／收藏判定 | `audio/spoilerResolver.ts:138` `deriveSongUnlockFlag()` |
| `{entityKey}:gallery`／`gallery:{pageId}` | visual clue 展示授旗 | `visuals/threeState.ts:177` `deriveGalleryUnlockFlag()` |
| `{galleryId}:image:{imageId}` | 單張圖片解鎖 | `visuals/threeState.ts:162` `deriveImageUnlockFlag()` |
| `zone:visited:{zone}` | 進入 zone | S6 |

這類旗標的名稱是 key 的函數，**改 key 就等於改旗標**，不存在「改旗標名」這種獨立操作。註冊表若把它們收進去當可編輯項，等於開了一條與 key 定義互相矛盾的第二事實來源。

**B. 手填自由字串（本次要收編的對象）**

| 位置 | UI 現況 | 檔案 |
|---|---|---|
| 授予端 `grantsFlags` | ProgressMarkerNode 的 bubble，**純文字 input，逗號分隔** | `RichEditor.tsx:3375-3410` |
| 需求端 `requiresFlags` | GateConditionEditor 的「custom flag」自由輸入框 | `GateConditionEditor.tsx:246-273` |

兩處都是**零驗證的自由字串**。授予端打錯一個字，需求端就永遠等不到那個旗標——而且不會有任何錯誤，只會靜默地永遠鎖著。這正是「真 CRUD + 註冊表」要解掉的痛點。

⚠️ `GateConditionEditor` 的「requires completion…」picker 產生的是 `completed:{pageId}`，屬 A 類，**不經過註冊表**，這條路徑必須保留原樣。

### 1-2 key 生態與 S10-1 留下的地基

**已就緒（本次直接消費，不重做）：**

| 資產 | 狀態 |
|---|---|
| `GET /api/interlink/usage?keyType&key` | 已實作、已 `isAuthorized`、`private, no-store`；回傳 `definitions`（定義端 live-scan）+ `anchors`（錨點端讀表）+ `storyPoint` |
| `GET /api/interlink/anchors` | 公開，觸發模型消費中 |
| `history_interlink_index` | 存檔時整頁 DELETE+INSERT 重建，軟刪除會清理 |
| `story_points` 殼列 | 存檔路徑 `ensureStoryPoints()` + `reindex-interlink.mjs` 都會補建 |
| `findKeyConflict()` | 存檔時 409 擋撞名 |
| 三個 entity-index 建構器 | `concepts-index.ts` / `echoes-index.ts` / `visuals-index.ts`，皆支援 `includeHidden` |

**缺口：**

1. `story_points` **只有讀（`findStoryPoint`）與建殼（`ensureStoryPoints`），沒有 UPDATE 端點**
2. **沒有「列出全站 key」的端點**——`usage` 只能單 key 精準查，管理頁要清單得另開
3. entityKey **沒有任何說明欄位**（story 有殼但 entity 連殼都沒有）
4. admin 前端**零接線**：`apps/uep/src/pages/admin/` 只有 index／login／users／media／site／homepage／edit

### 1-3 admin 頁面慣例

```
pages/admin/{name}.astro   ← DesignLayout + .adm header 骨架 + prerender=false
  └── <XxxManager client:only="react" apiBase={apiBase} />
```

`apiBase` 一律走 `getApiBase(Astro.cookies.get(TEST_MODE_COOKIE_NAME)?.value ?? null)`（test 模式切換）。
dashboard（`admin/index.astro`）目前三張工具卡：`/admin/site`、`/admin/users`、`/admin/media`。

### 1-4 沒有通用設定表

D1 現有 22 個 migration、下一個編號 **0023**。與設定相關的只有：

- `site_homepage` — 文件站首頁專用，不是通用 key-value
- `root_singletons` — **主站專用**，`apps/root` 的資料，文件站不共用

所以「進度系統參數 admin 化」需要新表。

### 1-5 進度系統參數的硬編碼清單

目前寫死在前端 bundle 的常數。**⚠️ D-2 定案後，此表只有標 ★ 的兩項會進 `uep_settings`，
其餘維持常數不開放調整**（保留此表是為了記錄「哪些東西刻意不開放」，避免下一個 session
以為是漏掉的）：

| 常數 | 值 | 檔案 |
|---|---|---|
| `FOG_RATIO_WRITE_STEP` | 0.005 | `progress/types.ts:233` |
| `FOG_RATIO_PRECISION` | 3 | `progress/types.ts:226` |
| ★ `LOST_BOOKMARK_BASE_PCT` | 20 | `progress/types.ts:239` |
| ★ `STORAGE_NOTE_MAX` / `STORAGE_NOTE_TEXT_MAX` | 30 / 200 | `progress/types.ts:70-72` |
| `STORAGE_NOTE_LOCATION_LABEL_MAX` | 60 | `progress/types.ts:42` |
| rush 速度門檻 | 1500px/s | S10-2 迷霧 |
| 跳躍可及距離 | 1.5vh | S10-2 迷霧 |
| 掃描線位置 | 視窗 80% | `progress/scanline.ts` rootMargin |

---

## 2. 資料模型

### 2-1 旗標註冊表 `uep_flags`

```sql
CREATE TABLE IF NOT EXISTS uep_flags (
  name        TEXT PRIMARY KEY,        -- 旗標字串本體，例：'chapter1:truth-revealed'
  label       TEXT,                    -- 人看的名稱
  description TEXT,                    -- 說明（管理用途，非前台消費）
  category    TEXT,                    -- 分組：'story' | 'system' | 'debug' | NULL
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uep_flags_category ON uep_flags(category);
```

**ADR-B：註冊表只收自訂旗標，規則生成的自動旗標不入表。**

理由：§1-1 已論證自動旗標的名稱是 key 的函數，入表等於製造第二事實來源。巡查儀表板仍會**顯示**自動旗標（live-scan 從內容掃出來），只是它們在 UI 上標為 `derived`、不可編輯、不可刪除。

替代方案（否決）：把自動旗標也 INSERT 進表當快取——需要在每個 key 變更點同步維護，正是 S10-1 §4-6 拒絕「集中式 key registry」時的同一個理由。

**強制性**：見 §11 待決點 D-1。**2026-07-29 實測後改按「強制」設計**——正式 D1 的 244 頁裡，帶 `data-grants-flags` 的頁面是 **0**，設了 `requiresFlags` 的 5 頁要求的全是 `completed:*`（A 類自動旗標）。也就是說**全站目前一個自訂旗標都還沒有**，強制註冊的遷移成本是零，不存在「既有內容存不了檔」的問題。

⚠️ 這與 S10-1 的 `uep_users = 0` 是同一種**一次性視窗**：一旦內容裡開始出現自訂旗標，強制化就要先做全站補註冊。開工前必須重查（§13）。

強制的具體語意：`upsertPage()` 存檔前檢查 `metadata.gate.requiresFlags` 與 content 的 `data-grants-flags`，出現未註冊且非 A 類前綴的旗標 → 409，錯誤訊息帶未註冊清單。與 S10-1 的 key 撞名 409 走同一個前置關卡，不新增第二套攔截機制。

### 2-2 key 說明表：`story_points` 泛化為 `interlink_keys`

**ADR-A：把 `story_points` 泛化成同時容納 entity 與 story 的單一表，而非新增平行的 `entity_points`。**

```sql
-- 0023 migration
CREATE TABLE IF NOT EXISTS interlink_keys (
  key_type    TEXT NOT NULL,           -- 'entity' | 'story'
  key_value   TEXT NOT NULL,
  title       TEXT,
  description TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  PRIMARY KEY (key_type, key_value)
);

INSERT OR IGNORE INTO interlink_keys (key_type, key_value, title, description, created_at, updated_at)
  SELECT 'story', story_key, title, description, created_at, updated_at FROM story_points;

DROP TABLE story_points;
```

理由：

1. 艾斯維爾定案第 2 條把「劇情點」與「實體」的說明並列，兩者行為**完全對稱**——都是「這個 key 叫什麼、是什麼」。兩張結構相同的表會讓 `usage` handler、殼列建立、reindex、seed／reset 全部長出 `keyType === 'story' ? A : B` 的分支。
2. `usage` 端點的回應可以直接把 `storyPoint` 欄位改成 `keyMeta`，前端一套 UI 吃兩種 key。
3. **現在是零成本遷移視窗**：`story_points` 的 title／description 全站皆為 NULL（S10-1 全程不寫），只有殼列。這與 S10-1 §2-3-a 的 `uep_users = 0` 是同一種一次性視窗——一旦艾斯維爾開始填說明，改表就要真的搬資料。⚠️ 開工前必須重查一次 `SELECT COUNT(*) FROM story_points WHERE title IS NOT NULL OR description IS NOT NULL`，不能假設本文件記錄的「0」仍成立。

替代方案（否決）：
- 新增 `entity_points` 平行表 → 上述三處全部要分支，且兩表 schema 必須手動保持同步
- 把說明塞進各定義頁的 metadata → S10-1 §2-4 已論證過：key 的三個掛點（歌／圖／History 錨點）皆非必然存在，掛在任一邊都會有「另一邊沒這資訊」的尷尬。entityKey 更嚴重——一個 entity 可以同時在 concepts／echoes／visuals 有定義，掛哪邊都不對

**⚠️ entity 的 `title` 不開放編輯（2026-07-29 艾斯維爾定案）**

原話：「我們可以為某些 storykey 命名（entity 已經透過 concept 中的 dossier 獲得 canonical identity name 了）」。

查證屬實：`concepts-index.ts` 的 `EntityIndexEntry.name` 即 entity 的權威顯示名稱
（dossier／browser 取條目的 `name`、diff 取 `term`、chrono 取 `title`／`year`），
`/api/concepts/entity-index` 已經回傳。因此：

| keyType | `title` | `description` |
|---|---|---|
| `story` | **可編輯**——這是本次「命名」的主要目的，storyKey 沒有其他名稱來源 | 可編輯 |
| `entity` | **唯讀**，UI 顯示 entity-index 的 `name` 並標註來源；**不寫入表** | 可編輯 |

欄位在 schema 上仍然保留（兩種 keyType 共用一張表），但 entity 列的 `title` 永遠是 NULL——
寫進去就是與 dossier 打對台的第二事實來源。API 層在 `PUT /api/interlink/keys/entity/:value`
直接忽略 `title` 欄位，不靠前端自律。

**殼列建立**：`ensureStoryPoints()` 改名為 `ensureInterlinkKeys()`，同時為 entity 與 story 兩種 keyType 建殼（現行只建 story）。`backfillStoryPoints()` 同步擴充為掃 concepts／echoes／visuals 三個 index 的全部 key。

⚠️ **改名牽連 8 個檔案，其中兩個是本文件初稿沒提到的隱性依賴**（戴爾拆卡發現，已驗證）：

`interlink.ts`／`index.ts`／`interlink.test.ts`／`api.test.ts`／`sync-import-interlink.test.ts`／
`reindex-interlink.mjs` 是預期內的。另外兩個：

- **`test-seed.ts:157-169` 的 `BUSINESS_TABLES`** 把 `story_points` 與 `history_interlink_index`
  並列為「reset 時必須一起清空的衍生表」，檔案註解明寫「新增從 pages 衍生的資料表時**必須**
  列進來」。沒同步改名 → `pnpm test:reset` 直接炸在 `DELETE FROM story_points`（表已不存在）
- **`test-reset.test.ts`** 有直接斷言 `tables` 陣列含 `'story_points'`

這 8 個檔案彼此緊耦合（改表名不改呼叫端即編譯錯誤），**必須同一個 commit**。

📌 附帶決定：`uep_flags` 要不要也進 `BUSINESS_TABLES`？它是**管理者直接輸入**的註冊表，
不是從 pages 衍生，不符合該常數註解描述的 stale anchor 風險模式。但為了 test:reset 後
環境乾淨（不留上一輪的旗標註冊），**建議一併加入**。

⚠️ **套完 0023 必須跑一次 backfill**——與 S10-1 的 `pnpm interlink:reindex:*` 同性質的坑：migration 只搬既有 story 殼列，全站既有 entityKey 一筆殼列都沒有，管理 UI 會看到空清單。沿用既有的 `reindex-interlink.mjs`（它已經呼叫 backfill），三個環境各跑一次。

### 2-3 站台設定 `uep_settings`

```sql
CREATE TABLE IF NOT EXISTS uep_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,           -- JSON 序列化（數字/布林/物件皆可）
  updated_at TEXT NOT NULL
);
```

刻意用 key-value 而非固定欄位：參數清單一定會長，每加一個參數就多一個 migration 不划算；且參數的型別各異（數字／布林／字串），JSON value 一律涵蓋。

**寫入端**：admin only。**讀取端**：`/api/settings/public` 公開（這些參數本來就會出現在前端 bundle，不是機密）。

**⚠️ 開放範圍大幅收斂（2026-07-29 艾斯維爾定案 D-2）**

原話：「我不希望太多東西被暴露控制，基本上進度點也是透過 history 的文章去控管的，
我是認為頂多就是可以從這裡看到並控制進度頁吧」。

因此 **§1-5 的參數表整張不做**——迷霧、掃描線、rush 門檻、跳躍距離、fogRatio 精度與級距
全部維持編譯期常數。`uep_settings` 只收 D-4 勾選的四項：

| key | 型別 | 對應常數 |
|---|---|---|
| `protection.mode` | `'always' \| 'never' \| 'env'` | `content-protection.ts` |
| `bookmark.baseChancePct` | number | `LOST_BOOKMARK_BASE_PCT` |
| `note.max` | number | `STORAGE_NOTE_MAX` |
| `note.textMax` | number | `STORAGE_NOTE_TEXT_MAX` |

這四項的共同性質：**都不參與單拍計算**。R1 的風險（runtime 值造成首拍不一致）因此消失——
便條上限只在新增便條時讀一次、書籤機率只在讀完文章 roll 時讀一次、內容保護只在頁面
mount 時讀一次。迷霧參數之所以被排除，正是因為它們每個 scroll tick 都要用。

「進度頁的看與控」不走 `uep_settings`，走 §4-2 的 History 全樹總覽（改的是頁面 metadata，
不是站台設定）。

---

## 3. API 端點

### 3-1 旗標 CRUD

```
GET    /api/flags                    admin  列出註冊旗標（含 category 過濾）
POST   /api/flags                    admin  新建 { name, label?, description?, category? }
PUT    /api/flags/:name              admin  更新 label／description／category（不改 name）
DELETE /api/flags/:name              admin  刪除註冊（見 §3-4 引用檢查）
GET    /api/flags/audit              admin  巡查：註冊表 ∪ live-scan 的全站旗標盤點
```

`GET /api/flags/audit` 的回應是巡查儀表板的資料來源：

```
{
  ok: true,
  data: {
    flags: {
      name: string;
      source: 'registered' | 'derived' | 'unregistered';
      grantedBy: { pageId, pageTitle, area }[];   // 誰授予（content 掃 data-grants-flags）
      requiredBy: { pageId, pageTitle, area }[];  // 誰需要（metadata.gate.requiresFlags）
      orphan: boolean;                            // 有人要但沒人給
      unused: boolean;                            // 有人給但沒人要
    }[]
  }
}
```

⚠️ `grantedBy` 要掃 `content` 欄位裡的 `data-grants-flags` 屬性。Worker 沒有 TipTap／PMNode 環境，**必須仿 `assets.ts` 的 `extractAssetKeysFromContentBlock()` 寫 regex-based HTML 掃描器**——這是 S10-1 拆卡時踩過的同一個坑（記錄在「反向索引『移植』是誤導性說法」），工時按「新寫掃描器」估。

⚠️ **掃描範圍是全站，不是 History**（戴爾拆卡發現）。`ProgressMarkerNode` 掛在共用的
`RichEditor.tsx`，而那是**所有 zone 的 `rich_text` 區塊共用的編輯器**——與只在 History
頁使用的 `EchoSpotNode`／`VisualClueNode` 不同。授予端旗標理論上可出現在 Storage 劇本、
Concepts 說明段落等任何 rich_text 內容裡。查詢要 `WHERE deleted_at IS NULL` 掃全表，
**不可沿用 `history_interlink_index` 那種「刻意只認 History」的範圍限制**：
反向索引管的是跨區互聯，旗標授予是內容閘門系統，兩者職責不同。

⚠️ **`classifyFlag()` 必須是單一事實來源**。audit 要判斷「這個旗標是 A 類自動生成
還是 B 類自訂」，`upsertPage` 的 409 檢查也要用同一個判斷來豁免 A 類（`completed:*` 等
不需註冊）。目前**沒有任何現成函式做這件事**，要新寫；兩邊各寫一份必然漂移——
會出現「audit 說是 derived 不用註冊、存檔卻擋你沒註冊」這種自相矛盾。

### 3-2 key 說明 CRUD

```
GET    /api/interlink/keys           admin  列出全站 key（entity + story），含說明與使用計數
PUT    /api/interlink/keys/:type/:value  admin  更新 title／description
GET    /api/interlink/usage          admin  （已存在）單 key 的定義端＋錨點端
GET    /api/interlink/keys/public?keyType&key   公開  只回 title／description（前台消費用，見 §6）
```

`GET /api/interlink/keys` 的清單來源 = 三個 entity-index 建構器（`includeHidden: true`）∪ `interlink_keys` 表 ∪ `history_interlink_index` 的錨點端。三路聯集才能同時涵蓋「有定義沒說明」「有說明但定義被刪」「只在 History 被引用過」三種狀態。

### 3-3 旗標改名（ADR-C）

```
POST /api/flags/:name/rename   admin  { newName, dryRun?: boolean }
```

**三段式，不做即時連動：**

1. **掃描**：找出所有引用點——`pages.metadata` 的 `gate.requiresFlags`（JSON）＋ `pages.content` 的 `data-grants-flags`（HTML 屬性）
2. **dry-run 預覽**：回傳受影響的頁面清單與每頁的改動筆數，前端顯示確認對話框
3. **batch 寫入**：`db.batch()` 單一交易改寫全部引用 ＋ 更新 `uep_flags.name`

理由：跨頁寫入若做成「改名時自動即時更新」，部分失敗會留下一半舊名一半新名的狀態，而旗標系統的失敗症狀是**靜默永久鎖死**，沒有任何錯誤訊息。強制 dry-run 讓艾斯維爾看見影響範圍再按下去。

⚠️ **改名必須觸發受影響 History 頁的反向索引重建**——`data-grants-flags` 不進 `history_interlink_index`（那張表只管 entity mark／echo spot／visual clue 三種），所以本項不受影響。但若改名連帶動到 content，`updated_at` 會變，sync 狀態會標 modified，這點要在 UI 上提醒。

### 3-4 旗標刪除的引用檢查

`DELETE /api/flags/:name` 預設**擋有引用的旗標**（409 + 引用清單），需 `?force=true` 才強制刪。強制刪只移除註冊列，不動任何內容——刪掉的旗標會在巡查清單重新以 `unregistered` 出現，不會靜默改變前台行為。

### 3-5 設定

```
GET /api/settings          admin  全部設定（含未設定項的預設值）
PUT /api/settings          admin  批次更新 { [key]: value }
GET /api/settings/public   公開   前台消費的參數子集
```

### 3-6 頁面 metadata 的部分更新（進度頁總覽用）

```
PATCH /api/content/:area/:slug/metadata   admin  { progressPage?: boolean, gateExempt?: boolean }
```

**為什麼要新端點而不是複用 `PUT /api/content/:area/:slug`**：既有的 PUT 是**整頁覆寫**，
呼叫端必須先把整份 content + metadata 讀進來再送回去。進度頁總覽一頁可能列 44 筆，
若要就地切一個 checkbox 就得先抓整頁內容（含 TipTap JSON），不但慢，而且開著編輯器時
切總覽的 toggle 會把編輯器未存檔的內容用舊快照蓋回去。

PATCH 只讀寫 `metadata` 的指定鍵，**不碰 content**，也因此不觸發 History 反向索引重建
（索引只認 content 裡的錨點，metadata 的 progressPage 與它無關）。

⚠️ 白名單只有 `progressPage` 與 `gateExempt` 兩個鍵。不要做成通用的 metadata patch——
`gate`、`entityKey`、`storyKey` 都有各自的驗證關卡（409 撞名、旗標註冊檢查），
開一條繞過它們的旁路等於把 S10-1 的把關廢掉。

⚠️ **路由掛載順序是地雷（戴爾拆卡發現，本文件初稿完全沒提）**

`index.ts:2135` 的內容 CRUD 路由是 `/^\/api\/content\/([a-z]+)(?:\/(.+))?$/`，slug 群組
**貪婪**，會把 `/api/content/history/xxx/metadata` 整段吃成 `slug = "xxx/metadata"`。
而且該分支的 `switch (request.method)` 只有 `GET`／`PUT`／`DELETE`，PATCH 會落
`default: 405`——不是 404，是根本進不到新端點。

所以要用更精確的正規式，**且必須排在 `contentMatch` 之前**：

```js
const metadataPatchMatch = path.match(/^\/api\/content\/([a-z]+)\/(.+)\/metadata$/);
if (metadataPatchMatch && request.method === 'PATCH') { ... }
```

這與既有的 `/api/concepts/entity-index`、`/api/echoes/entity-song` 走「獨立前綴避開
contentMatch」是同一個問題的兩種解法。往後任何想用路徑後綴當子資源的端點都要留意。

---

## 4. Admin UI（ADR-E）

dashboard 新增兩張工具卡：

### 4-1 `/admin/keys` — Key 與旗標管理

三欄佈局，沿用編輯器的視覺語彙（`.ned-*` token）：

```
┌─ 清單（左） ─┬─ 詳細（中） ────────┬─ 用在哪（右） ─┐
│ [key] [flag] │ key: xavier-colsono │ 定義端         │
│ 搜尋 ______  │ 標題: ____________  │  concepts/...  │
│ ▸ entity(30) │ 說明: ____________  │  echoes/...    │
│ ▸ story(N)   │        ____________ │ 錨點端         │
│ ▸ flags(N)   │ [儲存]              │  history/01-06 │
│  · 未註冊(N) │                     │  (echo-spot)   │
│  · 孤兒(N)   │ 旗標另有：           │                │
│              │  類別 / 改名 / 刪除  │ [跳到該頁編輯] │
└──────────────┴─────────────────────┴────────────────┘
```

- 左欄清單 = `GET /api/interlink/keys` ＋ `GET /api/flags/audit`
- 右欄 = `GET /api/interlink/usage`（key）或 audit 的 `grantedBy`／`requiredBy`（flag）
- 「跳到該頁編輯」直接連 `/admin/edit/{pageId}`——反查的終點是修改，不該讓艾斯維爾自己複製 id

### 4-2 `/admin/behavior` — 進度頁總覽與巡查

**上半：History 全樹進度頁總覽（D-2 定案的主體）**

一頁列出整棵 History 樹，每列顯示該頁的進度相關狀態，並可**就地切換**：

```
 深度  標題                          progressPage  exempt  gate 條件           標記
 ─────────────────────────────────────────────────────────────────────────────
 zone  三向通道                          ☐          ☐      —                  —
 ├ ch  第一章                            ☑          ☐      —                  —
 │ ├ arc 相遇                            ☑(繼承)    ☐      —                  —
 │ │ ├ sect 01-01                        ☑(繼承)    ☐      completed:arc.01   ⚑2 ♪1
 │ │ ├ sect 01-02                        ☑(繼承)    ☑      —                  —
```

- `progressPage` / `exempt` 兩個 checkbox 可直接勾選，寫回該頁 `metadata`
- **繼承態唯讀**：父容器已標進度頁時顯示 `☑(繼承)` 且禁用

  ⚠️ **本項的初稿寫法已被推翻（戴爾拆卡讀碼發現，2026-07-29 驗證屬實）**。初稿要求
  「與 `GateConditionEditor.tsx:138` 的 `inheritedProgressPage` 語意一致，共用同一份判定」——
  但那個變數只是 `parentIsProgressContainer && !isGateExempt` 的一次 AND，真正算出
  `parentIsProgressContainer` 的是 `RichEditor.tsx:237-249`：**只 fetch 直接父頁一次，
  只看父頁自己 raw 的 `metadata.progressPage`**，不往上多層走訪。

  照抄會壞在三層巢狀：chapter 標記 → arc 只是被動繼承（raw 為 false）→ section 查到 arc
  就判定「未繼承」，與本節範例表格要求的顯示結果不符。

  **正確做法**：`GET /api/content/history/tree` 已 `SELECT LIST_COLS, metadata`
  （`index.ts:1782`，已查證），全樹在手，自行做 top-down 遞迴：

  ```
  effectiveProgressPage(node) =
    isProgressPage(node.metadata)
    || (!isGateExempt(node.metadata) && effectiveProgressPage(parent(node)))
  ```

  複用的是 `progress/gating.ts` 的 `isProgressPage` / `isGateExempt` **兩個純函式**
  （無 side effect、不依賴 tree adapter），而不是 `effectiveGate()` 整套——後者是為
  前台旗標鏈求值設計的，需要 `ProgressTreeAdapter` 與使用者 `ProgressState`，
  總覽只需要「是不是進度頁」這一個布林。
- `gate 條件` 欄唯讀顯示 `requiresFlags`／`pristineOnly` 摘要，點擊跳 `/admin/edit/{pageId}`
- `標記` 欄顯示該頁的 FlagMarker／echo spot／visual clue 計數（來自 §3-1 的 HTML 掃描器）

⚠️ **兩個地方都能改同一件事的風險**：進度頁 toggle 同時存在於編輯器 Inspector 與這張總覽。
兩者都是對 `metadata` 的部分更新，**必須走同一個端點**（§3-6），不可讓總覽自己拼一份
metadata 寫回去——那會在編輯器同時開著時互相覆蓋。

**中段：四個開關**（§2-3 的 `uep_settings` 四項）

**下半：內容巡查儀表板**，每項是一張可展開的問題卡：

| 巡查項 | 判定 | 來源 |
|---|---|---|
| 孤兒旗標 | 有人 requires 但沒人 grants | `/api/flags/audit` |
| 未使用旗標 | 有人 grants 但沒人 requires | 同上 |
| 未註冊旗標 | 內容裡有但註冊表沒有 | 同上 |
| 劇情歌未綁 storyKey | echoes 有音檔但 metadata 無 storyKey（S10-1 §9 R1） | `echoes-index` |
| key 無說明 | `interlink_keys` 該列 title／description 皆 NULL | `/api/interlink/keys` |
| 孤兒錨點 | History 有錨點但查無定義端 | `usage` 的 definitions 為空 |
| 未被引用的 key | 有定義但零錨點零觸發 | 同上，anchors 為空 |

每張卡顯示計數 ＋ 展開後列出項目 ＋ 可直接跳到修正位置。

---

## 5. 編輯器接線

### 5-1 授予端（`RichEditor.tsx` marker bubble）

純文字 input → **旗標 picker**：可搜尋的下拉（來源 `GET /api/flags`）＋ 「＋ 新建旗標」按鈕（就地開小表單寫入註冊表）＋ 已選旗標以 chip 呈現。

依 §2-1 的強制設計，picker **不保留自由輸入逃生口**——想用新旗標就在 picker 裡當場建，建完即可選。這避免了「前端允許輸入、存檔才被 409 打回」的挫折型互動。

### 5-2 需求端（`GateConditionEditor.tsx`）

「custom flag」自由輸入框改成同一顆 picker 元件。**「requires completion…」page picker 完全不動**（§1-1 ⚠️）。

### 5-3 共用元件

新增 `components/editor/FlagPicker.tsx`，兩處共用。理由：兩處的差別只有「授予 vs 需求」的文案，資料來源與互動完全相同；分開寫必然漂移。

⚠️ 這是「不要重複造輪子」原則的直接應用——但也要注意**只有兩個使用者**，抽象止於此，不要為此建立一整套 flag 元件家族。

### 5-4 進度參數的前端消費（ADR-D）

```
DesignLayout 掛載時 → fetch /api/settings/public → 寫入 window.__uepSettings
                                                  → sessionStorage 快取（同一 session 不重取）
消費點（僅四處）→ getSetting('note.max', STORAGE_NOTE_MAX) 等
```

常數**保留在程式碼裡當 fallback 預設值**，不刪。理由：uep 站是 MPA，每頁重新 mount；設定 fetch 失敗時若沒有 fallback，相關功能會用 undefined 算數。

⚠️ 消費點只有四處，且**每一處都是「一次性讀取」**（新增便條時、讀完文章 roll 書籤時、
頁面 mount 決定內容保護時）。D-2 定案排除了所有每 tick 讀取的參數——那才是會把非同步
依賴插進熱路徑的東西。實作時若發現某個新參數需要在 scroll／IO 回呼裡讀，**代表它不該
進 `uep_settings`**，維持常數。

---

## 6. 「說明」的前台消費點

**定案（2026-07-29）**：主用途是**為 storyKey 命名，供 History 浮島顯示**。
艾斯維爾原話：「主要是我們可以為某些 storykey 命名（entity 已經透過 concept 中的 dossier
獲得 canonical identity name 了）」，且「跟 history 浮島有關」。

| # | 消費點 | 用途 | 優先 |
|---|---|---|---|
| 1 | **History 島線索卡** | 目前標題行只有來源 pageTitle；改為優先顯示 `interlink_keys.title`（劇情點名稱），無則退回 pageTitle | **主** |
| 2 | Echoes 收藏池 | 劇情歌以 storyKey 的 title 呈現，取代歌名 fallback | 次 |
| 3 | Storage 便條 entity 拖入 | 目前填 raw key；改填 entity-index 的 `name`（不是表裡的 title，見 §2-2） | 次 |
| 4 | Concepts 條目「相關」按鈕 | hover／點擊顯示 description 摘要 | 次 |

四項都是**既有 UI 的文案來源置換**，不是新功能。不做專屬的「劇情點檔案」介面
（D-3 定案：先做文案置換）。

⚠️ 第 1 項是唯一與「命名」原意直接對應的消費點，**不可與其餘三項一起被砍**。
其餘三項若拆卡時要延後，可以，但 1 必須在 S10-3 落地——否則「命名」這件事做完之後
沒有任何地方看得到名字。

公開端點 `/api/interlink/keys/public` 只回 title／description，**不回 definitions／anchors**——後者含未公開內容的頁 id 與標題，正是 S10-1 把 `usage` 收成 admin-only 的理由。

---

## 7. DevTools 擴充

新群組「旗標」（`devtools/actions/flagActions.ts`）：

- 傾印目前持有旗標（分組：自動／自訂／未知）
- 授予／撤銷任意旗標（含 picker，來源同註冊表）
- 模擬「持有全部註冊旗標」／「清空自訂旗標」
- 檢查目前頁面的 gate 求值結果（列出四維條件各自的通過狀態）

最後一項對應記憶中的「Gate 四維條件是聯集」——目前無法在前台看出「為什麼這頁鎖著」，只能猜。

---

## 8. 「其他零散尚未統整的機制」候選盤點

艾斯維爾定案第 2 條末段提到的項目，我盤點出以下候選（**需要在待決點 D-4 勾選要收哪些**）：

| 候選 | 現況 | 收進設定卡的形狀 |
|---|---|---|
| 內容保護開關 | `content-protection.ts` 正式站恆開，dev/test 需 opt-in | 三態：恆開／恆關／跟隨環境 |
| 浮島解鎖物件配置 | 各 zone 硬編碼 | 每個島的解鎖條件與位置 |
| onboarding 儀式 | `OnboardingGate.tsx` 自帶狀態 | 開關 ＋ 重播 |
| 遺落的書籤機率 | `LOST_BOOKMARK_BASE_PCT` | 進度參數表單 |
| 便條上限 | `STORAGE_NOTE_MAX` / `TEXT_MAX` | 同上 |
| Echoes spoiler 等級規則 | 分散在 `spoilerResolver.ts` | 唯讀說明 ＋ 巡查 |
| test 模式切換 | `AdminTestModeControl`（已有） | 移進設定卡統一位置 |
| 使用者進度重置 | `/admin/users`（已有） | 保持原位，設定卡加連結 |

---

## 9. 資料流全圖

```
                      ┌──────────────────┐
     編輯器 ──────────▶│  uep_flags       │◀──── /admin/keys CRUD
   (FlagPicker)        └──────────────────┘
                              │ audit（live-scan content + metadata）
                              ▼
     pages.content ──▶ ┌──────────────────┐
     pages.metadata ─▶ │ /api/flags/audit │──▶ 巡查儀表板
                       └──────────────────┘

                      ┌──────────────────┐
   三個 entity-index ─▶│ interlink_keys   │◀──── /admin/keys 說明編輯
   （定義端 live-scan）└──────────────────┘
   history_interlink_  ─────┘  │
   index（錨點端讀表）          ▼
                       前台四個消費點（§6）

                      ┌──────────────────┐
   /admin/behavior ──▶│  uep_settings    │──▶ /api/settings/public
                      └──────────────────┘      ──▶ window.__uepSettings
                                                    （常數為 fallback）
```

---

## 10. 風險與技術債

| # | 風險 | 影響 | 緩解 |
|---|---|---|---|
| ~~R1~~ | ~~編譯期常數改 runtime 值，在進度計算路徑插入非同步依賴~~ | **已消除**——D-2 定案排除全部單拍計算類參數（迷霧／掃描線／rush），`uep_settings` 只剩四項各自「一次性讀取」的設定 | — |
| R2 | §3-3 改名的 content 改寫是 regex-based HTML 操作 | 改壞 content 等於損毀文章 | 強制 dry-run；改寫前後比對「該頁 data-grants-flags 出現次數」；先在 test 環境驗證 |
| R3 | §3-1 audit 每次都 live-scan 全站 content | 頁數成長後 admin 頁載入變慢 | 目前 242 頁量級可忽略（同 S10-1 R3 的判準）；若變慢改為端點內快取 60s |
| R4 | §2-2 的表遷移視窗依賴「title/description 全 NULL」 | 若艾斯維爾在開工前已填過說明，遷移要真的搬資料 | 開工前必查（§2-2 ⚠️）；`INSERT OR IGNORE ... SELECT` 本身就會搬既有值，實際風險是低的 |
| R5 | 旗標註冊表與內容的一致性沒有強制力（軟性把關） | 仍可能出現打錯字的旗標 | 巡查儀表板的「未註冊」「孤兒」兩張卡就是為此存在；若艾斯維爾要強制，見 D-1 |
| R6 | `/admin/keys` 與既有編輯器的 key 唯一性驗證是兩套判定 | 管理頁顯示的衝突狀態可能與存檔時的 409 不一致 | 兩者共用 `findKeyConflict()`，不另寫判定 |

---

## 11. 待決點定案記錄（2026-07-29 艾斯維爾全數回覆）

**本文件目前沒有待拍板的開放問題。** 以下為五項定案與對設計的影響：

| # | 問題 | 定案 | 影響 |
|---|---|---|---|
| **D-1** | 旗標註冊是否強制 | **強制，做註冊表** | 艾斯維爾確認會用 FlagMarker 的頁內粒度（「讀到某段 → 解鎖某首歌」這類比整頁完成更細的觸發）。`uep_flags` 表 + `FlagPicker` + 存檔 409 全數保留 |
| **D-2** | 哪些進度參數開放 admin 調整 | **§1-5 參數表整張不做**；改為「History 全樹進度頁總覽 + 就地切換」 | §2-3 收斂成四項非計算類設定；新增 §3-6 的 metadata PATCH 端點與 §4-2 上半的總覽 UI。R1 風險連帶消失 |
| **D-3** | 「說明」的消費點範圍 | **四項文案置換**，不做專屬介面；主用途是**為 storyKey 命名供 History 浮島顯示** | §6 第 1 項升為必做；entity 的 `title` 改唯讀吃 dossier name（§2-2） |
| **D-4** | 零散機制收哪幾項 | **照建議**：內容保護開關／test 模式切換／遺落書籤機率／便條上限 | §2-3 的四個 key |
| **D-5** | 是否拆 sub-session | **拆上下兩段**（艾斯維爾評估此 session 複雜度僅次於 S10-1） | §12 的 3a／3b |

### 11-1 為什麼全站零 key／零 flag 是刻意的

艾斯維爾原話：「之所以你都沒有看到我有引用 key 和 flag，是因為我原本就打算把這些東西
都完成之後再實際填入，不然會需要遷移很麻煩」。

⚠️ 這句話對實作 session 有兩個直接後果：

1. **強制註冊、表泛化、旗標命名規則變更，全部趁現在做完**——這是最後一次零成本視窗，
   內容一旦填入就要走遷移。看到「反正現在沒資料」不是偷懶的藉口，而是**現在把規則
   訂死的正當理由**
2. **不要用「正式站沒有資料」當作跳過測試的理由**。驗收在 test 環境做（§13），
   而且要主動造出足夠複雜的樣本（多錨點劇情點、跨 stack entity、孤兒旗標）

---

## 12. 建議實作順序

假設 D-5 採「拆兩段」：

**S10-3a：key 與 flag 管理（0.9.16.0 起）**

1. Migration 0023（`interlink_keys` 泛化 ＋ `uep_flags`）＋ `ensureInterlinkKeys()` / `backfillInterlinkKeys()` 擴充——地基，不動 UI
2. 三個環境套 migration ＋ 跑 backfill（**不可略過**，見 §2-2 ⚠️）
3. `usage` 端點改回 `keyMeta`、新增 `/api/interlink/keys` 清單與 PUT
4. `/api/flags` CRUD ＋ HTML 掃描器 ＋ `/api/flags/audit`
5. `/admin/keys` 三欄 UI（清單 → 詳細 → 用在哪）
6. `FlagPicker.tsx` ＋ 兩處編輯器接線
7. `/api/flags/:name/rename` 三段式改名
8. DevTools 旗標群組

**S10-3b：進度頁總覽、巡查與說明消費（接續）**

9. `PATCH /api/content/:area/:slug/metadata`（§3-6，白名單兩個鍵）
10. `/admin/behavior` 上半：History 全樹進度頁總覽 ＋ 就地切換（繼承判定共用 `effectiveGate` 那套）
11. 巡查儀表板七張卡（§4-2 下半）
12. **§6 第 1 項：History 島線索卡改顯示劇情點名稱**（D-3 的必做項）
13. Migration 0024（`uep_settings`）＋ `/api/settings*` ＋ 四個開關 ＋ runtime 接線
14. §6 其餘三項文案置換（可延後，不阻塞收尾）

依賴鏈：1→2→3→5、1→4→5、5→6→7；9→10 獨立於 3a 全部；11 依賴 4；12 依賴 3。

⚠️ **步驟 12 不可與 14 一起延後**——§6 已說明理由：命名做完卻沒有任何地方顯示名字，
等於整條 storyKey 命名鏈沒有出口。

---

## 13. 開工前必查清單

比照 S10-1 §11-2 的慣例，實作 session 開始前逐項確認（**不可假設本文件記錄的數值仍成立**）。
以下為 **2026-07-29 對正式 D1（`eternity-content`）的實測值**：

| 必查項 | 實測（2026-07-29） | 意義 |
|---|---|---|
| `story_points` 殼列 / 已填說明 | **0 / 0** | §2-2 的表遷移是零成本——連殼列都沒有，`DROP TABLE` 重建無任何資料損失 |
| `uep_users` | **0** | S10-1 記錄的一次性視窗仍然開著；§3-3 的改名**不必**處理使用者端 progress blob 裡的 flags 陣列 |
| 帶 `data-grants-flags` 的頁面 | **0 / 244** | 全站零自訂旗標授予點 → D-1 改建議「強制註冊」 |
| 設了 `requiresFlags` 的頁面 | **5**（全為 `completed:*`） | 同上，皆為 A 類自動旗標，不經註冊表 |
| 帶 `storyKey` 的頁面 | **0** | 與 story_points 殼列 0 一致 |
| 帶 `entityKey` 的頁面 | **4** | §5-1 picker 不需要分頁 |
| History 頁 / 反向索引錨點 | **44 / 0** | ⚠️ 見下方 |
| 下一個 migration 編號 | **0023** | |
| `pnpm check` 基線 | 未跑，開工前必跑 | |

⚠️ **正式站 history 內容目前零標記**（`echo-spot` / `visual-clue` / `progress-marker` 全數 0），
因此 `history_interlink_index` 為空是**正確狀態，不是索引失效**。連帶影響：

- S10-3 的「用在哪」反查 UI 在正式環境會是空清單，**驗收必須在 test 環境做**
  （S10-1 記錄 test D1：26 頁 / 6 錨點 / 1 劇情點 `test-id`）
- S10-1 盤點時記錄的「正式 01-06 同病相憐（815 字元，含 spot + entity）」已不成立：
  該頁遠端現況為 **57 字元、`status='local_only'`、`updated_at=2026-07-26T22:43:31Z`**。
  這是內容資料狀態（非程式問題），但與 S10-1 的盤點記錄不符，實作前應向艾斯維爾確認是否為預期
