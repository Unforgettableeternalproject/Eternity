/**
 * ConceptsEditorBody — Dossier 群組改名／刪除時的 revision 引用同步
 *
 * revision 的 `patch.set.group` 以 label 指向同分類內的群組；群組沒有
 * 穩定 id，改名與刪除必須把指向它的值一併改寫，否則條目會回到原群組。
 * 改名時改寫的是「開始輸入當下指向這個群組的那一批 revision」，每次按鍵
 * 都與 label 一起寫回——輸入途中存檔，內容也是自洽的。
 */
import '@testing-library/jest-dom/vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { DossierContent, DossierGroup } from '../../concepts/types';
import ConceptsEditorBody, {
  serializeConceptsContent,
  type ConceptsEditorData,
} from '../ConceptsEditorBody';

function movedTo(label: string) {
  return [
    {
      id: 'r1',
      gate: { requiresFlags: ['f:1'] },
      patch: { set: { group: label, name: '改名後' } },
    },
  ];
}

function makeData(groups: DossierGroup[]): DossierContent {
  return {
    variants: [
      {
        id: 'u',
        label: 'U',
        subcategories: [
          { label: '三區', groups },
          {
            label: '五區',
            groups: [
              { label: '', entries: [] },
              {
                label: '舊會議',
                entries: [{ name: '他區條目', revisions: movedTo('舊會議') }],
              },
            ],
          },
        ],
      },
    ],
  };
}

function setup(groups: DossierGroup[]) {
  const onDataChange = vi.fn<(d: ConceptsEditorData) => void>();
  render(
    <ConceptsEditorBody
      accent="#2d6a4f"
      stackStyle="dossier"
      initialData={{
        stackStyle: 'dossier',
        contentBlockType: 'dossier',
        data: makeData(groups),
      }}
      onDataChange={onDataChange}
      onDirty={vi.fn()}
    />
  );
  const lastSubcats = () =>
    (onDataChange.mock.calls.at(-1)![0].data as DossierContent).variants[0]
      .subcategories;
  return { lastSubcats, onDataChange };
}

/** 點左側第 gi 個群組，右側面板切到群組設定 */
function selectGroup(gi: number) {
  const folders = document.querySelectorAll<HTMLElement>('.ced-browser-folder');
  fireEvent.click(folders[gi]);
}

function groupNameInput(): HTMLInputElement {
  const label = Array.from(document.querySelectorAll('.ced-label')).find(
    (el) => el.textContent === '群組名稱'
  )!;
  return label.parentElement!.querySelector('input')!;
}

/** 聚焦名稱輸入框、依序輸入各個中間值，最後失焦提交 */
function rename(...values: string[]) {
  const input = groupNameInput();
  fireEvent.focus(input);
  for (const value of values) {
    fireEvent.change(groupNameInput(), { target: { value } });
  }
  fireEvent.blur(groupNameInput());
}

function groupRefs(groups: DossierGroup[]) {
  return groups.flatMap((g) =>
    g.entries.flatMap((e) =>
      (e.revisions ?? []).map((r) => [e.name, r.patch.set?.group])
    )
  );
}

const confirm = vi.fn();

beforeEach(() => {
  confirm.mockReset().mockResolvedValue(true);
  (
    window as unknown as { __uepDialogManager: { confirm: typeof confirm } }
  ).__uepDialogManager = { confirm };
});

