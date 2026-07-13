import { Node, mergeAttributes } from '@tiptap/core';
import { ECHO_SPOT_ROLE } from '../../progress/markers';

/** Echo Spot 在持久化 HTML 中的 data-role。 */
export const ECHO_SPOT_SELECTOR = `[data-role="${ECHO_SPOT_ROLE}"]`;

export interface EchoSpotAttributes {
  spotId: string;
  songId: string;
  songUrlKey: string;
  entityKey?: string;
  title?: string;
  clusterId?: string;
  duration?: number;
  spoilerLevel?: number;
  spoilerRevisions?: unknown[];
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    echoSpot: {
      /** 在游標處插入已完整綁定曲目的回聲點。 */
      setEchoSpot: (attrs: EchoSpotAttributes) => ReturnType;
    };
  }
}

/**
 * EchoSpotNode — History 文章內的 block atom。
 *
 * D1 只保存 R2 裸 key；title/cluster/duration 是編輯器預覽快照，前台播放
 * 不依賴它們判定曲目身分。spotId 必須穩定，才能做單次頁面造訪去重。
 */
const EchoSpotNode = Node.create({
  name: 'echoSpot',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      spotId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-spot-id') || '',
        renderHTML: (attrs) =>
          attrs.spotId ? { 'data-spot-id': attrs.spotId } : {},
      },
      songId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-song-id') || '',
        renderHTML: (attrs) =>
          attrs.songId ? { 'data-song-id': attrs.songId } : {},
      },
      songUrlKey: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-song-url-key') || '',
        renderHTML: (attrs) =>
          attrs.songUrlKey ? { 'data-song-url-key': attrs.songUrlKey } : {},
      },
      entityKey: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-entity-key') || '',
        renderHTML: (attrs) =>
          attrs.entityKey ? { 'data-entity-key': attrs.entityKey } : {},
      },
      title: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-song-title') || '',
        renderHTML: (attrs) =>
          attrs.title ? { 'data-song-title': attrs.title } : {},
      },
      clusterId: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-cluster-id') || '',
        renderHTML: (attrs) =>
          attrs.clusterId ? { 'data-cluster-id': attrs.clusterId } : {},
      },
      duration: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-duration')) || 0,
        renderHTML: (attrs) =>
          Number(attrs.duration) > 0
            ? { 'data-duration': String(attrs.duration) }
            : {},
      },
      spoilerLevel: {
        default: 0,
        parseHTML: (el) => Number(el.getAttribute('data-spoiler-level')) || 0,
        renderHTML: (attrs) => ({
          'data-spoiler-level': String(Number(attrs.spoilerLevel) || 0),
        }),
      },
      spoilerRevisions: {
        default: [] as unknown[],
        parseHTML: (el) => {
          try {
            const parsed = JSON.parse(
              el.getAttribute('data-spoiler-revisions') || '[]'
            );
            return Array.isArray(parsed) ? parsed : [];
          } catch {
            return [];
          }
        },
        renderHTML: (attrs) =>
          Array.isArray(attrs.spoilerRevisions) &&
          attrs.spoilerRevisions.length > 0
            ? {
                'data-spoiler-revisions': JSON.stringify(
                  attrs.spoilerRevisions
                ),
              }
            : {},
      },
    };
  },

  parseHTML() {
    return [{ tag: `div[data-role="${ECHO_SPOT_ROLE}"]` }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-role': ECHO_SPOT_ROLE,
        class: 'tiptap-echo-spot',
        'aria-label': `回聲點：${HTMLAttributes['data-song-title'] || HTMLAttributes['data-song-id'] || '未綁定'}`,
      }),
    ];
  },

  addCommands() {
    return {
      setEchoSpot:
        (attrs: EchoSpotAttributes) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

export default EchoSpotNode;
