# S10-1 手動驗收清單（0.9.15.1 → 0.9.15.14）

跨區互聯（entityKey／storyKey 命名空間、History 反向索引、觸發模型、便條擴充）的
人工驗收。自動測試已全綠（前端 1461+ / worker 全數），這份只列**自動測試抓不到**
或**需要肉眼判斷手感**的部分。

標記說明：

- 🔴 **無自動測試保護**——壞了不會有人擋，請仔細看
- 🟠 **審查後才補的修正**（0.9.15.12～14）——剛改完，回歸風險最高
- 🔵 有測試覆蓋，這裡只確認實際觀感

---

## 0. 前置作業（不做完，後面幾乎全部會是假失敗）

### 0-1 🔴 補建互聯索引 `POST /api/interlink/reindex`

migration 0022 只建了空表。**既有文章的錨點一筆都還沒進索引**，不跑這步的話第 5、6
節看起來會全部壞掉（線索卡永遠不出現），但那不是 bug。

冪等，可重複執行。需要授權（write method 會被全域 `isAuthorized` 擋）。最方便的做法
是在已登入的 admin 頁面開 DevTools console：

```js
const jwt = document.cookie
  .split('; ')
  .find((c) => c.startsWith('uep-admin-jwt='))
  .split('=')[1];

for (const base of [
  'https://eternity-content-api.ptyc4076.workers.dev',
  'https://eternity-content-api-test.ptyc4076.workers.dev',
]) {
  const r = await fetch(`${base}/api/interlink/reindex`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${jwt}` },
  }).then((r) => r.json());
  console.log(base, r);
}
```

- [ ] 正式與 test 都回 `ok: true`，`data` 內有掃描／寫入筆數
- [ ] 重跑第二次結果相同（冪等，不會重複累加）

本地環境同理（`http://localhost:8788`，dev 不需授權）。

### 0-2 環境確認

- [ ] test worker 已部署到最新版（`pnpm deploy:content-api:test`）
- [ ] migration 0022 三環境都已套用（本地／test／正式皆已於 07/27 完成，這裡只需確認
      `history_interlink_index`、`story_points` 兩張表存在）
- [ ] 兩站 dev server 在跑（uep:4321、root:4320、content-api:8788）

### 0-3 驗收用身分

多數項目需要：**探索者視角 + 桌面寬度（>760px）+ 相應浮島已解鎖且未停用**。
用 `Ctrl+Shift+D` 開 DevTools 面板調整。觀測者視角下大部分互聯功能刻意不出現，
那是設計不是 bug。

---

## 1. 編輯器：雙 key 命名空間 🔵

`entityKey`（Concepts 條目／Echoes 角色歌·區域歌／Visuals 陳列走廊）與
`storyKey`（Echoes 劇情歌／Visuals 插圖）互斥，依所在位置決定顯示哪一個。

### Echoes 編輯器

- [ ] 開一首**角色歌**或**區域歌** → 顯示 `entityKey` 欄位，無 storyKey
- [ ] 開一首**劇情歌** → 顯示 `storyKey` 欄位，**entityKey 欄位不再出現**
      （S10 前劇情歌也能填 entityKey，這條路已收掉）
- [ ] storyKey 留空可以正常存檔（**選填**，不擋存檔），但編輯器有軟性提示
      說明「不填就無法被互聯反查、無法解鎖收藏」

### Visuals 編輯器

- [ ] 陳列走廊的 gallery → `entityKey`
- [ ] 鑲框室的插圖 gallery → `storyKey`，且**看不到舊的 `illustrationId` 欄位**
      （已被 storyKey 完全取代，不是並存）

### Concepts 編輯器

- [ ] dossier / browser / chrono / diff 四種 stack 的條目都有 `entityKey` 欄位
- [ ] 🟠 同一個 stack 內跨頁重複的 key 會被前端標紅提示
      （範圍是「整個 stack」不是「單頁」——records stack 底下
      character_list / location_list / invera / hostile_creatures 四頁互相檢查）

---

## 2. key 撞名把關 🟠

### 2-1 存檔擋重複

