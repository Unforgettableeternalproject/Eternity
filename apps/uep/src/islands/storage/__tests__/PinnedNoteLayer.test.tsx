/**
 * PinnedNoteLayer 元件測試（S9-A.5）
 *
 * 覆蓋：跨頁過濾、便條本體讀取、拆除、inline 編輯、page/fixed fallback。
 * element 錨點的實際定位依賴 getBoundingClientRect（jsdom 全 0）——
 * 只驗「有渲染出便條」而不斷言精確 pixel 座標。
 */
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PinnedNoteLayer from '../PinnedNoteLayer';
import { JUMP_TO_PINNED_KEY } from '../dragToPin';
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

  // 【回歸:07/24 二次驗收】艾斯維爾定案「同一便條紙釘選一次」——
  // 語意是**每張便條各自能釘一次**，多張不同便條可同時在同頁釘選並顯示。
  it('同頁多張不同便條 → 全部渲染', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('第一張');
    uepProgress.addStorageNote('第二張');
    uepProgress.addStorageNote('第三張');
    const notes = uepProgress.getState().storageNotes;
    // 三張都釘在 /history，不同 anchorId 避免完全視覺重疊
    notes.forEach((n, i) => {
      uepStoragePins.pin(
        makePinned({ noteId: n.id, pagePath: '/history', anchorId: `p-${i}` })
      );
    });

    const { container } = render(<PinnedNoteLayer />);
    expect(container.querySelectorAll('.uep-pinned-note')).toHaveLength(3);
    expect(screen.getByText('第一張')).toBeInTheDocument();
    expect(screen.getByText('第二張')).toBeInTheDocument();
    expect(screen.getByText('第三張')).toBeInTheDocument();
  });

  // 【回歸:07/25 三驗】storage stuff / concepts 等互動頁沒有 .sto-prose 容器
  // →  drop 都走 page 級 fallback。實測「第二張蓋掉第一張」——本測試
  // 模擬同頁兩張都 page 級，確認 render 端仍全部渲染出來。
  it('同頁多張 page 級 fallback → 全部渲染（不會互相蓋掉）', async () => {
    window.history.replaceState({}, '', '/storage/room');
    // 刻意不建 .sto-prose 容器，模擬互動頁
    document.body.innerHTML = '';
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('先釘的');
    uepProgress.addStorageNote('後釘的');
    const notes = uepProgress.getState().storageNotes;
    uepStoragePins.pin(
      makePinned({
        noteId: notes[0].id,
        pagePath: '/storage/room',
        anchorKind: 'page',
        anchorId: null,
        offsetX: 100,
        offsetY: 100,
      })
    );
    uepStoragePins.pin(
      makePinned({
        noteId: notes[1].id,
        pagePath: '/storage/room',
        anchorKind: 'page',
        anchorId: null,
        offsetX: 400,
        offsetY: 200,
      })
    );

    const { container } = render(<PinnedNoteLayer />);
    expect(container.querySelectorAll('.uep-pinned-note')).toHaveLength(2);
    expect(screen.getByText('先釘的')).toBeInTheDocument();
    expect(screen.getByText('後釘的')).toBeInTheDocument();
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

  //【回歸:07/25 code review finding 2】PinnedNoteCard 的 hook 必須全部在
  // `if (!note) return null` **之前**宣告。真實觸發路徑：本機釘選 metadata
  // 在 localStorage 先到位、ProgressState 稍後由 server adapter hydrate 補上
  // 便條本體——同一張卡的 note 從 null 變有值，early return 若擋在 hook 前
  // 面，hook 數量從 0 變 N，React 直接 crash。
  it('便條本體 hydrate 後才到 → 同一張卡不因 hook 數量變動而炸', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepStoragePins.pin(makePinned({ noteId: 'late-note' }));

    const { rerender, container } = render(<PinnedNoteLayer />);
    // 卡片已 mount（pin 在），但便條本體還沒到 → 不畫內容
    expect(container.querySelectorAll('.uep-pinned-note')).toHaveLength(0);

    const base = uepProgress.getState();
    await uepProgress.setAdapter({
      load: async () => ({
        ...base,
        storageNotes: [
          {
            id: 'late-note',
            text: '晚到的便條',
            tilt: -2,
            createdAt: '2026-07-21T00:00:00.000Z',
            updatedAt: '2026-07-21T00:00:00.000Z',
          },
        ],
      }),
      save: async () => {},
    });
    rerender(<PinnedNoteLayer />);

    expect(screen.getByText('晚到的便條')).toBeInTheDocument();
  });
});

