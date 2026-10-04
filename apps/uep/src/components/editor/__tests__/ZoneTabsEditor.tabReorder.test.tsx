/**
 * ZoneTabsEditor — 分頁本身的拖曳排序
 *
 * 分頁陣列順序即 History 前台分頁顯示順序；重排走 onZoneTabsChange，
 * 由編輯器標記 dirty 後隨一般存檔保存。選取中的分頁要跟著分頁本身移動，
 * 各分頁的章節清單不可錯位。
 */
import '@testing-library/jest-dom/vitest';
import {
  render,
  createEvent,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import ZoneTabsEditor, { type ZoneTab } from '../ZoneTabsEditor';

const PAGE_ID = 'zone-root';

function makeTabs(): ZoneTab[] {
  return ['甲', '乙', '丙'].map((name) => ({
    label: `分頁${name}`,
    items: [`page-${name}`],
  }));
}

function treeResponse() {
  const children = ['甲', '乙', '丙'].map((name, i) => ({
    id: `page-${name}`,
    title: `章節${name}`,
    slug: name,
    sortOrder: i,
    pageType: 'section',
    metadata: {},
    children: [],
  }));
  return {
    ok: true,
    data: [
      {
        id: PAGE_ID,
        title: 'History',
        slug: 'history',
        sortOrder: 0,
        pageType: 'zone',
        metadata: {},
        children,
      },
    ],
  };
}

function fakeDataTransfer() {
  return {
    effectAllowed: 'all',
    dropEffect: 'none',
    setData: vi.fn(),
    getData: vi.fn(),
    setDragImage: vi.fn(),
  };
}

function tabs(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('.ned-zone-tab-drag')
  );
}

/** 每個分頁寬 100px 並排，供左右半邊判定 */
function mockTabRects() {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      const i = tabs().indexOf(this);
      const left = i < 0 ? 0 : i * 100;
      return {
        left,
        right: left + 100,
        top: 0,
        bottom: 30,
        width: 100,
        height: 30,
        x: left,
        y: 0,
        toJSON: () => ({}),
      } as DOMRect;
    }
  );
}

/** jsdom 沒有 DragEvent，clientX 不會從 init 帶入，需手動掛上 */
function fireDrag(
  type: 'dragStart' | 'dragOver' | 'drop' | 'dragEnd',
  el: HTMLElement,
  dataTransfer: ReturnType<typeof fakeDataTransfer>,
  clientX: number
) {
  const ev = createEvent[type](el, { dataTransfer });
  Object.defineProperty(ev, 'clientX', { value: clientX });
  fireEvent(el, ev);
  return ev;
}

/** 把第 from 個分頁拖到第 to 個分頁的左／右半邊 */
function dragTab(from: number, to: number, side: 'before' | 'after') {
  const dataTransfer = fakeDataTransfer();
  const clientX = to * 100 + (side === 'before' ? 20 : 80);
  const src = tabs()[from];
  fireDrag('dragStart', src, dataTransfer, from * 100 + 50);
  fireDrag('dragOver', tabs()[to], dataTransfer, clientX);
  const drop = fireDrag('drop', tabs()[to], dataTransfer, clientX);
  fireDrag('dragEnd', src, dataTransfer, clientX);
  return { dataTransfer, drop };
}

async function setup() {
  const onChange = vi.fn<(tabs: ZoneTab[]) => void>();
  function Harness() {
    const [zoneTabs, setZoneTabs] = useState<ZoneTab[]>(makeTabs);
    return (
      <ZoneTabsEditor
        area="history"
        apiBase=""
        pageId={PAGE_ID}
        accent="#b08a3e"
        zoneTabs={zoneTabs}
        onZoneTabsChange={(next) => {
          onChange(next);
          setZoneTabs(next);
        }}
      />
    );
  }
  render(<Harness />);
  await waitFor(() => expect(tabs()).toHaveLength(3));
  return { onChange, lastTabs: () => onChange.mock.calls.at(-1)![0] };
}

/** 分頁標籤文字（排除選取中分頁的 × 移除鈕） */
const labelOf = (btn: Element) => btn.firstChild!.textContent;
const tabLabels = () =>
  tabs().map((t) => labelOf(t.querySelector('.ned-zone-tab-btn')!));
const activeLabel = () =>
  labelOf(document.querySelector('.ned-zone-tab-btn.is-active')!);
