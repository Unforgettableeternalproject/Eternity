# S8 Echoes 設計文件：流浪回聲 Playlist Island（上半場）

> 起草基準：0.9.12.46（feature/epic2-progress-foundation）
> 版號範疇：**S8 全段掛 0.9.13.x**（艾斯維爾 2026-07-11 修正——A/B 段實作時曾沿用 0.9.12.48~55，版號重整 commit 進位至 0.9.13.0，C 段起從 **0.9.13.1** 續編）
> 目標里程碑：S8 完成點 → **0.9.14.0**（原「0.9.13.0 掛 S8 完成點」作廢）
> 作者：奈留 × 奈也（架構師）；B 段實作與交接註記：諾薇亞
> 日期：2026-07-11
>
> **交接注意**：A/B 段已完成（見文末「實作進度與交接」章節），
> 本文件 §3-1 的解鎖語意已依艾斯維爾二輪口頭定案修正——閱讀舊筆記
> 時若見「讀到詳情頁自動解鎖」字樣，以本文件現行內容為準。

---

## 總覽

S8 上半場核心命題：**讓音樂跟著讀者走，而不是被頁面綁住。**

現行 EchoesReader 的 AudioProvider 採用 React Context，Audio 元素在 Reader unmount 時立即殺死——讀者切換到其他 zone，音樂必然中斷。浮島（EchoesIsland）常駐於 `document.body`（portal），與 Reader tree 分離，兩者之間沒有共享的播放狀態，屬結構性衝突。

S8 解決方案：**將 Audio 元素抽離 React tree，成為 module-level singleton**（`uepAudioStore`，`window.__uepAudio` bridge），沿 `progressStore`/`islandRuntime` 的既有慣例。EchoesReader 的 AudioProvider 改為包裹 singleton 的薄殼（Context API 介面盡量不變），EchoesIsland 直接消費同一個 singleton。

S8 同時引入**兩種內容訊號**——echo spot（掃描線觸發播放）與互動嵌入展示——以及**解鎖 vs Spoiler 兩軸**的訊號控制架構。

---

## 一、Audio Singleton

### 1-1 設計原則與為什麼不用其他方案

**必須抽離 React tree 的根因**：React component 的 unmount 語意是「清理副作用」，AudioProvider 的 `useEffect` cleanup 正確地 `pause()` 並清空 `audio.src`——這是 React 正確的做法，但也是問題所在。若改用 Context API + 全域 Provider（放在最外層 Astro component），因 uep 站是純 MPA（沒有 ClientRouter），跨 zone 導航本來就是整頁重載，頂層 Provider 照樣消失。

結論：**唯一能在頁面生命週期內全程存活的位置是 module-level 變數**，配合 `window.__uepAudio` bridge 跨 React island 共用，與 `progressStore`/`islandRuntime` 完全同模式。

**同 zone pushState 導航（useZoneRouter）不整頁重載**：EchoesReader 內部換頁（如從歌曲列表切到歌曲詳情）走 pushState，IslandHost 的 portal 常駐在 body 上，singleton 不受影響，音樂天然不斷。

**跨 zone 整頁重載**：使用者導航到非 Echoes 的其他 zone，整頁重載，singleton 消失。此時恢復策略：由 `uep.audio.v1` localStorage 讀回狀態，恢復為**暫停態**。使用者手勢（點擊播放按鈕）才續播——autoplay policy 防禦。`currentTime` 恢復必須等 `loadedmetadata` 事件，沿用 EchoesReader.tsx:368 的 `endSeek` retry 模式。

### 1-2 模組位置

```
apps/uep/src/audio/
  audioStore.ts          ← module-level singleton + window bridge（新建）
  audioStore.test.ts     ← 純函式層測試（新建）
  audioTypes.ts          ← 型別定義（新建）
  audioContext.tsx        ← React Context 橋接層，AudioProvider 薄殼（新建）
```

AudioProvider 從 `EchoesReader.tsx` 搬遷至 `audio/audioContext.tsx`，原始檔案只保留 `import { AudioProvider, useAudio } from '../../audio/audioContext'`。

### 1-3 核心型別

```typescript
// audio/audioTypes.ts

/** 播放佇列中的單一曲目 */
export interface AudioQueueItem {
  songId: string;
  url: string;
  /** 插播快照：記錄插播前佇列，用於插播結束後恢復 */
  _isInterruption?: boolean;
}

/** Audio Singleton 的完整狀態 */
export interface AudioState {
  /** 目前播放曲目 ID；null = 無 */
  currentSongId: string | null;
  /** 是否正在播放 */
  isPlaying: boolean;
  /** 播放進度 0-1 */
  progress: number;
  /** 目前時間（秒） */
  currentTime: number;
  /** 總時長（秒，0 = 未知） */
  duration: number;
  /** 音量 0-1 */
  volume: number;
  /** 播放佇列（不含當前曲目） */
  playlist: AudioQueueItem[];
  /** 一般播放歷史；Echo Spot 插播不納入 */
  history: AudioQueueItem[];
  /** 循環模式 */
  loop: 'none' | 'one' | 'all';
  /**
   * 插播快照：echo spot 觸發時的前一佇列狀態。
   * null = 目前不在插播狀態。
   */
  interruptionSnapshot: {
    songId: string | null;
    currentTime: number;
    playlist: AudioQueueItem[];
    wasPlaying: boolean;
  } | null;
}

/** uep.audio.v1 的 localStorage 持久化形狀 */
export interface AudioPersisted {
  currentSongId: string | null;
  currentTime: number;
  playlist: AudioQueueItem[];
  history?: AudioQueueItem[];
  volume: number;
  loop: 'none' | 'one' | 'all';
  wasPlaying: boolean;
}
```

### 1-4 Singleton API

```typescript
// audio/audioStore.ts（介面草稿）

declare global {
  interface Window { __uepAudio?: typeof uepAudio; }
}

export const uepAudio = {
  /** 取得目前狀態（唯讀快照） */
  getState(): AudioState;

  /** 訂閱狀態變更，回傳取消訂閱函式 */
  subscribe(listener: (state: AudioState) => void): () => void;

  // ── 播放控制 ──
  play(songId: string, url: string): void;
  pause(): void;
  toggle(songId: string, url: string): void;
  seek(fraction: number): void;
  beginSeek(): void;
  endSeek(fraction: number): void;
  setVolume(v: number): void;
  setLoop(mode: 'none' | 'one' | 'all'): void;
  next(): void;
  previous(): void;

  // ── 佇列管理 ──
  enqueue(item: AudioQueueItem): void;
  setPlaylist(items: AudioQueueItem[]): void;
  clearPlaylist(): void;

  // ── 插播 ──
  /**
   * 插播語意：記錄快照 → 中斷當前佇列 → 播放 songId。
   * 如果已在插播，直接替換（新插播覆蓋舊插播，快照不巢狀）。
   */
  interrupt(songId: string, url: string): void;

  /**
   * 結束插播，恢復快照狀態。
   * 恢復條件任一：離開頁面 / 被其他 echo spot 插入 / 播畢 / 使用者手動切掉。
   * 恢復後繼續播還是維持暫停，由 interruptionSnapshot.wasPlaying 決定。
   */
  restoreFromInterruption(): void;

  // ── 生命週期 ──
  /** 停用 echoes 島時或登出時呼叫：停止播放 + 清理狀態 */
  stop(): void;
};
```

