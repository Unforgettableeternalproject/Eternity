/**
 * ConceptsEditorBody — Dossier 分類 tab 拖曳排序
 *
 * 分類是 variant 內 subcategories 陣列，群組與條目巢狀在分類物件裡，
 * 重排只動陣列順序；排序屬於頁面內容，走 onDataChange + onDirty，
 * 隨既有存檔流程保存。選取中的分類要跟著分類本身移動。
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

import type { DossierContent } from '../../concepts/types';
import ConceptsEditorBody, {
  type ConceptsEditorData,
} from '../ConceptsEditorBody';

function makeData(): DossierContent {
  return {
    variants: [
      {
        id: 'u',
        label: 'U',
        subcategories: ['甲', '乙', '丙'].map((name) => ({
          label: `分類${name}`,
          groups: [
            { label: '', entries: [{ name: `${name}-預設條目` }] },
            {
              label: `${name}-群組`,
              entries: [{ name: `${name}-群組條目`, entityKey: `key-${name}` }],
            },
          ],
        })),
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
  return Array.from(document.querySelectorAll<HTMLElement>('.ced-tab'));
}

/** 每個 tab 寬 100px 並排，供左右半邊判定 */
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
}

/** 把第 from 個 tab 拖到第 to 個 tab 的左／右半邊 */
function dragTab(from: number, to: number, side: 'before' | 'after') {
  const dataTransfer = fakeDataTransfer();
  const clientX = to * 100 + (side === 'before' ? 20 : 80);
  const src = tabs()[from];
  fireDrag('dragStart', src, dataTransfer, from * 100 + 50);
  fireDrag('dragOver', tabs()[to], dataTransfer, clientX);
  fireDrag('drop', tabs()[to], dataTransfer, clientX);
  fireDrag('dragEnd', src, dataTransfer, clientX);
}

function setup() {
  const onDataChange = vi.fn<(d: ConceptsEditorData) => void>();
  const onDirty = vi.fn<(dirty: boolean) => void>();
  render(
    <ConceptsEditorBody
      accent="#2d6a4f"
      stackStyle="dossier"
      initialData={{
        stackStyle: 'dossier',
        contentBlockType: 'dossier',
        data: makeData(),
      }}
      onDataChange={onDataChange}
      onDirty={onDirty}
    />
  );
  const lastData = () =>
    onDataChange.mock.calls.at(-1)![0].data as DossierContent;
  return { onDataChange, onDirty, lastData };
}

const tabLabels = () =>
  tabs().map((t) => t.querySelector('.ced-tab-btn')!.textContent);
const activeLabel = () =>
  document.querySelector('.ced-tab.active .ced-tab-btn')!.textContent;

beforeEach(() => {
  mockTabRects();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConceptsEditorBody — Dossier 分類 tab 拖曳排序', () => {
  it('往右拖到最後：順序正確、群組與條目隨分類移動、標記 dirty', () => {
    const { onDirty, lastData } = setup();
    dragTab(0, 2, 'after');

    expect(tabLabels()).toEqual(['分類乙', '分類丙', '分類甲']);
    const subcats = lastData().variants[0].subcategories;
    expect(subcats.map((s) => s.label)).toEqual(['分類乙', '分類丙', '分類甲']);
    // 引用不錯位：每個分類底下仍是自己的群組與條目
    for (const sc of subcats) {
      const name = sc.label.replace('分類', '');
      expect(sc.groups[0].entries[0].name).toBe(`${name}-預設條目`);
      expect(sc.groups[1].label).toBe(`${name}-群組`);
      expect(sc.groups[1].entries[0].entityKey).toBe(`key-${name}`);
    }
    expect(onDirty).toHaveBeenLastCalledWith(true);
  });

  it('往左拖到最前（左半邊）', () => {
    const { lastData } = setup();
    dragTab(2, 0, 'before');
    expect(lastData().variants[0].subcategories.map((s) => s.label)).toEqual([
      '分類丙',
      '分類甲',
      '分類乙',
    ]);
  });

  it('選取中的分類重排後仍被選取（含被擠動的非拖曳分類）', async () => {
    setup();
    // 選分類乙並打開其第二個群組
    fireEvent.click(tabs()[1].querySelector('.ced-tab-btn')!);
    fireEvent.click(document.querySelectorAll('.ced-browser-folder')[1]);
    expect(activeLabel()).toBe('分類乙');

    // 拖曳別的分類（丙 → 最前），乙被往右擠
    dragTab(2, 0, 'before');
    expect(tabLabels()).toEqual(['分類丙', '分類甲', '分類乙']);
    expect(activeLabel()).toBe('分類乙');
    expect(
      (document.querySelector('.ced-field-row .ced-input') as HTMLInputElement)
        .value
    ).toBe('分類乙');

    // 拖曳選取中的分類本身（乙 → 最前）
    dragTab(2, 0, 'before');
    await waitFor(() => expect(activeLabel()).toBe('分類乙'));
    expect(tabLabels()).toEqual(['分類乙', '分類丙', '分類甲']);
    // 群組選取跟著同一個分類保留
    expect(
      document.querySelector('.ced-browser-folder.active')!.textContent
    ).toContain('乙-群組');
  });

  it('放回原位不觸發資料變更', () => {
    const { onDataChange } = setup();
    onDataChange.mockClear();
    dragTab(1, 1, 'after');
    dragTab(1, 2, 'before');
    expect(onDataChange).not.toHaveBeenCalled();
    expect(tabLabels()).toEqual(['分類甲', '分類乙', '分類丙']);
  });

  it('只動目前 variant，其他 variant 不受影響', () => {
    const onDataChange = vi.fn<(d: ConceptsEditorData) => void>();
    const data = makeData();
    data.variants.push({
      id: 'e',
      label: 'E',
      subcategories: [
        { label: 'E一', groups: [{ label: '', entries: [] }] },
        { label: 'E二', groups: [{ label: '', entries: [] }] },
      ],
    });
    render(
      <ConceptsEditorBody
        accent="#2d6a4f"
        stackStyle="dossier"
        initialData={{
          stackStyle: 'dossier',
          contentBlockType: 'dossier',
          data,
        }}
        onDataChange={onDataChange}
        onDirty={vi.fn()}
      />
    );
    dragTab(0, 1, 'after');
    const out = onDataChange.mock.calls.at(-1)![0].data as DossierContent;
    expect(out.variants[0].subcategories.map((s) => s.label)).toEqual([
      '分類乙',
      '分類甲',
      '分類丙',
    ]);
    expect(out.variants[1].subcategories.map((s) => s.label)).toEqual([
      'E一',
      'E二',
    ]);
  });
});
