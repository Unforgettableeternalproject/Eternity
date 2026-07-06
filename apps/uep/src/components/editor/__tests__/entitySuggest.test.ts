/**
 * entity 自動偵測 suggestion 測試（Epic 2 S7-D-3）
 *
 * 純函式層（entitySuggest.ts）：
 * - buildMatchTerms：中文全名/首段/英文全名拆解、姓氏不進預設、
 *   aliases 納入、方括號剝殼、單字元派生排除
 * - buildSuggestIndex / matchSuffix：最長後綴、多候選、英文詞邊界
 *
 * Plugin 層（EntitySuggestExtension.ts，真 TipTap Editor）：
 * - 打字位置命中 → active suggestion
 * - Tab 套 uepEntity mark（entity:{key} + kind 推斷）
 * - Esc 跳過（同位置不再提示）
 * - ↑↓ 多候選切換
 * - 已標記文字不偵測
 */
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, it, expect, afterEach } from 'vitest';

import type { EntityPickerEntry } from '../EntityIndexPicker';
import { EntitySuggest, entitySuggestKey } from '../EntitySuggestExtension';
import { UepEntityMark, UepCueMark } from '../UepEmbedMarks';
import {
  buildMatchTerms,
  buildSuggestIndex,
  matchSuffix,
} from '../entitySuggest';

function entry(
  overrides: Partial<EntityPickerEntry> & { name: string }
): EntityPickerEntry {
  return {
    stack: 'dossier',
    pageId: 'concepts/server/records/character_list',
    pageTitle: '人物出現列表',
    ...overrides,
  };
}

// ── buildMatchTerms ────────────────────────────────────────────────

describe('buildMatchTerms', () => {
  it('中文全名 + 中文首段 + 英文全名；姓氏不進預設', () => {
    const terms = buildMatchTerms('艾斯維爾·科索諾 Xavier Colsono');
    expect(terms).toContain('艾斯維爾·科索諾');
    expect(terms).toContain('艾斯維爾');
    expect(terms).toContain('Xavier Colsono');
    // 姓氏單獨匹配刻意不派生（家族同姓誤傷）
    expect(terms).not.toContain('科索諾');
    expect(terms).not.toContain('Colsono');
  });

  it('無間隔號名稱不重複派生首段', () => {
    expect(buildMatchTerms('諾薇亞 Norvia')).toEqual(['諾薇亞', 'Norvia']);
  });

  it('純中文 / 純英文名稱', () => {
    expect(buildMatchTerms('原質震盪')).toEqual(['原質震盪']);
    expect(buildMatchTerms('Essence')).toEqual(['Essence']);
  });

  it('方括號詞條剝殼（diff 慣例），原樣也保留', () => {
    const terms = buildMatchTerms('[遣返]');
    expect(terms).toContain('[遣返]');
    expect(terms).toContain('遣返');
  });

  it('aliases 納入且不受派生長度限制；去重', () => {
    const terms = buildMatchTerms('諾薇亞 Norvia', ['小諾', '諾薇亞', 'Nov']);
    expect(terms).toContain('小諾');
    expect(terms).toContain('Nov');
    expect(terms.filter((t) => t === '諾薇亞')).toHaveLength(1);
  });

  it('單字元派生詞排除（太氾濫）', () => {
    expect(buildMatchTerms('光 L')).toEqual([]);
  });
});

// ── buildSuggestIndex / matchSuffix ────────────────────────────────

describe('buildSuggestIndex / matchSuffix', () => {
  const entries: EntityPickerEntry[] = [
    entry({
      name: '艾斯維爾·科索諾 Xavier Colsono',
      entityKey: 'xavier-colsono',
    }),
    entry({ name: '諾薇亞 Norvia', entityKey: 'norvia', aliases: ['小諾'] }),
    // 同 alias 多候選
    entry({
      name: '諾薇亞複製體',
      entityKey: 'norvia-clone',
      aliases: ['小諾'],
    }),
  ];
  const index = buildSuggestIndex(entries);

  it('索引含拆名與 aliases；同詞多候選聚合', () => {
    expect(index.terms.get('艾斯維爾')![0].entityKey).toBe('xavier-colsono');
    expect(index.terms.get('小諾')!.map((e) => e.entityKey)).toEqual([
      'norvia',
      'norvia-clone',
    ]);
    expect(index.maxTermLength).toBeGreaterThanOrEqual(
      '艾斯維爾·科索諾'.length
    );
  });

  it('後綴命中：打完匹配詞的瞬間', () => {
    const hit = matchSuffix('今天遇見了諾薇亞', index);
    expect(hit).not.toBeNull();
    expect(hit!.term).toBe('諾薇亞');
    expect(hit!.length).toBe(3);
  });

  it('最長後綴優先（全名蓋過首段）', () => {
    const hit = matchSuffix('報告：艾斯維爾·科索諾', index);
    expect(hit!.term).toBe('艾斯維爾·科索諾');
  });

  it('英文詞要求左邊界（Nov 不命中 Renov 的尾巴）', () => {
    const withNov = buildSuggestIndex([
      entry({ name: '諾薇亞 Norvia', entityKey: 'norvia', aliases: ['Nov'] }),
    ]);
    expect(matchSuffix('meet Nov', withNov)!.term).toBe('Nov');
    expect(matchSuffix('Renov', withNov)).toBeNull();
  });

  it('未命中 / 空文字 → null', () => {
    expect(matchSuffix('無關文字', index)).toBeNull();
    expect(matchSuffix('', index)).toBeNull();
  });
});

