import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import {
  VISUAL_CLUE_END_ROLE,
  VISUAL_CLUE_GATE_ROLE,
  VISUAL_CLUE_START_ROLE,
} from '../../progress/markers';

/** Visual Clue 錨點在持久化 HTML 中的 data-role（起訖各一）。 */
export const VISUAL_CLUE_SELECTOR = `[data-role="${VISUAL_CLUE_START_ROLE}"], [data-role="${VISUAL_CLUE_GATE_ROLE}"], [data-role="${VISUAL_CLUE_END_ROLE}"]`;

/**
 * 引用目標種類：陳列走廊走 entityKey、鑲框室走 storyKey。
 *
 * S10-1 起第二個值由 `'illustration'` 改名 `'story'`——職責（「這個 clue
 * 要去哪個命名空間找 targetKey」）完全沒變，只是「插圖」這個命名空間
 * 本身被劇情點取代。不保留舊值做三態相容：全站僅一筆測試資料受影響，
 * 為它付出的是永久的判斷分支負擔。
 */
export type VisualClueTargetType = 'entity' | 'story';

export interface VisualClueAttributes {
  /** 同一 clue 的起訖錨點共用 id；穩定值，session dedupe 依賴它。 */
  clueId: string;
  /** start = 書籤浮現點、gate = 區間切圖點、end = 離場點。 */
  edge: 'start' | 'gate' | 'end';
  targetType: VisualClueTargetType;
  /** entityKey 或 storyKey（依 targetType）。 */
  targetKey: string;
  /** 目標 gallery 頁 id 快照（前台觸發時以 targetKey 反查現行資料）。 */
  galleryId?: string;
  /** 目標 gallery 標題快照（編輯器顯示用）。 */
  title?: string;
  /** 預設展示圖（start）或切換目標（gate）的 gallery 內 image id。 */
  imageId?: string;
  /** 圖片 caption 快照（編輯器顯示用，不作身分判定）。 */
  imageTitle?: string;
  /** 圖片 R2 key 快照（前台書籤縮圖用，不作身分判定）。 */
  imageFile?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    visualClue: {
      /** 在游標處插入成對起訖錨點（start 在前、end 緊隨其後）。 */
      insertVisualCluePair: (
        attrs: Omit<VisualClueAttributes, 'edge'>
      ) => ReturnType;
      /** 在 gallery clue 區間內插入指定圖片切換點。 */
      insertVisualClueGate: (
        attrs: Omit<VisualClueAttributes, 'edge'>
      ) => ReturnType;
    };
  }
}

/** 配對驗證問題（存檔閘與前台容錯共用語意：孤兒錨點 = 無效 clue） */
export interface VisualCluePairIssue {
  clueId: string;
  message: string;
}

/**
 * 掃描文件收集 Visual Clue 配對問題（存檔前呼叫，阻擋壞資料進 D1）：
 * - 同 clueId 必須恰好一個 start + 一個 end
 * - start 必須在 end 之前（文件順序）
 * - 目標（targetType/targetKey）必須存在且起訖一致
 *
 * 前台另有孤兒容錯（無效 clue 直接不渲染書籤），此處是第一層防禦。
 */
export function collectVisualClueIssues(doc: PMNode): VisualCluePairIssue[] {
  interface ClueRecord {
    starts: { pos: number; attrs: VisualClueAttributes }[];
    gates: { pos: number; attrs: VisualClueAttributes }[];
    ends: { pos: number; attrs: VisualClueAttributes }[];
  }
  const clues = new Map<string, ClueRecord>();
  doc.descendants((node, pos) => {
    if (node.type.name !== 'visualClue') return true;
    const attrs = node.attrs as VisualClueAttributes;
    const clueId = attrs.clueId || '';
    const record = clues.get(clueId) ?? { starts: [], gates: [], ends: [] };
    const bucket =
      attrs.edge === 'end'
        ? record.ends
        : attrs.edge === 'gate'
          ? record.gates
          : record.starts;
    bucket.push({ pos, attrs });
    clues.set(clueId, record);
    return true;
  });

  const issues: VisualCluePairIssue[] = [];
  for (const [clueId, record] of clues) {
    const label = clueId ? `Clue「${clueId.slice(0, 8)}」` : '未命名 Clue';
    if (!clueId) {
      issues.push({ clueId, message: `${label}缺少 clueId，請刪除後重新插入` });
      continue;
    }
    if (record.starts.length !== 1 || record.ends.length !== 1) {
      issues.push({
        clueId,
        message:
          `${label}錨點不成對（起點 ${record.starts.length}、` +
          `訖點 ${record.ends.length}），請補齊或刪除孤兒錨點`,
      });
      continue;
    }
    const [start] = record.starts;
    const [end] = record.ends;
    if (start.pos > end.pos) {
      issues.push({
        clueId,
        message: `${label}的起點在訖點之後，請調整順序`,
      });
    }
    if (!start.attrs.targetKey?.trim() || !end.attrs.targetKey?.trim()) {
      issues.push({
        clueId,
        message: `${label}缺少目標（entityKey／storyKey），請重新指定`,
      });
    } else if (
      start.attrs.targetKey !== end.attrs.targetKey ||
      start.attrs.targetType !== end.attrs.targetType
    ) {
      issues.push({
        clueId,
        message: `${label}起訖錨點的目標不一致，請重新指定目標`,
      });
    }
    for (const gate of record.gates) {
      if (
        gate.pos <= start.pos ||
        gate.pos >= end.pos ||
        gate.attrs.targetKey !== start.attrs.targetKey ||
        gate.attrs.targetType !== start.attrs.targetType ||
        gate.attrs.galleryId !== start.attrs.galleryId ||
        !gate.attrs.imageId?.trim()
      ) {
        issues.push({
          clueId,
          message: `${label}含有無效的切圖 Gate（必須位於同一 gallery 區間內並指定圖片）`,
        });
      }
    }
  }
  return issues;
}

