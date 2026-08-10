/**
 * UEP 系統旗標
 *
 * 與劇情旗標的差別在**誰決定名字**：劇情旗標由編輯者在文章裡當場取名、
 * 存檔時補進註冊表；系統旗標的名字是這裡的常數，由站台行為授予，編輯端
 * 只能引用不能發明（見 `editorModeRegistry` 的 `gateFlagPrefix`）。
 *
 * 消費端目前是 Storage 的對話 gate——「與 UEP 的某些對話要在某些事件之後
 * 才會出現」。
 *
 * ## 前綴是 `uep:` 不是 `uep-`
 *
 * 沿用早於本模組存在的 `uep:teatime`（`lib/teatime.ts`，茶會彩蛋已經在
 * 授予它），也與站內 `completed:` / `met:` 的冒號慣例一致。⚠️ 冒號形狀
 * 容易讓人以為它是 derived 旗標（`completed:{pageId}` 那種由 key 推導、
 * 不入註冊表的），但這些是**貨真價實的註冊表項目**——worker 的
 * `flags-scan.ts` 只把列舉出來的前綴當 derived，`uep:` 不在其中。
 */

import { getProgressManager } from './progressStore';

/** 系統旗標的共同前綴 */
export const UEP_FLAG_PREFIX = 'uep:';

export const UEP_FLAGS = {
  /** 進過這個網站。其他 uep 旗標的共同前提 */
  intro: 'uep:intro',
  /** 五個區域都造訪過 */
  allZone: 'uep:all-zone',
  /** 五座浮島全數解鎖 */
  allIsland: 'uep:all-island',
  /** 見過閒置帷幕全遮的「空曠~」 */
  afk: 'uep:afk',
  /** 見過有人的茶會（授予端在 `components/teatime/TeatimePage`） */
  teatime: 'uep:teatime',
  /** 已持有 intro 的讀者再從主站經 portal 進來 */
  fromFar: 'uep:from-far',
} as const;

/**
 * 「走遍五區」要數的區域。
 *
 * 與 `ISLAND_IDS` 目前是同一組字串，但**不共用常數**：那邊數的是浮島，
 * 這邊數的是內容區域，日後任何一邊增減都不該連動另一邊。
 * portal 不在內——它是通道不是區域。
 */
export const UEP_ZONE_IDS = [
  'history',
  'echoes',
  'visuals',
  'concepts',
  'storage',
] as const;

/** 造訪足跡旗標前綴 */
const ZONE_VISITED_PREFIX = 'zone:visited:';

/**
 * 某個區域的造訪足跡旗標。
 *
 * ⚠️ 這支旗標在 2026-07-26 被移除過，2026-08-10 為了 `uep:all-zone`
 * 引回。移除的原因不是旗標本身有問題，而是它當時的用途（浮島解鎖儀式的
 * 前置條件）恆真卻會故障：`ReaderShell` 的 mount effect 授旗，若遠端
 * hydrate 隨後回來就整包覆蓋掉，而 effect 不會因 hydrate 重跑。
 *
 * 現在引回是安全的——那個競態已由 `progressStore` 的 `mergeHydrated()`
 * 修掉（`flags` 走 `unionAdded`，空窗期內新增的旗標會保留）。而且這次
 * **只餵給 `uep:all-zone`**，不再回去當解鎖儀式的守門：儀式的原則仍是
 * 「看得到就應該能動作」。
 */
export function zoneVisitedFlag(zoneId: string): string {
  return `${ZONE_VISITED_PREFIX}${zoneId}`;
}

/** 記下造訪足跡；順手推導 `uep:all-zone` */
export function markZoneVisited(zoneId: string): void {
  const manager = getProgressManager();
  manager.grantFlags([zoneVisitedFlag(zoneId)]);
  syncDerivedUepFlags();
}

/**
 * 推導型系統旗標的補授。
 *
 * `uep:all-zone` 與 `uep:all-island` 的條件是「其他狀態湊齊了」而不是
 * 某個當下的動作，所以不能只在事件發生的那一刻檢查——遠端 hydrate 帶回
 * 另一台裝置的進度時同樣可能剛好湊齊。改成每次進度變動都重算一次，
 * `grantFlags` 本身會濾掉已持有的，重複呼叫沒有成本。
 */
export function syncDerivedUepFlags(): void {
  const manager = getProgressManager();
  const state = manager.getState();
  const gained: string[] = [];

  if (
    !state.flags.includes(UEP_FLAGS.allZone) &&
    UEP_ZONE_IDS.every((zone) => state.flags.includes(zoneVisitedFlag(zone)))
  ) {
    gained.push(UEP_FLAGS.allZone);
  }

  if (
    !state.flags.includes(UEP_FLAGS.allIsland) &&
    UEP_ZONE_IDS.every((island) => state.islandsUnlocked.includes(island))
  ) {
    gained.push(UEP_FLAGS.allIsland);
  }

  if (gained.length > 0) manager.grantFlags(gained);
}

/**
 * 進站即授予 `uep:intro`。
 *
 * ⚠️ 授予時機刻意**不**等 hydrate：`mergeHydrated` 的 `unionAdded` 會保住
 * 空窗期內新增的旗標，所以早給不會被覆蓋掉；反過來等 hydrate 才給的話，
 * 從未登入過的讀者（沒有遠端快照可等）就永遠拿不到。
 */
export function markUepIntro(): void {
  getProgressManager().grantFlags([UEP_FLAGS.intro]);
}

/**
 * 從主站經 portal 進來時授予 `uep:from-far`。
 *
 * **要求先持有 `uep:intro`**（艾斯維爾定義）：這支旗標的語意是「老朋友
 * 又從遠方過來了」，第一次就穿 portal 進來的人不算。由於 intro 在同一次
 * 進站就會授予，判定必須看**這一次進站之前**是否已持有——呼叫端要在
 * `markUepIntro()` 之前先把結果讀出來。
 */
export function markUepFromFar(): void {
  getProgressManager().grantFlags([UEP_FLAGS.fromFar]);
}

/** 見過閒置帷幕全遮 */
export function markUepAfk(): void {
  getProgressManager().grantFlags([UEP_FLAGS.afk]);
}