describe('ConceptsEditorBody — Dossier 群組引用同步', () => {
  const groups = (): DossierGroup[] => [
    { label: '', entries: [{ name: '預設條目', revisions: movedTo('') }] },
    {
      label: '無組織',
      entries: [
        { name: '凱奇', revisions: movedTo('舊會議') },
        { name: '路人', revisions: movedTo('無組織') },
      ],
    },
    { label: '舊會議', entries: [{ name: '議長' }] },
  ];

  it('改名：同分類內指向舊 label 的 set.group 跟著改，其他引用與他區不動', () => {
    const { lastSubcats } = setup(groups());
    selectGroup(2);
    rename('新會議');

    const [subcat, other] = lastSubcats();
    expect(subcat.groups.map((g) => g.label)).toEqual(['', '無組織', '新會議']);
    expect(groupRefs(subcat.groups)).toEqual([
      ['預設條目', ''],
      ['凱奇', '新會議'],
      ['路人', '無組織'],
    ]);
    // patch 的其他欄位原樣保留
    expect(subcat.groups[1].entries[0].revisions![0].patch.set).toEqual({
      group: '新會議',
      name: '改名後',
    });
    expect(groupRefs(other.groups)).toEqual([['他區條目', '舊會議']]);
  });

  it('改名：預設群組取名後，以空字串指向它的引用維持空字串', () => {
    const { lastSubcats } = setup(groups());
    selectGroup(0);
    rename('未分類');

    const [subcat] = lastSubcats();
    expect(subcat.groups[0].label).toBe('未分類');
    expect(groupRefs(subcat.groups)[0]).toEqual(['預設條目', '']);
  });

  it('改名後不失焦就存檔：送出的內容中 label 與引用都是新名稱', () => {
    const { onDataChange } = setup(groups());
    selectGroup(2);
    fireEvent.focus(groupNameInput());
    for (const value of ['舊會', '新', '新會議']) {
      fireEvent.change(groupNameInput(), { target: { value } });
    }

    // 鍵盤存檔序列化的就是最後一次 onDataChange 交出去的資料
    const [block] = serializeConceptsContent(
      onDataChange.mock.calls.at(-1)![0]
    );
    const saved = (JSON.parse(block.content) as DossierContent).variants[0]
      .subcategories[0];
    expect(saved.groups[2].label).toBe('新會議');
    expect(groupRefs(saved.groups)).toEqual([
      ['預設條目', ''],
      ['凱奇', '新會議'],
      ['路人', '無組織'],
    ]);
  });

  it('改名：輸入途中每一步的 label 與引用都對得上', () => {
    const { lastSubcats } = setup(groups());
    selectGroup(2);
    fireEvent.focus(groupNameInput());
    // [輸入值, 凱奇的引用]：清空或撞名時引用留在開始時的名稱
    const steps: [string, string][] = [
      ['舊會', '舊會'],
      ['', '舊會議'],
      ['無組織', '舊會議'],
      ['無組織分部', '無組織分部'],
    ];
    for (const [value, ref] of steps) {
      fireEvent.change(groupNameInput(), { target: { value } });
      const [subcat] = lastSubcats();
      expect(subcat.groups[2].label).toBe(value);
      expect(groupRefs(subcat.groups)[1]).toEqual(['凱奇', ref]);
      expect(groupRefs(subcat.groups)[2]).toEqual(['路人', '無組織']);
    }
  });

  it('改名：失焦後再改名，以當時的名稱重新認引用', () => {
    const { lastSubcats } = setup(groups());
    selectGroup(2);
    rename('新會議');
    rename('更新的會議');
    expect(groupRefs(lastSubcats()[0].groups)[1]).toEqual([
      '凱奇',
      '更新的會議',
    ]);
  });

  it('改名：原本就指向不存在名稱的引用，不會因為途中經過那個名稱被帶走', () => {
    const data = groups();
    data[1].entries.push({ name: '懸空', revisions: movedTo('新') });
    const { lastSubcats } = setup(data);
    selectGroup(2);
    rename('新', '新會議');

    expect(groupRefs(lastSubcats()[0].groups)).toEqual([
      ['預設條目', ''],
      ['凱奇', '新會議'],
      ['路人', '無組織'],
      ['懸空', '新'],
    ]);
  });

  it('改名：一般群組清空名稱後失焦，引用維持指向舊名稱', () => {
    const { lastSubcats } = setup(groups());
    selectGroup(2);
    rename('舊會', '舊', '');

    const [subcat] = lastSubcats();
    expect(subcat.groups[2].label).toBe('');
    expect(groupRefs(subcat.groups)[1]).toEqual(['凱奇', '舊會議']);
  });

  it('改名：名稱刪光再重打（同一次輸入），引用指向新名稱', () => {
    const { lastSubcats } = setup(groups());
    selectGroup(2);
    rename('舊會', '舊', '', '新', '新會議');

    const [subcat] = lastSubcats();
    expect(subcat.groups[2].label).toBe('新會議');
    expect(groupRefs(subcat.groups)[1]).toEqual(['凱奇', '新會議']);
  });

  it('改名：輸入途中經過另一群組的名稱，最後停在新名稱 → 只有自己的引用跟著改', () => {
    const { lastSubcats } = setup(groups());
    selectGroup(2);
    rename('', '無', '無組織', '無組織分部');

    const [subcat] = lastSubcats();
    expect(subcat.groups.map((g) => g.label)).toEqual([
      '',
      '無組織',
      '無組織分部',
    ]);
    expect(groupRefs(subcat.groups)).toEqual([
      ['預設條目', ''],
      ['凱奇', '無組織分部'],
      ['路人', '無組織'],
    ]);
  });

  it('改名：失焦時與既有群組同名 → 引用不變', () => {
    const { lastSubcats } = setup(groups());
    selectGroup(2);
    rename('無組織');

    const [subcat] = lastSubcats();
    expect(subcat.groups.map((g) => g.label)).toEqual(['', '無組織', '無組織']);
    expect(groupRefs(subcat.groups)).toEqual([
      ['預設條目', ''],
      ['凱奇', '舊會議'],
      ['路人', '無組織'],
    ]);
  });

  it('刪除有條目的群組：條目併入預設群組，引用改指預設群組 label', async () => {
    const { lastSubcats } = setup(groups());
    selectGroup(2);
    fireEvent.click(
      Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === '刪除群組'
      )!
    );
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    await waitFor(() =>
      expect(lastSubcats()[0].groups.map((g) => g.label)).toEqual([
        '',
        '無組織',
      ])
    );

    const [subcat] = lastSubcats();
    expect(subcat.groups[0].entries.map((e) => e.name)).toEqual([
      '預設條目',
      '議長',
    ]);
    expect(groupRefs(subcat.groups)).toEqual([
      ['預設條目', ''],
      ['凱奇', ''],
      ['路人', '無組織'],
    ]);
  });

  it('刪除空群組：引用改指具名預設群組的 label', async () => {
    const data = groups();
    data[0].label = '未分類';
    data[2].entries = [];
    const { lastSubcats } = setup(data);
    selectGroup(2);
    fireEvent.click(
      Array.from(document.querySelectorAll('button')).find(
        (b) => b.textContent === '刪除群組'
      )!
    );
    await waitFor(() => expect(lastSubcats()[0].groups).toHaveLength(2));

    expect(confirm).not.toHaveBeenCalled();
    expect(groupRefs(lastSubcats()[0].groups)[1]).toEqual(['凱奇', '未分類']);
  });

  it('同名群組：後面那個改名不動引用（引用解析到第一個）', () => {
    const data = groups();
    data.push({ label: '舊會議', entries: [] });
    const { lastSubcats } = setup(data);
    selectGroup(3);
    rename('另一個會議');

    const [subcat] = lastSubcats();
    expect(subcat.groups[3].label).toBe('另一個會議');
    expect(groupRefs(subcat.groups)[1]).toEqual(['凱奇', '舊會議']);
  });

  it('同名群組：第一個改名時引用跟著改', () => {
    const data = groups();
    data.push({ label: '舊會議', entries: [] });
    const { lastSubcats } = setup(data);
    selectGroup(2);
    rename('新會議');

    expect(groupRefs(lastSubcats()[0].groups)[1]).toEqual(['凱奇', '新會議']);
  });
});
