/**
 * GlobalWelcomeHost 測試
 *
 * 核心契約：**消費即清**。pending flag 一被讀走就從 sessionStorage 移除，
 * 儀式狀態只留在記憶體。若留到播完才清，使用者在儀式那 2.2 秒內導航離開
 * （登出後馬上回去登入是最常見的路徑），flag 會跟到下一頁被重新讀取，
 * 動畫從頭再播一次——看起來像「接續播放」，實際是重複觸發。
 */
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import GlobalWelcomeHost, { WELCOME_PENDING_KEY } from '../GlobalWelcomeHost';

vi.mock('../WelcomeCeremony', () => ({
  default: ({ kind, onDone }: { kind: string; onDone: () => void }) => (
    <div data-testid="ceremony" data-kind={kind}>
      <button onClick={onDone}>done</button>
    </div>
  ),
}));

function seed(kind: string, alias = '守夜的譯讀者') {
  sessionStorage.setItem(WELCOME_PENDING_KEY, JSON.stringify({ kind, alias }));
}

describe('GlobalWelcomeHost', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    document.documentElement.classList.remove('uep-welcome-pending');
    document.body.classList.remove('uep-welcome-pending');
  });

  it('讀到 pending 就播儀式', () => {
    seed('logout');
    const { getByTestId } = render(<GlobalWelcomeHost />);
    expect(getByTestId('ceremony').dataset.kind).toBe('logout');
  });

  it('沒有 pending 時不渲染任何東西', () => {
    const { container } = render(<GlobalWelcomeHost />);
    expect(container.firstChild).toBeNull();
  });

  it('flag 在開播當下就清掉，不等儀式播完', () => {
    seed('login');
    render(<GlobalWelcomeHost />);
    expect(sessionStorage.getItem(WELCOME_PENDING_KEY)).toBeNull();
  });

  /* 中途離開頁面 = 這次掛載期間沒有播完就卸載。flag 已經清掉，
     下一頁重新掛載時就不該再看到儀式 */
  it('儀式播到一半離開頁面，下一頁不會重播', () => {
    seed('logout');
    const first = render(<GlobalWelcomeHost />);
    expect(first.queryByTestId('ceremony')).toBeTruthy();
    first.unmount();

    const second = render(<GlobalWelcomeHost />);
    expect(second.queryByTestId('ceremony')).toBeNull();
  });

  it('播完會清掉 pending class 並發出結束事件', async () => {
    seed('login');
    document.documentElement.classList.add('uep-welcome-pending');
    document.body.classList.add('uep-welcome-pending');
    const onDone = vi.fn();
    window.addEventListener('uep:welcome-done', onDone);

    const { getByText, queryByTestId } = render(<GlobalWelcomeHost />);
    await act(async () => {
      getByText('done').click();
    });

    expect(onDone).toHaveBeenCalled();
    expect(
      document.documentElement.classList.contains('uep-welcome-pending')
    ).toBe(false);
    expect(document.body.classList.contains('uep-welcome-pending')).toBe(false);
    expect(queryByTestId('ceremony')).toBeNull();

    window.removeEventListener('uep:welcome-done', onDone);
  });

  it('壞掉的 flag 不播儀式，也不留在 sessionStorage', () => {
    sessionStorage.setItem(WELCOME_PENDING_KEY, '{"kind":"nope"}');
    const { container } = render(<GlobalWelcomeHost />);
    expect(container.firstChild).toBeNull();
    expect(sessionStorage.getItem(WELCOME_PENDING_KEY)).toBeNull();
  });
});
