import { Node, mergeAttributes } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { ECHO_SPOT_ROLE } from '../../progress/markers';
import type { EchoSongChoice } from './EchoSongPicker';

/** Echo Spot 在持久化 HTML 中的 data-role。 */
export const ECHO_SPOT_SELECTOR = `[data-role="${ECHO_SPOT_ROLE}"]`;

export interface EchoSpotAttributes {
  spotId: string;
  songId: string;
  songUrlKey: string;
  /** 角色歌／區域歌的實體身分（`songType` 非 story 時使用） */
  entityKey?: string;
  /** 劇情歌的劇情點身分（`songType === 'story'` 時使用，與 entityKey 互斥） */
  storyKey?: string;
  title?: string;
  clusterId?: string;
  songType?: string;
  duration?: number;
  spoilerLevel?: number;
  spoilerRevisions?: unknown[];
}

/**
 * picker 選中的曲目 → 節點屬性快照。
 *
 * storyKey／entityKey 依曲目本身帶的欄位二擇一寫入：劇情歌少了 storyKey
 * 就不會進 `history_interlink_index`（worker 端看 `data-story-key`），
 * Echoes 進頁時 History 島永遠浮不出對應段落，且沒有任何錯誤訊息。
 */
export function buildEchoSpotAttributes(
  song: EchoSongChoice,
  spotId: string
): EchoSpotAttributes {
  return {
    spotId,
    songId: song.id,
    songUrlKey: song.audioFile,
    ...(song.storyKey ? { storyKey: song.storyKey } : {}),
    ...(song.entityKey ? { entityKey: song.entityKey } : {}),
    title: song.title,
    clusterId: song.clusterId,
    songType: song.songType,
    ...(song.duration ? { duration: song.duration } : {}),
    spoilerLevel: song.spoilerLevel,
    ...(song.spoilerRevisions
      ? { spoilerRevisions: song.spoilerRevisions }
      : {}),
  };
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
 * 掃描文件收集 Echo Spot 問題（存檔前呼叫，阻擋壞資料進 D1）：
 * spotId 必須非空且全文唯一——複製貼上會複製 spotId，重複時前台
 * useEchoSpots 的單次造訪去重會把兩個 spot 當同一個，第二個永遠
 * 不觸發。沿 collectVisualClueIssues 的存檔閘模式。
 */
export function collectEchoSpotIssues(doc: PMNode): string[] {
  const issues: string[] = [];
  const seen = new Map<string, number>();
  doc.descendants((node) => {
    if (node.type.name !== 'echoSpot') return true;
    const spotId =
      typeof node.attrs.spotId === 'string' ? node.attrs.spotId.trim() : '';
    if (!spotId) {
      issues.push('有回聲點缺少 spotId，請刪除後重新插入');
      return true;
    }
    seen.set(spotId, (seen.get(spotId) ?? 0) + 1);
    return true;
  });
  for (const [spotId, count] of seen) {
    if (count > 1) {
      issues.push(
        `回聲點 spotId「${spotId.slice(0, 12)}」重複（${count} 個）——` +
          '複製貼上會沿用同一 id，請刪除重複的回聲點後重新插入'
      );
    }
  }
  return issues;
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
      storyKey: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-story-key') || '',
        renderHTML: (attrs) =>
          attrs.storyKey ? { 'data-story-key': attrs.storyKey } : {},
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
      songType: {
        default: '',
        parseHTML: (el) => el.getAttribute('data-song-type') || '',
        renderHTML: (attrs) =>
          attrs.songType ? { 'data-song-type': attrs.songType } : {},
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
