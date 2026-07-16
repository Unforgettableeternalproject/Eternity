/**
 * RevisionSimulator 測試（Epic 2 S7-B）
 *
 * 涵蓋：
 * - 旗標 chips 彙整（各 revision gate 的 requiresFlags 聯集）
 * - 勾選旗標 → gate 求值結果與 effective view 即時更新（走真 resolver）
 * - 亂序警告：後段通過但前段未通過
 * - 觀測者視角 bypass requiresFlags
 * - 條目可見/隱藏狀態（isEntryUnlocked 語意）
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import type { ConceptsRevision } from '../../concepts/types';
import RevisionSimulator from '../RevisionSimulator';

const baseEntry = {
  name: '艾斯維爾',
  content_html: '<p>初始描述</p>',
  entityKey: 'xavier-colsono',
};

const revisions: ConceptsRevision[] = [
  {
    id: 'xavier-colsono:01',
    gate: { requiresFlags: ['xavier-colsono:01'] },
    patch: { set: { content_html: '<p>第一次揭露</p>' } },
  },
  {
    id: 'xavier-colsono:02',
    gate: { requiresFlags: ['xavier-colsono:02'] },
    patch: { set: { name: '艾斯維爾·柯索諾' } },
  },
];

function setup(revs: ConceptsRevision[] = revisions) {
  render(
    <RevisionSimulator
      baseEntry={baseEntry}
      revisions={revs}
      accent="#2d6a4f"
    />
  );
}

describe('RevisionSimulator', () => {
  it('彙整各 revision 的 requiresFlags 為可勾選 chips', () => {
    setup();
    expect(
      screen.getByRole('button', { name: 'xavier-colsono:01' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'xavier-colsono:02' })
    ).toBeInTheDocument();
  });

  it('首個 revision 帶 gate 且未通過 → 條目隱藏', () => {
    setup();
    expect(screen.getByText(/隱藏（未解鎖）/)).toBeInTheDocument();
  });

  it('勾選旗標後條目可見且 effective view 套用 patch', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'xavier-colsono:01' }));
    expect(screen.getByText('可見')).toBeInTheDocument();
    // effective view JSON 包含 patch 後的內容
    expect(screen.getByText(/第一次揭露/)).toBeInTheDocument();
    // 未通過的 revision 不套用
    expect(screen.queryByText(/艾斯維爾·柯索諾/)).not.toBeInTheDocument();
  });

  it('亂序警告：後段通過但前段未通過', () => {
    setup();
    // 只勾第二個旗標
    fireEvent.click(screen.getByRole('button', { name: 'xavier-colsono:02' }));
    expect(screen.getByText('⚠ 亂序')).toBeInTheDocument();
    expect(screen.getByText(/前置 revision 未通過/)).toBeInTheDocument();
  });

  it('循序通過時無亂序警告', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: 'xavier-colsono:01' }));
    fireEvent.click(screen.getByRole('button', { name: 'xavier-colsono:02' }));
    expect(screen.queryByText('⚠ 亂序')).not.toBeInTheDocument();
    expect(screen.getByText(/艾斯維爾·柯索諾/)).toBeInTheDocument();
  });

  it('觀測者視角 bypass requiresFlags', () => {
    setup();
    fireEvent.click(screen.getByText(/觀測者視角/));
    expect(screen.getByText('可見')).toBeInTheDocument();
    expect(screen.getAllByText('✓')).toHaveLength(2);
  });

  it('自訂旗標可加入模擬集合', () => {
    setup();
    const input = screen.getByPlaceholderText(/自訂旗標/);
    fireEvent.change(input, { target: { value: 'extra:01' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(
      screen.getByRole('button', { name: 'extra:01' })
    ).toBeInTheDocument();
  });

  it('effective view 剝除 revisions 與 entityKey', () => {
    setup();
    const json = document.querySelector('.ced-rev-sim-json');
    expect(json?.textContent).not.toContain('revisions');
    expect(json?.textContent).not.toContain('entityKey');
  });

  it('無 revision 時顯示空旗標提示', () => {
    setup([]);
    expect(screen.getByText(/尚無可模擬的旗標/)).toBeInTheDocument();
    expect(screen.getByText('可見')).toBeInTheDocument();
  });
});
