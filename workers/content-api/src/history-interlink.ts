/**
 * history-interlink.ts — History 三種互聯標記的內容掃描（Epic 2 S10-1）
 *
 * 設計依據：docs/agent/S10_INTERLINK_DESIGN.md §4
 *
 * ⚠️ 這裡**不是**把編輯器的 `collectEchoSpotIssues` / `collectVisualClueIssues`
 * 搬過來。那兩個函式吃的是 `PMNode`（`@tiptap/pm/model`，瀏覽器端
 * ProseMirror 專用型別），Worker 沒有那個執行環境；而且 D1 的 `content`
 * 欄位存的是**序列化後的 HTML 字串**，不是 PMNode 樹。
 *
 * 改為對 HTML 屬性做 regex 掃描，模式沿 `assets.ts` 的
 * `extractAssetKeysFromContentBlock`——同一個「在 worker 端從 content
 * 字串撈出結構化資訊」的問題，那邊已經驗證過這個做法。
 *
 * 三種標記在持久化 HTML 中的形狀：
 * - entity mark：`<span data-uep-entity="{kind}" data-ref="entity:{key}">文字</span>`
 * - echo spot：`<div data-role="echo-spot" data-spot-id data-entity-key|data-story-key ...>`
 * - visual clue：`<div data-role="visual-clue-{start|gate|end}" data-clue-id
 *   data-target-type="entity|story" data-target-key ...>`
 */

import { collectContentStrings, readAttr, stripTags } from './content-scan';

export type HistoryAnchorKind =
  | 'entity-mark'
  | 'echo-spot'
  | 'visual-clue-start'
  | 'visual-clue-gate'
  | 'visual-clue-end';

/** 掃描出的單一錨點（對應 history_interlink_index 的一列） */
export interface HistoryInterlinkAnchor {
  anchorKind: HistoryAnchorKind;
  /** echoSpot.spotId / visualClue.clueId；entity mark 無穩定 id */
  anchorId: string | null;
  keyType: 'entity' | 'story';
  keyValue: string;
  /** 顯示快照（歌名／圖說／entity 顯示文字），沒有就 null */
  label: string | null;
}

/** entity ref 的新格式前綴（S7-C）；舊的路徑型 ref 不進索引 */
const ENTITY_KEY_REF_PREFIX = 'entity:';

/** 與 embed/marks.ts 的 ENTITY_KEY_PATTERN 同步——非法格式不進索引 */
const KEY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ENTITY_MARK_REGEX =
  /<span\s([^>]*data-uep-entity[^>]*)>([\s\S]*?)<\/span>/g;
const MARKER_DIV_REGEX =
  /<div\s([^>]*data-role="(?:echo-spot|visual-clue-start|visual-clue-gate|visual-clue-end)"[^>]*)>/g;

function scanEntityMarks(html: string, out: HistoryInterlinkAnchor[]): void {
  ENTITY_MARK_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ENTITY_MARK_REGEX.exec(html)) !== null) {
    const ref = readAttr(match[1], 'data-ref');
    // 只收新格式 `entity:{key}`——舊的路徑型 ref（`{area}/{slug}#entry:{id}`）
    // 是 key 制度之前的過渡格式，本來就不是這套系統的一部分
    if (!ref.startsWith(ENTITY_KEY_REF_PREFIX)) continue;
    const keyValue = ref.slice(ENTITY_KEY_REF_PREFIX.length);
    if (!KEY_PATTERN.test(keyValue)) continue;
    const label = stripTags(match[2]);
    out.push({
      anchorKind: 'entity-mark',
      anchorId: null,
      keyType: 'entity',
      keyValue,
      label: label || null,
    });
  }
}

function scanMarkerDivs(html: string, out: HistoryInterlinkAnchor[]): void {
  MARKER_DIV_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MARKER_DIV_REGEX.exec(html)) !== null) {
    const attrs = match[1];
    const role = readAttr(attrs, 'data-role') as HistoryAnchorKind;

    if (role === 'echo-spot') {
      // songType 決定看哪一格；兩者皆空的 spot（例如未設 storyKey 的
      // 劇情歌）不產生索引列——沒有 key 就沒有可反查的身分
      const storyKey = readAttr(attrs, 'data-story-key');
      const entityKey = readAttr(attrs, 'data-entity-key');
      const isStory = readAttr(attrs, 'data-song-type') === 'story';
      const keyValue = isStory ? storyKey : entityKey;
      if (!keyValue || !KEY_PATTERN.test(keyValue)) continue;
      out.push({
        anchorKind: 'echo-spot',
        anchorId: readAttr(attrs, 'data-spot-id') || null,
        keyType: isStory ? 'story' : 'entity',
        keyValue,
        label: readAttr(attrs, 'data-song-title') || null,
      });
      continue;
    }

    const targetKey = readAttr(attrs, 'data-target-key');
    if (!targetKey || !KEY_PATTERN.test(targetKey)) continue;
    out.push({
      anchorKind: role,
      anchorId: readAttr(attrs, 'data-clue-id') || null,
      keyType:
        readAttr(attrs, 'data-target-type') === 'story' ? 'story' : 'entity',
      keyValue: targetKey,
      label: readAttr(attrs, 'data-gallery-title') || null,
    });
  }
}

/**
 * 掃描 History 頁內容，取出所有互聯錨點。
 *
 * entity mark 沒有穩定 id，同一篇文章提到同一個 key 十次不該產生十列——
 * 以 `(keyType, keyValue)` 去重，label 保留第一次出現的文字。echo spot 與
 * visual clue 靠 spotId/clueId 在編輯器存檔閘就保證同文件唯一，天然不需
 * 去重（同一個 clue 的 start/gate/end 是三個不同的錨點，各自成列）。
 */
export function scanHistoryInterlinkAnchors(
  content: unknown
): HistoryInterlinkAnchor[] {
  const anchors: HistoryInterlinkAnchor[] = [];
  for (const html of collectContentStrings(content)) {
    scanEntityMarks(html, anchors);
    scanMarkerDivs(html, anchors);
  }

  const seenEntityMarks = new Set<string>();
  return anchors.filter((anchor) => {
    if (anchor.anchorKind !== 'entity-mark') return true;
    const dedupeKey = `${anchor.keyType}\u0000${anchor.keyValue}`;
    if (seenEntityMarks.has(dedupeKey)) return false;
    seenEntityMarks.add(dedupeKey);
    return true;
  });
}
