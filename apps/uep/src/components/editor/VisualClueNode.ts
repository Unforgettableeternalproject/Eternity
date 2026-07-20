import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import {
  VISUAL_CLUE_END_ROLE,
  VISUAL_CLUE_START_ROLE,
} from '../../progress/markers';

/** Visual Clue 錨點在持久化 HTML 中的 data-role（起訖各一）。 */
export const VISUAL_CLUE_SELECTOR = `[data-role="${VISUAL_CLUE_START_ROLE}"], [data-role="${VISUAL_CLUE_END_ROLE}"]`;

/** 引用目標種類：陳列走廊走 entityKey、鑲框室走插圖 ID。 */
export type VisualClueTargetType = 'entity' | 'illustration';

export interface VisualClueAttributes {
  /** 同一 clue 的起訖錨點共用 id；穩定值，session dedupe 依賴它。 */
  clueId: string;
  /** start = 書籤浮現點、end = 離場點。 */
  edge: 'start' | 'end';
  targetType: VisualClueTargetType;
  /** entityKey 或插圖 ID（依 targetType）。 */
  targetKey: string;
  /** 目標 gallery 頁 id 快照（前台觸發時以 targetKey 反查現行資料）。 */
  galleryId?: string;
  /** 目標 gallery 標題快照（編輯器顯示用）。 */
  title?: string;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    visualClue: {
      /** 在游標處插入成對起訖錨點（start 在前、end 緊隨其後）。 */
      insertVisualCluePair: (
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
    ends: { pos: number; attrs: VisualClueAttributes }[];
  }
  const clues = new Map<string, ClueRecord>();
  doc.descendants((node, pos) => {
    if (node.type.name !== 'visualClue') return true;
    const attrs = node.attrs as VisualClueAttributes;
    const clueId = attrs.clueId || '';
    const record = clues.get(clueId) ?? { starts: [], ends: [] };
    (attrs.edge === 'end' ? record.ends : record.starts).push({ pos, attrs });
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
        message: `${label}缺少目標（entityKey／插圖 ID），請重新指定`,
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
            : 'start',
        // data-role 由 renderHTML 統一輸出（依 edge），此處不重複
        renderHTML: () => ({}),
      },
      targetType: {
        default: 'entity',
        parseHTML: (el) =>
          el.getAttribute('data-target-type') === 'illustration'
            ? 'illustration'
            : 'entity',
        renderHTML: (attrs) => ({
          'data-target-type':
            attrs.targetType === 'illustration' ? 'illustration' : 'entity',
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
    };
  },

  parseHTML() {
    return [
      { tag: `div[data-role="${VISUAL_CLUE_START_ROLE}"]` },
      { tag: `div[data-role="${VISUAL_CLUE_END_ROLE}"]` },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    const isEnd = node.attrs.edge === 'end';
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-role': isEnd ? VISUAL_CLUE_END_ROLE : VISUAL_CLUE_START_ROLE,
        class: `tiptap-visual-clue is-${isEnd ? 'end' : 'start'}`,
        'aria-label':
          `視覺線索${isEnd ? '訖點' : '起點'}：` +
          `${node.attrs.title || node.attrs.targetKey || '未綁定'}`,
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
    };
  },
});

export default VisualClueNode;
