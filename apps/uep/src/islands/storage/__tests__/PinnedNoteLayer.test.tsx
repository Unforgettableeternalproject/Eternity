/**
 * PinnedNoteLayer 元件測試（S9-A.5）
 *
 * 覆蓋：跨頁過濾、便條本體讀取、拆除、inline 編輯、page/fixed fallback。
 * element 錨點的實際定位依賴 getBoundingClientRect（jsdom 全 0）——
 * 只驗「有渲染出便條」而不斷言精確 pixel 座標。
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PinnedNoteLayer from '../PinnedNoteLayer';
import type { PinnedNote } from '../pinnedStore';

function makePinned(overrides: Partial<PinnedNote> = {}): PinnedNote {
  return {
    noteId: 'note-1',
    pagePath: '/history',
    pageSearch: '',
    zone: 'history',
    pageLabel: '歷史典藏庫 - 邊際世界',
    anchorKind: 'element',
    anchorId: 'p-0',
    offsetX: 10,
    offsetY: 20,
    createdAt: '2026-07-21T00:00:00.000Z',
    ...overrides,
  };
}

async function freshStores() {
  vi.resetModules();
  const progressMod = await import('../../../progress/progressStore');
  const pinnedMod = await import('../pinnedStore');
  return { ...progressMod, ...pinnedMod };
}

beforeEach(() => {
  window.localStorage.clear();
  delete window.__uepProgress;
  delete window.__uepStoragePins;
  window.history.replaceState({}, '', '/history');
  document.title = '歷史典藏庫 - 邊際世界';
  // 為便條內容 render 準備 .history-prose 容器
  document.body.innerHTML = `<div class="history-prose"><p data-uep-anchor-id="p-0">內容一</p></div>`;
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('跨頁過濾', () => {
  it('只渲染 pagePath 等於當前 pathname 的釘選', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('這頁的');
    uepProgress.addStorageNote('別頁的');
    const [a, b] = uepProgress.getState().storageNotes;
    uepStoragePins.pin(makePinned({ noteId: a.id, pagePath: '/history' }));
    uepStoragePins.pin(makePinned({ noteId: b.id, pagePath: '/echoes' }));

    render(<PinnedNoteLayer />);
    expect(screen.getByText('這頁的')).toBeInTheDocument();
    expect(screen.queryByText('別頁的')).not.toBeInTheDocument();
  });

  // 【回歸：S9-A Codex #1】同 pathname 下 query string 切子頁，
  // pinned 過濾必須依 pathname+search 聯合比對，否則會跨子頁誤顯示。
  it('同 pathname 不同 search → 只渲染對應子頁的釘選', async () => {
    window.history.replaceState({}, '', '/history?page=alpha');
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('alpha 的');
    uepProgress.addStorageNote('beta 的');
    const [alpha, beta] = uepProgress.getState().storageNotes;
    uepStoragePins.pin(
      makePinned({
        noteId: alpha.id,
        pagePath: '/history',
        pageSearch: '?page=alpha',
      })
    );
    uepStoragePins.pin(
      makePinned({
        noteId: beta.id,
        pagePath: '/history',
        pageSearch: '?page=beta',
      })
    );

    render(<PinnedNoteLayer />);
    expect(screen.getByText('alpha 的')).toBeInTheDocument();
    expect(screen.queryByText('beta 的')).not.toBeInTheDocument();
  });
});

describe('便條本體讀取', () => {
  it('讀 storageNotes 拿最新 text', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('原文');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(makePinned({ noteId }));

    const { rerender } = render(<PinnedNoteLayer />);
    expect(screen.getByText('原文')).toBeInTheDocument();

    // 更新便條本體
    uepProgress.updateStorageNote(noteId, '新文');
    rerender(<PinnedNoteLayer />);
    expect(screen.getByText('新文')).toBeInTheDocument();
  });

  it('便條本體不存在 → 該張不 render（sweepOrphans 落後一個 tick 也不會炸）', async () => {
    const { uepStoragePins } = await freshStores();
    // 只釘不建 → note 找不到（模擬 sweep 尚未完成的 race）
    uepStoragePins.pin(makePinned({ noteId: 'no-body' }));
    const { container } = render(<PinnedNoteLayer />);
    expect(container.querySelectorAll('.uep-pinned-note')).toHaveLength(0);
  });
});

describe('拆除', () => {
  it('點 × → unpin', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('待拆');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(makePinned({ noteId }));

    render(<PinnedNoteLayer />);
    fireEvent.click(screen.getByLabelText('拆除便條'));
    expect(uepStoragePins.getAll()).toEqual([]);
  });
});

describe('inline 編輯', () => {
  it('點文字 → 進 textarea，Enter 儲存 → updateStorageNote', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('原文');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(makePinned({ noteId }));

    render(<PinnedNoteLayer />);
    fireEvent.click(screen.getByText('原文'));

    const textarea = screen.getByLabelText('編輯便條') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '新文' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });

    expect(uepProgress.getState().storageNotes[0].text).toBe('新文');
  });

  it('Esc 取消 → 內容不變', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('原文');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(makePinned({ noteId }));

    render(<PinnedNoteLayer />);
    fireEvent.click(screen.getByText('原文'));

    const textarea = screen.getByLabelText('編輯便條');
    fireEvent.change(textarea, { target: { value: '半路取消' } });
    fireEvent.keyDown(textarea, { key: 'Escape' });

    expect(uepProgress.getState().storageNotes[0].text).toBe('原文');
  });
});

describe('page 級 fallback', () => {
  it('anchorKind=page → 便條顯示 uep-pinned-note--page class', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('page 級');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(
      makePinned({ noteId, anchorKind: 'page', anchorId: null })
    );

    const { container } = render(<PinnedNoteLayer />);
    expect(container.querySelector('.uep-pinned-note--page')).not.toBeNull();
  });

  it('element 錨點但容器缺失 → fixed fallback', async () => {
    // 移除 prose 容器
    document.body.innerHTML = '';
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('孤兒錨');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(makePinned({ noteId }));

    const { container } = render(<PinnedNoteLayer />);
    expect(container.querySelector('.uep-pinned-note--fixed')).not.toBeNull();
  });

  it('錨點在容器內找不到（改內容後） → 顯示 is-stale 提示', async () => {
    // 容器在，但 p-0 這個 anchorId 沒有對應元素（p tag 也沒）
    document.body.innerHTML = `<div class="history-prose"><div>無錨點內容</div></div>`;
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('原位置變動');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(makePinned({ noteId }));

    const { container } = render(<PinnedNoteLayer />);
    expect(container.querySelector('.is-stale')).not.toBeNull();
    expect(screen.getByText('原位置已變動')).toBeInTheDocument();
  });
});
