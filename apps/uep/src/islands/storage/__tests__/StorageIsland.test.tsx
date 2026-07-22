/**
 * StorageIsland 元件測試（S9-A.2）
 *
 * 驗證：pool 便條列表（排序/最新放大）+ inline 編輯 + 島內局部刪除確認
 * + cap 邊界 + 輸入驗證 + 當前位置條。
 *
 * progressStore 是 module singleton：vi.resetModules 取全新實例；
 * 沒有 audio/tree 依賴，測試較單純。
 */
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StorageIsland from '../StorageIsland';

async function freshStore() {
  vi.resetModules();
  // 重新載入 progressStore 前先清 localStorage 與 window bridge
  return await import('../../../progress/progressStore');
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  delete window.__uepProgress;
  delete window.__uepStoragePins;
  window.history.replaceState({}, '', '/history');
  document.title = '歷史典藏庫 - 邊際世界';
});

afterEach(() => {
  cleanup();
});

describe('位置條', () => {
  it('顯示當前 zone 中文名 + 頁面標籤（去除 邊際世界 尾）', async () => {
    await freshStore();
    const { container } = render(<StorageIsland />);
    // 位置條顯示 zone 中文名
    const label = container.querySelector('.uep-stoland__location-label');
    expect(label?.textContent).toBe('歷史典藏庫');
    // 頁面標籤去掉「 - 邊際世界」尾
    const page = container.querySelector('.uep-stoland__location-page');
    expect(page?.textContent).toBe('歷史典藏庫');
  });

  it('非浮島 zone 顯示「起始頁」', async () => {
    window.history.replaceState({}, '', '/');
    document.title = '';
    await freshStore();
    render(<StorageIsland />);
    expect(screen.getByText('起始頁')).toBeInTheDocument();
  });
});

describe('空狀態', () => {
  it('無便條顯示提示', async () => {
    await freshStore();
    render(<StorageIsland />);
    expect(screen.getByText('還沒寫下任何東西。')).toBeInTheDocument();
  });

  it('計數 0 / 30', async () => {
    await freshStore();
    render(<StorageIsland />);
    expect(screen.getByText('0 / 30')).toBeInTheDocument();
  });
});

describe('新增便條', () => {
  it('輸入 + 貼上按鈕新增便條', async () => {
    const { uepProgress } = await freshStore();
    render(<StorageIsland />);
    const input = screen.getByLabelText('新增便條') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '測試便條' } });
    fireEvent.click(screen.getByText('+ 貼上'));
    expect(uepProgress.getState().storageNotes).toHaveLength(1);
    expect(uepProgress.getState().storageNotes[0].text).toBe('測試便條');
    // 輸入框清空
    expect(input.value).toBe('');
  });

  it('trim 後為空的輸入無法新增', async () => {
    const { uepProgress } = await freshStore();
    render(<StorageIsland />);
    const input = screen.getByLabelText('新增便條') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    // 按鈕應該 disabled
    expect(screen.getByText('+ 貼上')).toBeDisabled();
    expect(uepProgress.getState().storageNotes).toHaveLength(0);
  });

  it('Enter 送出表單', async () => {
    const { uepProgress } = await freshStore();
    const { container } = render(<StorageIsland />);
    const input = screen.getByLabelText('新增便條');
    fireEvent.change(input, { target: { value: 'Enter 送出' } });
    const form = container.querySelector('form.uep-stoland__form')!;
    fireEvent.submit(form);
    expect(uepProgress.getState().storageNotes).toHaveLength(1);
  });
});

