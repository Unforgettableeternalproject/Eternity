/**
 * dossier「尚未知」佔位測試
 *
 * 佔位只在 Reader 渲染層合成：群組本身可見（群組 gate 已過）、有條目
 * 歸屬於它但全部未解鎖時出現，有條目變可見就消失；沒有任何歸屬條目的
 * 群組整組不顯示。它不是實體——不帶 entityKey、不長「詳細」／「相關」
 * 按鈕、不可拖曳、不計入條目數。
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
import type { ResolvedDossierSubcat } from '../revision';
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
  it('群組可見但沒有任何歸屬條目 → 不顯示（具名也一樣）', () => {
    expect(viewOf(dossier([{ label: '政府', entries: [] }]), reader)).toEqual(
      []
    );
    const view = viewOf(
      dossier([
        { label: '政府', entries: [] },
        { label: '組織', entries: [{ name: '甲' }] },
      ]),
      reader
    );
    expect(view[0].groups.map((g) => g.label)).toEqual(['組織']);
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
    // 群組 gate 通過但底下沒有條目 → 仍不顯示
    expect(viewOf(data, stateWith({ flags: ['sec'] }))).toEqual([]);
  });

  it('群組 gate 通過、條目全鎖 → 群組出現並帶佔位', () => {
    const data = dossier([
      {
        label: '機密',
        gate: { requiresFlags: ['sec'] },
        entries: [{ name: '甲', gate: { requiresFlags: ['f:a'] } }],
      },
    ]);
    expect(viewOf(data, reader)).toEqual([]);
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
        {
          label: '政府',
          entries: [{ name: '乙', gate: { requiresFlags: ['y'] } }],
        },
      ]),
      reader
    );
    expect(view[0].groups.map((g) => g.label)).toEqual(['政府']);
  });

  it('未經 effective view 的資料：以 entries 是否為空判斷歸屬', () => {
    const view = buildDossierView([
      {
        label: '三區',
        groups: [
          { label: '政府', entries: [] },
          { label: '組織', entries: [{ name: '甲' }] },
        ],
      },
    ]);
    expect(view[0].groups.map((g) => g.label)).toEqual(['組織']);
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

describe('buildDossierView — revision 移動群組', () => {
  const moveTo = (label: string) => [
    {
      id: 'move',
      gate: { requiresFlags: ['move:01'] },
      patch: { set: { group: label } },
    },
  ];
  const moved = stateWith({ flags: ['move:01'] });
  const summary = (view: ReturnType<typeof buildDossierView>) =>
    view[0].groups.map((g) => [
      g.label,
      g.entries.map((e) => e.name),
      g.showUnknown,
    ]);

  it('基底在 A：gate 未過留在 A；通過後排到 B 尾端，搬空的 A 不出現', () => {
    const data = dossier([
      { label: '', entries: [] },
      {
        label: '無組織',
        entries: [{ name: '凱奇', revisions: moveTo('舊會議') }],
      },
      { label: '舊會議', entries: [{ name: '議長' }] },
    ]);
    expect(summary(viewOf(data, reader))).toEqual([
      ['無組織', ['凱奇'], false],
      ['舊會議', ['議長'], false],
    ]);
    expect(summary(viewOf(data, moved))).toEqual([
      ['舊會議', ['議長', '凱奇'], false],
    ]);
  });

  it('A 還有其他歸屬條目時照常顯示', () => {
    const data = dossier([
      {
        label: '無組織',
        entries: [
          { name: '凱奇', revisions: moveTo('舊會議') },
          { name: '路人' },
        ],
      },
      { label: '舊會議', entries: [] },
    ]);
    expect(summary(viewOf(data, moved))).toEqual([
      ['無組織', ['路人'], false],
      ['舊會議', ['凱奇'], false],
    ]);
  });

  it('舊群組的鎖定條目與可見條目都移到新群組 → 舊群組隱藏', () => {
    const data = dossier([
      {
        label: '舊名',
        entries: [
          {
            name: '鎖',
            gate: { requiresFlags: ['never'] },
            revisions: moveTo('新名'),
          },
          { name: '見', revisions: moveTo('新名') },
        ],
      },
      { label: '新名', entries: [] },
    ]);
    expect(summary(viewOf(data, reader))).toEqual([['舊名', ['見'], false]]);
    expect(summary(viewOf(data, moved))).toEqual([['新名', ['見'], false]]);
  });

  it('整組搬走且全部鎖定 → 佔位出現在新群組，舊群組隱藏', () => {
    const data = dossier([
      {
        label: '舊名',
        entries: [
          {
            name: '鎖',
            gate: { requiresFlags: ['never'] },
            revisions: moveTo('新名'),
          },
        ],
      },
      { label: '新名', entries: [] },
    ]);
    expect(summary(viewOf(data, reader))).toEqual([['舊名', [], true]]);
    expect(summary(viewOf(data, moved))).toEqual([['新名', [], true]]);
  });

  it('目標 label 不存在 → 留在原群組', () => {
    const data = dossier([
      {
        label: '無組織',
        entries: [{ name: '凱奇', revisions: moveTo('不存在') }],
      },
    ]);
    expect(summary(viewOf(data, moved))).toEqual([['無組織', ['凱奇'], false]]);
  });

  it('輸出的條目物件不含 group 欄位', () => {
    const data = dossier([
      { label: '', entries: [{ name: '凱奇', revisions: moveTo('舊會議') }] },
      { label: '舊會議', entries: [] },
    ]);
    const entry = viewOf(data, moved)[0].groups[0].entries[0];
    expect(entry).toEqual({ name: '凱奇' });
  });
});

describe('ReaderDossier 佔位渲染', () => {
  function renderDossier(subcategories: ResolvedDossierSubcat[]) {
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
      {
        label: '三區',
        groups: [{ label: '政府', entries: [], hasMembers: true }],
      },
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
          { label: '政府', entries: [], hasMembers: true },
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

  it('選取中的群組消失後，選取落在最後一個仍存在的群組', () => {
    const before: ResolvedDossierSubcat[] = [
      {
        label: '三區',
        groups: [
          { label: '政府', entries: [{ name: '甲', entityKey: 'a' }] },
          { label: '組織', entries: [{ name: '乙', entityKey: 'b' }] },
          { label: '舊會議', entries: [{ name: '丙', entityKey: 'c' }] },
        ],
      },
    ];
    // 「舊會議」的條目被移到「組織」，群組從三個縮成兩個
    const after: ResolvedDossierSubcat[] = [
      {
        label: '三區',
        groups: [
          before[0].groups[0],
          {
            label: '組織',
            entries: [
              { name: '乙', entityKey: 'b' },
              { name: '丙', entityKey: 'c' },
            ],
          },
        ],
      },
    ];
    const { container, rerender } = render(
      <ReaderDossier subcategories={before} onOpenBrowserDetail={vi.fn()} />
    );
    fireEvent.click(screen.getByText('舊會議'));
    expect(container.querySelector('[data-entity-key="c"]')).not.toBeNull();

    rerender(
      <ReaderDossier subcategories={after} onOpenBrowserDetail={vi.fn()} />
    );
    const active = container.querySelectorAll(
      'button.conc-dossier-group.active'
    );
    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain('組織');
    expect(container.querySelector('[data-entity-key="b"]')).not.toBeNull();
    expect(container.querySelector('[data-entity-key="c"]')).not.toBeNull();
    expect(container.querySelector('[data-entity-key="a"]')).toBeNull();
  });

  it('沒有歸屬條目的具名群組不渲染，分類一併消失', () => {
    renderDossier([
      { label: '三區', groups: [{ label: '政府', entries: [] }] },
    ]);
    expect(screen.getByText(/目前沒有可讀取的記錄/)).toBeTruthy();
  });

  it('只有無名稱空群組時走整頁 empty fallback', () => {
    renderDossier([{ label: '三區', groups: [{ label: '', entries: [] }] }]);
    expect(screen.getByText('0 records')).toBeTruthy();
    expect(screen.getByText(/目前沒有可讀取的記錄/)).toBeTruthy();
  });
});