- [ ] 在 Concepts 某頁把某條目的 entityKey 改成**另一頁已存在的同 stack key** → 存檔失敗
- [ ] Echoes 兩首歌填同一個 entityKey → 存檔失敗
- [ ] 🔴 **失敗時的提示是否看得懂？** 預期要明確指出「key 已被哪一頁使用」。
      若只是靜默失敗、或只顯示「儲存失敗」而沒說原因，**請記下來**——
      前端錯誤呈現這一層沒有自動測試

### 2-2 合法的跨 zone 重複不可被誤擋

`xavier-colsono` 正式環境橫跨四處且**全部合法**：

| zone     | 位置                                            |
| -------- | ----------------------------------------------- |
| concepts | dossier `records/character_list`                |
| concepts | browser `server/browser/charateristics`         |
| echoes   | `characters/core_chara/protag/rebirth`          |
| visuals  | `profiles/characters/unknown`                   |

- [ ] 隨便打開上述任一頁，不改 key 直接存檔 → **成功**（不可被 409 擋）
- [ ] test 環境的 `a-man` 同時掛 echoes song + visuals gallery → 同樣可存檔

### 2-3 🟠 同一份 payload 內部的重複

- [ ] 在**同一個 Concepts 頁面**建立兩個 entityKey 相同的條目 → 存檔失敗
      （審查前這個情況對後端完全隱形，違規資料能永久存活）

---

## 3. Echoes 分類改唯讀 🔵

- [ ] 任一首歌的編輯器中，「分類」下拉是**灰掉不可改**的狀態
- [ ] 顯示的值與該歌所在 cluster 一致
      （areas→區域歌 / characters→角色歌 / special→特殊 / stories→劇情歌）
- [ ] 把一首歌在樹狀結構中移到別的 cluster 底下 → 分類跟著變

---

## 4. 收藏旗標改看 storyKey 🔴

旗標命名從 `song:{songId}` 改成 `{storyKey|entityKey}:song`。**正式環境使用者數為 0**，
所以這次改名不需要遷移——但這是一次性視窗，之後不能再這樣改。

- [ ] 角色歌／區域歌解鎖後進收藏池，旗標形如 `xavier-colsono:song`
- [ ] 劇情歌**有填 storyKey** → 可解鎖、可進收藏池
- [ ] 劇情歌**沒填 storyKey** → 永遠無法產生收藏旗標，只能透過 Echo Spot
      現場插播聆聽，**不進收藏池**（這是預期行為，不是 bug）

### 4-1 🔴 DevTools 四個 action（`Ctrl+Shift+D` →「Echoes 收藏池」）

已於 `0a92e75` 補上單元測試，但 prompt 互動本身仍需手動確認：

- [ ] `授予歌曲收藏` → 輸入 `character` + entityKey → 該歌出現在收藏池
- [ ] 輸入 `story` + storyKey → 同樣生效
- [ ] `撤銷歌曲收藏` → 該歌移出收藏池
- [ ] `推導歌曲 unlock flag` → console 印出旗標且複製到剪貼簿，**不改動進度**
- [ ] `傾印目前所有 song 相關旗標` → console 列出收藏旗標與完整 flags

---

## 5. History 反向索引 🟠

### 5-1 存檔時重建

- [ ] 在 admin 開一篇含 echo spot／visual clue／entity mark 的 History 文章
- [ ] 不改任何內容直接存檔 → **不報錯**
      （⚠️ migration 沒套用前這步會直接炸，現在應該正常）
- [ ] 刪掉其中一個 echo spot 後存檔 → 該錨點從索引消失
      （可用第 6 節的線索卡驗證，或直接查 D1 `history_interlink_index`）
- [ ] 同一篇重複存檔兩次 → 索引列數不變（冪等，不會累加）

### 5-2 🟠 批次匯入路徑（`pnpm sync`）

審查前 `/api/content/sync/import` 完全繞過所有寫入鉤子，這是新補的：

- [ ] 對 History 內容跑一次 `pnpm sync`（或 `--dry-run` 後實跑）→ 完成後索引有更新
- [ ] 🟠 若來源含撞名 key → **不整批中止**，該頁跳過並列進 `conflicts` 回報
      （靜默跳過會讓同步顯示成功但那幾頁根本沒寫進去）