### 1-5 持久化策略

持久化 key：`uep.audio.v1`（統一入 `uep.*.v1` 命名空間，收編舊 `uep-player-volume`）。

寫入時機：
1. 換曲、暫停、seek **立即**寫入
2. 播放中 **throttle 約 5 秒**寫入一次（RAF 驅動，不另設 setInterval）
3. `pagehide` 事件兜底（處理快速切頁來不及 throttle 的情況）

讀回時機：模組 bootstrap（`window.__uepAudio` 首次初始化）。恢復後：
- `volume`、`playlist`、`loop` 立即套用
- `currentSongId`、`currentTime`：讀回 ID、等 `loadedmetadata` 後定位（沿 EchoesReader:368 retry 模式）
- `wasPlaying = true` 時**不自動播放**，等使用者手勢——autoplay policy 防禦

### 1-6 生命週期連線

| 事件 | 行為 |
|------|------|
| 登出（session→null） | `islandRuntime.resetAll()` 被呼叫 → 同時 `uepAudio.stop()` |
| 進度 reset（`source='reset'`） | 同登出，`uepAudio.stop()` |
| echoes 島被使用者停用 | `islandRuntime` 的 `island-setting` 通知 → `uepAudio.stop()` |

**依賴方向注意**：`islandRuntime.ts` 不可反向 import `audioStore`。連線方式為：`audioStore.ts` 訂閱 `PROGRESS_CHANGE_EVENT`（已在 `islandRuntime.ts` 中使用），`stop()` 的呼叫透過 CustomEvent 觸發而非直接 import。

替代方案：在 `IslandHost.tsx` 統一訂閱，協調 island runtime 與 audio singleton 的生命週期。此方案耦合度低但需要 React 層作橋接，適合作為 fallback。

### 1-7 EchoesReader AudioProvider 改造

EchoesReader 的 `AudioProvider` 改為**薄殼**：不再建立 `new Audio()`，改為從 `uepAudio.getState()` 讀取初始狀態，訂閱後 `setState` 驅動重渲染，並把 play/pause/seek 等操作代理到 `uepAudio.*`。

Context API 的介面（`AudioState` 的欄位名稱、`useAudio` hook）**盡量不變**，讓 `EchoesAudioPlayer` 等消費端零改動或僅微調。

```typescript
// audio/audioContext.tsx（薄殼）
function AudioProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState(() => getAudioStore().getState());

  useEffect(() => {
    return getAudioStore().subscribe(setState); // 訂閱 → 狀態同步
  }, []);

  const value = useMemo(() => ({
    ...state,
    play: (id, url) => getAudioStore().play(id, url),
    pause: () => getAudioStore().pause(),
    // ... 餘下代理
  }), [state]);

  return <AudioCtx.Provider value={value}>{children}</AudioCtx.Provider>;
}
```

---

## 二、兩種內容訊號

### 2-1 Echo Spot（掃描線觸發）

**定位**：類 FlagMarker 的 TipTap 節點，插在文字段落中。掃描線通過時觸發**插播**，同時解鎖對應歌曲。

**觸發語意**：
- 同一次頁面 session（不跨整頁重載）只觸發一次——用 `sessionStorage` 記錄已觸發的 spot ID，不進 localStorage（頁面重載後允許再次觸發）
- 掃描線通過 → `uepAudio.interrupt(songId, url)` → 插播

**島未掛載時不播放（艾斯維爾 07/12 定案）**：
- 插播（與任何 spot 觸發的播放/提示卡）以 `shouldMountIsland(progress, 'echoes')` 為前置條件——**流浪回聲島未解鎖、被停用、或非登入探索者時，echo spot 不觸發播放也不出卡**。理由：島是唯一的播放控制 UI，島不在時播出來的音樂沒有任何可見控制入口
- **解鎖旗標的授予不受此限**——spot 掃過永遠照常授予推導旗標（歌曲照樣進收藏池），之後解鎖島時收藏已累積。互動式嵌入不適用這條規則，永遠不授旗。

**為什麼用 sessionStorage 而非 ProgressState**：
- ProgressState 的旗標是持久化的、跨裝置同步的，語意是「認知的永久狀態」
- echo spot 的「一次觸發」是**單次頁面 session 的體驗保護**，避免重複干擾，重新進入頁面可以再次觸發（合理的劇情重讀體驗）
- 不汙染 ProgressState 的旗標空間

**DOM 形狀（TipTap 序列化到 D1）**：

```html
<div
  data-role="echo-spot"
  data-song-id="{songId}"
  data-song-url-key="{audioFileKey}"
></div>
```

`data-song-url-key` 存 R2 key（裸），前台由 `buildAudioUrl` 組合完整 URL。不存完整 URL 的理由：API base 可能隨環境變動，D1 只存純粹的資源路徑。

**掃描線整合（`useScanline` 或等效機制）**：
在已有的 FlagMarker 掃描線掃到 `[data-role="echo-spot"]` 時，額外呼叫 echo spot handler。注意：echo spot **不授予 FlagMarker 旗標**，兩者職責分離。解鎖旗標（見第三節）由 echo spot handler 單獨授予。

**Autoplay 防禦（第五節詳述）**：
一般曲目在快速捲動、快速跳轉（resume jump）時降級為提示卡。**劇情歌在正常掃描時必須直接嘗試插播**，不因尚無 click/tap 手勢而預先降級；只有實際被瀏覽器拒絕，或屬快速捲動／跳轉誤觸，才顯示播放提示。若本次 spot 新解鎖歌曲，另顯示右下角解鎖通知。

### 2-2 互動嵌入展示

**定位**：entity 嵌入被點擊（`uep:entity-activate`）時，查詢同 entityKey 的歌曲。只有**已解鎖、有效 Spoiler 等級為 L0、具有音檔的非劇情歌**可以產生互動；其餘情況靜默忽略。

**呈現與操作**：
1. `IslandHost` 在島尚未 mount 時接住事件並查詢 `/api/echoes/entity-song?key={entityKey}`。
2. 符合條件時開啟流浪回聲島，透過 window pending bridge 把歌曲交給 `EchoesIsland`。
3. 提示直接浮在浮島內容中；淡灰回聲球以角色／區域歌的 cluster 色閃爍。
4. 使用者可選「播放」或「忽略」。播放是一般曲目切換，不使用 `interrupt()`；在使用者選擇前不得影響目前播放。

