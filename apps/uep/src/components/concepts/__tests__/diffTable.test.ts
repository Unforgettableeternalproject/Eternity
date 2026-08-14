/**
 * diffTable — 對照表欄位推導
 *
 * 閱讀器與編輯器共用同一份規則。這裡鎖住「取大者」與「跨 section 統一」
 * 兩條，因為既有資料沒有 valueLabels，一旦改成以標籤為準就會裁掉資料。
 */
import { describe, it, expect } from 'vitest';

import {
  padValueLabels,
  sectionValueColumns,
  subcatValueColumns,
  subcatValueLabels,
} from '../diffTable';
import type { DiffSection, DiffSubcat } from '../types';

const section = (over: Partial<DiffSection> = {}): DiffSection => ({
  label: '',
  entries: [],
  ...over,
});

describe('sectionValueColumns', () => {
  it('無標籤時由實際值數推導', () => {
    expect(
      sectionValueColumns(
        section({ entries: [{ term: '甲', values: ['A', 'B'] }] })
      )
    ).toBe(2);
  });

  it('值數多於標籤數時取值數（不裁掉資料）', () => {
    expect(
      sectionValueColumns(
        section({
          valueLabels: ['英文'],
          entries: [{ term: '甲', values: ['A', 'B', 'C'] }],
        })
      )
    ).toBe(3);
  });

  it('標籤數多於值數時取標籤數（空欄位仍可填）', () => {
    expect(
      sectionValueColumns(
        section({
          valueLabels: ['英文', '日文', '德文'],
          entries: [{ term: '甲', values: ['A'] }],
        })
      )
    ).toBe(3);
  });

  it('空 section 至少 1 欄', () => {
    expect(sectionValueColumns(section())).toBe(1);
    expect(sectionValueColumns(section({ valueLabels: [] }))).toBe(1);
  });
});

describe('subcatValueColumns', () => {
  it('跨 section 取最大欄數（展平成單表時各列要對齊）', () => {
    const subcat: DiffSubcat = {
      label: 'A',
      sections: [
        section({ entries: [{ term: '甲', values: ['A'] }] }),
        section({ entries: [{ term: '乙', values: ['A', 'B', 'C'] }] }),
      ],
    };
    expect(subcatValueColumns(subcat)).toBe(3);
  });

  it('無分類時 0 欄（不渲染表格）', () => {
    expect(subcatValueColumns(undefined)).toBe(0);
  });
});

describe('subcatValueLabels', () => {
  it('取第一組已定義的標籤', () => {
    const subcat: DiffSubcat = {
      label: 'A',
      sections: [
        section(),
        section({ valueLabels: ['英文', '日文'] }),
        section({ valueLabels: ['其他'] }),
      ],
    };
    expect(subcatValueLabels(subcat)).toEqual(['英文', '日文']);
  });

  it('全部未定義時回空陣列（閱讀器據此不畫表頭）', () => {
    expect(
      subcatValueLabels({ label: 'A', sections: [section(), section()] })
    ).toEqual([]);
    expect(subcatValueLabels(undefined)).toEqual([]);
  });
});

describe('padValueLabels', () => {
  it('補齊到指定欄數，缺的補空字串', () => {
    expect(padValueLabels(['英文'], 3)).toEqual(['英文', '', '']);
    expect(padValueLabels(undefined, 2)).toEqual(['', '']);
  });

  it('標籤多於欄數時截到欄數', () => {
    expect(padValueLabels(['A', 'B', 'C'], 2)).toEqual(['A', 'B']);
  });
});
