/**
 * 解鎖儀式 → 教學的整合測試（2026-08-05）
 *
 * `GuideRunner.test.tsx` 把 `shouldMountIsland` 與 `getProgressManager` 都
 * mock 成讀測試用的可變物件，那份 mock 永遠是即時的——結構上測不出「判定
 * 讀到過期快照」這類時序問題。這裡刻意用**真實**的 progressStore、
 * unlockRitual 與 guideRequest，只 mock 掉瀏覽器環境相關的部分。
 *
 * 守的是這條線：`completeUnlockRitual` 在解鎖後的同一個同步堆疊裡發出請求，
 * 而 React 的重渲染排在那之後。GuideRunner 若用 render 時的 progress 判定
 * 資格，看到的是解鎖前的快照，會把請求判成「這座島還沒解鎖」而丟掉——
 * 症狀是浮島教學在正式解鎖時永遠不播，且沒有任何錯誤。
 */
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/* islandRuntime 在 import 當下就會問 getReaderAuth().isLoggedIn() 並訂閱 */
const authState = vi.hoisted(() => ({ loggedIn: true }));
vi.mock('../../../auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../auth')>()),
  useReaderAuth: () => (authState.loggedIn ? { username: 'test' } : null),
  getReaderAuth: () => ({
    isLoggedIn: () => authState.loggedIn,
    subscribe: () => () => {},
  }),
}));

/** 島的根節點——`waitForGuideRoot` 找的就是它 */
function mountIslandRoot(id: string) {
  const el = document.createElement('div');
  el.className = `uep-island uep-island--${id}`;
  document.body.appendChild(el);
}

async function settle(ms = 2000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function freshModules() {
  vi.resetModules();
  const progress = await import('../../../progress/progressStore');
  const ritual = await import('../../unlockRitual');
  const guideRequest = await import('../guideRequest');
  const Runner = (await import('../GuideRunner')).default;
  return { store: progress.uepProgress, ritual, guideRequest, Runner };
}

describe('解鎖儀式 → 教學', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
    window.localStorage.clear();
    delete window.__uepProgress;
    authState.loggedIn = true;
    // matchMedia：useDesktopIslandViewport 訂閱用；桌面寬度由 innerWidth 決定
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
    mountIslandRoot('history');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('正式解鎖後真的會播教學', async () => {
    const { store, ritual, Runner } = await freshModules();
    store.setView('explorer');
    render(<Runner />);

    await act(async () => {
      expect(ritual.completeUnlockRitual('history')).toBe(true);
    });
    await settle();

    // 教學卡出現＝請求沒有在資格判定那一關被丟掉
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('沒有資格時不播——判定本身仍然有效', async () => {
    const { store, ritual, Runner } = await freshModules();
    store.setView('observer'); // 觀測者不能用浮島
    render(<Runner />);

    await act(async () => {
      expect(ritual.completeUnlockRitual('history')).toBe(false);
    });
    await settle();

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('書籤儀式走的是同一條線', async () => {
    vi.resetModules();
    const progress = await import('../../../progress/progressStore');
    const lb = await import('../../history/lostBookmark');
    const Runner = (await import('../GuideRunner')).default;

    progress.uepProgress.setView('explorer');
    progress.uepProgress.updateLostBookmark({ visible: true });
    render(<Runner />);

    await act(async () => {
      expect(lb.openLostBookmark()).toBe(true);
    });
    await settle();

    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});