/* 【回歸:07/27 驗收】便條勾了地點／時間，釘到頁面上之後小標整個不見——
 * 島內的便條卡有渲染，釘選層漏了。兩邊是不同的渲染路徑但顯示同一份快照。 */
describe('地點／時間小標', () => {
  it('便條有地點快照 → 釘選後仍顯示（zone 顯示成中文名）', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('帶地點的');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepProgress.setStorageNoteLocation(noteId, {
      zone: 'history',
      pageLabel: '第一章 · 同病相憐',
    });
    uepStoragePins.pin(makePinned({ noteId }));

    render(<PinnedNoteLayer />);
    expect(screen.getByText(/歷史.*第一章 · 同病相憐/u)).toBeInTheDocument();
  });

  it('便條有時間快照 → 釘選後顯示 YYYY-MM-DD HH:mm，完整值留在 title', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('帶時間的');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepProgress.setStorageNoteCapturedAt(noteId, true);
    const iso = uepProgress.getState().storageNotes[0].capturedAt!;
    uepStoragePins.pin(makePinned({ noteId }));

    const { container } = render(<PinnedNoteLayer />);
    const item = container.querySelector('.uep-pinned-note__meta-item');
    expect(item?.textContent).toBe(iso.slice(0, 16).replace('T', ' '));
    expect(item?.getAttribute('title')).toBe(iso);
  });

  it('兩個小標都沒勾 → 不留空的小標區塊', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('純文字');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(makePinned({ noteId }));

    const { container } = render(<PinnedNoteLayer />);
    expect(container.querySelector('.uep-pinned-note__meta')).toBeNull();
  });

  it('進入編輯態時小標讓位給 textarea', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('編輯看看');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepProgress.setStorageNoteCapturedAt(noteId, true);
    uepStoragePins.pin(makePinned({ noteId }));

    const { container } = render(<PinnedNoteLayer />);
    expect(container.querySelector('.uep-pinned-note__meta')).not.toBeNull();
    fireEvent.click(screen.getByText('編輯看看'));
    expect(container.querySelector('.uep-pinned-note__meta')).toBeNull();
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

  /*【回歸:07/25 四驗】pointerdown 就 setPointerCapture——便條只有 200px 寬，
   * 快速甩動時指標常在超過 DRAG_THRESHOLD 之前就飛出卡片，pointermove 只掛
   * 在卡片上會直接斷線（主觀感受：拖不太動）。但捕獲後原生 click 的 target
   * 被鎖在卡片 div，不會分派到內部 `.uep-pinned-note__text` button，所以
   * 「點一下進編輯」改由 pointerup 自行判定。以下兩案走 pointer 序列而非
   * fireEvent.click，才真的守得住這條路徑。 */
  it('pointerdown → 原地 pointerup（未超過拖曳門檻）→ 進編輯態', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('原文');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(makePinned({ noteId }));

    const { container } = render(<PinnedNoteLayer />);
    const card = container.querySelector('.uep-pinned-note')!;
    fireEvent.pointerDown(card, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(card, { clientX: 102, clientY: 101, pointerId: 1 });

    expect(screen.getByLabelText('編輯便條')).toBeInTheDocument();
  });

  it('pointerdown → 超過門檻拖曳 → pointerup 不進編輯態', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('原文');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(makePinned({ noteId }));
    // resolveDropTarget 會呼叫 elementFromPoint——jsdom 沒有，補 stub
    (
      document as unknown as { elementFromPoint: () => Element | null }
    ).elementFromPoint = () => null;

    const { container } = render(<PinnedNoteLayer />);
    const card = container.querySelector('.uep-pinned-note')!;
    fireEvent.pointerDown(card, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(card, { clientX: 180, clientY: 160, pointerId: 1 });
    fireEvent.pointerUp(card, { clientX: 180, clientY: 160, pointerId: 1 });

    expect(screen.queryByLabelText('編輯便條')).not.toBeInTheDocument();
    expect(uepStoragePins.getAll()).toHaveLength(1);
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

  //【回歸:07/25 三驗+】page 級 offset 語意改為內容座標——render 位置
  // 要用 containerRect + offset - scrollLeft/Top 補償（附著頁面內容，
  // 而非固定 viewport 右下角）。
  it('page 級：style.left/top 由 containerRect + offset - scroll 補償', async () => {
    window.history.replaceState({}, '', '/storage/room');
    document.body.innerHTML = `<div class="sto-content"></div>`;
    const container = document.querySelector('.sto-content') as HTMLElement;
    container.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 80,
        right: 900,
        bottom: 700,
        width: 800,
        height: 620,
        x: 100,
        y: 80,
        toJSON: () => {},
      }) as DOMRect;
    Object.defineProperty(container, 'scrollLeft', {
      value: 0,
      configurable: true,
    });
    Object.defineProperty(container, 'scrollTop', {
      value: 200,
      configurable: true,
    });

    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('附著頁面的');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(
      makePinned({
        noteId,
        pagePath: '/storage/room',
        anchorKind: 'page',
        anchorId: null,
        offsetX: 200,
        offsetY: 370,
      })
    );

    const { container: rendered } = render(<PinnedNoteLayer />);
    const note = rendered.querySelector<HTMLElement>('.uep-pinned-note--page');
    expect(note).not.toBeNull();
    // left = 100 + 200 - 0 = 300; top = 80 + 370 - 200 = 250
    expect(note!.style.left).toBe('300px');
    expect(note!.style.top).toBe('250px');
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

describe('jump-to（點 pool 內暗掉便條 → 捲到釘選位置）', () => {
  /*【回歸:07/25 code review finding 1】page 級與 element 錨點的 trackEl
   * 語意不同：element 的 trackEl 是錨點元素（scrollIntoView 正確），
   * page 級的 trackEl 是**捲動容器自己**——對它 scrollIntoView 只會把容器
   * 捲進「它父層」的視野，不會改它自己的 scrollTop，摺線下方的 page pin
   * 點下去仍在畫面外。page 級必須改用 container.scrollTo 到儲存的內容座標。 */
  it('page 級 → 捲動容器 scrollTo 到儲存座標，不是 scrollIntoView', async () => {
    document.body.innerHTML = `<div class="history-content"></div>`;
    const scroller = document.querySelector('.history-content') as HTMLElement;
    Object.defineProperty(scroller, 'clientWidth', {
      value: 800,
      configurable: true,
    });
    Object.defineProperty(scroller, 'clientHeight', {
      value: 600,
      configurable: true,
    });
    const scrollTo = vi.fn();
    const scrollIntoView = vi.fn();
    scroller.scrollTo = scrollTo as unknown as HTMLElement['scrollTo'];
    scroller.scrollIntoView = scrollIntoView;

    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('摺線下方的便條');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(
      makePinned({
        noteId,
        anchorKind: 'page',
        anchorId: null,
        offsetX: 100,
        offsetY: 3000,
      })
    );
    window.sessionStorage.setItem(JUMP_TO_PINNED_KEY, noteId);

    render(<PinnedNoteLayer />);

    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
    expect(scrollIntoView).not.toHaveBeenCalled();
    // top = offsetY - clientHeight/2；left 被 clamp 到 0（100 - 800/2 < 0）
    expect(scrollTo.mock.calls[0][0]).toMatchObject({ left: 0, top: 2700 });
  });

  it('element 錨點 → 仍走錨點元素的 scrollIntoView', async () => {
    document.body.innerHTML = `<div class="history-prose"><p data-uep-anchor-id="p-0">內容一</p></div>`;
    const anchor = document.querySelector('p') as HTMLElement;
    const scrollIntoView = vi.fn();
    anchor.scrollIntoView = scrollIntoView;

    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('段落上的便條');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(makePinned({ noteId }));
    window.sessionStorage.setItem(JUMP_TO_PINNED_KEY, noteId);

    render(<PinnedNoteLayer />);

    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
  });
});

/*【07/25 四驗】首頁支援釘選便條。
 * 首頁「一區塊一區塊跳轉」只是呈現模式——位置狀態的載體仍是單一的
 * `.journey-scroll.scrollTop`（HomePage.tsx 的 scrollTo 瞬跳與 Verse 內部
 * 手動推進都寫它），所以 page 級的定位公式原封不動適用。 */
describe('首頁釘選（07/25 四驗）', () => {
  function mountHome(scrollTop: number) {
    window.history.replaceState({}, '', '/');
    document.body.innerHTML = `<div class="journey-scroll"></div>`;
    const scroller = document.querySelector('.journey-scroll') as HTMLElement;
    scroller.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 1280,
        bottom: 800,
        width: 1280,
        height: 800,
        x: 0,
        y: 0,
        toJSON: () => {},
      }) as DOMRect;
    Object.defineProperty(scroller, 'scrollTop', {
      value: scrollTop,
      configurable: true,
    });
    Object.defineProperty(scroller, 'scrollLeft', {
      value: 0,
      configurable: true,
    });
    return scroller;
  }

  function homePin(noteId: string): PinnedNote {
    return makePinned({
      noteId,
      pagePath: '/',
      pageSearch: '',
      zone: 'home',
      pageLabel: '世界的軸心',
      anchorKind: 'page',
      anchorId: null,
      offsetX: 300,
      offsetY: 1500,
    });
  }

  it('page 級便條依 .journey-scroll 的 scrollTop 補償定位（不是螢幕座標）', async () => {
    mountHome(1000);
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('首頁便條');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(homePin(noteId));

    const { container } = render(<PinnedNoteLayer />);
    const card = container.querySelector('.uep-pinned-note') as HTMLElement;
    // top = containerRect.top(0) + offsetY(1500) - scrollTop(1000)
    expect(card.style.top).toBe('500px');
    expect(card.style.left).toBe('300px');
  });

  it('捲到不同位置 → 便條跟著頁面走（而非固定在螢幕上）', async () => {
    mountHome(1400);
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('首頁便條');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(homePin(noteId));

    const { container } = render(<PinnedNoteLayer />);
    const card = container.querySelector('.uep-pinned-note') as HTMLElement;
    // 同一張 pin、scrollTop 從 1000 變 1400 → 便條上移 400px
    expect(card.style.top).toBe('100px');
  });

  it('首頁便條掛 is-home（CSS 把它壓到轉場漸暗層/黑幕之下）', async () => {
    mountHome(0);
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('首頁便條');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(homePin(noteId));

    const { container } = render(<PinnedNoteLayer />);
    expect(container.querySelector('.uep-pinned-note.is-home')).not.toBeNull();
  });

  it('其他 zone 的便條不掛 is-home', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('history 便條');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(makePinned({ noteId }));

    const { container } = render(<PinnedNoteLayer />);
    expect(container.querySelector('.uep-pinned-note')).not.toBeNull();
    expect(container.querySelector('.uep-pinned-note.is-home')).toBeNull();
  });
});