**不變量**：互動式嵌入不授予任何收藏旗標、不解鎖曲目、不插播，也不使用右下角 `SongPreviewCard`。右下角卡片保留給 Echo Spot 的新解鎖通知或實際 autoplay 失敗提示。

**監聽位置**：查詢仍掛在 `IslandHost.tsx`，避免 EchoesIsland 收合／未 mount 時漏接事件；提示的視覺與 Play／Dismiss 操作則由 `EchoesIsland` 負責。
### 2-3 歌曲種類與訊號適用矩陣

| 歌曲種類 | Echo Spot 觸發 | 嵌入展示 | 備註 |
|---------|--------------|---------|------|
| 劇情歌 | ✓（插播並解鎖） | ✗ | 不使用 Spoiler Level；類似劇情 CG，收藏狀態只有未解鎖／已解鎖 |
| 角色歌 | ✓（插播並可解鎖） | ✓（需已解鎖且為 L0） | 嵌入只提示，不解鎖 |
| 區域歌 | ✓（插播並可解鎖） | ✓（需已解鎖且為 L0） | 嵌入只提示，不解鎖 |

歌曲種類使用 Echoes 既有 metadata `category: 'story' | 'character' | 'area'`；EchoSpotNode 另保存 `songType` 快照供掃描時判定。劇情歌一律視為 L0，但未透過 Echo Spot／其他 gate 解鎖前仍不可見。

---

## 三、解鎖 vs Spoiler 兩軸

### 3-1 解鎖機制

**定義**：解鎖 = 歌曲進入收藏池（有資格加入佇列）。

**解鎖凌駕於所有 spoiler 之上**（艾斯維爾 2026-07-11 第二輪修正）：
未解鎖的歌曲在 Echoes 中**完全不存在**——列表、計數、prev/next、deep link
一律隱藏（同 Concepts dossier 語意，不是遮蔽佔位）。解鎖之後才輪到
Spoiler 降級鏈決定資訊量。**沒有「讀到詳情頁自動解鎖」這種事——未解鎖
根本讀不到。**

**解鎖來源**（任一成立即解鎖）：
1. **Gate 條件達成**——基本上與 Concepts 的做法相同：可能是被某個旗標
   觸發、完成某個章節（`completed:*`）等，走既有 `parseGateCondition` +
   `evaluateGate`（`requiresFlags` / `pristineOnly`）。**無 gate 且無靜態鎖
   的歌 = 天生解鎖**。
2. **系統推導旗標被授予**（`deriveSongUnlockFlag`）——只由 Echo Spot 觸發時授予，並同時嘗試插播。互動式嵌入永遠不授旗、不解鎖。

靜態鎖（`metadata.locked === true`，手動封存）凌駕於推導旗標之上。
觀測者沿既有 `evaluateGate` 語意 bypass `requiresFlags`。

- 使用者看不到「有幾首未解鎖歌曲」
- 已解鎖歌曲的可見資訊量由 Spoiler 等級決定（見 3-2）

#### 解鎖旗標慣例（諾薇亞提案 + 奈留分析）

**選項 A：`song:{songId}`**
- 優點：直接對應歌曲 ID，零歧義，不依賴 entityKey
- 缺點：與 Concepts 的 `{entityKey}:{stage}` 旗標慣例斷裂，Terminal 無法用 entityKey 反查
- 適用：劇情歌（無 entityKey，spot 唯一入口）

**選項 B：`song:{entityKey}` 或 `{entityKey}:unlocked`**
- 優點：沿 entityKey 命名空間，Terminal 可用 `{entityKey}:*` 掃描
- 缺點：劇情歌不一定有 entityKey；且 Concepts 的 `{entityKey}:NN` 是版本進度，語意不同

**奈留建議（提案，非定案）**：

採**雙命名空間並存**策略：
- 凡有 entityKey 的歌曲 → 解鎖旗標為 `{entityKey}:song`（沿 entityKey 空間，stage 用 `song` 固定詞，不與 Concepts 的 `:NN` 序號衝突）
- 無 entityKey 的純劇情歌 → 解鎖旗標為 `song:{songId}`

理由：Terminal Island 的 `{entityKey}:*` 掃描可以找到音樂解鎖（`xavier-colsono:song`），而劇情歌有自己的 `song:` 命名空間，保持語意分離。`evaluateGate({ requiresFlags: ['xavier-colsono:song'] })` 語意清晰。

> **待艾斯維爾定案**——此為奈留的技術觀點，最終由艾斯維爾拍板。

**Echoes 頁 metadata 欄位**：

```typescript
// Echoes 歌曲頁（pageType: 'song'）的 metadata 擴充
interface EchoeSongMetadata {
  /** 音檔 R2 key */
  audioFile?: string;
  /** 封面圖 R2 key */
  coverImage?: string;
  /** 歌曲時長（秒，管理端填入，避免每次 loadedmetadata） */
  duration?: number;
  /** 跨 zone 統一實體身分（沿 S7 entityKey 慣例） */
  entityKey?: string;
  /** 歌曲種類 */
  songType?: 'story' | 'character' | 'area';
  /** Spoiler 降級鏈（格式見 3-2） */
  spoilerRevisions?: SongSpoilerRevision[];
}
```

### 3-2 Spoiler 降級鏈

**定義**：決定「已解鎖歌曲顯示多少資訊」的進度閘控機制。

**四個 Spoiler 等級**（沿既有機制，見 EchoesReader.tsx:2148-2160）：

| 等級 | 可見資訊（既有語意不變） | 可播放 |
|------|---------|--------|
| L3（最嚴格） | 標題全遮蔽、無副標/metadata | **否（S8 變更：取代既有 30 秒 preview）** |
| L2 | 標題遮蔽（SpoilerTitle）、無副標/metadata | 是 |
| L1 | 標題可見、副標/metadata 模糊（partial appreciation） | 是 |
| L0（完全解鎖） | 完整資訊 | 是 |

**艾斯維爾定案：spoiler 機制維持原本做法，唯一變更是 L3 從「30 秒 preview」改為「完全不可播放」**（`previewLimit` 30 秒路徑廢除）。L0-L2 照舊可播放。遮蔽視覺沿用既有 `SpoilerTitle` 四級系統；Reader 內既有的 spoiler 警告確認流程（`requestUnlock`）保留不動。觀測者 bypass 全部 spoiler（既有語意）。

**已解鎖但 spoiler 仍在 L3 → 不可播放**：進入收藏池資格（解鎖）≠ 播放資格（spoiler < 3）。

**Spoiler 降級鏈結構**：Gate 表示「達成後離開哪個 Level」，不是「降到哪級」。最高有 Gate 的 Level 就是歌曲起始遮蔽級；**未設定任何 Gate 時有效等級一律是 L0**，單獨保存的舊靜態 `spoilerLevel` 不產生遮蔽。劇情歌也不使用這套結構。