// ── Plugin 整合（真 TipTap Editor） ────────────────────────────────

describe('EntitySuggestExtension', () => {
  const entries: EntityPickerEntry[] = [
    entry({ name: '諾薇亞 Norvia', entityKey: 'norvia' }),
    entry({ name: '雙生子甲', entityKey: 'twin-a', aliases: ['雙生子'] }),
    entry({ name: '雙生子乙', entityKey: 'twin-b', aliases: ['雙生子'] }),
  ];

  let editor: Editor;
  afterEach(() => {
    editor?.destroy();
  });

  /** 建 editor + 注入索引 + 游標移到段落尾 */
  function setup(html: string) {
    editor = new Editor({
      element: document.createElement('div'),
      extensions: [StarterKit, UepEntityMark, UepCueMark, EntitySuggest],
      content: html,
    });
    editor.view.dispatch(
      editor.state.tr.setMeta(entitySuggestKey, {
        type: 'set-index',
        index: buildSuggestIndex(entries),
      })
    );
    // 游標移到第一段文字結尾
    const end = editor.state.doc.firstChild!.nodeSize - 1;
    editor.commands.setTextSelection(end);
    return editor;
  }

  function pluginState() {
    return entitySuggestKey.getState(editor.state)!;
  }

  /** 只呼叫本 plugin 的 handleKeyDown——someProp 會連 gapcursor 等
      其他 plugin 的方向鍵 handler 一起跑，jsdom 無 layout 會炸 */
  function pressKey(key: string): boolean {
    const plugin = entitySuggestKey.get(editor.state)!;
    const handler = plugin.props.handleKeyDown!;
    return (
      handler.call(
        plugin,
        editor.view,
        new KeyboardEvent('keydown', { key })
      ) === true
    );
  }

  it('游標停在匹配詞尾 → active suggestion', () => {
    setup('<p>今天遇見了諾薇亞</p>');
    const { active } = pluginState();
    expect(active).not.toBeNull();
    expect(active!.term).toBe('諾薇亞');
    expect(active!.candidates[0].entityKey).toBe('norvia');
  });

  it('Tab 套 uepEntity mark（entity:{key} + kind 推斷）並清除 suggestion', () => {
    setup('<p>今天遇見了諾薇亞</p>');
    expect(pressKey('Tab')).toBe(true);
    expect(pluginState().active).toBeNull();
    const html = editor.getHTML();
    expect(html).toContain('data-uep-entity="character"');
    expect(html).toContain('data-ref="entity:norvia"');
    expect(html).toContain('>諾薇亞</span>');
  });

  it('Esc 跳過：同位置不再提示，繼續打字恢復偵測', () => {
    setup('<p>今天遇見了諾薇亞</p>');
    expect(pressKey('Escape')).toBe(true);
    expect(pluginState().active).toBeNull();
    expect(pluginState().dismissed!.term).toBe('諾薇亞');
    // 繼續打字（位置改變）→ 新的匹配照常出現
    editor.commands.insertContent('與諾薇亞');
    expect(pluginState().active!.term).toBe('諾薇亞');
  });

  it('↑↓ 多候選切換，Tab 套用選中候選', () => {
    setup('<p>遇見雙生子</p>');
    const { active } = pluginState();
    expect(active!.candidates).toHaveLength(2);
    expect(pressKey('ArrowDown')).toBe(true);
    expect(pluginState().active!.selected).toBe(1);
    expect(pressKey('Tab')).toBe(true);
    expect(editor.getHTML()).toContain('data-ref="entity:twin-b"');
  });

  it('單候選不攔截方向鍵', () => {
    setup('<p>今天遇見了諾薇亞</p>');
    expect(pressKey('ArrowDown')).toBe(false);
  });

  it('已標記文字不偵測', () => {
    setup(
      '<p>今天遇見了<span data-uep-entity="character" data-ref="entity:norvia">諾薇亞</span></p>'
    );
    expect(pluginState().active).toBeNull();
  });

  it('無 suggestion 時 Tab/Esc 不攔截', () => {
    setup('<p>無關文字</p>');
    expect(pressKey('Tab')).toBe(false);
    expect(pressKey('Escape')).toBe(false);
  });
});