/*【07/25 UX】把釘在頁面上的便條拖回**展開的**便條島 → 解除釘選
 * （便條本體不刪，只是回到 pool 的未釘選狀態）。
 * 艾斯維爾定案：收合成 dock chip 時不算拆除目標。 */
describe('拖回便條島解除釘選', () => {
  function mountIsland(): HTMLElement {
    const island = document.createElement('div');
    island.className = 'uep-island uep-island--storage';
    document.body.appendChild(island);
    return island;
  }

  function stubPointAt(el: Element | null) {
    (
      document as unknown as { elementFromPoint: () => Element | null }
    ).elementFromPoint = () => el;
  }

  async function renderPinned() {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('要收回去的');
    const noteId = uepProgress.getState().storageNotes[0].id;
    uepStoragePins.pin(makePinned({ noteId }));
    const { container } = render(<PinnedNoteLayer />);
    const card = container.querySelector('.uep-pinned-note') as HTMLElement;
    return { uepProgress, uepStoragePins, container, card, noteId };
  }

  afterEach(() => {
    document.body.classList.remove('uep-pin-unpin-hover');
  });

  it('拖曳放開在便條島上 → 解除釘選（便條本體保留）', async () => {
    const island = mountIsland();
    stubPointAt(island);
    const { uepProgress, uepStoragePins, card } = await renderPinned();

    fireEvent.pointerDown(card, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(card, { clientX: 300, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(card, { clientX: 300, clientY: 300, pointerId: 1 });

    expect(uepStoragePins.getAll()).toEqual([]);
    // 便條本體還在（只是不再釘選）
    expect(uepProgress.getState().storageNotes).toHaveLength(1);
  });

  it('拖曳懸在島上 → 卡片掛 is-unpin-pending + body 掛島高亮 class', async () => {
    const island = mountIsland();
    stubPointAt(island);
    const { card } = await renderPinned();

    fireEvent.pointerDown(card, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(card, { clientX: 300, clientY: 300, pointerId: 1 });

    expect(card.classList.contains('is-unpin-pending')).toBe(true);
    expect(document.body.classList.contains('uep-pin-unpin-hover')).toBe(true);
  });

  it('離開島範圍 → 高亮解除，放開仍是重新釘選而非拆除', async () => {
    const island = mountIsland();
    const outside = document.querySelector('.history-prose') as HTMLElement;
    stubPointAt(island);
    const { uepStoragePins, card } = await renderPinned();

    fireEvent.pointerDown(card, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(card, { clientX: 300, clientY: 300, pointerId: 1 });
    expect(document.body.classList.contains('uep-pin-unpin-hover')).toBe(true);

    // 移出島範圍
    stubPointAt(outside);
    fireEvent.pointerMove(card, { clientX: 60, clientY: 400, pointerId: 1 });
    expect(card.classList.contains('is-unpin-pending')).toBe(false);
    expect(document.body.classList.contains('uep-pin-unpin-hover')).toBe(false);

    fireEvent.pointerUp(card, { clientX: 60, clientY: 400, pointerId: 1 });
    // 沒被拆除——仍留一筆釘選（位置被 commitPin 更新）
    expect(uepStoragePins.getAll()).toHaveLength(1);
  });

  it('放開後島的高亮一定清掉', async () => {
    const island = mountIsland();
    stubPointAt(island);
    const { card } = await renderPinned();

    fireEvent.pointerDown(card, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(card, { clientX: 300, clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(card, { clientX: 300, clientY: 300, pointerId: 1 });

    expect(document.body.classList.contains('uep-pin-unpin-hover')).toBe(false);
  });

  it('未超過拖曳門檻的點擊不會誤觸拆除', async () => {
    const island = mountIsland();
    stubPointAt(island);
    const { uepStoragePins, card } = await renderPinned();

    fireEvent.pointerDown(card, { clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerUp(card, { clientX: 102, clientY: 101, pointerId: 1 });

    expect(uepStoragePins.getAll()).toHaveLength(1);
    expect(screen.getByLabelText('編輯便條')).toBeInTheDocument();
  });
});