```typescript
export interface SongSpoilerRevision {
  /** 此條件控制離開哪一級；L0 沒有離開條件 */
  sourceLevel: 1 | 2 | 3;
  gate: GateCondition;
}

// 例：L3 通過後直接前往下一個有 Gate 的 L1，L1 通過後到 L0
// spoilerRevisions: [
//   { sourceLevel: 3, gate: { requiresFlags: ['chapter:01'] } },
//   { sourceLevel: 1, gate: { requiresFlags: ['chapter:03'] } },
// ]
```

**求值規則**：
- 由最高 `sourceLevel` 起算。
- 當前 Gate 未通過就停在該級。
- 通過後前往下一個有設定 Gate 的較低級，因此允許 L3 → L1 這類跳級。
- 若下方沒有任何 Gate，則只降一級後停止；例如只設定 L3，通過後為 L2。
- 舊資料的 `targetLevel` 仍可讀取，會正規化為 `sourceLevel = targetLevel + 1`；新資料只寫 `sourceLevel`。
- 觀測者仍直接視為 L0。
**`isEntryUnlocked` 的類比**：Echoes 需要對應的 `isSongCollected` 純函式（**不叫 `isSongUnlocked`**——Reader 內已有同名的 spoiler 警告確認狀態，語意不同，見風險 R7）：

```typescript
// audio/spoilerResolver.ts
export function isSongCollected(
  unlockFlag: string,      // 'song:{songId}' 或 '{entityKey}:song'
  progress: ProgressState
): boolean {
  if (progress.view === 'observer') return true;
  return progress.flags.includes(unlockFlag);
}
```

---

## 四、插播語意

### 4-1 插播流程

```
echo spot 掃描線通過
  → 防禦判斷（autoplay policy，見第五節）
  ↓ 可播放
  → 檢查是否已觸發過（sessionStorage 查詢）
  → 已觸發：忽略
  → 未觸發：
      1. uepAudio.interrupt(songId, url)
         ├── 記錄快照（currentSongId, currentTime, playlist, wasPlaying）
         ├── clearPlaylist()
         └── play(songId, url)
      2. 授予解鎖旗標（isSongCollected = false 時）
      3. sessionStorage.setItem(`echo-spot-triggered:{spotId}`, '1')
```

**快照記錄只做一層**：如果已在插播狀態，新的插播覆蓋快照（不做巢狀快照），理由：多重插播的「恢復到哪裡」在 UX 上很難清晰，覆蓋是最可預期的行為。

**插播一律從頭播放（2026-07-17 修訂）**：插播曲恰好已是播放器當前曲（無論播放中、暫停中或重載恢復中）時，不得從當前位置續播——`interrupt()` 歸零 `pendingSeekTime`，`loadSong` 同曲早退路徑也要消化 seek。快照仍記錄使用者原本的位置與播放狀態，插播結束後照常恢復。

### 4-2 插播恢復條件

任一條件達成即觸發 `uepAudio.restoreFromInterruption()`：

| 條件 | 實作方式 |
|------|---------|
| 離開該頁面 | `useEffect` cleanup 或 `pushstate`/`popstate` 偵測（不是整頁重載，只有 zone 內導航） |
| 被其他 echo spot 插入 | `interrupt()` 被再次呼叫，自動覆蓋快照 |
| 播放完畢 | Audio `ended` 事件 → `restoreFromInterruption()` |
| 使用者手動切掉 | Island 的「上一首/下一首/停止」按鈕 → `restoreFromInterruption()` 或 clearInterruption() |

**恢復後行為**：
- `wasPlaying = true` → 繼續播放快照中的曲目（從 snapshot.currentTime 恢復）
- `wasPlaying = false` → 維持暫停，等使用者手勢

**整頁重載時的插播狀態**：插播快照不進 localStorage（`interruptionSnapshot` 不在 `AudioPersisted` 中），整頁重載後快照自然清空，恢復為一般播放狀態（讀 wasPlaying）。

---

## 五、Autoplay 防禦

### 5-1 防禦策略

**根本限制**：瀏覽器 Autoplay Policy 要求使用者有過手勢互動（click、tap、keydown）後才允許 `audio.play()` 成功；純捲動不算手勢。

**三層防禦**：

1. **實際播放判定**：所有 Echo Spot 在正常掃描時都直接嘗試 `interrupt()`；不因尚無 click/tap 手勢而預先降級，由實際 `audio.play()` 結果決定是否出提示卡。

2. **頁面去重**：spot 本身仍維持每次頁面造訪只觸發一次；既有 autoplay attempt 紀錄不得阻止其他正常掃描的 spot 嘗試插播。

3. **快速捲動偵測**：若捲速超過閾值（如 > 1500px/s，可由測試調整），判定為「快速跳轉」，跳過當下的 spot 觸發（同 sessionStorage 只觸發一次的語意）。實作：`useScanline` 或 echo spot handler 傳入最近的 scroll velocity。

### 5-2 降級模式：提示卡

提示卡（`SongPreviewCard`）——不中斷現有播放，浮現在頁面右下角，顯示：
- 曲名（依 spoiler 等級決定顯示多少）
- 「播放」按鈕（使用者手勢點擊 → `uepAudio.play`）
- 「加入佇列」按鈕
- 自動消失：8 秒後或使用者關閉

**提示卡語意（2026-07-17 修訂）**：提示卡在插播結果確定後才發送，依 `source` 分三種：
- `played`（插播成功）：純告知卡——只顯示曲名與分類，**無任何動作按鈕**；本次同時新收藏時標頭改為「已收錄一枚回聲 · 插播中」（`justCollected`）。
- `spot`（autoplay 失敗／誤觸降級）：帶「播放」「加入佇列」按鈕的手動入口。
- `unlock`（保留給 Echo Spot 以外的解鎖來源，如旗標達成）：同樣帶動作按鈕。

新收藏不再另發一張 unlock 卡——收藏資訊以 `justCollected` 併入結果卡。互動式嵌入不使用此卡，改由 EchoesIsland 內嵌提示。

### 5-3 「上次讀到」快速跳轉保護

使用者點擊「回到上次位置」時，HistoryReader 會 `scrollTo` 上次標記點，可能瞬間觸發多個掃描線（包含 echo spot）。此時：
- `scrollTo` 前設 `sessionStorage` flag（`reading-resume-jump = 1`）
- echo spot handler 偵測到此 flag → 跳過自動播放，直接降級到提示卡
- scroll 結束後清除此 flag（`setTimeout` 兜底或 `scrollend` 事件）

---

## 六、EchoesIsland（流浪回聲）

### 6-1 定位與職責

EchoesIsland 是**跨頁面跟著走的基本播放器**。

```
職責：
  - 顯示當前播放曲目（依 spoiler 等級決定資訊量）
  - 播放控制（play/pause/prev/next/seek/volume）
  - 顯示播放佇列（已解鎖且 L0 的曲目可加入）
  - loop 模式切換
  - 接收 echo spot 插播通知

不做：
  - 內容解鎖（由 spot/Reader 負責）
  - Spoiler 降級鏈的 gate 求值（純函式層負責，島只讀結果）
  - 歌曲的完整詳情展示（導向 Echoes Reader）
```