- [ ] 🟠 匯入更新既有頁時，`metadata` 有一併寫入（改了來源的 entityKey，
      D1 裡也要是新值），但 D1 端獨有的手動欄位（icon、gate 等）**不可被清掉**

---

## 6. 觸發模型：線索卡浮出 🟠🔴

### 6-1 Echoes／Visuals 自動觸發

- [ ] 進入一首**有 entityKey 且該 key 在 History 有錨點**的歌曲頁
      → History 島浮出「《曲名》相關的段落」卡片
- [ ] 進入一個有 entityKey 的 Visuals 陳列走廊 gallery → 同樣浮出
- [ ] 進入**查無錨點**的歌／畫廊 → **不出現空卡片**（靜默，這是預期）
- [ ] 卡片中的段落標題可點 → 導向對應 History 頁

### 6-2 Concepts 條目觸發按鈕（新增可見 UI）

四種 stack 的條目旁各有一顆 `⟡ 段落` 小按鈕：

- [ ] dossier 條目標題旁
- [ ] browser 角色檔案的名字旁
- [ ] chrono 時間點展開後的標題列
- [ ] diff 詞條（對照表列與術語定義兩種版面都要看）
- [ ] 點下去 → History 島浮出線索卡
- [ ] 🔴 點**查無錨點**的條目 → 出現「沒有段落提到「XXX」」的 toast
      （手動觸發不能靜默，否則像壞掉）
- [ ] 沒有 entityKey 的條目 → **按鈕整顆不出現**
- [ ] 切到觀測者視角／停用 History 島／視窗縮到 760px 以下 → 按鈕全部消失

### 6-3 🟠 島收合時的行為（審查後重寫，最高風險）

原本 `HistoryIsland` 自己訂閱事件，收合期間島根本沒掛載，線索整個消失——
「收合時 chip 亮框、展開後看到卡片」這條路徑**從來沒有真正發生過**。
現在監聽常駐在 `IslandHost`，收合時留 pending。

- [ ] 把 History 島**收合**進 dock → 進入一首有錨點的歌
      → dock 的 History chip **亮框／閃爍**
- [ ] 展開 History 島 → 線索卡出現，chip 提示同時消失
- [ ] 展開狀態下直接觸發 → 卡片直接出現，不需要額外動作

### 6-4 🟠 換頁作廢

- [ ] 線索卡出現後**換到別的頁面** → 卡片消失（不跨頁殘留）
- [ ] 收合狀態下產生 pending，然後換頁 → pending 也一併作廢，
      chip 不再亮著
- [ ] 一次只留一則：連續進入兩首不同的歌 → 卡片被新的取代，不排隊堆疊
- [ ] 點卡片的關閉鈕 → 消失；整頁重整 → 不會復活（不持久化）

---

## 7. 便條擴充：地點／時間小標 🔵

- [ ] 便條島展開 → 點一張便條進入編輯態 → 出現「地點」「時間」兩個 checkbox
- [ ] 勾「地點」→ 顯示當前 zone + 頁面名稱
      （⚠️ 頁面名稱來自 Reader 發佈的 pageContext，**不是 document.title**）
- [ ] 勾「時間」→ 顯示當下的現實時間（使用者時區）
- [ ] 離開編輯態 → 小標以唯讀形式留在便條上
- [ ] 取消勾選 → 小標消失
- [ ] 換到別的頁面再看那張便條 → 顯示的是**當初記錄的快照**，不會跟著變
- [ ] 超長頁面名稱會被截斷（cap 60 字），不撐破版面
- [ ] 重整頁面後小標仍在（有進 progress blob）

---

## 8. entity 拖進便條島 🔴

**核心規則**：拖出來的文字一律是該 entity 在 **Concepts dossier** 裡的名稱，
不是拖曳來源上顯示的字。dossier 查不到 = 不可拖。

### 8-1 四個拖曳來源（便條島需**展開**）

- [ ] **History 文內的 entity 嵌入** → 拖進島 → 建立便條，內容是 dossier 正名
- [ ] **Concepts dossier 條目卡** → 同上
- [ ] **Echoes 歌曲卡**（清單列） → 拖出的是該 entity 的正名，不是曲名
- [ ] **Visuals 畫廊卡** → 同上，不是畫廊標題