const itemTitles = () =>
  Array.from(document.querySelectorAll('.ned-zone-tab-item-title')).map(
    (el) => el.textContent
  );

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => treeResponse() }))
  );
  mockTabRects();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('ZoneTabsEditor — 分頁拖曳排序', () => {
  it('往右拖到最後：順序正確、章節清單隨分頁移動、走 onZoneTabsChange', async () => {
    const { onChange, lastTabs } = await setup();
    const { dataTransfer, drop } = dragTab(0, 2, 'after');

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(lastTabs()).toEqual([
      { label: '分頁乙', items: ['page-乙'] },
      { label: '分頁丙', items: ['page-丙'] },
      { label: '分頁甲', items: ['page-甲'] },
    ]);
    expect(tabLabels()).toEqual(['分頁乙', '分頁丙', '分頁甲']);
    // Firefox 需要 setData 才會啟動拖曳；drop 要擋預設行為
    expect(dataTransfer.setData).toHaveBeenCalled();
    expect(drop.defaultPrevented).toBe(true);
  });

  it('往左拖到最前（左半邊）', async () => {
    const { lastTabs } = await setup();
    dragTab(2, 0, 'before');
    expect(lastTabs().map((t) => t.label)).toEqual([
      '分頁丙',
      '分頁甲',
      '分頁乙',
    ]);
  });

  it('選取中的分頁重排後仍被選取（含被擠動的非拖曳分頁）', async () => {
    await setup();
    fireEvent.click(tabs()[1].querySelector('.ned-zone-tab-btn')!);
    expect(activeLabel()).toBe('分頁乙');
    await waitFor(() => expect(itemTitles()).toEqual(['章節乙']));

    // 拖曳別的分頁（丙 → 最前），乙被往右擠
    dragTab(2, 0, 'before');
    expect(tabLabels()).toEqual(['分頁丙', '分頁甲', '分頁乙']);
    expect(activeLabel()).toBe('分頁乙');
    expect(itemTitles()).toEqual(['章節乙']);

    // 拖曳選取中的分頁本身（乙 → 最前）
    dragTab(2, 0, 'before');
    expect(tabLabels()).toEqual(['分頁乙', '分頁丙', '分頁甲']);
    expect(activeLabel()).toBe('分頁乙');
    expect(itemTitles()).toEqual(['章節乙']);
  });

  it('放回原位不觸發資料變更', async () => {
    const { onChange } = await setup();
    dragTab(1, 1, 'after');
    dragTab(1, 2, 'before');
    dragTab(1, 0, 'after');
    expect(onChange).not.toHaveBeenCalled();
    expect(tabLabels()).toEqual(['分頁甲', '分頁乙', '分頁丙']);
  });

  it('章節列的拖曳不會被當成分頁重排', async () => {
    const { onChange } = await setup();
    await waitFor(() => expect(itemTitles()).toEqual(['章節甲']));
    const row = document.querySelector<HTMLElement>('.ned-zone-tab-item')!;
    const dataTransfer = fakeDataTransfer();
    fireDrag('dragStart', row, dataTransfer, 10);
    fireDrag('dragOver', tabs()[2], dataTransfer, 280);
    fireDrag('drop', tabs()[2], dataTransfer, 280);
    fireDrag('dragEnd', row, dataTransfer, 280);
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('ZoneTabsEditor — 分頁內章節列拖曳排序', () => {
  /** 單一分頁內含三個章節 */
  async function setupItems() {
    const onChange = vi.fn<(tabs: ZoneTab[]) => void>();
    function Harness() {
      const [zoneTabs, setZoneTabs] = useState<ZoneTab[]>([
        { label: '分頁甲', items: ['page-甲', 'page-乙', 'page-丙'] },
      ]);
      return (
        <ZoneTabsEditor
          area="history"
          apiBase=""
          pageId={PAGE_ID}
          accent="#b08a3e"
          zoneTabs={zoneTabs}
          onZoneTabsChange={(next) => {
            onChange(next);
            setZoneTabs(next);
          }}
        />
      );
    }
    render(<Harness />);
    await waitFor(() =>
      expect(itemTitles()).toEqual(['章節甲', '章節乙', '章節丙'])
    );
    return onChange;
  }

  const rows = () =>
    Array.from(document.querySelectorAll<HTMLElement>('.ned-zone-tab-item'));

  function dragRow(from: number, to: number) {
    const dataTransfer = fakeDataTransfer();
    const src = rows()[from];
    fireDrag('dragStart', src, dataTransfer, 0);
    fireDrag('dragOver', rows()[to], dataTransfer, 0);
    const drop = fireDrag('drop', rows()[to], dataTransfer, 0);
    fireDrag('dragEnd', src, dataTransfer, 0);
    return { dataTransfer, drop };
  }

  it('拖到目標列位置：順序正確，以 setData 起手且 drop 擋預設行為', async () => {
    const onChange = await setupItems();
    const { dataTransfer, drop } = dragRow(0, 2);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0][0].items).toEqual([
      'page-乙',
      'page-丙',
      'page-甲',
    ]);
    expect(itemTitles()).toEqual(['章節乙', '章節丙', '章節甲']);
    expect(dataTransfer.setData).toHaveBeenCalledWith('text/plain', '0');
    expect(drop.defaultPrevented).toBe(true);
  });

  it('往上拖', async () => {
    const onChange = await setupItems();
    dragRow(2, 0);
    expect(onChange.mock.calls[0][0][0].items).toEqual([
      'page-丙',
      'page-甲',
      'page-乙',
    ]);
  });

  it('is-dragging 延到下一幀才套，拖曳結束後清除', async () => {
    await setupItems();
    const dataTransfer = fakeDataTransfer();
    const src = rows()[1];
    fireDrag('dragStart', src, dataTransfer, 0);
    expect(src).not.toHaveClass('is-dragging');
    await waitFor(() => expect(rows()[1]).toHaveClass('is-dragging'));
    fireDrag('dragEnd', src, dataTransfer, 0);
    await waitFor(() => expect(rows()[1]).not.toHaveClass('is-dragging'));
  });

  it('放回原位或分頁拖到章節列上不觸發資料變更', async () => {
    const onChange = await setupItems();
    dragRow(1, 1);
    // 分頁本身的拖曳經過章節列，不得被當成章節重排
    const dataTransfer = fakeDataTransfer();
    fireDrag('dragStart', tabs()[0], dataTransfer, 50);
    const over = fireDrag('dragOver', rows()[2], dataTransfer, 0);
    fireDrag('drop', rows()[2], dataTransfer, 0);
    fireDrag('dragEnd', tabs()[0], dataTransfer, 0);
    expect(over.defaultPrevented).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});