describe('排序與最新放大', () => {
  it('updatedAt desc 排序，最新排最上並帶 is-latest class', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.addStorageNote('第一張');
    // 手動間隔避免同一 ms 產生順序不穩
    await new Promise((r) => setTimeout(r, 5));
    uepProgress.addStorageNote('第二張');
    await new Promise((r) => setTimeout(r, 5));
    uepProgress.addStorageNote('第三張');

    const { container } = render(<StorageIsland />);
    const notes = container.querySelectorAll('.uep-stoland__note');
    expect(notes).toHaveLength(3);
    // 第一個應該是最新（第三張）
    expect(notes[0].textContent).toContain('第三張');
    expect(notes[0].classList.contains('is-latest')).toBe(true);
    // 後面兩張沒有 is-latest
    expect(notes[1].classList.contains('is-latest')).toBe(false);
    expect(notes[2].classList.contains('is-latest')).toBe(false);
  });

  it('編輯後該便條 updatedAt 更新，重新排到最上', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.addStorageNote('A');
    await new Promise((r) => setTimeout(r, 5));
    uepProgress.addStorageNote('B');
    await new Promise((r) => setTimeout(r, 5));
    uepProgress.addStorageNote('C');
    // 現在順序：C, B, A（最新→最舊）

    // 編輯 A 讓它到最上
    await new Promise((r) => setTimeout(r, 5));
    const aNote = uepProgress
      .getState()
      .storageNotes.find((n) => n.text === 'A')!;
    uepProgress.updateStorageNote(aNote.id, 'A 已編輯');

    const { container } = render(<StorageIsland />);
    const notes = container.querySelectorAll('.uep-stoland__note');
    expect(notes[0].textContent).toContain('A 已編輯');
  });
});

