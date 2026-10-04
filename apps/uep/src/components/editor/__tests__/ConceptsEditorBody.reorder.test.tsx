/**
 * ConceptsEditorBody — 群組／區段／分類／表格列的拖曳排序
 *
 * 全部沿用分類 tab 的縫隙模型（beginRowDrag 起手、來源記在 ref、drop
 * preventDefault）。index 0 的預設群組／區段是位置語意（不可刪、承接被刪
 * 群組的條目），固定首位不參與排序。群組拖曳與「條目拖到群組上 = 移入」
 * 共用同一列，必須互不誤判。重排屬於頁面內容，走 onDataChange + onDirty。
 */
import '@testing-library/jest-dom/vitest';
import {
  render,
  createEvent,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { DiffContent, DossierContent } from '../../concepts/types';
import ConceptsEditorBody, {
  type ConceptsEditorData,
} from '../ConceptsEditorBody';

// ── 拖曳模擬 ────────────────────────────────────────────────

function fakeDataTransfer() {
  return {
    effectAllowed: 'all',
    dropEffect: 'none',
    setData: vi.fn(),
    getData: vi.fn(),
    setDragImage: vi.fn(),
  };
}
type FakeDT = ReturnType<typeof fakeDataTransfer>;

/** 每個元素依其在父層的序位排成 100×30 的格子（tab 橫向、列縱向皆可判定） */
function mockRects() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const siblings = this.parentElement
        ? Array.from(this.parentElement.children)
        : [];
      const i = Math.max(0, siblings.indexOf(this));
      return {
        left: i * 100,
        right: i * 100 + 100,
        top: i * 30,
        bottom: i * 30 + 30,
        width: 100,
        height: 30,
        x: i * 100,
        y: i * 30,
        toJSON: () => ({}),
      } as DOMRect;
    }
  );
}

/** jsdom 沒有 DragEvent，座標不會從 init 帶入，需手動掛上 */
function fireDrag(
  type: 'dragStart' | 'dragOver' | 'drop' | 'dragEnd',
  el: HTMLElement,
  dt: FakeDT,
  x = 0,
  y = 0
) {
  const ev = createEvent[type](el, { dataTransfer: dt });
  Object.defineProperty(ev, 'clientX', { value: x });
  Object.defineProperty(ev, 'clientY', { value: y });
  fireEvent(el, ev);
  return ev;
}

/** 目標元素前半或後半的座標 */
function point(el: HTMLElement, side: 'before' | 'after') {
  const r = el.getBoundingClientRect();
  const k = side === 'before' ? 0.2 : 0.8;
  return { x: r.left + r.width * k, y: r.top + r.height * k };
}

/** 從 source 起手拖到 target 的前／後半，回傳 drop 事件與 dataTransfer */
function drag(
  source: HTMLElement,
  target: HTMLElement,
  side: 'before' | 'after',
  rectOf: HTMLElement = target
) {
  const dt = fakeDataTransfer();
  const p = point(rectOf, side);
  fireDrag('dragStart', source, dt);
  const over = fireDrag('dragOver', target, dt, p.x, p.y);
  const drop = fireDrag('drop', target, dt, p.x, p.y);
  fireDrag('dragEnd', source, dt);
  return { dt, over, drop };
}

