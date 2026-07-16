/**
 * EntitySuggestExtension — entity 自動偵測 suggestion（Epic 2 S7-D-3）
 *
 * 打字即時標記 + Tab 確認（定案 2）：
 * - 游標前文字後綴命中匹配詞 → 提示 decoration（虛線底）+ 行內 chip
 * - Tab：套 uepEntity mark（ref = entity:{key}、kind 自動推斷）
 * - Esc：跳過本次（同位置同詞不再提示，繼續打字即恢復偵測）
 * - ↑↓：多候選時切換要嵌入的條目（單候選不攔截方向鍵）
 *
 * 不偵測的情形：
 * - 已標記文字（uepEntity / uepCue 範圍內或重疊）
 * - code block（parent.type.spec.code）
 * - 非空選取（只在游標態偵測）
 *
 * 匹配核心（拆名/索引/後綴比對）在 entitySuggest.ts（純函式）；
 * 這裡只做 ProseMirror 接線。後綴比對天然只掃游標段落，
 * 每鍵成本 O(最長詞長)——不需 debounce（設計文件 D-3 的 debounce
 * 顧慮由演算法本身消解）。
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

import type { EntityPickerEntry } from './EntityIndexPicker';
import { inferEntityKind } from './EntityIndexPicker';
import { buildSuggestIndex, matchSuffix } from './entitySuggest';
import type { SuggestIndex } from './entitySuggest';

export const entitySuggestKey = new PluginKey<EntitySuggestState>(
  'entitySuggest'
);

/** 進行中的 suggestion（doc 位置 + 候選） */
export interface ActiveSuggestion {
  from: number;
  to: number;
  term: string;
  candidates: EntityPickerEntry[];
  selected: number;
}

export interface EntitySuggestState {
  index: SuggestIndex | null;
  active: ActiveSuggestion | null;
  /** Esc 跳過的位置（to 隨 mapping 平移；同詞同位置不再提示） */
  dismissed: { term: string; to: number } | null;
}

interface EntitySuggestOptions {
  /** 可嵌入條目載入（EntityIndexPicker.loadEmbeddableEntries 包 apiBase） */
  fetchEntries: (() => Promise<EntityPickerEntry[]>) | null;
}

type SuggestMeta =
  | { type: 'set-index'; index: SuggestIndex }
  | { type: 'select'; delta: number }
  | { type: 'dismiss' }
  | { type: 'clear' };

/** 依 doc + 游標重算 suggestion（apply 內呼叫；純計算不碰 view） */
function computeActive(
  tr: Transaction,
  index: SuggestIndex | null,
  dismissed: EntitySuggestState['dismissed'],
  prev: ActiveSuggestion | null
): ActiveSuggestion | null {
  if (!index) return null;
  const { selection } = tr;
  if (!selection.empty) return null;
  const $from = selection.$from;
  const parent = $from.parent;
  if (!parent.isTextblock || parent.type.spec.code) return null;

  // 游標前文字（leaf node 以 ￼ 佔位，阻斷跨物件的假後綴）
  const textBefore = parent.textBetween(0, $from.parentOffset, undefined, '￼');
  const match = matchSuffix(textBefore, index);
  if (!match) return null;

  const to = $from.pos;
  const from = to - match.length;
  if (dismissed && dismissed.term === match.term && dismissed.to === to) {
    return null;
  }
  // 已標記文字不偵測（uepEntity / uepCue 重疊即跳過）
  const schema = tr.doc.type.schema;
  const entityMark = schema.marks.uepEntity;
  const cueMark = schema.marks.uepCue;
  if (
    (entityMark && tr.doc.rangeHasMark(from, to, entityMark)) ||
    (cueMark && tr.doc.rangeHasMark(from, to, cueMark))
  ) {
    return null;
  }
  // 同詞同位置保留候選游標（↑↓ 切換不被打字重置以外的重算洗掉）
  const selected =
    prev && prev.term === match.term && prev.from === from
      ? Math.min(prev.selected, match.candidates.length - 1)
      : 0;
  return { from, to, term: match.term, candidates: match.candidates, selected };
}

/** 提示 chip 的 DOM（widget decoration；純 DOM，不進 React 樹） */
function buildHintChip(active: ActiveSuggestion): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'ned-entity-suggest-chip';
  chip.contentEditable = 'false';
  const entry = active.candidates[active.selected];
  const counter =
    active.candidates.length > 1
      ? ` ${active.selected + 1}/${active.candidates.length} ↑↓`
      : '';
  chip.textContent = `◈ ${entry.name} · Tab 嵌入${counter} · Esc 略過`;
  return chip;
}

