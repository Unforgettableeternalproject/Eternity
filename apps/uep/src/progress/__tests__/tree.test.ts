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

  it('收集無子頁的進度葉，略過非進度 sibling', () => {
    const arc = node('arc', true, [
      node('s1', true),
      node('extra', false),
      node('s2', true),
    ]);
    expect(collectProgressLeafIds(arc)).toEqual(['s1', 's2']);
  });

  it('進度頁有進度後代時只計後代、不計本身', () => {
    const chapter = node('ch', true, [
      node('arc1', true, [node('s1', true), node('s2', true)]),
    ]);
    expect(collectProgressLeafIds(chapter)).toEqual(['s1', 's2']);
  });

  it('邊界修正：進度頁有 children 但子樹無進度後代 → 本身即為葉', () => {
    // 標為進度的 section 底下掛圖片子頁（非進度）
    const arc = node('arc', true, [
      node('s1', true, [node('img-1', false), node('img-2', false)]),
      node('s2', true),
    ]);
    expect(collectProgressLeafIds(arc)).toEqual(['s1', 's2']);
  });

  it('非進度中間層之下的進度葉照常收集', () => {
    const chapter = node('ch', true, [
      node('cluster', false, [node('s1', true)]),
    ]);
    expect(collectProgressLeafIds(chapter)).toEqual(['s1']);
  });

  it('深層混合：進度 arc（含非進度子頁）與展開到最深的進度葉並存', () => {
    const chapter = node('ch', true, [
      node('arc1', true, [node('note', false)]), // 邊界：本身為葉
      node('arc2', true, [
        node('s1', true),
        node('s2', true, [node('sub', true)]), // 展開到最深
      ]),
    ]);
    expect(collectProgressLeafIds(chapter)).toEqual(['arc1', 's1', 'sub']);
  });

  it('目標節點本身不計入（即使標為進度頁）', () => {
    const leaf = node('solo', true, [node('img', false)]);
    // solo 自己不出現在自己的後代清單
    expect(collectProgressLeafIds(leaf)).toEqual([]);
  });
});
