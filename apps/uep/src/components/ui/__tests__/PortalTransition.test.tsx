import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PortalTransition from '../PortalTransition';

describe('PortalTransition', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('父層重渲染並更換 callback 時，不會重設轉場完成計時器', () => {
    const firstOnDone = vi.fn();
    const latestOnDone = vi.fn();
    const view = render(
      <PortalTransition zone={null} homeMode onDone={firstOnDone} />
    );

    act(() => vi.advanceTimersByTime(600));
    view.rerender(
      <PortalTransition zone={null} homeMode onDone={latestOnDone} />
    );
    act(() => vi.advanceTimersByTime(600));

    expect(firstOnDone).not.toHaveBeenCalled();
    expect(latestOnDone).toHaveBeenCalledTimes(1);
  });
});