export const EntitySuggest = Extension.create<EntitySuggestOptions>({
  name: 'entitySuggest',

  addOptions() {
    return { fetchEntries: null };
  },

  addProseMirrorPlugins() {
    const { fetchEntries } = this.options;

    return [
      new Plugin<EntitySuggestState>({
        key: entitySuggestKey,

        state: {
          init: (): EntitySuggestState => ({
            index: null,
            active: null,
            dismissed: null,
          }),
          apply(tr, prev): EntitySuggestState {
            let { index, dismissed } = prev;
            const meta = tr.getMeta(entitySuggestKey) as
              | SuggestMeta
              | undefined;

            if (meta?.type === 'set-index') index = meta.index;

            // dismissed 位置隨文件變動平移；被刪除位置直接失效。
            // assoc=-1：在該位置繼續打字時錨點不隨插入前推——
            // 否則「Esc 後繼續打同名」會被舊 dismissal 蓋住
            if (dismissed && tr.docChanged) {
              const mapped = tr.mapping.mapResult(dismissed.to, -1);
              dismissed = mapped.deleted
                ? null
                : { term: dismissed.term, to: mapped.pos };
            }

            if (meta?.type === 'dismiss' && prev.active) {
              return {
                index,
                active: null,
                dismissed: { term: prev.active.term, to: prev.active.to },
              };
            }
            if (meta?.type === 'clear') {
              return { index, active: null, dismissed };
            }
            if (meta?.type === 'select' && prev.active) {
              const len = prev.active.candidates.length;
              const selected = (prev.active.selected + meta.delta + len) % len;
              return {
                index,
                active: { ...prev.active, selected },
                dismissed,
              };
            }

            // 文件/游標沒動且無 meta → 原狀態
            if (!tr.docChanged && !tr.selectionSet && !meta) return prev;

            return {
              index,
              active: computeActive(tr, index, dismissed, prev.active),
              dismissed,
            };
          },
        },

        props: {
          decorations(state) {
            const plugin = entitySuggestKey.getState(state);
            const active = plugin?.active;
            if (!active) return null;
            return DecorationSet.create(state.doc, [
              Decoration.inline(active.from, active.to, {
                class: 'ned-entity-suggest',
              }),
              Decoration.widget(active.to, () => buildHintChip(active), {
                side: 1,
              }),
            ]);
          },

          handleKeyDown(view, event) {
            const plugin = entitySuggestKey.getState(view.state);
            const active = plugin?.active;
            if (!active) return false;

            if (event.key === 'Tab') {
              const entry = active.candidates[active.selected];
              const markType = view.state.schema.marks.uepEntity;
              if (!markType || !entry.entityKey) return false;
              const tr = view.state.tr
                .addMark(
                  active.from,
                  active.to,
                  markType.create({
                    kind: inferEntityKind(entry),
                    ref: `entity:${entry.entityKey}`,
                  })
                )
                // 清除 stored marks——繼續打字不得延續 entity 標記
                .setStoredMarks([])
                .setMeta(entitySuggestKey, { type: 'clear' } as SuggestMeta);
              view.dispatch(tr);
              event.preventDefault();
              return true;
            }
            if (event.key === 'Escape') {
              view.dispatch(
                view.state.tr.setMeta(entitySuggestKey, {
                  type: 'dismiss',
                } as SuggestMeta)
              );
              event.preventDefault();
              return true;
            }
            if (
              (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
              active.candidates.length > 1
            ) {
              view.dispatch(
                view.state.tr.setMeta(entitySuggestKey, {
                  type: 'select',
                  delta: event.key === 'ArrowDown' ? 1 : -1,
                } as SuggestMeta)
              );
              event.preventDefault();
              return true;
            }
            return false;
          },
        },

        view(editorView) {
          // 掛載後載入可嵌入條目 → 建索引（失敗靜默：偵測是輔助功能）
          if (fetchEntries) {
            void fetchEntries()
              .then((entries) => {
                if (editorView.isDestroyed) return;
                editorView.dispatch(
                  editorView.state.tr.setMeta(entitySuggestKey, {
                    type: 'set-index',
                    index: buildSuggestIndex(entries),
                  } as SuggestMeta)
                );
              })
              .catch(() => {
                /* 索引載入失敗 → 不偵測，手動嵌入照常可用 */
              });
          }
          return {};
        },
      }),
    ];
  },
});
