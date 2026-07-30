/**
 * flags-scan.ts — 旗標的內容掃描與分類
 *
 * 旗標分兩類，來源與可控性完全不同：
 *
 * **規則生成（derived）**：名稱是 key 或 pageId 的函數，由程式推導，
 * 編輯器不手填——`completed:{pageId}`、`met:{ref}`、`zone:visited:{zone}`、
 * `{storyKey}:song`、`{entityKey}:gallery`、`gallery:{pageId}`、
 * `{galleryId}:image:{imageId}`。改 key 就等於改旗標，不存在「改旗標名」
 * 這種獨立操作，因此**不進註冊表**、不受註冊強制。
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
  'met:',
  'zone:visited:',
  // deriveGalleryUnlockFlag 對沒有 entityKey 的 gallery 產生 `gallery:{pageId}`
  'gallery:',
];
const DERIVED_SUFFIXES = [':song', ':gallery'];
const DERIVED_INFIXES = [':image:'];

/**
 * 判斷旗標是規則生成還是自訂。
 *
 * ⚠️ 已知限制：判定看的是**形狀**，所以一個剛好以 `:song` 結尾的自訂旗標
 * 會被誤判為 derived（因而豁免註冊強制）。這不是可以靠更聰明的正規式解決
 * 的問題——`{storyKey}:song` 的 storyKey 本身就是任意 key 字串，與自訂旗標
 * 的字元集完全重疊。實務上的緩解是命名慣例：自訂旗標不要用這些尾碼。
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
  if (DERIVED_INFIXES.some((infix) => flag.includes(infix))) {
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