### 6-2 掛載位置

沿 `history`/`concepts` 的模式，在 `IslandHost.tsx` 的 `ISLAND_COMPONENTS` 新增：

```typescript
echoes: React.lazy(() => import('./echoes/EchoesIsland')),
```

路徑：`apps/uep/src/islands/echoes/EchoesIsland.tsx`（新建）。

`shouldMountIsland(progress, 'echoes')` 守門（探索者 + 已解鎖 + 未停用），沿用既有邏輯，零修改。

### 6-3 ISLAND_DEFINITIONS 更新

`types.ts` 的 `ISLAND_DEFINITIONS` 中 `echoes` 的 `title` 需從 `'回聲清單'` 改為 `'流浪回聲'`。這是唯一需要修改的 S6 既有定義。

### 6-4 島 UI 結構（功能層）

視覺設計待艾斯維爾出稿（Eternity-Design 無島原型），以下為功能結構定義：

```
EchoesIsland
├── 標題列（'流浪回聲' + 最小化按鈕）
├── 目前播放區
│   ├── 曲目資訊（沿既有 SpoilerTitle 遮蔽語彙，依有效 spoiler 等級呈現）
│   ├── VinylDisc（可從 EchoesReader 提取共用）
│   └── 播放控制（play/pause/prev/next/seek/volume）
├── 佇列區（可展開）
│   └── spoiler 0 的曲目清單，可拖曳排序（選填，S8 若時間不足可後置）
└── loop 切換
```

**與 EchoesReader 的關係**：EchoesReader 是「已解鎖曲目加入播放清單的入口」（主操作在 Reader），島是「帶著走的控制器」。讀者在 Echoes zone 看到某首歌 → 點「加入清單」→ 歌曲進入島的佇列；在其他 zone 閱讀時，用島控制播放。

### 6-5 Reader UI 新增「加入清單」動線

EchoesReader 的 `EchoesAudioPlayer` 元件（現有，L1027:L912 區間）在**spoiler 0 且流浪回聲島可掛載（`shouldMountIsland(progress, 'echoes')`，艾斯維爾 07/12 補充）**狀態下，新增「加入佇列」按鈕。spoiler 1–3 的臨時解鎖只允許當次聆聽，不授予加入持久佇列的資格：

```typescript
// EchoesAudioPlayer 新增 prop
interface EchoesAudioPlayerProps {
  // ... 現有 props
  onAddToQueue?: () => void; // spoiler 0 且島可掛載才顯示按鈕
}
```

呼叫 `uepAudio.enqueue({ songId, url })`，toast 提示「已加入流浪回聲佇列」。

---

## 七、編輯器設計

### 7-1 Echo Spot TipTap Node

**Node 類型**：block-level void node（與 FlagMarker 同模式，插在段落之間）

```typescript
// apps/uep/src/components/editor/nodes/EchoSpotNode.ts（新建）
// 沿 ProgressMarkerNode 的實作模式

const EchoSpotNode = Node.create({
  name: 'echoSpot',
  group: 'block',
  atom: true,    // void，不包含子節點
  draggable: true,

  addAttributes() {
    return {
      songId:       { default: null },
      songUrlKey:   { default: null },  // R2 裸 key
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-role="echo-spot"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, {
      'data-role': 'echo-spot',
      'data-song-id': HTMLAttributes.songId,
      'data-song-url-key': HTMLAttributes.songUrlKey,
    })];
  },
});
```

**編輯器工具列**：在 History 編輯器工具列新增「♫ 插入回聲點」按鈕（限 History 編輯器，同 FlagMarker 的 history-only 限制）。

### 7-2 曲目 Picker

點擊「插入回聲點」→ 開啟 Song Picker modal（類 S7-D 的 Reference Picker）：

```
Song Picker
├── 搜尋欄（曲名模糊比對）
├── Cluster 分組（areas / characters / stories / special）
│   └── Subcategory → Song 列表
│       └── 選中：寫入 EchoSpotNode 的 songId + songUrlKey
└── 取消
```

實作方式：類 `ConceptsEntityPicker`，API 呼叫 `GET /api/content/echoes/tree`，在前端遍歷取出 `pageType: 'song'` 的節點。Song Picker 排除 special／特殊回憶，也排除尚未設定 entityKey 的非劇情歌；劇情歌可不綁 entityKey。Modal 使用 body portal 與獨立高層級 backdrop，避免被 History 編輯器堆疊上下文穿透。

**預覽**：picker 選中後，在 Node 的 NodeView 中顯示小型 preview（曲名 + 所屬 cluster 色彩），類 FlagMarker 的已選旗標顯示方式。

### 7-3 歌曲頁 metadata 的 entityKey 欄位

Echoes 歌曲頁的 Admin 編輯器（`EchoesEditorBody`）新增 `entityKey` 輸入欄位，複用 S7-B 的 `EntityKeyField` 元件：

```typescript
// EchoesEditorBody 的 song 頁面編輯區
<EntityKeyField
  value={meta.entityKey}
  onChange={(key) => setMeta({ ...meta, entityKey: key })}
  existingKeys={allSongEntityKeys}  // 同 zone 內的已用 key（頁面層唯一）
  accent={clusterColor}
/>
```

### 7-4 Spoiler 降級鏈的編輯 UI

歌曲頁直接以 L0–L3 四張 Level 卡作為選擇器，不再另設「漸進降級」區塊：

- 點選 L1／L2／L3 後，在卡片列下方編輯「離開該 Level 的條件」。
- L0 沒有離開條件，只顯示說明。
- 有 Gate 的最高 Level 即為起始遮蔽級；設定 L1、L2 時從 L2 開始，不會因啟用降級而固定從 L3 開始。
- Level 可以不連續。例如 L3 與 L1 有 Gate、L2 無 Gate，執行路徑為 L3 → L1 → L0。
- 移除某一級 Gate 不連帶刪除其他級。
- 劇情歌完全隱藏 Level、Gate 與 spoiler 警告文案，序列化時固定 L0 且不輸出 `spoilerRevisions`。

每張卡顯示是否已設條件；編輯區在窄版 admin 會改為單欄，避免 GateConditionEditor 橫向溢出。
---

## 八、Worker 端點擴充（content-api）

### 8-1 Entity-Song 查詢端點

```
GET /api/echoes/entity-song?key={entityKey}
```

回傳：

```typescript
interface EntitySongResponse {
  found: boolean;
  song?: {
    id: string;
    title: string;
    audioFile: string | null;
    entityKey: string;
    songType: 'story' | 'character' | 'area';
    spoilerRevisions?: SongSpoilerRevision[];  // gate 摘要，前端 resolver 用
    clusterId: string;
    clusterColor: string;
  };
}
```

實作：D1 查詢 `pages` 表，條件 `area = 'echoes' AND page_type = 'song' AND json_extract(metadata, '$.entityKey') = {key}`，回傳 metadata 解析結果。

