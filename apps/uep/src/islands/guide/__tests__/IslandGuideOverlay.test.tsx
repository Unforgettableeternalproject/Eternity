/**
 * IslandGuideOverlay 測試
 *
 * 核心契約：完成／略過／Escape 三種收束語意不同、anchor 量不到時降級成
 * 置中卡且元素回來後恢復聚光、島被關掉即取消、焦點限制在說明卡內。
 */
import { render, screen, act, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getIslandRuntime } from '../../islandRuntime';
import IslandGuideOverlay from '../IslandGuideOverlay';
import type { GuideStep } from '../guideSteps';

/** 造一座假的 History 島，class 與 IslandHost 掛的一致 */
function mountIsland(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'uep-island uep-island--history';
  const target = document.createElement('div');
  target.className = 'target';
  root.appendChild(target);
  document.body.appendChild(root);
  return root;
}

/** jsdom 的 getBoundingClientRect 一律回 0，量不到就會降級 */
function stubRect(el: Element, rect: Partial<DOMRect>) {
  vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
    top: 100,
    left: 200,
    width: 120,
    height: 60,
    right: 320,
    bottom: 160,
    x: 200,
    y: 100,
    toJSON: () => ({}),
    ...rect,
  } as DOMRect);
}

function makeSteps(anchor: () => Element | null): GuideStep[] {
  return [
    { anchor, title: '第一步', body: '第一步說明' },
    { anchor, title: '第二步', body: '第二步說明' },
  ];
}

async function flushFrames() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(32);
  });
}

describe('IslandGuideOverlay', () => {
  beforeEach(() => {
    // fake timers 本身就接管 requestAnimationFrame，
    // 推進計時器即可讓 remeasure 的那一幀落地
    vi.useFakeTimers();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('逐步前進，最後一步按下才算完成', async () => {
    const root = mountIsland();
    const target = root.querySelector('.target')!;
    stubRect(target, {});
    const onClose = vi.fn();

    render(
      <IslandGuideOverlay
        islandId="history"
        steps={makeSteps(() => target)}
        onClose={onClose}
      />
    );
    await flushFrames();

    expect(screen.getByText('第一步')).toBeTruthy();
    expect(screen.getByText('1 / 2')).toBeTruthy();

    await act(async () => screen.getByText('下一步').click());
    expect(screen.getByText('第二步')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => screen.getByText('知道了').click());
    expect(onClose).toHaveBeenCalledWith('completed');
  });

  it('可以回上一步；第一步沒有上一步鈕', async () => {
    const root = mountIsland();
    const target = root.querySelector('.target')!;
    stubRect(target, {});

    render(
      <IslandGuideOverlay
        islandId="history"
        steps={makeSteps(() => target)}
        onClose={vi.fn()}
      />
    );
    await flushFrames();

    expect(screen.queryByText('上一步')).toBeNull();
    await act(async () => screen.getByText('下一步').click());
    await act(async () => screen.getByText('上一步').click());
    expect(screen.getByText('第一步')).toBeTruthy();
  });

  it('略過教學與 Escape 的收束語意不同', async () => {
    const root = mountIsland();
    const target = root.querySelector('.target')!;
    stubRect(target, {});
    const onClose = vi.fn();

    const { unmount } = render(
      <IslandGuideOverlay
        islandId="history"
        steps={makeSteps(() => target)}
        onClose={onClose}
      />
    );
    await flushFrames();

    await act(async () => screen.getByText('略過教學').click());
    expect(onClose).toHaveBeenCalledWith('skipped');
    unmount();

    onClose.mockClear();
    render(
      <IslandGuideOverlay
        islandId="history"
        steps={makeSteps(() => target)}
        onClose={onClose}
      />
    );
    await flushFrames();

    await act(async () => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    // Escape 只停止這次播放，不算看過
    expect(onClose).toHaveBeenCalledWith('dismissed');
  });

  it('anchor 量不到時降級成置中卡，元素回來後恢復聚光', async () => {
    const root = mountIsland();
    const target = root.querySelector('.target')!;
    let visible = false;
    stubRect(target, {});

    render(
      <IslandGuideOverlay
        islandId="history"
        steps={makeSteps(() => (visible ? target : null))}
        onClose={vi.fn()}
      />
    );
    await flushFrames();

    expect(document.querySelector('.iguide-scrim')).toBeTruthy();
    expect(document.querySelector('.iguide-spot')).toBeNull();
    expect(document.querySelector('.iguide-card--center')).toBeTruthy();

    // anchor 出現 → MutationObserver 觸發重量
    visible = true;
    await act(async () => {
      root.appendChild(document.createElement('span'));
      await vi.advanceTimersByTimeAsync(32);
    });

    expect(document.querySelector('.iguide-spot')).toBeTruthy();
    expect(document.querySelector('.iguide-scrim')).toBeNull();
  });

  it('尺寸為 0 的 anchor 視同量不到（收合中的元素）', async () => {
    const root = mountIsland();
    const target = root.querySelector('.target')!;
    stubRect(target, { width: 0, height: 0 });

    render(
      <IslandGuideOverlay
        islandId="history"
        steps={makeSteps(() => target)}
        onClose={vi.fn()}
      />
    );
    await flushFrames();

    expect(document.querySelector('.iguide-spot')).toBeNull();
  });

  it('拖曳中暫時收起聚光框', async () => {
    const root = mountIsland();
    const target = root.querySelector('.target')!;
    stubRect(target, {});

    render(
      <IslandGuideOverlay
        islandId="history"
        steps={makeSteps(() => target)}
        onClose={vi.fn()}
      />
    );
    await flushFrames();
    expect(document.querySelector('.iguide-spot')).toBeTruthy();

    await act(async () => {
      root.classList.add('uep-island--dragging');
      await vi.advanceTimersByTimeAsync(32);
    });
    expect(document.querySelector('.iguide-spot')).toBeNull();

    await act(async () => {
      root.classList.remove('uep-island--dragging');
      await vi.advanceTimersByTimeAsync(32);
    });
    expect(document.querySelector('.iguide-spot')).toBeTruthy();
  });

  it('島被關掉時取消，且不算看過', async () => {
    const root = mountIsland();
    const target = root.querySelector('.target')!;
    stubRect(target, {});
    const onClose = vi.fn();
    const runtime = getIslandRuntime();
    runtime.open('history');

    render(
      <IslandGuideOverlay
        islandId="history"
        steps={makeSteps(() => target)}
        onClose={onClose}
      />
    );
    await flushFrames();

    await act(async () => {
      runtime.close('history');
      await vi.advanceTimersByTimeAsync(32);
    });
    expect(onClose).toHaveBeenCalledWith('dismissed');
  });

  it('是 modal：有 aria-modal、可讀的步驟計數，焦點進到說明卡', async () => {
    const root = mountIsland();
    const target = root.querySelector('.target')!;
    stubRect(target, {});

    render(
      <IslandGuideOverlay
        islandId="history"
        steps={makeSteps(() => target)}
        onClose={vi.fn()}
      />
    );
    await flushFrames();

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toContain('第 1 步，共 2 步');
    expect(
      document.querySelector('.iguide-card')?.contains(document.activeElement)
    ).toBe(true);
  });
});
