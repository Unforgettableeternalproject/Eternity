import { Node, mergeAttributes } from '@tiptap/core';
import {
  PROGRESS_MARKER_ROLE,
  parseFlagsAttr,
  serializeFlagsAttr,
} from '../../progress/markers';

/**
 * ProgressMarkerNode — 掃描線進度標記（Epic 2）
 *
 * 編輯器可見（CSS 樣式化的虛線列）、前台隱形（零高度 div，
 * 保留 layout box 讓 IntersectionObserver 可觀察）。
 *
 * 帶 grantsFlags 的變體即 FlagMarker：掃描線通過該位置時
 * 授予對應旗標——「出現名字 ≠ 認識人物」的位置粒度授予機制。
 */

export interface ProgressMarkerOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    progressMarker: {
      /** 在游標處插入進度標記 */
      setProgressMarker: (attrs?: {
        grantsFlags?: string[];
        label?: string;
      }) => ReturnType;
    };
  }
}

const ProgressMarkerNode = Node.create<ProgressMarkerOptions>({
  name: 'progressMarker',
  group: 'block',
  atom: true,

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      grantsFlags: {
        default: [] as string[],
        parseHTML: (el) => parseFlagsAttr(el.getAttribute('data-grants-flags')),
        renderHTML: (attrs) => {
          const flags = Array.isArray(attrs.grantsFlags)
            ? (attrs.grantsFlags as string[])
            : [];
          return flags.length > 0
            ? { 'data-grants-flags': serializeFlagsAttr(flags) }
            : {};
        },
      },
      label: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-label') || '',
        renderHTML: (attrs) =>
          attrs.label ? { 'data-label': attrs.label } : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: `div[data-role="${PROGRESS_MARKER_ROLE}"]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-role': PROGRESS_MARKER_ROLE,
        class: 'tiptap-progress-marker',
        'aria-hidden': 'true',
      }),
    ];
  },

  addCommands() {
    return {
      setProgressMarker:
        (attrs = {}) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: {
              grantsFlags: attrs.grantsFlags ?? [],
              label: attrs.label ?? '',
            },
          }),
    };
  },
});

export default ProgressMarkerNode;
