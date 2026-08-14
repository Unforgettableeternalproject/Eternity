/**
 * Visuals 三態解鎖模型（純函式層）
 *
 * 設計依據：docs/agent/S8_VISUALS_DESIGN.md §1-2 / §1-3。
 *
 * 三態（取代 spoiler 降級鏈——艾斯維爾 2026-07-19 定案）：
 * - A `locked`   鎖定：鎖定樣式整張擋住（佔位可見，不隱藏——與 Echoes
 *   「未解鎖完全隱藏」刻意相反，讓讀者知道 gallery 總張數）
 * - B `partial`  部分解鎖：模糊/遮罩效果，可窺不可視
 * - C `unlocked` 解鎖：完整顯示
 *
 * 每張圖片顯式設定初始狀態 + 最多兩道閘，語意仍是單調 AND 鏈
 * （狀態只降不升，求值即時從旗標推導、不儲存進程）：
 *
 * | 初始 | lockGate | partialGate | 行為鏈 |
 * |------|----------|-------------|--------|
 * | A    | ✓        | ✓           | A →(lock)→ B →(partial)→ C |
 * | A    | ✓        | ✗           | A →(lock)→ C（跳過 B） |
 * | A    | ✗        | 任意        | 永遠 A（未釋出內容；無條件可離開鎖定） |
 * | B    | ✓        | ✓           | B →(partial)→ C（lockGate 無視） |
 * | B    | ✓        | ✗           | B →(lockGate 視為 partialGate)→ C |
 * | B    | ✗        | ✗           | 永遠 B |
 * | C    | 任意     | 任意        | 永遠 C（條件全無視） |
 *
 * 兩個不變量（§1-4）：
 * 1. 總 AND 鏈：圖片實際可見 = gallery 閘 ∧ 圖片自身鏈。**gallery 閘
 *    由呼叫端把關**（gallery 未解鎖時整個 gallery 呈鎖定態，不會逐圖
 *    呼叫本 resolver）。
 * 2. 第一張圖恆等式：sortOrder 第一張固定「gallery 解鎖即 C」，不設
 *    自身條件——以 `isFirstImage` 參數落實，恆回傳 `unlocked`。
 *
 * 觀測者：條件走既有 `evaluateGate` 語意——requiresFlags 被觀測者
 * bypass、pristineOnly 不 bypass。不在此另設特例。
 */

import { evaluateGate } from '../progress';
import type { GateCondition, ProgressState } from '../progress';

/** 圖片顯示三態 */
export type ImageDisplayState = 'locked' | 'partial' | 'unlocked';

/** 單張圖片的三態 gate 資料（掛在 ImageItem 上，全部選配） */
export interface ImageGateData {
  /** 初始狀態；未設定＝既有內容天生解鎖（艾斯維爾 2026-07-19 拍板） */
  initialState?: ImageDisplayState;
  /** 鎖定條件：離開 A 態的閘 */
  lockGate?: GateCondition | null;
  /** 部分鎖定條件：離開 B 態的閘 */
  partialGate?: GateCondition | null;
}

/** gate 是否有實質內容（空物件視為未設定） */
function hasGate(
  gate: GateCondition | null | undefined
): gate is GateCondition {
  if (!gate || typeof gate !== 'object') return false;
  return (
    (Array.isArray(gate.requiresFlags) && gate.requiresFlags.length > 0) ||
    gate.pristineOnly === true
  );
}

/**
 * 計算單張圖片的有效顯示狀態。
 *
 * @param gateData     圖片三態資料；null/undefined＝天生解鎖
 * @param isFirstImage 是否為 gallery（排序後）第一張——恆等式：恆 C
 * @param progress     進度狀態；null（SSR/載入前）採保守值：停在初始
 *                     狀態不求值任何閘（圖片比歌曲更易劇透，不做
 *                     Echoes 式「無 progress 即可見」的向後相容）
 * @param unlockFlag   image 級推導解鎖旗標（deriveImageUnlockFlag）；已授予
 *                     時無條件解鎖，凌駕 initialState 與所有閘——對位
 *                     gallery 授旗旁路（S8 #8：Visual Clue 指定圖片直接解鎖，
 *                     艾斯維爾定案不做「永遠鎖」防禦，clue 不會指到未釋出內容）
 */