beforeEach(() => {
  mockRects();
  (
    window as unknown as {
      __uepDialogManager: { confirm: () => Promise<boolean> };
    }
  ).__uepDialogManager = { confirm: vi.fn().mockResolvedValue(true) };
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── Dossier ─────────────────────────────────────────────────

function dossierData(): DossierContent {
  return {
    variants: [
      {
        id: 'u',
        label: 'U',
        subcategories: [
          {
            label: '分類',
            groups: [
              { label: '', entries: [{ name: '預設-1' }] },
              {
                label: '甲',
                entries: [
                  { name: '甲-1', entityKey: 'k-甲1' },
                  { name: '甲-2' },
                  { name: '甲-3' },
                ],
              },
              { label: '乙', entries: [{ name: '乙-1', entityKey: 'k-乙1' }] },
              { label: '丙', entries: [{ name: '丙-1' }, { name: '丙-2' }] },
            ],
          },
        ],
      },
    ],
  };
}

function setupDossier() {
  const onDataChange = vi.fn<(d: ConceptsEditorData) => void>();
  const onDirty = vi.fn<(dirty: boolean) => void>();
  render(
    <ConceptsEditorBody
      accent="#2d6a4f"
      stackStyle="dossier"
      initialData={{
        stackStyle: 'dossier',
        contentBlockType: 'dossier',
        data: dossierData(),
      }}
      onDataChange={onDataChange}
      onDirty={onDirty}
    />
  );
  const groupsOut = () =>
    (onDataChange.mock.calls.at(-1)![0].data as DossierContent).variants[0]
      .subcategories[0].groups;
  return { onDataChange, onDirty, groupsOut };
}

const groupWraps = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.ced-browser-group'));
const folders = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.ced-browser-folder'));
const files = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.ced-browser-file'));
/**
 * 群組／區段拖曳：實際游標落在群組列（子元素）上，事件冒泡到包裝；
 * 座標以包裝的範圍計算
 */
const dragGroup = (from: number, to: number, side: 'before' | 'after') =>
  drag(folders()[from], folders()[to], side, groupWraps()[to]);
const folderNames = () =>
  folders().map(
    (f) => f.querySelector('.ced-browser-folder-name')!.textContent
  );

describe('Dossier 群組拖曳排序', () => {
  it('往前拖：順序正確、條目隨群組移動、標記 dirty，不被當成條目移入', () => {
    const { onDirty, groupsOut } = setupDossier();
    const { dt, drop } = dragGroup(3, 1, 'before');

    expect(dt.setData).toHaveBeenCalledWith('text/plain', '3');
    expect(drop.defaultPrevented).toBe(true);
    expect(folderNames()).toEqual(['(預設)', '丙', '甲', '乙']);
    const groups = groupsOut();
    expect(groups.map((g) => g.label)).toEqual(['', '丙', '甲', '乙']);
    expect(groups.map((g) => g.entries.map((e) => e.name))).toEqual([
      ['預設-1'],
      ['丙-1', '丙-2'],
      ['甲-1', '甲-2', '甲-3'],
      ['乙-1'],
    ]);
    expect(groups[3].entries[0].entityKey).toBe('k-乙1');
    expect(document.querySelector('.drag-over')).toBeNull();
    expect(onDirty).toHaveBeenLastCalledWith(true);
  });

  it('往後拖到最後（後半）', () => {
    const { groupsOut } = setupDossier();
    dragGroup(1, 3, 'after');
    expect(groupsOut().map((g) => g.label)).toEqual(['', '乙', '丙', '甲']);
  });

  it('預設群組不可拖，也不能被擠離首位', () => {
    const { groupsOut } = setupDossier();
    expect(folders()[0]).toHaveAttribute('draggable', 'false');
    expect(folders()[1]).toHaveAttribute('draggable', 'true');

    // 拖到預設群組前半：夾到預設群組之後
    dragGroup(2, 0, 'before');
    expect(groupsOut().map((g) => g.label)).toEqual(['', '乙', '甲', '丙']);
  });

  it('選取中的群組跟著移動（含被擠動的群組），條目選取不錯位', () => {
    setupDossier();
    fireEvent.click(folders()[1]); // 甲
    dragGroup(3, 1, 'before'); // 丙 → 甲之前
    expect(
      document.querySelector('.ced-browser-folder.active')!.textContent
    ).toContain('甲');
    // 展開的仍是甲的條目
    expect(files().map((f) => f.textContent)).toEqual([
      '◈甲-1✕',
      '◈甲-2✕',
      '◈甲-3✕',
    ]);

    // 拖曳選取中的群組本身
    dragGroup(2, 3, 'after');
    expect(folderNames()).toEqual(['(預設)', '丙', '乙', '甲']);
    expect(
      document.querySelector('.ced-browser-folder.active')!.textContent
    ).toContain('甲');
  });

  it('放回原位不觸發資料變更', () => {
    const { onDataChange } = setupDossier();
    onDataChange.mockClear();
    dragGroup(2, 2, 'before');
    dragGroup(2, 1, 'after');
    dragGroup(2, 3, 'before');
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe('Dossier 條目拖曳（beginRowDrag 起手）', () => {
  it('條目拖到其他群組 = 移入，不觸發群組排序', () => {
    const { groupsOut } = setupDossier();
    fireEvent.click(folders()[1]); // 展開甲
    const { dt, drop } = drag(files()[0], folders()[2], 'before');

    expect(dt.setData).toHaveBeenCalledWith('text/plain', '0');
    expect(drop.defaultPrevented).toBe(true);
    const groups = groupsOut();
    expect(groups.map((g) => g.label)).toEqual(['', '甲', '乙', '丙']);
    expect(groups[1].entries.map((e) => e.name)).toEqual(['甲-2', '甲-3']);
    expect(groups[2].entries.map((e) => e.name)).toEqual(['乙-1', '甲-1']);
    expect(groups[2].entries[1].entityKey).toBe('k-甲1');
  });

  it('同群組內排序，選取跟著條目走；放回原位不變更', async () => {
    const { onDataChange, groupsOut } = setupDossier();
    fireEvent.click(folders()[1]);
    fireEvent.click(files()[1]); // 選甲-2
    drag(files()[0], files()[2], 'before'); // 甲-1 → 第 3 位
    expect(groupsOut()[1].entries.map((e) => e.name)).toEqual([
      '甲-2',
      '甲-3',
      '甲-1',
    ]);
    await waitFor(() =>
      expect(
        document.querySelector('.ced-browser-file.active')!.textContent
      ).toContain('甲-2')
    );

    onDataChange.mockClear();
    drag(files()[1], files()[1], 'before');
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

// ── Diff ────────────────────────────────────────────────────

function diffData(): DiffContent {
  return {
    subcategories: ['甲', '乙', '丙'].map((n) => ({
      label: `分類${n}`,
      sections: [
        {
          label: '',
          valueLabels: ['英', '日'],
          entries: [
            { term: `${n}-A`, values: ['a', 'あ'] },
            { term: `${n}-B`, values: ['b', 'い'], hidden: true },
            { term: `${n}-C`, values: ['c', 'う'] },
          ],
        },
        { label: `${n}-區一`, entries: [{ term: `${n}-一`, values: ['1'] }] },
        { label: `${n}-區二`, entries: [{ term: `${n}-二`, values: ['2'] }] },
      ],
    })),
  };
}

function setupDiff() {
  const onDataChange = vi.fn<(d: ConceptsEditorData) => void>();
  const onDirty = vi.fn<(dirty: boolean) => void>();
  render(
    <ConceptsEditorBody
      accent="#2d6a4f"
      stackStyle="diff"
      initialData={{
        stackStyle: 'diff',
        contentBlockType: 'diff_table',
        data: diffData(),
      }}
      onDataChange={onDataChange}
      onDirty={onDirty}
    />
  );
  const out = () => onDataChange.mock.calls.at(-1)![0].data as DiffContent;
  return { onDataChange, onDirty, out };
}

const tabs = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.ced-tab'));
const tabLabels = () =>
  tabs().map((t) => t.querySelector('.ced-tab-btn')!.textContent);
const rows = () =>
  Array.from(
    document.querySelectorAll<HTMLElement>(
      '.ced-diff-trow:not(.ced-diff-thead)'
    )
  );
const grips = () =>
  Array.from(document.querySelectorAll<HTMLElement>('.ced-diff-trow-grip'));
const rowTerms = () =>
  rows().map((r) => (r.querySelector('input') as HTMLInputElement).value);

describe('Diff 分類 tab 拖曳排序', () => {
  it('順序正確、區段隨分類移動、選取跟著分類、dirty', () => {
    const { onDirty, out } = setupDiff();
    fireEvent.click(tabs()[1].querySelector('.ced-tab-btn')!); // 乙
    drag(tabs()[0], tabs()[2], 'after');

    expect(tabLabels()).toEqual(['分類乙', '分類丙', '分類甲']);
    const subcats = out().subcategories;
    for (const sc of subcats) {
      const n = sc.label.replace('分類', '');
      expect(sc.sections[1].label).toBe(`${n}-區一`);
      expect(sc.sections[0].entries[0].term).toBe(`${n}-A`);
    }
    expect(
      document.querySelector('.ced-tab.active .ced-tab-btn')!.textContent
    ).toBe('分類乙');
    expect(onDirty).toHaveBeenLastCalledWith(true);
  });

  it('放回原位不觸發資料變更', () => {
    const { onDataChange } = setupDiff();
    onDataChange.mockClear();
    drag(tabs()[1], tabs()[0], 'after');
    drag(tabs()[1], tabs()[2], 'before');
    expect(onDataChange).not.toHaveBeenCalled();
  });
});

describe('Diff 區段拖曳排序', () => {
  it('順序正確、預設區段固定首位、不被當成條目移入', () => {
    const { out, onDirty } = setupDiff();
    expect(folders()[0]).toHaveAttribute('draggable', 'false');
    dragGroup(2, 0, 'before');

    const sections = out().subcategories[0].sections;
    expect(sections.map((s) => s.label)).toEqual(['', '甲-區二', '甲-區一']);
    expect(sections.map((s) => s.entries.map((e) => e.term))).toEqual([
      ['甲-A', '甲-B', '甲-C'],
      ['甲-二'],
      ['甲-一'],
    ]);
    expect(document.querySelector('.drag-over')).toBeNull();
    expect(onDirty).toHaveBeenLastCalledWith(true);
  });

  it('選取中的區段跟著移動；放回原位不變更', () => {
    const { onDataChange } = setupDiff();
    fireEvent.click(folders()[1]); // 甲-區一
    dragGroup(1, 2, 'after');
    expect(
      document.querySelector('.ced-browser-folder.active')!.textContent
    ).toContain('甲-區一');
    expect(
      (
        document.querySelector(
          '.ced-browser-detail .ced-field-row .ced-input'
        ) as HTMLInputElement
      ).value
    ).toBe('甲-區一');

    onDataChange.mockClear();
    dragGroup(2, 2, 'after');
    dragGroup(2, 1, 'after');
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('條目拖到其他區段仍是移入', () => {
    const { out } = setupDiff();
    const { dt } = drag(files()[2], folders()[1], 'before'); // 甲-C → 區一
    expect(dt.setData).toHaveBeenCalledWith('text/plain', '2');
    const sections = out().subcategories[0].sections;
    expect(sections.map((s) => s.label)).toEqual(['', '甲-區一', '甲-區二']);
    expect(sections[1].entries.map((e) => e.term)).toEqual(['甲-一', '甲-C']);
  });
});

describe('Diff 表格列拖曳排序', () => {
  it('grip 起手、順序正確、整列資料隨列移動、dirty', () => {
    const { out, onDirty } = setupDiff();
    expect(rowTerms()).toEqual(['甲-A', '甲-B', '甲-C']);
    // 輸入框本身不可拖
    expect(rows()[0]).not.toHaveAttribute('draggable');

    const { dt, drop } = drag(grips()[0], rows()[2], 'after');
    expect(dt.setData).toHaveBeenCalledWith('text/plain', '0');
    // 擋下預設行為，避免 text/plain 被插進輸入框
    expect(drop.defaultPrevented).toBe(true);
    expect(rowTerms()).toEqual(['甲-B', '甲-C', '甲-A']);
    const entries = out().subcategories[0].sections[0].entries;
    expect(entries).toEqual([
      { term: '甲-B', values: ['b', 'い'], hidden: true },
      { term: '甲-C', values: ['c', 'う'] },
      { term: '甲-A', values: ['a', 'あ'] },
    ]);
    expect(onDirty).toHaveBeenLastCalledWith(true);
  });

  it('選取中的詞條跟著移動', () => {
    setupDiff();
    // 開 ⚙ 選甲-C，再回到表格
    fireEvent.click(rows()[2].querySelector('.ced-diff-trow-btn')!);
    fireEvent.click(
      document.querySelector('.ced-browser-detail .ced-add-btn')!
    );
    expect(rows()[2]).toHaveClass('active');

    drag(grips()[2], rows()[0], 'before');
    expect(rowTerms()).toEqual(['甲-C', '甲-A', '甲-B']);
    expect(rows()[0]).toHaveClass('active');
    expect(rows()[2]).not.toHaveClass('active');
  });

  it('放回原位不觸發資料變更', () => {
    const { onDataChange } = setupDiff();
    onDataChange.mockClear();
    drag(grips()[1], rows()[1], 'after');
    drag(grips()[1], rows()[0], 'after');
    drag(grips()[1], rows()[2], 'before');
    expect(onDataChange).not.toHaveBeenCalled();
  });

  it('側邊清單同區段排序沿用同一套移動邏輯', () => {
    const { out, onDataChange } = setupDiff();
    drag(files()[0], files()[2], 'before');
    expect(
      out().subcategories[0].sections[0].entries.map((e) => e.term)
    ).toEqual(['甲-B', '甲-C', '甲-A']);
    onDataChange.mockClear();
    drag(files()[1], files()[1], 'before');
    expect(onDataChange).not.toHaveBeenCalled();
  });
});