此端點**不回傳音檔 URL**（只回傳 `audioFile` 裸 key），前端由 `buildAudioUrl` 組合。

### 8-2 解鎖旗標授予

Echo spot 觸發時的解鎖旗標授予**在前台完成**（`getProgressManager().grantFlags([unlockFlag])`），不需要後端端點。與 FlagMarker 的 grantsFlags 機制相同。

---

## 九、ProgressState 擴充

S8 需要在 `ProgressState` 新增以下欄位：

```typescript
// progress/types.ts 新增欄位
interface ProgressState {
  // ... 既有欄位 ...

  /**
   * 已解鎖的 Echoes 歌曲旗標（S8）。
   * 實際儲存在 flags 陣列（'song:{id}' 或 '{entityKey}:song'）——
   * 此欄位的設計決策同 Concepts 的 conceptsReadLevel：
   * 旗標本身在 flags 裡，EchoesIsland 需要的是「哪些歌已解鎖」的快速查詢。
   *
   * 不另開欄位：利用 isSongCollected(flag, progress) 函式對 flags 掃描即可，
   * 不需要冗餘欄位——flags 陣列已是 Set 語意（parseFlagsAttr 去重）。
   */
}
```

**結論**：S8 不新增 ProgressState 欄位，解鎖旗標寫入既有 `flags` 陣列，由 `isSongCollected` 純函式判斷。`normalizeState` 不需要修改。

---

## 十、可測性設計

延續 `revision.ts`、`markers.ts` 的純函式優先原則：

| 純函式 | 位置 | 測試重點 |
|--------|------|---------|
| `resolveSpoilerLevel` | `audio/spoilerResolver.ts` | 初始 L3、逐級降、亂序防禦、觀測者 bypass |
| `isSongCollected` | `audio/spoilerResolver.ts` | flags 存在/不存在、觀測者 bypass |
| `AudioPersisted` 序列/反序列 | `audio/audioStore.ts` | volume 收編、向後相容 |
| echo spot sessionStorage 查詢 | 純函式包裝 | 觸發/已觸發/重置 |

**Singleton 測試策略**：`audioStore.ts` 提供 `_resetForTest()` 函式（僅測試環境），讓各測試 case 可清空 module-level state，同 `progressStore` 的測試慣例。

**Island 測試**：EchoesIsland 的 UI 邏輯盡量下推到純函式（如 `resolvePlayableState(songId, progress)`），減少依賴 singleton 的元件測試量。

---

## 十一、遷移/相容策略

### 11-1 既有 `uep-player-volume` 收編

Bootstrap 時讀取順序：
1. `uep.audio.v1` 存在 → 使用（volume 欄位已在其中）
2. `uep.audio.v1` 不存在，但 `uep-player-volume` 存在 → 遷移：讀 volume 值，寫入 `uep.audio.v1`，刪除 `uep-player-volume`
3. 兩者皆不存在 → 使用預設值 `0.6`

### 11-2 EchoesReader 的現有播放功能

S8 初期：EchoesReader 保留 `AudioProvider`（改為薄殼），`EchoesAudioPlayer` 零改動，Reader 內的播放行為不變。用戶在 Reader 播放的歌曲，因為現在對到同一個 singleton，島的狀態會自動同步。

### 11-3 既有 ISLAND_DEFINITIONS

`types.ts` 中 `echoes.title` 的改名（`'回聲清單'` → `'流浪回聲'`）是唯一 breaking change，需確認沒有 hardcode 字串 `'回聲清單'` 的地方（一律用 `ISLAND_DEFINITIONS.echoes.title`）。

---

## 十二、風險識別

### R1：Audio Singleton 的 DOM 問題

**風險**：module-level `new Audio()` 在 SSR 環境（Astro 預渲染）會 throw，因為 `Audio` 不存在於 Node.js。

**緩解**：`audioStore.ts` 的 bootstrap 加 `typeof window !== 'undefined'` 防禦，Audio 元素延遲到首次 `play()` 呼叫或 `window` 初始化時建立，同 `islandRuntime.ts` 的 bootstrap 模式。

### R2：RAF 驅動的 5s throttle 與頁面 visibility

**風險**：頁面進入背景時 `requestAnimationFrame` 被瀏覽器降頻或暫停，throttle 計時失準，可能導致 `currentTime` 持久化落後。

**緩解**：`pagehide`（pagehide 取代 beforeunload，iOS Safari 相容性更好）兜底強制寫入，這是最重要的持久化路徑。RAF throttle 只是「播放中的定期更新」，不是唯一防線。

### R3：插播快照的競態條件

**風險**：多個 echo spot 在快速捲動中幾乎同時觸發，快照被連續覆蓋，「最後一個」快照可能記錄的是上一個插播的狀態，而非真正的「播放前」狀態。

**緩解**：sessionStorage 的「已觸發」機制確保每個 spot 在同一 session 只觸發一次，加上快速捲動偵測，正常使用場景下不會發生多重觸發。極端情況（debug 清 sessionStorage 後快速捲動）可接受降級行為（快照記錄到中間狀態）。

### R4：echo spot 在 History 編輯器中的 DOM 汙染

**風險**：History 文章 HTML 被其他 Reader 或非 Echoes 頁面渲染時，`data-role="echo-spot"` div 會產生空白 block。

**緩解**：echo spot handler（掃描線整合端）只在 EchoesReader 或 HistoryReader（非 Echoes zone）中掛載時才啟用。其他 zone 的 Reader 渲染 History HTML 時，`data-role="echo-spot"` 被當成普通 div，CSS 設 `display: none` 防視覺干擾。長遠：`renderHtmlWithUep` 增加 strip echo spot 選項（S9 前考慮）。

### R5：uep 站純 MPA 的 singleton 壽命假設

**風險**：設計文件基於「uep 站純 MPA，跨 zone 必整頁重載」的假設。若未來引入 View Transitions API 或部分 SPA 化，singleton 壽命變長，需要額外的清理邏輯。

**緩解**：此假設已在定案筆記中明確記錄，架構決策有文字依據。未來若引入 SPA 導航，需重新評估 singleton 的頁面邊界語意。

### R6：`concepts` 浮島同事件競爭

**風險**：`uep:entity-activate` 被 Terminal Island（concepts）和 EchoesIsland 同時消費，若 entity 同時有 Concepts 條目和 Echoes 歌曲對應，兩個 UI 同時彈出。

**緩解**：Terminal 顯示 Concepts 資料（左邊），EchoesIsland 顯示曲目卡（右邊），兩者視覺上不重疊（位置分離）。UX 上這是「同一個人物既有百科資料也有歌曲」的合理呈現，非 bug。若艾斯維爾覺得 too busy，可設優先序（Terminal 先，曲目卡自動延遲 1.5s 顯示）。

### R7：`isSongUnlocked` 命名衝突

