/**
 * dragToPin 純函式測試（S9-A.6）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  JUMP_TO_PINNED_KEY,
  commitPin,
  isUnpinDropTarget,
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

  //【回歸:07/25 四驗】抓取偏移：使用者抓在便條中間拖曳時，便條左上角
  // 在指標的左上方。存下的 offset 若直接用指標座標，還原時 left =
  // anchorRect.left + offsetX 會把「左上角」貼到指標位置 → 放開瞬間
  // 便條往右下跳一個抓取偏移量。grab 參數就是用來扣掉這段。
  it('帶 grab → element 錨點 offset 對齊便條左上角而非指標', () => {
    document.body.innerHTML = `
      <div class="history-prose">
        <p data-uep-anchor-id="p-0">A</p>
      </div>
    `;
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

    const bare = resolveDropTarget(150, 120);
    const grabbed = resolveDropTarget(150, 120, { dx: -40, dy: -15 });
    expect(grabbed.kind).toBe('element');
    if (bare.kind === 'element' && grabbed.kind === 'element') {
      // 判定不變（同一個錨點），只有偏移被 grab 平移
      expect(grabbed.anchorId).toBe(bare.anchorId);
      expect(grabbed.offsetX).toBe(bare.offsetX - 40);
      expect(grabbed.offsetY).toBe(bare.offsetY - 15);
      expect(grabbed.offsetX).toBe(110); // 150 - 0 - 40
      expect(grabbed.offsetY).toBe(5); // 120 - 100 - 15
    }
  });

  it('帶 grab → page 級 offset 同樣對齊便條左上角', () => {
    document.body.innerHTML = `<div class="other">X</div>`;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(
      document.querySelector('.other')
    );
    // /history 但沒有 .history-content scroll container → 退為 client 座標
    const grabbed = resolveDropTarget(200, 300, { dx: -60, dy: -20 });
    expect(grabbed.kind).toBe('page');
    if (grabbed.kind === 'page') {
      expect(grabbed.offsetX).toBe(140);
      expect(grabbed.offsetY).toBe(280);
    }
  });

  it('elementFromPoint 回 null → page 級', () => {
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(null);
    const result = resolveDropTarget(50, 50);
    expect(result.kind).toBe('page');
  });

  //【回歸:07/25 三驗+】anchor-first：drop 落在 prose 外但頁面有 prose
  // → 掃全頁找最近 anchor 綁定，不再直接走 page 級（原本 page 級是
  // fixed 相對 viewport 不隨頁面捲，是艾斯維爾三驗回饋的主 UX 問題）
  it('drop 落在 prose 外但頁面有 prose → 綁最近 anchor', () => {
    document.body.innerHTML = `
      <div class="sidebar">邊欄</div>
      <div class="history-prose">
        <p data-uep-anchor-id="p-0">A</p>
        <p data-uep-anchor-id="p-1">B</p>
      </div>
    `;
    // drop 點正上方是邊欄（非 prose）
    const sidebar = document.querySelector('.sidebar')!;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(sidebar);
    // 兩個 p 的 rect：drop 點 (50, 120) 離 p-0 (top=100) 較近
    const [p0, p1] = Array.from(document.querySelectorAll('p'));
    p0.getBoundingClientRect = () =>
      ({
        left: 200,
        right: 500,
        top: 100,
        bottom: 150,
        width: 300,
        height: 50,
        x: 200,
        y: 100,
        toJSON: () => {},
      }) as DOMRect;
    p1.getBoundingClientRect = () =>
      ({
        left: 200,
        right: 500,
        top: 400,
        bottom: 450,
        width: 300,
        height: 50,
        x: 200,
        y: 400,
        toJSON: () => {},
      }) as DOMRect;

    const result = resolveDropTarget(50, 120);
    expect(result.kind).toBe('element');
    if (result.kind === 'element') {
      expect(result.anchorId).toBe('p-0');
      expect(result.container.className).toBe('history-prose');
    }
  });

  it('drop 落在 prose 外且頁面完全沒 prose → 仍走 page 級 fallback', () => {
    document.body.innerHTML = `<div class="only-interactive">互動頁</div>`;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(
      document.querySelector('.only-interactive')
    );
    Object.defineProperty(window, 'innerWidth', {
      value: 1024,
      configurable: true,
    });
    Object.defineProperty(window, 'innerHeight', {
      value: 768,
      configurable: true,
    });

    const result = resolveDropTarget(100, 100);
    expect(result.kind).toBe('page');
  });

  //【回歸:07/25 三驗+】page 級 offset 語意改為「相對 scroll container
  // 內容左上角座標」（原本是「相對 viewport 右下角」）——這樣便條會
  // 附著在頁面內容上、隨 container scroll 一起走。
  it('page 級 offset 是內容座標：scrollLeft+clientX-containerLeft', () => {
    window.history.replaceState({}, '', '/storage/room');
    document.body.innerHTML = `
      <div class="sto-content" style="position:absolute;left:100px;top:80px;">
        <div class="only-interactive">互動頁</div>
      </div>
    `;
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
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(
      document.querySelector('.only-interactive')
    );

    // drop 點 (300, 250) - 沒 prose → page 級，offset 應為內容座標：
    // contentX = 0 + 300 - 100 = 200
    // contentY = 200 + 250 - 80 = 370
    const result = resolveDropTarget(300, 250);
    expect(result.kind).toBe('page');
    if (result.kind === 'page') {
      expect(result.offsetX).toBe(200);
      expect(result.offsetY).toBe(370);
    }
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
  //【回歸:07/25 三驗】useZoneRouter 只監聽 popstate；pushState 依規範
  // 不會產生 popstate 事件，Reader 不會自動 react → 必須手動派
  // PopStateEvent。漏派時 URL 換了但頁面不切（艾斯維爾親自 DevTools 抓到）。
  it('同 pathname 不同 search → pushState + 派 popstate + 派同頁 jump', () => {
    window.history.replaceState({}, '', '/history?page=alpha');
    const jumpSpy = vi.fn();
    const popSpy = vi.fn();
    window.addEventListener('uep:storage-jump', jumpSpy);
    window.addEventListener('popstate', popSpy);
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
      expect(popSpy).toHaveBeenCalledTimes(1);
      expect(jumpSpy).toHaveBeenCalledTimes(1);
      expect(window.sessionStorage.getItem(JUMP_TO_PINNED_KEY)).toBe('c');
    } finally {
      window.removeEventListener('uep:storage-jump', jumpSpy);
      window.removeEventListener('popstate', popSpy);
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

/*【07/25 四驗】首頁釘選：首頁沒有 prose 容器 → 一律 page 級，
 * 座標語意是「相對 .journey-scroll 內容左上角」，這樣便條才會附著在
 * 頁面內容上、隨區塊跳轉一起走，而不是凍結在螢幕座標。 */
