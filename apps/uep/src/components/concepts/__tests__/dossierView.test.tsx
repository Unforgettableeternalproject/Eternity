/**
 * dossier「尚未知」佔位測試
 *
 * 佔位只在 Reader 渲染層合成：群組本身可見（群組 gate 已過）但沒有可見
 * 條目時出現，有條目變可見就消失。它不是實體——不帶 entityKey、不長
 * 「詳細」／「相關」按鈕、不可拖曳、不計入條目數。
 */

import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../islands', () => ({
  useEntityDragSource: () => ({
    handlers: { 'data-drag-handlers': '' },
    ghost: null,
  }),
}));
vi.mock('../../../islands/concepts/terminalCore', () => ({
  loadEntityIndex: () => Promise.resolve([]),
}));
vi.mock('../InterlinkTriggerButton', () => ({
  default: ({ entityKey }: { entityKey?: string }) => (
    <span data-testid="interlink" data-key={entityKey} />
  ),
}));
vi.mock('../BrowserDetailButton', () => ({
  default: ({ entityKey }: { entityKey?: string }) => (
    <span data-testid="detail" data-key={entityKey} />
  ),
}));

import { createInitialState } from '../../../progress/types';
import type { ProgressState } from '../../../progress/types';
import { ReaderDossier } from '../ConceptsReader';
import { buildDossierView, DOSSIER_UNKNOWN_PLACEHOLDER } from '../dossierView';
import { resolveEffectiveViewForPage } from '../revision';
import type { DossierContent, DossierGroup, DossierSubcat } from '../types';

function stateWith(partial: Partial<ProgressState>): ProgressState {
  return { ...createInitialState(), ...partial };
}

function dossier(groups: DossierGroup[], subcatLabel = '三區'): DossierContent {
  return {
    variants: [
      {
        id: 'v',
        label: 'V',
        subcategories: [{ label: subcatLabel, groups }],
      },
    ],
  };
}

/** 走真實 effective view，再交給 Reader 的檢視推導 */
function viewOf(data: DossierContent, progress: ProgressState) {
  const resolved = resolveEffectiveViewForPage(data, progress);
  return buildDossierView(resolved.variants[0].subcategories);
}

const reader = stateWith({});
const observer = stateWith({ view: 'observer', observerEver: true });

describe('buildDossierView', () => {
  it('群組可見但沒有條目 → 佔位', () => {
    const view = viewOf(dossier([{ label: '政府', entries: [] }]), reader);
    expect(view).toHaveLength(1);
    expect(view[0].groups.map((g) => [g.label, g.showUnknown])).toEqual([
      ['政府', true],
    ]);
  });

  it('群組可見但條目全鎖 → 佔位', () => {
    const view = viewOf(
      dossier([
        {
          label: '政府',
          entries: [
            { name: '甲', entityKey: 'a', gate: { requiresFlags: ['f:a'] } },
            { name: '乙', entityKey: 'b', gate: { requiresFlags: ['f:b'] } },
          ],
        },
      ]),
      reader
    );
    expect(view[0].groups[0].showUnknown).toBe(true);
    expect(view[0].groups[0].entries).toEqual([]);
  });

  it('有一條可見 → 無佔位', () => {
    const view = viewOf(
      dossier([
        {
          label: '政府',
          entries: [
            { name: '甲', entityKey: 'a' },
            { name: '乙', entityKey: 'b', gate: { requiresFlags: ['f:b'] } },
          ],
        },
      ]),
      reader
    );
    expect(view[0].groups[0].showUnknown).toBe(false);
    expect(view[0].groups[0].entries.map((e) => e.name)).toEqual(['甲']);
  });

  it('群組 gate 未過 → 群組不顯示也無佔位；分類無群組時一併不顯示', () => {
    const data = dossier([
      { label: '機密', gate: { requiresFlags: ['sec'] }, entries: [] },
    ]);
    expect(viewOf(data, reader)).toEqual([]);
    // 群組 gate 通過後群組出現並帶佔位
    const unlocked = viewOf(data, stateWith({ flags: ['sec'] }));
    expect(unlocked[0].groups[0].showUnknown).toBe(true);
  });

  it('觀測者視角以該視角的可見條目數判斷', () => {
    const data = dossier([
      {
        label: '政府',
        entries: [
          { name: '甲', entityKey: 'a', gate: { requiresFlags: ['f:a'] } },
        ],
      },
    ]);
    expect(viewOf(data, reader)[0].groups[0].showUnknown).toBe(true);
    const obs = viewOf(data, observer)[0].groups[0];
    expect(obs.showUnknown).toBe(false);
    expect(obs.entries.map((e) => e.name)).toEqual(['甲']);
  });

  it('無名稱（含預設）群組無可見條目 → 不顯示、不給佔位', () => {
    const view = viewOf(
      dossier([
        { label: '', entries: [] },
        {
          label: '  ',
          entries: [{ name: '甲', gate: { requiresFlags: ['x'] } }],
        },
        { label: '政府', entries: [] },
      ]),
      reader
    );
    expect(view[0].groups.map((g) => g.label)).toEqual(['政府']);
  });

  it('無名稱群組有可見條目時照常顯示', () => {
    const view = viewOf(
      dossier([{ label: '', entries: [{ name: '甲' }] }]),
      reader
    );
    expect(view[0].groups).toHaveLength(1);
    expect(view[0].groups[0].showUnknown).toBe(false);
  });

  it('不改動傳入的資料物件', () => {
    const subcats: DossierSubcat[] = [
      { label: '三區', groups: [{ label: '政府', entries: [] }] },
    ];
    const snapshot = JSON.parse(JSON.stringify(subcats));
    buildDossierView(subcats);
    expect(subcats).toEqual(snapshot);
  });
});