### 8-2 不可拖的情況（同樣重要）

- [ ] **Concepts browser／chrono／diff 的條目** → 拖不動
      （只有 dossier 是 canonical entity）
- [ ] **劇情歌／插圖**（storyKey 命名空間） → 拖不動
- [ ] **尚未解鎖的 dossier 條目**對應的 entity → 拖不動
      （否則等於繞過進度閘漏出還沒讀到的角色名）
- [ ] **標題被 spoiler 遮住的歌曲卡**（顯示 ████ 或亂碼）→ 拖不動
- [ ] 便條島**收合**時 → 連 ghost 與連線都不該出現，不是拖到一半才失敗
- [ ] 便條島**未解鎖／被停用／手機寬度** → 同樣完全不接

### 8-3 拖曳手感

- [ ] 按住條目小幅移動（< 6px）放開 → 判定為**點擊**，原本的行為照常發生
      （開 Terminal／進詳細頁），不會誤觸拖曳
- [ ] 超過門檻後 → 出現跟隨游標的名牌 ghost + 從起點拉到游標的虛線
- [ ] 游標移到便條島上方 → 虛線變實線、ghost 邊框高亮（「即將落地」）
- [ ] 在島**外面**放開 → 不建立便條，ghost 乾淨消失
- [ ] 拖到一半按 Esc／切換視窗（pointercancel）→ ghost 收掉，不留殘影
- [ ] 便條已達 30 張上限時拖入 → 出現「便條放不下了」提示，不是靜默失敗
- [ ] 成功落地 → 「「XXX」記到便條上了」的成功提示
- [ ] 深色模式下 ghost 與連線的配色正常（不是刺眼的亮色塊）

---

## 9. 🟠 test 環境重置

`pnpm test:reset` 這次一併改了兩處：加入互聯衍生表、CLI 授權改走 admin JWT 登入。

- [ ] `pnpm test:reset` → 未設 `API_TOKEN` 時會**互動式問帳密**（同 `pnpm sync`）
- [ ] 登入後正常完成，不會問第二次（reset 會把 token 傳給它呼叫的 seed）
- [ ] 完成後 `history_interlink_index` 與 `story_points` 已依 seed 內容重建，
      不殘留上一輪的舊錨點
- [ ] `pnpm test:seed` 單獨執行同樣會問帳密並成功

---

## 10. 觀測者／守門矩陣 🔵

切到觀測者視角，逐項確認**完全不出現**：

- [ ] Concepts 條目的 `⟡ 段落` 按鈕
- [ ] History 島線索卡與 dock chip 提示
- [ ] entity 拖曳（連 ghost 都不該有）
- [ ] History 文內 entity 嵌入退化成普通文字（不可點、無樣式）

視窗縮到 760px 以下（手機寬度）：

- [ ] 上述全部同樣不出現

---

## 附錄：預期行為，不要當成 bug

1. **查無錨點時自動觸發完全靜默** —— Echoes／Visuals 進頁不彈任何東西是對的；
   只有 Concepts 的手動按鈕會給 toast。
2. **劇情歌沒填 storyKey 就無法進收藏池** —— 沒有 fallback，這是定案。
3. **同一個 entityKey 跨 zone 重複是合法的** —— 那正是互聯的基礎，
   唯一性只在「Concepts 同 stack」「Echoes/Visuals/History 各自區塊內」成立。
4. **`/api/interlink/usage` 需要授權且不進 CDN 快取** —— 未登入拿到 401 是對的
   （它會回 includeHidden 的定義端資料）。`anchors` 則維持公開。
5. **`findEntitySong` / `findEntityGallery` 需顯式帶 `keyType`** —— 打錯字回 400
   而不是靜默退回 entity 查詢。
6. **便條的地點／時間是快照** —— 之後頁面改名或刪除都不會回溯更新。

---

## 回報格式建議

發現問題時請記下：**哪一節第幾項 / 當時的視角與島狀態 / 實際看到什麼 / 預期什麼**。
浮島相關的問題請一併註明「島是展開還是收合」——這次審查修掉的最大一個缺口
（6-3）正是收合路徑從未被觸發過。