export function resolveImageState(
  gateData: ImageGateData | null | undefined,
  isFirstImage: boolean,
  progress: ProgressState | null | undefined,
  unlockFlag?: string | null
): ImageDisplayState {
  // 不變量 2：第一張圖恆等於 gallery 解鎖狀態（呼叫端已把關 gallery 閘）
  if (isFirstImage) return 'unlocked';

  // image 級授旗旁路：Visual Clue 指定並展示過的圖片直接解鎖（無條件
  // 凌駕 initialState，同 gallery 的 isGalleryUnlockedInZone 推導旗標旁路）
  if (unlockFlag && progress?.flags?.includes(unlockFlag)) return 'unlocked';

  // 防禦性解析：未設定或非法值一律視為解鎖（2026-07-19 拍板的預設，
  // 防外部資料異常時把既有圖片誤鎖）
  const raw = gateData?.initialState;
  const initial: ImageDisplayState =
    raw === 'locked' || raw === 'partial' ? raw : 'unlocked';
  if (initial === 'unlocked') return 'unlocked'; // 案 7：條件全無視

  const lockGate = hasGate(gateData?.lockGate) ? gateData!.lockGate! : null;
  const partialGate = hasGate(gateData?.partialGate)
    ? gateData!.partialGate!
    : null;

  if (initial === 'partial') {
    // 案 4/5：以 partialGate 為主；缺 partialGate 時 lockGate 視為
    // partialGate；案 6：無任何條件 → 永遠 B
    const exitGate = partialGate ?? lockGate;
    if (!exitGate) return 'partial';
    if (!progress) return 'partial';
    return evaluateGate(progress, exitGate) ? 'unlocked' : 'partial';
  }

  // initial === 'locked'
  // 案 3/8：無 lockGate 即無條件離開鎖定（partialGate 形同虛設）
  if (!lockGate) return 'locked';
  if (!progress) return 'locked';
  if (!evaluateGate(progress, lockGate)) return 'locked';
  // 案 1：lockGate 通過 → 進 B，再看 partialGate；案 2：無 partialGate 直達 C
  if (!partialGate) return 'unlocked';
  return evaluateGate(progress, partialGate) ? 'unlocked' : 'partial';
}

/** 圖片 + 已求值的顯示狀態（Reader renderer / lightbox / 浮島共用單位） */
export interface ResolvedGalleryImage<T> {
  img: T;
  state: ImageDisplayState;
}

/**
 * 依 sortOrder 排序並逐張求值三態。index 0 = 第一張圖恆等式
 * （gallery 閘由呼叫端把關——gallery 鎖定時不會走到這裡）。
 * 泛型：Reader 的 ImageItem 與浮島的 PhantomImage 都是
 * ImageGateData 的超集，共用同一條求值路徑。
 * 精靈圖 gallery 本輪不接三態，呼叫端直接跳過。
 */
export function resolveGalleryImages<
  T extends ImageGateData & { sortOrder?: number },
>(
  images: T[],
  progress: ProgressState | null | undefined,
  galleryId?: string | null
): ResolvedGalleryImage<T>[] {
  return [...images]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map((img, i) => ({
      img,
      state: resolveImageState(
        img,
        i === 0,
        progress,
        galleryId && 'id' in img && typeof img.id === 'string'
          ? deriveImageUnlockFlag(galleryId, img.id)
          : null
      ),
    }));
}

/**
 * 自動推導單張圖片的解鎖旗標。
 *
 * 圖片 id 只保證在頁面內唯一，因此命名空間必須同時包含 gallery id；
 * `encodeURIComponent` 避免 id 中的 `:` 與層級分隔混淆。Visual Clue
 * 指定圖片或 image gate 切圖時授予，Reader 與浮動幻影共用此判定。
 */
export function deriveImageUnlockFlag(
  galleryId: string,
  imageId: string
): string {
  return `image:${encodeURIComponent(galleryId.trim())}:${encodeURIComponent(imageId.trim())}`;
}

/**
 * 自動推導 gallery 的解鎖旗標（對位 deriveSongUnlockFlag 的雙命名空間）：
 * - 有 entityKey 的 gallery（陳列走廊）→ `{entityKey}:gallery`
 * - 無 entityKey（鑲框室等）→ `gallery:{pageId}`
 *
 * Visual Clue／entity 嵌入觸發展示未解鎖 gallery 時授旗（V-D 接線），
 * 編輯器不手填旗標字串。
 */
export function deriveGalleryUnlockFlag(
  pageId: string,
  entityKey?: string | null
): string {
  const key = entityKey?.trim();
  if (key) return `${key}:gallery`;
  return `gallery:${pageId}`;
}
