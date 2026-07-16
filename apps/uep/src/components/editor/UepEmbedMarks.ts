import { Mark, mergeAttributes } from '@tiptap/core';

import { UEP_ENTITY_ATTR, UEP_CUE_ATTR, UEP_REF_ATTR } from '../../embed/marks';

/**
 * UepEntityMark / UepCueMark — 互動式嵌入標記（Epic 2）
 *
 * inline mark（工具列 🔗 嵌入工具組），與 ⚑ 旗標工具（block node）
 * 是兩套獨立工具：旗標標註進度授予點，嵌入標註可互動的引用。
 *
 * - entity：角色/地點/術語 → 點擊開 Concepts mini view（S4 接線）
 * - cue：歌曲/圖片 → 點擊觸發媒體事件（S4 接線）
 *
 * 序列化格式定義在 embed/marks.ts（唯一事實來源）。
 * 前台在 dispatcher 接線前不附加任何樣式——就是普通文字。
 */

export interface UepEmbedMarkOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    uepEntity: {
      /** 將選取文字標記為 entity 引用（自動延伸至整個既有標記範圍） */
      setUepEntity: (attrs: { kind: string; ref: string }) => ReturnType;
      /** 移除 entity 標記 */
      unsetUepEntity: () => ReturnType;
    };
    uepCue: {
      /** 將選取文字標記為 cue 引用（自動延伸至整個既有標記範圍） */
      setUepCue: (attrs: { kind: string; ref: string }) => ReturnType;
      /** 移除 cue 標記 */
      unsetUepCue: () => ReturnType;
    };
  }
}

export const UepEntityMark = Mark.create<UepEmbedMarkOptions>({
  name: 'uepEntity',
  // 同一段文字不應同時是 entity 與 cue
  excludes: 'uepEntity uepCue',

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      kind: {
        default: 'term',
        parseHTML: (el) => el.getAttribute(UEP_ENTITY_ATTR) || 'term',
        renderHTML: (attrs) => ({ [UEP_ENTITY_ATTR]: attrs.kind || 'term' }),
      },
      ref: {
        default: '',
        parseHTML: (el) => el.getAttribute(UEP_REF_ATTR) || '',
        renderHTML: (attrs) => (attrs.ref ? { [UEP_REF_ATTR]: attrs.ref } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[${UEP_ENTITY_ATTR}]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      setUepEntity:
        (attrs) =>
        ({ chain }) =>
          chain().extendMarkRange(this.name).setMark(this.name, attrs).run(),
      unsetUepEntity:
        () =>
        ({ chain }) =>
          chain().extendMarkRange(this.name).unsetMark(this.name).run(),
    };
  },
});

export const UepCueMark = Mark.create<UepEmbedMarkOptions>({
  name: 'uepCue',
  excludes: 'uepCue uepEntity',

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      kind: {
        default: 'song',
        parseHTML: (el) => el.getAttribute(UEP_CUE_ATTR) || 'song',
        renderHTML: (attrs) => ({ [UEP_CUE_ATTR]: attrs.kind || 'song' }),
      },
      ref: {
        default: '',
        parseHTML: (el) => el.getAttribute(UEP_REF_ATTR) || '',
        renderHTML: (attrs) => (attrs.ref ? { [UEP_REF_ATTR]: attrs.ref } : {}),
      },
    };
  },

  parseHTML() {
    return [{ tag: `span[${UEP_CUE_ATTR}]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },

  addCommands() {
    return {
      setUepCue:
        (attrs) =>
        ({ chain }) =>
          chain().extendMarkRange(this.name).setMark(this.name, attrs).run(),
      unsetUepCue:
        () =>
        ({ chain }) =>
          chain().extendMarkRange(this.name).unsetMark(this.name).run(),
    };
  },
});