describe('ReaderDossier 佔位渲染', () => {
  function renderDossier(subcategories: DossierSubcat[]) {
    const onOpenBrowserDetail = vi.fn();
    const utils = render(
      <ReaderDossier
        subcategories={subcategories}
        onOpenBrowserDetail={onOpenBrowserDetail}
      />
    );
    return { ...utils, onOpenBrowserDetail };
  }

  it('佔位不帶 entityKey、不長實體按鈕、不掛拖曳、不計入條目數', () => {
    const { container, onOpenBrowserDetail } = renderDossier([
      { label: '三區', groups: [{ label: '政府', entries: [] }] },
    ]);
    const card = container.querySelector('[data-dossier-unknown]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain(DOSSIER_UNKNOWN_PLACEHOLDER.name);
    expect(container.querySelector('[data-entity-key]')).toBeNull();
    expect(screen.queryByTestId('interlink')).toBeNull();
    expect(screen.queryByTestId('detail')).toBeNull();
    expect(container.querySelector('[data-drag-handlers]')).toBeNull();
    expect(
      container.querySelector('button.conc-dossier-group')?.textContent
    ).toContain('0 entries');
    expect(screen.getByText('0 records')).toBeTruthy();
    fireEvent.click(card as Element);
    expect(onOpenBrowserDetail).not.toHaveBeenCalled();
  });

  it('切到有可見條目的群組時不出現佔位', () => {
    const { container } = renderDossier([
      {
        label: '三區',
        groups: [
          { label: '政府', entries: [] },
          { label: '組織', entries: [{ name: '甲', entityKey: 'a' }] },
        ],
      },
    ]);
    expect(container.querySelector('[data-dossier-unknown]')).not.toBeNull();
    fireEvent.click(screen.getByText('組織'));
    expect(container.querySelector('[data-dossier-unknown]')).toBeNull();
    expect(container.querySelector('[data-entity-key="a"]')).not.toBeNull();
    expect(screen.getAllByTestId('detail')).toHaveLength(1);
  });

  it('只有無名稱空群組時走整頁 empty fallback', () => {
    renderDossier([{ label: '三區', groups: [{ label: '', entries: [] }] }]);
    expect(screen.getByText('0 records')).toBeTruthy();
    expect(screen.getByText(/目前沒有可讀取的記錄/)).toBeTruthy();
  });
});