describe('首頁落點（07/25 四驗）', () => {
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
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(scroller);
    return scroller;
  }

  it('drop → page 級，offset 是相對 .journey-scroll 的內容座標', () => {
    mountHome(2000);
    const result = resolveDropTarget(400, 300);
    expect(result.kind).toBe('page');
    if (result.kind === 'page') {
      // contentY = scrollTop(2000) + clientY(300) - containerTop(0)
      expect(result.offsetY).toBe(2300);
      expect(result.offsetX).toBe(400);
    }
  });

  it('commitPin 在首頁存 zone=home / pagePath=/', async () => {
    mountHome(0);
    const { uepProgress, uepStoragePins, commitPin } = await freshStores();
    uepProgress.addStorageNote('首頁便條');
    const noteId = uepProgress.getState().storageNotes[0].id;
    commitPin(noteId, { kind: 'page', offsetX: 100, offsetY: 900 });

    const [pin] = uepStoragePins.getAll();
    expect(pin.zone).toBe('home');
    expect(pin.pagePath).toBe('/');
    expect(pin.anchorKind).toBe('page');
  });
});

/*【07/25 UX】拖回展開的便條島 = 解除釘選。
 * 艾斯維爾定案：**只有展開的島**（`.uep-island--storage`）算拆除目標，
 * 收合成 dock chip 時不算，拖曳仍照常釘到頁面上。 */
describe('isUnpinDropTarget', () => {
  it('放開點落在展開的便條島上 → true', () => {
    document.body.innerHTML = `
      <div class="uep-island uep-island--storage">
        <div class="uep-island__body"><span class="deep">便條列表</span></div>
      </div>
    `;
    // 命中島內深層元素也算（closest 往上找）
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(
      document.querySelector('.deep')
    );
    expect(isUnpinDropTarget(500, 400)).toBe(true);
  });

  it('放開點落在其他浮島上 → false（只有便條島是家）', () => {
    document.body.innerHTML = `<div class="uep-island uep-island--history">歷史島</div>`;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(
      document.querySelector('.uep-island--history')
    );
    expect(isUnpinDropTarget(500, 400)).toBe(false);
  });

  it('島收合成 dock chip → false（照常釘到頁面上）', () => {
    document.body.innerHTML = `
      <div class="uep-island-dock">
        <button class="uep-island-dock__chip">◈</button>
      </div>
    `;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(
      document.querySelector('.uep-island-dock__chip')
    );
    expect(isUnpinDropTarget(500, 400)).toBe(false);
  });

  it('放開點落在頁面內容上 → false', () => {
    document.body.innerHTML = `<div class="history-prose"><p>內容</p></div>`;
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(
      document.querySelector('p')
    );
    expect(isUnpinDropTarget(500, 400)).toBe(false);
  });

  it('elementFromPoint 回 null → false', () => {
    vi.spyOn(document, 'elementFromPoint').mockReturnValue(null);
    expect(isUnpinDropTarget(500, 400)).toBe(false);
  });
});
