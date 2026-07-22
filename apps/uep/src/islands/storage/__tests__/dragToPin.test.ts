/**
 * dragToPin 純函式測試（S9-A.6）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  JUMP_TO_PINNED_KEY,
  commitPin,
  navigateToPinned,
  resolveDropTarget,
  takeJumpToPinned,
} from '../dragToPin';
import type { PinnedNote } from '../pinnedStore';

async function freshStores() {
  vi.resetModules();
  const progressMod = await import('../../../progress/progressStore');
  const pinnedMod = await import('../pinnedStore');
  const dragMod = await import('../dragToPin');
  return { ...progressMod, ...pinnedMod, ...dragMod };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  delete window.__uepProgress;
  delete window.__uepStoragePins;
  window.history.replaceState({}, '', '/history');
  document.title = '歷史典藏庫 - 邊際世界';
  // jsdom 沒有 elementFromPoint，先建 stub 讓 spyOn 有東西可攔
  (
    document as unknown as {
      elementFromPoint: (x: number, y: number) => Element | null;
    }
  ).elementFromPoint = () => null;
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('resolveDropTarget', () => {
  it('drop 落在支援 element 錨點的容器內 → element pin', () => {
    document.body.innerHTML = `
      <div class="history-prose">
        <p data-uep-anchor-id="p-0">A</p>
      </div>
    `;
    // stub elementFromPoint + getBoundingClientRect
    const p = document.querySelector('p')!;
    p.getBoundingClientRect = () =>
      ({
        left: 0,
        right: 300,
        top: 100,
        bottom: 150,
        width: 300,
        height: 50,
        x: 0,
        y: 100,
        toJSON: () => {},
      }) as DOMRect;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(p);

    const result = resolveDropTarget(150, 120);
    expect(result.kind).toBe('element');
    if (result.kind === 'element') {
      expect(result.anchorId).toBe('p-0');
      expect(result.container.className).toBe('history-prose');
      expect(result.offsetY).toBe(20);
    }
  });

  it('drop 落在容器外 → page 級（右下角基準）', () => {
    document.body.innerHTML = `<div class="other">X</div>`;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(
      document.querySelector('.other')
    );
    // window.innerWidth 通常 1024，drop x=200 y=300 → right=808 bottom=... 之類
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 768,
      configurable: true,
    });

    const result = resolveDropTarget(200, 300);
    expect(result.kind).toBe('page');
    if (result.kind === 'page') {
      // offsetX/offsetY 都 >= 0（右下角基準）
      expect(result.offsetX).toBeGreaterThanOrEqual(0);
      expect(result.offsetY).toBeGreaterThanOrEqual(0);
    }
  });

  it('elementFromPoint 回 null → page 級', () => {
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(null);
    const result = resolveDropTarget(50, 50);
    expect(result.kind).toBe('page');
  });
});

describe('commitPin', () => {
  it('element resolution → 寫入 pinnedStore 帶 element 資訊', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('X');
    const noteId = uepProgress.getState().storageNotes[0].id;

    document.body.innerHTML = `
      <div class="history-prose"><p data-uep-anchor-id="p-0">A</p></div>
    `;
    const container = document.querySelector('.history-prose') as HTMLElement;
    const pinned = commitPin(noteId, {
      kind: 'element',
      container,
      anchorId: 'p-0',
      offsetX: 5,
      offsetY: 10,
    });

    expect(pinned.anchorKind).toBe('element');
    expect(pinned.anchorId).toBe('p-0');
    expect(pinned.pagePath).toBe('/history');
    expect(pinned.zone).toBe('history');
    expect(uepStoragePins.getAll()).toHaveLength(1);
  });

  it('page resolution → 寫入 anchorKind=page + anchorId=null', async () => {
    const { uepProgress, uepStoragePins } = await freshStores();
    uepProgress.addStorageNote('X');
    const noteId = uepProgress.getState().storageNotes[0].id;

    const pinned = commitPin(noteId, {
      kind: 'page',
      offsetX: 20,
      offsetY: 30,
    });

    expect(pinned.anchorKind).toBe('page');
    expect(pinned.anchorId).toBeNull();
    expect(pinned.offsetX).toBe(20);
    expect(uepStoragePins.isPinned(noteId)).toBe(true);
  });
});

describe('jumpToPinned sessionStorage', () => {
  it('take 後 flag 被清除', () => {
    window.sessionStorage.setItem(JUMP_TO_PINNED_KEY, 'x');
    expect(takeJumpToPinned()).toBe('x');
    expect(window.sessionStorage.getItem(JUMP_TO_PINNED_KEY)).toBeNull();
    expect(takeJumpToPinned()).toBeNull();
  });
});

describe('navigateToPinned', () => {
  function makePinned(overrides: Partial<PinnedNote> = {}): PinnedNote {
    return {
      noteId: 'note-1',
      pagePath: '/history',
      pageSearch: '',
      zone: 'history',
      pageLabel: 'X',
      anchorKind: 'element',
      anchorId: 'p-0',
      offsetX: 0,
      offsetY: 0,
      createdAt: '2026-07-21T00:00:00.000Z',
      ...overrides,
    };
  }

  it('同頁 → 派 uep:storage-jump 事件，不整頁跳', () => {
    window.history.replaceState({}, '', '/history');
    const spy = vi.fn();
    window.addEventListener('uep:storage-jump', spy);
    navigateToPinned(makePinned({ pagePath: '/history', noteId: 'a' }));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(JUMP_TO_PINNED_KEY)).toBe('a');
    window.removeEventListener('uep:storage-jump', spy);
  });

  // 【回歸：S9-A Codex #1】同 pathname 但 pageSearch 不同時，需 pushState
  // 到目標 query 觸發 Reader 內部路由，再派同頁 jump 事件由 layer 接手。
  it('同 pathname 不同 search → pushState + 派同頁 jump', () => {
    window.history.replaceState({}, '', '/history?page=alpha');
    const jumpSpy = vi.fn();
    window.addEventListener('uep:storage-jump', jumpSpy);
    try {
      navigateToPinned(
        makePinned({
          pagePath: '/history',
          pageSearch: '?page=beta',
          noteId: 'c',
        })
      );
      expect(window.location.pathname).toBe('/history');
      expect(window.location.search).toBe('?page=beta');
      expect(jumpSpy).toHaveBeenCalledTimes(1);
      expect(window.sessionStorage.getItem(JUMP_TO_PINNED_KEY)).toBe('c');
    } finally {
      window.removeEventListener('uep:storage-jump', jumpSpy);
    }
  });

  it('跨頁 → sessionStorage flag 寫入，不派同頁事件', () => {
    window.history.replaceState({}, '', '/history');
    // jsdom 的 location.assign 是 non-configurable spy 攔不了——我們改驗
    // 「flag 已寫入 + 未派 uep:storage-jump」（同頁分支才會派）。
    // 實際導航會失敗（jsdom 不真跳頁）但這是實作可接受的副作用。
    const jumpSpy = vi.fn();
    window.addEventListener('uep:storage-jump', jumpSpy);
    try {
      // 只在 try 內呼叫——jsdom 環境呼叫 location.assign 可能拋 Not implemented
      // 但實作已先寫 sessionStorage，測試值不受影響
      try {
        navigateToPinned(makePinned({ pagePath: '/echoes', noteId: 'b' }));
      } catch {
        /* jsdom Not implemented: navigation—flag 已寫入，忽略 */
      }
      expect(window.sessionStorage.getItem(JUMP_TO_PINNED_KEY)).toBe('b');
      expect(jumpSpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('uep:storage-jump', jumpSpy);
    }
  });
});
