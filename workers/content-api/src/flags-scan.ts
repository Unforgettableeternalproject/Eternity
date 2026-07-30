/**
 * flags-scan.ts — 旗標的內容掃描與分類
 *
 * 旗標分兩類，來源與可控性完全不同：
 *
 * **規則生成（derived）**：名稱是 key 或 pageId 的函數，由程式推導，
 * 編輯器不手填——`completed:{pageId}`、`met:{ref}`、`zone:visited:{zone}`、
 * `{storyKey}:song`、`{entityKey}:gallery`、`gallery:{pageId}`、
 * `image:{galleryId}:{imageId}`。改 key 就等於改旗標，不存在「改旗標名」
 * 這種獨立操作，因此**不進註冊表**、不受註冊強制。
 *
 * ⚠️ 這份清單的權威來源是產生端的函式，不是任何設計文件的摘要表：
 * `progress/markers.ts` 的 `completed:`、`embed/marks.ts` 的 `metFlag`、
 * `audio/spoilerResolver.ts` 的 `deriveSongUnlockFlag`、`visuals/threeState.ts`
 * 的 `deriveGalleryUnlockFlag`／`deriveImageUnlockFlag`（皆在 apps/uep，
 * 跨 package 無法 import，只能靠這條註記維持對齊）。新增 derived 形狀時
 * 一律回去讀那些函式的 return，不要照文件抄。
 *
 * **自訂（custom）**：編輯器手填的兩處——FlagMarker 的 `data-grants-flags`
 * 與 gate 的 `requiresFlags`。這些必須先註冊才能使用，否則授予端打錯一個
 * 字，需求端就永遠等不到，而且沒有任何錯誤訊息，只會靜默地永遠鎖著。
 *
 * ⚠️ `classifyFlag` 是**單一事實來源**：巡查儀表板的 derived 標記與存檔時
 * 的註冊豁免必須用同一份判定。兩邊各寫一份的話會漂移成「巡查說這個不用
 * 註冊、存檔卻擋你沒註冊」。
 */

import { collectContentStrings, readAttr } from './content-scan';

/** 旗標來源分類 */
export type FlagKind = 'derived' | 'custom';

/**
 * 規則生成旗標的形狀。
 *
 * 這是**形狀比對**不是查表——derived 旗標的值取決於實際內容（有多少頁面
 * 就有多少 `completed:*`），無法窮舉，只能認前綴／尾碼。
 */
const DERIVED_PREFIXES = [
  'completed:',
  // met:* 與 zone:visited:* 都已退役（前者 S7-C 起僅舊格式 fallback 消費、
  // 後者 2026-07-26 移除授旗），但既有讀者進度裡仍留著這些旗標，刻意不清理。
  // 分類器必須繼續認得它們，否則舊資料一進巡查清單就變成「未註冊」假警報。
  'met:',
  'zone:visited:',
  // deriveGalleryUnlockFlag 對沒有 entityKey 的 gallery 產生 `gallery:{pageId}`
  'gallery:',
  // deriveImageUnlockFlag 產生 `image:{galleryId}:{imageId}`——是前綴而非中綴
  'image:',
];
const DERIVED_SUFFIXES = [':song', ':gallery'];

/**
 * 判斷旗標是規則生成還是自訂。
 *
 * ⚠️ 已知限制：判定看的是**形狀**，所以一個剛好以 `:song` 結尾或以 `image:`
 * 開頭的自訂旗標會被誤判為 derived（因而豁免註冊強制）。這不是可以靠更聰明
 * 的正規式解決的問題——`{storyKey}:song` 的 storyKey 本身就是任意 key 字串，
 * 與自訂旗標的字元集完全重疊。實務上的緩解是命名慣例：自訂旗標不要用這些
 * 前綴與尾碼。
 */
export function classifyFlag(name: string): FlagKind {
  const flag = name.trim();
  if (!flag) return 'custom';
  if (DERIVED_PREFIXES.some((prefix) => flag.startsWith(prefix))) {
    return 'derived';
  }
  if (DERIVED_SUFFIXES.some((suffix) => flag.endsWith(suffix))) {
    return 'derived';
  }
  return 'custom';
}

/** `data-grants-flags` 的序列化格式：逗號分隔、去空白、去重（與編輯器對齊） */
function parseFlagsAttr(value: string): string[] {
  return [
    ...new Set(
      value
        .split(',')
        .map((flag) => flag.trim())
        .filter((flag) => flag.length > 0)
    ),
  ];
}

// data-role 的位置不固定：mergeAttributes 會把節點自己的屬性排在
// data-role 之前，所以前後都要允許任意屬性
const PROGRESS_MARKER_DIV_REGEX =
  /<div\s([^>]*data-role="progress-marker"[^>]*)>/g;

/**
 * 掃出內容裡所有 FlagMarker 授予的旗標（去重）。
 *
 * ⚠️ 掃描範圍是**全站**不是 History：`ProgressMarkerNode` 掛在共用的
 * `RichEditor`，任何 zone 的 rich_text 區塊都可能有 FlagMarker——這與只在
 * History 頁使用的 echo spot／visual clue 不同，不可沿用 History-only 的
 * 範圍假設。
 */
export function scanGrantedFlags(content: unknown): string[] {
  const flags = new Set<string>();
  for (const html of collectContentStrings(content)) {
    PROGRESS_MARKER_DIV_REGEX.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PROGRESS_MARKER_DIV_REGEX.exec(html)) !== null) {
      const raw = readAttr(match[1], 'data-grants-flags');
      if (!raw) continue;
      for (const flag of parseFlagsAttr(raw)) flags.add(flag);
    }
  }
  return [...flags];
}

/**
 * 從存檔請求抽出這次涉及的全部旗標（授予端 ∪ 需求端）。
 *
 * 只掃請求真的帶了的欄位——PUT 支援部分更新，沒帶 `content` 就代表內容
 * 沒動，拿舊值重新檢查會讓「只改標題」這種操作被上一次就存在的旗標擋住。
 * 這與既有 key 唯一性檢查的「只在請求帶了才查」是同一條慣例。
 */
export function collectFlagsFromBody(body: {
  content?: unknown;
  metadata?: unknown;
}): string[] {
  const flags = new Set<string>();
  if (body.content !== undefined) {
    for (const flag of scanGrantedFlags(body.content)) flags.add(flag);
  }
  if (body.metadata !== undefined) {
    for (const flag of scanRequiredFlags(body.metadata)) flags.add(flag);
  }
  return [...flags];
}

/**
 * 讀出 metadata 的 gate 要求的旗標。
 *
 * 兩種存放形狀都要吃——平鋪（`{ requiresFlags }`）與巢狀（`{ gate: {...} }`），
 * 這是前端 `parseGateCondition` 既有的相容行為，掃描器漏掉任一種就會把
 * 真正有在用的旗標誤報成「沒人需要」。
 */
export function scanRequiredFlags(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== 'object') return [];
  const meta = metadata as Record<string, unknown>;
  const source =
    typeof meta.gate === 'object' && meta.gate !== null
      ? (meta.gate as Record<string, unknown>)
      : meta;

  if (!Array.isArray(source.requiresFlags)) return [];
  return [
    ...new Set(
      source.requiresFlags
        .filter((flag): flag is string => typeof flag === 'string')
        .map((flag) => flag.trim())
        .filter((flag) => flag.length > 0)
    ),
  ];
}