/**
 * VisualClueNode — History 文章內的成對隱形 block atom（S8 下半場 V-D）。
 *
 * 同 clueId 的 start/end 兩個錨點界定書籤浮現區間；沿 ProgressMarker /
 * EchoSpot 的 data-role 體系（掃描線觀察、前台隱形、可拖曳定位）。
 * 目標引用（targetType/targetKey）是身分；galleryId/title 是插入當下的
 * 快照，前台觸發時以引用反查現行資料（/api/visuals/gallery）。
 */
const VisualClueNode = Node.create({
  name: 'visualClue',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      clueId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-clue-id') || '',
        renderHTML: (attrs) =>
          attrs.clueId ? { 'data-clue-id': attrs.clueId } : {},
      },
      edge: {
        default: 'start',
        parseHTML: (el) =>
          el.getAttribute('data-role') === VISUAL_CLUE_END_ROLE
            ? 'end'
            : el.getAttribute('data-role') === VISUAL_CLUE_GATE_ROLE
              ? 'gate'
              : 'start',
        // data-role 由 renderHTML 統一輸出（依 edge），此處不重複
        renderHTML: () => ({}),
      },
      targetType: {
        default: 'entity',
        parseHTML: (el) =>
          el.getAttribute('data-target-type') === 'story' ? 'story' : 'entity',
        renderHTML: (attrs) => ({
          'data-target-type': attrs.targetType === 'story' ? 'story' : 'entity',
        }),
      },
      targetKey: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-target-key') || '',
        renderHTML: (attrs) =>
          attrs.targetKey ? { 'data-target-key': attrs.targetKey } : {},
      },
      galleryId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-gallery-id') || '',
        renderHTML: (attrs) =>
          attrs.galleryId ? { 'data-gallery-id': attrs.galleryId } : {},
      },
      title: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-gallery-title') || '',
        renderHTML: (attrs) =>
          attrs.title ? { 'data-gallery-title': attrs.title } : {},
      },
      imageId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-image-id') || '',
        renderHTML: (attrs) =>
          attrs.imageId ? { 'data-image-id': attrs.imageId } : {},
      },
      imageTitle: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-image-title') || '',
        renderHTML: (attrs) =>
          attrs.imageTitle ? { 'data-image-title': attrs.imageTitle } : {},
      },
      imageFile: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-image-file') || '',
        renderHTML: (attrs) =>
          attrs.imageFile ? { 'data-image-file': attrs.imageFile } : {},
      },
    };
  },

  parseHTML() {
    return [
      { tag: `div[data-role="${VISUAL_CLUE_START_ROLE}"]` },
      { tag: `div[data-role="${VISUAL_CLUE_GATE_ROLE}"]` },
      { tag: `div[data-role="${VISUAL_CLUE_END_ROLE}"]` },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const isEnd = node.attrs.edge === 'end';
    const isGate = node.attrs.edge === 'gate';
    const edgeLabel = isEnd ? 'clear' : isGate ? 'gate' : 'start';
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-role': isEnd
          ? VISUAL_CLUE_END_ROLE
          : isGate
            ? VISUAL_CLUE_GATE_ROLE
            : VISUAL_CLUE_START_ROLE,
        class: `tiptap-visual-clue is-${edgeLabel}`,
        'aria-label':
          `視覺線索${isEnd ? '訖點' : isGate ? '切圖 Gate' : '起點'}：` +
          `${node.attrs.imageTitle || node.attrs.title || node.attrs.targetKey || '未綁定'}`,
      }),
    ];
  },

  addCommands() {
    return {
      insertVisualCluePair:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent([
            { type: this.name, attrs: { ...attrs, edge: 'start' } },
            { type: this.name, attrs: { ...attrs, edge: 'end' } },
          ]),
      insertVisualClueGate:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { ...attrs, edge: 'gate' },
          }),
    };
  },
});

export default VisualClueNode;
