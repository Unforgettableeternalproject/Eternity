/**
 * EntityIndexPicker 測試（Epic 2 S7-D-1）
 *
 * 涵蓋：
 * - embeddableEntries：dossier/diff 帶 key 過濾 + 同 key 去重
 * - inferEntityKind：pageId/pageTitle 推斷（人物/地點/其他）
 * - groupPickerEntries：關鍵字過濾 + 分組（頁面｜分類）
 * - 元件：載入索引 → 列出條目 → 點選回傳 entity:{key} + 建議 kind
 */
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import EntityIndexPicker, {
  embeddableEntries,
  inferEntityKind,
  groupPickerEntries,
  invalidateEntityPickerCache,
} from '../EntityIndexPicker';
import type { EntityPickerEntry } from '../EntityIndexPicker';

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

describe('embeddableEntries', () => {
  it('只留 dossier/diff 且帶 entityKey 的條目', () => {
    const result = embeddableEntries([
      entry({ name: '艾斯維爾', entityKey: 'xavier-colsono' }),
      entry({ name: '無 key 條目' }),
      entry({ name: 'browser 條目', stack: 'browser', entityKey: 'b-key' }),
      entry({ name: 'chrono 條目', stack: 'chrono', entityKey: 'c-key' }),
      entry({ name: '對照條目', stack: 'diff', entityKey: 'repatriation' }),
    ]);
    expect(result.map((e) => e.entityKey)).toEqual([
      'xavier-colsono',
      'repatriation',
    ]);
  });

  it('同 entityKey 去重（跨 variant / 跨 stack 取第一筆）', () => {
    const result = embeddableEntries([
      entry({
        name: '艾斯維爾 (u)',
        entityKey: 'xavier-colsono',
        variantId: 'u',
      }),
      entry({
        name: '艾斯維爾 (e)',
        entityKey: 'xavier-colsono',
        variantId: 'e',
      }),
      entry({ name: '對照同 key', stack: 'diff', entityKey: 'xavier-colsono' }),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('艾斯維爾 (u)');
  });
});

describe('inferEntityKind', () => {
  it('pageId 含 character 或標題含人物 → character', () => {
    expect(inferEntityKind(entry({ name: 'x' }))).toBe('character');
    expect(
      inferEntityKind(
        entry({ name: 'x', pageId: 'concepts/other', pageTitle: '人物索引' })
      )
    ).toBe('character');
  });

  it('pageId 含 location 或標題含場景/地區 → location', () => {
    expect(
      inferEntityKind(
        entry({
          name: 'x',
          pageId: 'concepts/server/records/location_list',
          pageTitle: '場景地區、地形與興趣點',
        })
      )
    ).toBe('location');
  });

  it('推不出來 → term（魔獸 / 翻譯條目）', () => {
    expect(
      inferEntityKind(
        entry({
          name: 'x',
          pageId: 'concepts/server/records/hostile_creatures',
          pageTitle: '魔獸與◼︎◼︎遭遇',
        })
      )
    ).toBe('term');
    expect(
      inferEntityKind(
        entry({
          name: 'x',
          stack: 'diff',
          pageId: 'concepts/server/translation/explainations',
          pageTitle: '意義的認知',
        })
      )
    ).toBe('term');
  });
});

describe('groupPickerEntries', () => {
  const entries: EntityPickerEntry[] = [
    entry({ name: '艾斯維爾', entityKey: 'xavier-colsono', category: '三區' }),
    entry({ name: '諾薇亞', entityKey: 'novia', category: '三區' }),
    entry({
      name: '遣返',
      stack: 'diff',
      pageId: 'concepts/server/translation/explainations',
      pageTitle: '意義的認知',
      entityKey: 'repatriation',
      category: '理論',
    }),
  ];

  it('空關鍵字列出全部，分組鍵 = 頁面｜分類', () => {
    const groups = groupPickerEntries(entries, '');
    expect(groups.map((g) => g.category)).toEqual([
      '人物出現列表｜三區',
      '意義的認知｜理論',
    ]);
    expect(groups[0].entries).toHaveLength(2);
  });

  it('關鍵字比對 name / entityKey / category', () => {
    expect(groupPickerEntries(entries, '諾薇')[0].entries[0].name).toBe(
      '諾薇亞'
    );
    expect(groupPickerEntries(entries, 'repatri')[0].entries[0].name).toBe(
      '遣返'
    );
    expect(groupPickerEntries(entries, '理論')[0].entries[0].name).toBe('遣返');
    expect(groupPickerEntries(entries, '不存在')).toEqual([]);
  });

  it('關鍵字比對 aliases（S7-D-2）', () => {
    const withAlias = [
      ...entries,
      entry({
        name: '瑞斯可·亞克',
        entityKey: 'rethiscor-yaakov',
        aliases: ['主人'],
      }),
    ];
    const groups = groupPickerEntries(withAlias, '主人');
    expect(groups).toHaveLength(1);
    expect(groups[0].entries[0].name).toBe('瑞斯可·亞克');
  });
});

describe('EntityIndexPicker 元件', () => {
  beforeEach(() => {
    invalidateEntityPickerCache();
  });

  function stubIndex(entries: EntityPickerEntry[]) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, data: { entries } }),
      }))
    );
  }

  it('載入後列出可嵌入條目，點選回傳 entity:{key} + 建議 kind', async () => {
    stubIndex([
      entry({
        name: '艾斯維爾',
        entityKey: 'xavier-colsono',
        category: '三區',
      }),
      entry({ name: '無 key 不出現' }),
    ]);
    const onPick = vi.fn();
    render(<EntityIndexPicker apiBase="http://api" onPick={onPick} />);

    const item = await screen.findByText('艾斯維爾');
    expect(screen.queryByText('無 key 不出現')).toBeNull();
    fireEvent.click(item);
    expect(onPick).toHaveBeenCalledWith('entity:xavier-colsono', 'character');
  });

  it('搜尋框過濾條目', async () => {
    stubIndex([
      entry({ name: '艾斯維爾', entityKey: 'xavier-colsono' }),
      entry({ name: '諾薇亞', entityKey: 'novia' }),
    ]);
    render(<EntityIndexPicker apiBase="http://api" onPick={vi.fn()} />);

    await screen.findByText('艾斯維爾');
    fireEvent.change(screen.getByPlaceholderText(/搜尋條目/), {
      target: { value: 'novia' },
    });
    expect(screen.queryByText('艾斯維爾')).toBeNull();
    expect(screen.getByText('諾薇亞')).toBeInTheDocument();
  });

  it('載入失敗顯示重試', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500 }))
    );
    render(<EntityIndexPicker apiBase="http://api" onPick={vi.fn()} />);
    expect(await screen.findByText(/載入失敗/)).toBeInTheDocument();
    expect(screen.getByText('重試')).toBeInTheDocument();
  });
});