describe('inline 編輯', () => {
  it('點便條 → 進入編輯 textarea，Enter 儲存', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.addStorageNote('原文');
    render(<StorageIsland />);

    // 點便條進入編輯
    fireEvent.click(screen.getByText('原文'));

    const textarea = screen.getByLabelText('編輯便條') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '新文' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(uepProgress.getState().storageNotes[0].text).toBe('新文');
  });

  it('Esc 取消編輯，內容不變', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.addStorageNote('原文');
    render(<StorageIsland />);

    fireEvent.click(screen.getByText('原文'));
    const textarea = screen.getByLabelText('編輯便條');
    fireEvent.change(textarea, { target: { value: '半路取消' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(uepProgress.getState().storageNotes[0].text).toBe('原文');
  });

  it('編輯後 trim 為空 → 不觸發更新（改用刪除）', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.addStorageNote('原文');
    render(<StorageIsland />);

    fireEvent.click(screen.getByText('原文'));
    const textarea = screen.getByLabelText('編輯便條');
    fireEvent.change(textarea, { target: { value: '   ' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(uepProgress.getState().storageNotes[0].text).toBe('原文');
  });
});

describe('刪除確認', () => {
  it('點 × → 展開島內確認 UI（不觸發全螢幕 dialog）', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.addStorageNote('待刪除');
    render(<StorageIsland />);

    fireEvent.click(screen.getByLabelText('刪除便條'));
    // 確認 UI 出現
    expect(screen.getByText('刪除這張便條？')).toBeInTheDocument();
    expect(screen.getByText('刪除')).toBeInTheDocument();
    expect(screen.getByText('取消')).toBeInTheDocument();
    // 資料層還沒動
    expect(uepProgress.getState().storageNotes).toHaveLength(1);
  });

  it('確認刪除 → 便條被移除', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.addStorageNote('待刪除');
    render(<StorageIsland />);

    fireEvent.click(screen.getByLabelText('刪除便條'));
    fireEvent.click(screen.getByText('刪除'));

    expect(uepProgress.getState().storageNotes).toHaveLength(0);
  });

  it('取消刪除 → 便條保留，確認 UI 收起', async () => {
    const { uepProgress } = await freshStore();
    uepProgress.addStorageNote('保留');
    render(<StorageIsland />);

    fireEvent.click(screen.getByLabelText('刪除便條'));
    fireEvent.click(screen.getByText('取消'));

    expect(uepProgress.getState().storageNotes).toHaveLength(1);
    expect(screen.queryByText('刪除這張便條？')).not.toBeInTheDocument();
  });
});

describe('cap 邊界', () => {
  it('達 30 條上限時 input 禁用、按鈕禁用、顯示上限提示', async () => {
    const { uepProgress } = await freshStore();
    for (let i = 0; i < 30; i++) {
      uepProgress.addStorageNote(`便條 ${i}`);
    }
    render(<StorageIsland />);

    const input = screen.getByLabelText('新增便條') as HTMLInputElement;
    expect(input).toBeDisabled();
    expect(input.placeholder).toBe('便條已滿');
    expect(screen.getByText('+ 貼上')).toBeDisabled();
    expect(screen.getByText('30 / 30')).toBeInTheDocument();
  });

  it('第 31 條被 store 擋下（addStorageNote 回 false）', async () => {
    const { uepProgress } = await freshStore();
    for (let i = 0; i < 30; i++) {
      uepProgress.addStorageNote(`便條 ${i}`);
    }
    const ok = uepProgress.addStorageNote('第 31 條');
    expect(ok).toBe(false);
    expect(uepProgress.getState().storageNotes).toHaveLength(30);
  });
});

describe('已釘便條的暗掉與導向（S9-A.6）', () => {
  async function freshWithPinned() {
    vi.resetModules();
    const progressMod = await import('../../../progress/progressStore');
    const pinnedMod = await import('../pinnedStore');
    return { ...progressMod, ...pinnedMod };
  }

  it('已釘便條顯示 is-pinned class、點擊 → 派 uep:storage-jump（同頁）', async () => {
    const { uepProgress, uepStoragePins } = await freshWithPinned();
    uepProgress.addStorageNote('已釘的');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin({
      noteId,
      pagePath: '/history',
      pageSearch: '',
      zone: 'history',
      pageLabel: 'X',
      anchorKind: 'element',
      anchorId: 'p-0',
      offsetX: 0,
      offsetY: 0,
      createdAt: '2026-07-21T00:00:00.000Z',
    });

    const { container } = render(<StorageIsland />);
    const note = container.querySelector('.uep-stoland__note');
    expect(note?.classList.contains('is-pinned')).toBe(true);

    const jumpSpy = vi.fn();
    window.addEventListener('uep:storage-jump', jumpSpy);
    fireEvent.click(screen.getByText('已釘的'));
    expect(jumpSpy).toHaveBeenCalledTimes(1);
    window.removeEventListener('uep:storage-jump', jumpSpy);
  });

  it('已釘便條不顯示刪除鈕（要拆需在頁面上拆）', async () => {
    const { uepProgress, uepStoragePins } = await freshWithPinned();
    uepProgress.addStorageNote('X');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin({
      noteId,
      pagePath: '/history',
      pageSearch: '',
      zone: 'history',
      pageLabel: 'X',
      anchorKind: 'page',
      anchorId: null,
      offsetX: 0,
      offsetY: 0,
      createdAt: '2026-07-21T00:00:00.000Z',
    });

    render(<StorageIsland />);
    expect(screen.queryByLabelText('刪除便條')).not.toBeInTheDocument();
  });

  it('已釘便條 pool 中點擊不進 inline 編輯', async () => {
    const { uepProgress, uepStoragePins } = await freshWithPinned();
    uepProgress.addStorageNote('已釘的');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin({
      noteId,
      pagePath: '/history',
      pageSearch: '',
      zone: 'history',
      pageLabel: 'X',
      anchorKind: 'page',
      anchorId: null,
      offsetX: 0,
      offsetY: 0,
      createdAt: '2026-07-21T00:00:00.000Z',
    });

    render(<StorageIsland />);
    fireEvent.click(screen.getByText('已釘的'));
    // 不進編輯 → textarea 不出現
    expect(screen.queryByLabelText('編輯便條')).not.toBeInTheDocument();
  });
});