**風險**：EchoesReader 內已有同名概念（`EchoesReader.tsx:2149` 的 `isSongUnlocked`）——語意是「使用者已確認 spoiler 警告」，與 S8 新引入的「歌曲進入收藏池」完全不同。若新純函式沿用 `isSongUnlocked` 命名，實作與 review 時極易混淆。

**緩解**：新純函式改名為 `isSongCollected`（或 `isSongInPool`），既有 Reader 內的 spoiler 警告確認機制保留原名不動。Sub-session B 實作時定名。

---

## 十三、實作分期建議（粗粒度，供戴爾細拆）

### Sub-session A：Audio Singleton 地基

**目標**：純函式層與 singleton 可跑測試，不接 UI。

- 新建 `audio/audioTypes.ts`、`audio/audioStore.ts`（含 bootstrap、persistence、play/pause/seek/volume API）
- `uep-player-volume` 遷移邏輯
- `audio/audioContext.tsx`（AudioProvider 薄殼，Context 介面不變）
- EchoesReader.tsx 中 AudioProvider 改為 import 薄殼（不修改 EchoesAudioPlayer）
- `audioStore.test.ts`：bootstrap、persistence、play/pause/volume/enqueue

**驗收**：EchoesReader 播放功能不退化；`uep.audio.v1` 寫入正確；Reader 與 Island 共用同一個 Audio 元素（不同 React tree 操控同一首歌）

### Sub-session B：EchoesIsland 骨架 + 佇列 UI

**目標**：EchoesIsland 可掛載、可播放，視覺為骨架（等設計稿）。

- `audio/spoilerResolver.ts`（`resolveSpoilerLevel`、`isSongUnlocked` 純函式 + 測試）
- `islands/echoes/EchoesIsland.tsx`（新建：標題列、播放控制、佇列清單、骨架）
- `IslandHost.tsx` 新增 echoes lazy import
- `ISLAND_DEFINITIONS.echoes.title` 改名
- EchoesReader 新增「加入佇列」按鈕（spoiler L0 才顯示）
- `Worker entity-song 端點`（`/api/echoes/entity-song`）

**驗收**：Island 可掛載；播放控制正常接 audioStore；Reader 的「加入佇列」可進佇列；spoiler 等級計算正確（單元測試）

### Sub-session C：Echo Spot + 插播

**目標**：TipTap node 可插入，掃描線觸發插播，歌曲解鎖旗標授予。

- `EchoSpotNode.ts`（TipTap node）
- History 編輯器工具列新增 Echo Spot 按鈕
- Song Picker modal
- 掃描線整合（EchoesReader 或 HistoryReader 的 echo spot handler）
- 插播語意（`interrupt()`、`restoreFromInterruption()`）
- sessionStorage 觸發追蹤
- 解鎖旗標授予（`grantFlags`）

**驗收**：Admin 可插入 echo spot；前台掃描線通過觸發插播；歌曲解鎖後在 Echoes 列表可見；插播結束後正確恢復

### Sub-session D：嵌入展示 + Autoplay 防禦 + Spoiler 降級鏈編輯

**目標**：entity 嵌入展示歌曲卡，autoplay 防禦完整，admin 可設定 spoiler 降級鏈。

- `SongPreviewCard` 供 Echo Spot autoplay 降級與新解鎖通知；互動嵌入提示改放在 EchoesIsland 內
- `IslandHost.tsx` 新增 `entity-activate` 的 echoes 消費（類 Terminal 的 pushEntityActivate 模式）
- Autoplay 防禦三層（手勢追蹤、一次嘗試、快速捲動偵測）
- 歌曲頁 Admin 編輯器：EntityKeyField + Spoiler 降級鏈 UI（GateConditionEditor 復用）
- `entityKey` 的 metadata 存取/存檔

**驗收**：點擊已解鎖且為 L0 的角色／區域歌 entity 嵌入 → 流浪回聲島浮現提示與染色回聲球；Play／Dismiss 不解鎖；Echo Spot 可插播並於新解鎖時通知；Admin 可直接在 Level 卡設定離開條件且支援跳級。

---

## 定案記錄（2026-07-11 艾斯維爾核可）

| 議題 | 決議 |
|------|------|
| Audio singleton 方案 | module-level + `window.__uepAudio` bridge；AudioProvider 改薄殼，Context API 介面不變 |
| MPA 導航行為 | 跨 zone 整頁重載恢復暫停態；同 zone pushState 天然不斷 |
| 持久化 key | `uep.audio.v1`，收編 `uep-player-volume` |
| 插播快照 | 不巢狀，後來的插播覆蓋快照 |
| sessionStorage 去重 | echo spot 同 session 只觸發一次，整頁重載後重置 |
| 未解鎖歌曲 | Echoes 列表完全隱藏（非佔位遮蔽） |
| Spoiler 降級鏈語意 | 單調 AND 鏈（`break`）；遮蔽維持既有 SpoilerTitle 語意，L0-L2 可播放，**L3 不可播放（取代既有 30 秒 preview）** |
| 觀測者 bypass | bypass 全部 spoiler（既有語意沿用） |
| 嵌入展示語意 | 僅展示不播放；entity 出現 ≠ 歌曲解鎖 |
| 劇情歌唯一解鎖路徑 | 必須經 echo spot，嵌入展示不開放劇情歌 |
| EchoesIsland 標題 | `'流浪回聲'`（原 `'回聲清單'`）|
| 版號範疇 | S8 全段掛 0.9.13.x（2026-07-11 修正）；S8 完成點 → 0.9.14.0 |
| 測試基準 | 731 全綠，新增純函式測試；建議 A 段完成後驗 731 不退化 |
| 島收合行為 | **收合即暫停**；展開（點擊=手勢）若收合前播放中則自動續播（2026-07-11 二輪） |
| 解鎖旗標慣例 | 雙命名空間：`{entityKey}:song` / `song:{songId}`，由系統自動推導、編輯器不手填（2026-07-11 二輪） |

---

## 待決問題（2026-07-11 二輪定案後更新）

### ~~待決 1~~ → 已定案：**收合即暫停**（選項 B，艾斯維爾 2026-07-11）

收合 EchoesIsland → `uepAudio.pause()`。展開島（點擊本身即使用者手勢）時，若收合前正在播放則自動續播。實作歸 Sub-session B（島 UI 接線）。Dock chip 不需要播放中動畫。

### ~~待決 2~~ → 已定案：**雙命名空間 + 編輯器直接綁定**（艾斯維爾 2026-07-11）

- 有 entityKey 的歌曲：`{entityKey}:song`；無 entityKey 的劇情歌：`song:{songId}`
- **綁定操作全在編輯器完成**：歌曲頁編輯器以 EntityKeyField 綁 entityKey（§7-3）；劇情歌可直接以歌曲頁 id 為準
- 解鎖旗標由系統**自動推導**（有 entityKey → `{entityKey}:song`，無 → `song:{songId}`），編輯者無需手填旗標字串；echo spot picker 選中歌曲時同樣自動推導

