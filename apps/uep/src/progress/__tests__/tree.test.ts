/**
 * progress/tree 測試 — collectProgressLeafIds（getProgressDescendantIds 參考實作）
 *
 * 合約：「葉」= 本身標為進度頁、且子樹內沒有其他進度頁。
 * 涵蓋 2026-07-03 審核發現的邊界：進度頁有 children 但子樹無進度後代時，
 * 本身應計為葉（原實作會遞迴略過）。
 */

import { describe, it, expect } from 'vitest';

import { collectProgressLeafIds } from '../tree';
import type { ProgressTreeNode } from '../tree';

function node(
  id: string,
  progress: boolean,
  children: ProgressTreeNode[] = []
): ProgressTreeNode {
  return {
    id,
    metadata: progress ? { progressPage: true } : {},
    children,
  };
}

describe('collectProgressLeafIds', () => {
  it('無子節點的容器回傳空陣列', () => {
    expect(collectProgressLeafIds(node('arc', true))).toEqual([]);
  });

  it('繼承語意：非進度 sibling 因父容器繼承成為葉（想略過改標 gateExempt）', () => {
    // arc 標 progressPage → extra 即使無 progressPage 也被繼承
    const arc = node('arc', true, [
      node('s1', true),
      node('extra', false),
      node('s2', true),
    ]);
    expect(collectProgressLeafIds(arc)).toEqual(['s1', 'extra', 's2']);
  });

  it('進度頁有進度後代時只計後代、不計本身', () => {
    const chapter = node('ch', true, [
      node('arc1', true, [node('s1', true), node('s2', true)]),
    ]);
    expect(collectProgressLeafIds(chapter)).toEqual(['s1', 's2']);
  });

  it('邊界修正：進度頁有 children 但子樹無進度後代 → 本身即為葉（在 s1 底下的圖片被 s1 繼承成葉）', () => {
    // s1 (progress) 底下的圖片被繼承成 progress leaf（單層繼承語意，2026-07-03 修 #10）
    // 若不希望圖片計入，改標 hidden / gateExempt 即可
    const arc = node('arc', true, [
      node('s1', true, [node('img-1', false), node('img-2', false)]),
      node('s2', true),
    ]);
    // s1 為 progress container → img-1、img-2 繼承；s2 為葉；arc 本身不計入
    expect(collectProgressLeafIds(arc)).toEqual(['img-1', 'img-2', 's2']);
  });

  it('非進度中間層之下的進度葉照常收集', () => {
    const chapter = node('ch', true, [
      node('cluster', false, [node('s1', true)]),
    ]);
    // ch 是 progress container → cluster 繼承 → s1 更是直接 progressPage
    // 但 cluster 無 progress metadata、繼承的 progress 不 pass down（單層規則）
    // → s1 自己還是 progress → 為葉
    expect(collectProgressLeafIds(chapter)).toEqual(['s1']);
  });

  it('繼承（2026-07-03 修 #10）：arc 標進度 → 直接 sections 自動當進度葉', () => {
    // 使用者不用一個個 section 手動勾 progressPage
    const arc = node('arc', true, [
      node('s1', false),
      node('s2', false),
      node('s3', false),
    ]);
    expect(collectProgressLeafIds(arc)).toEqual(['s1', 's2', 's3']);
  });

  it('繼承 + 豁免：section 標 gateExempt 退出鏈', () => {
    const arc = {
      id: 'arc',
      metadata: { progressPage: true },
      children: [
        { id: 's1', metadata: {}, children: [] },
        { id: 'extra', metadata: { gateExempt: true }, children: [] },
        { id: 's2', metadata: {}, children: [] },
      ],
    };
    expect(collectProgressLeafIds(arc)).toEqual(['s1', 's2']);
  });

  it('繼承只走一層：chapter 標進度但只影響 arc、不影響 arc 底下的 section', () => {
    // ch (progress) → arc (無標) 繼承成 progress leaf；arc 底下 s1/s2 不再自動繼承
    // 若要 sections 也自動 → arc 自己標為 progress
    const chapter = node('ch', true, [
      node('arc', false, [node('s1', false), node('s2', false)]),
    ]);
    // arc 繼承成 progress、子孫 s1/s2 不繼承 → arc 走「無進度後代」邊界 → 本身為葉
    expect(collectProgressLeafIds(chapter)).toEqual(['arc']);
  });

  it('深層混合：進度 arc（含非進度子頁）與展開到最深的進度葉並存', () => {
    // 繼承語意：arc1 標 progress → note 繼承成葉
    const chapter = node('ch', true, [
      node('arc1', true, [node('note', false)]),
      node('arc2', true, [
        node('s1', true),
        node('s2', true, [node('sub', true)]),
      ]),
    ]);
    // arc1 → note 繼承；arc2 → s1 為葉；arc2 → s2 → sub 展開到最深
    expect(collectProgressLeafIds(chapter)).toEqual(['note', 's1', 'sub']);
  });

  it('目標節點本身不計入（即使標為進度頁）——但底下的 child 因繼承成為葉', () => {
    const leaf = node('solo', true, [node('img', false)]);
    // solo 自己不出現在自己的後代清單；img 因繼承成為 progress leaf
    expect(collectProgressLeafIds(leaf)).toEqual(['img']);
  });

  /**
   * 2026-07-03 修正：hidden 與 static-locked 節點按定義不可完成，
   * 整段子樹排除以避免容器 completeness 永遠不成立。
   */
  describe('排除 hidden 與 static-locked（2026-07-03 修）', () => {
    it('static-locked 進度葉不計入（例：01-06 手動封存）', () => {
      const arc = {
        id: 'arc',
        metadata: {},
        children: [
          { id: 's1', metadata: { progressPage: true }, children: [] },
          {
            id: 's2',
            metadata: { progressPage: true, locked: true },
            children: [],
          },
        ],
      };
      expect(collectProgressLeafIds(arc)).toEqual(['s1']);
    });

    it('hidden 進度葉不計入', () => {
      const arc = {
        id: 'arc',
        metadata: {},
        children: [
          { id: 's1', metadata: { progressPage: true }, children: [] },
          {
            id: 's2',
            metadata: { progressPage: true, hidden: true },
            children: [],
          },
        ],
      };
      expect(collectProgressLeafIds(arc)).toEqual(['s1']);
    });

    it('static-locked 容器：其進度子樹整段排除', () => {
      const chapter = {
        id: 'ch',
        metadata: {},
        children: [
          { id: 'arc1', metadata: { progressPage: true }, children: [] },
          {
            id: 'arc2',
            metadata: { locked: true },
            children: [
              { id: 's1', metadata: { progressPage: true }, children: [] },
              { id: 's2', metadata: { progressPage: true }, children: [] },
            ],
          },
        ],
      };
      expect(collectProgressLeafIds(chapter)).toEqual(['arc1']);
    });

    it('保留順序（DFS in tree order）給 penultimate/last 規則用', () => {
      const arc = {
        id: 'arc',
        metadata: {},
        children: [
          { id: 's1', metadata: { progressPage: true }, children: [] },
          { id: 's2', metadata: { progressPage: true }, children: [] },
          { id: 's3', metadata: { progressPage: true }, children: [] },
          {
            id: 's4',
            metadata: { progressPage: true, locked: true },
            children: [],
          },
        ],
      };
      // s4 排除；順序 s1、s2、s3
      const leaves = collectProgressLeafIds(arc);
      expect(leaves).toEqual(['s1', 's2', 's3']);
      // 倒數第二 = s2、最後 = s3
      expect(leaves[leaves.length - 2]).toBe('s2');
      expect(leaves[leaves.length - 1]).toBe('s3');
    });
  });
});