### ~~待決 3~~ → 已定案：流浪回聲視覺（2026-07-11）

定案稿：`Eternity-Design/components/echoes-island.jsx`（設計 agent 初稿 → 諾薇亞格局改版 → 艾斯維爾視覺修正）。要點：

- **淡灰的回聲球＝播放鍵**：待機淡灰、**播放中被曲目分類色染色**（球體/光暈/漣漪/字形，艾斯維爾明示不要黑色）；砍掉獨立播放按鈕
- 橫排舞台（球 96px 靠左、曲目資訊右側）、控制列單行（⟳ ◀◀ ▶▶ ♪）
- 佇列曲目以小球繞球公轉（佇列收合時仍是佇列的軌道形態）；佇列預設收合、toggle 展開
- 尺寸：佇列收合態 292×約215
- 生產版已落地 `apps/uep/src/islands/echoes/`（B-3）；D 段 EchoSpotToast/SongPreviewCard 視覺照稿（288px 卡）

---

## 實作進度與交接（S8-C/D 完成，2026-07-14）

### 已完成

**A 段（0.9.12.48~50）**：audioTypes + spoilerResolver / audioStore singleton（播放/佇列/插播/持久化/生命週期）/ AudioProvider 薄殼接線。interrupt 不清佇列（快照不含 playlist）、插播中再 interrupt 不重拍快照。2026-07-14 補上最多 50 首的一般播放歷史：previous() 可返回前曲並讓 next 再前進；Echo Spot 插播不入歷史，互動式嵌入的使用者選歌屬一般播放。

**B 段（0.9.12.51~55 + 2 fix）**：

| 版號 | 內容 |
|---|---|
| .51 | Echoes 接進度系統：`echoesVisibility.ts` 的 `isSongUnlockedInZone`——未解鎖完全隱藏（列表/計數/prev-next/deep link）+ **L3 封印（sealed）取代 30 秒 preview** + 移除列表 LOCK 佔位 |
| .52 | ISLAND_DEFINITIONS 改名「流浪回聲」、寬度 292、IslandHost lazy 註冊 |
| .53 | 島本體 `islands/echoes/`：球=播放鍵 + **accent 分類色管線**（AudioQueueItem.accent / AudioState.currentAccent，沿 title 管線鋪滿 store 含持久化與插播快照）+ 收合即暫停/展開續播 + 佇列 UI |
| .54 | Reader EchoesAudioPlayer `onAddToQueue`（+♫，僅 spoiler 0）+ 去重 toast |
| .55 | content-api `GET /api/echoes/entity-song?key=`（**偏離 §8-1：不回傳 clusterColor**——分類色是前端 CLUSTERS 常數，回 clusterId 由頁面 id 路徑推導；songType 對映既有 metadata.category，不開新欄位） |
| fix | audioStore 移除 `/* global */`（no-redeclare）；回聲球淡灰+播放染色（視覺定案） |

測試基線：前端 **699** + workers **108** 全綠；`pnpm check` 全過。

### 關鍵實作備註（C 段會踩到的）

1. **收合即暫停的真相**：DraggableIsland 的 close = `runtime.close(id)` → IslandHost 只渲染 open 島 → **body unmount**。pause 在 EchoesIsland 的 useEffect cleanup；`wasPlayingBeforeCollapse` 是 **module-level 變數**（React ref 活不過 unmount）。登出/停用先 `stop()` 清 isPlaying，旗標不會誤續播
2. **推導旗標的 songId = 完整頁 id**（如 `song:echoes/characters/heroes/xxx`）——C-3 spot 授旗、Song Picker 寫入 node 屬性時必須保持一致（`deriveSongUnlockFlag(page.id, entityKey)`）
3. **跨 island bundle 隔離**：任何要跨 Reader/島共享的資料只能走 store（window bridge），module-level map 不共享——accent 進 store 就是這個原因
4. **echoes 歌曲頁 metadata.gate 是「字串」**（spoiler 警告的提示文案），與 gating 的 GateCondition（平鋪 requiresFlags/pristineOnly 或巢狀 gate 物件）不同——`parseGateCondition` 遇字串 gate 會 fallback 平鋪解析，天然不衝突，但 D 段 admin UI 設計 gate 編輯時要處理這個欄位歧義

### C 段（0.9.13.1~5）已完成

- `EchoSpotNode` 已納入 TipTap：保存穩定 `spotId`、完整歌曲頁 id、R2 裸 key、entityKey、分類／時長與 spoiler revision 快照；Song Picker 只列出具音檔且符合綁定規則的歌曲，排除 special 與缺 entityKey 的非劇情歌
- progress marker 掃描線已擴充 `role + element` callback；echo spot 每次頁面造訪只觸發一次，重新造訪可再觸發，且無論島是否掛載都先授予推導旗標
- 只有 Echoes 島已掛載時才走 `audioStore.interrupt()`；所有 Echo Spot 正常掃描都實際嘗試插播，快速捲動、resume jump、L3 封印或瀏覽器實際拒絕播放時才出提示卡
- 插播在離頁時恢復；插播中 next/previous 不再把插播曲誤當使用者佇列狀態
- 「上次讀到」跳轉以 session 旗標、`scrollend` 與 500ms timeout 雙重解除，避免掃描線沿途觸發 echo spot

### D 段（0.9.13.6~10）已完成

- `SongPreviewCard` 僅供 Echo Spot 的播放降級與新解鎖通知；entity activation 改由 EchoesIsland 內提示，限定已解鎖、L0、非劇情歌，Play／Dismiss 均不授旗
- IslandHost 新增 Echoes entity activation consumer，會取消過期請求、重查 entity-song、套用可見性 gate 與動態 spoiler resolver；Terminal consumer 保持原行為
- `/api/echoes/entity-song` 摘要補齊 subtitle、duration、spoilerLevel、GateCondition 與 locked，並排除 hidden 歌曲
- Echoes 編輯器新增 EntityKeyField 與同 zone 唯一性硬驗證；查核未完成／失敗時阻擋存檔並可重試
- Spoiler Gate 直接整合進 L0–L3 Level 卡：分類／Level 在左、條件區在右且有空狀態；Gate 表示離開該級，可跳過未設定級；最高有 Gate 的 Level 為起點，完全無 Gate 時有效 L0
- **資料相容修正**：舊 `metadata.gate` 字串只向後相容讀成 `spoilerGate`；真正的 `metadata.gate` 物件保留給全站內容可見性，儲存時不再互相覆寫

### 驗證重點

- Echo Spot HTML round-trip、Picker、marker/scanline、session dedupe、autoplay/interrupt、spoiler resolver、曲目卡 L3/L0 權限與 Echoes metadata round-trip 均有自動測試
- Spoiler 不變量：最高有 Gate 的級別為起點；通過後前往下一個有 Gate 的較低級；若無更低 Gate 才只降一級。禁止重新引入固定 L3 起算或連續級別限制。

*文件結束。*
