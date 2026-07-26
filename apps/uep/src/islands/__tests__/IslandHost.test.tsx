/**
 * IslandHost — entity-activate 消費行為測試（S9-D.5）
 *
 * S9-D.5 起收合的島不再因為互動式嵌入被點擊就強制展開：detail 只會
 * 暫存進 terminalBridge，展開與否交還使用者（dock chip 閃爍提示）。
 * 本檔只驗證這個掛點——其餘掛載守門/資料流由各自模組測試覆蓋。
 *
 * 大量週邊模組（DraggableIsland/IslandDock/testBridge/PinnedNoteLayer/
 * SongPreviewCard）與本測試主張無關，一律換成無副作用的假元件，避免
 * 牽動它們各自的 hook 訂閱造成測試不穩定。
 */
import { act, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EntityActivateDetail } from '../../embed';
import { UEP_ENTITY_ACTIVATE_EVENT } from '../../embed';
import { createInitialState } from '../../progress';
import type { ProgressState } from '../../progress';

const progressMock = vi.hoisted(() => ({
  state: null as ProgressState | null,
}));

/** 可掛載的 zone id；預設只留 concepts，避免牽動 echoes/visuals 各自的
 * entity-activate 反查流程（不是本測試主張）。第二個測試會改成全假。 */
const gatingMock = vi.hoisted(() => ({
  allowedId: 'concepts' as string | null,
}));

vi.mock('../../auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../auth')>()),
  useReaderAuth: () => null,
}));

vi.mock('../../progress', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../progress')>()),
  useProgress: () => progressMock.state,
}));

vi.mock('../islandRuntime', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../islandRuntime')>()),
  canUseIslands: () => true,
  shouldMountIsland: (_progress: unknown, id: string) =>
    id === gatingMock.allowedId,
}));

vi.mock('../useIslands', () => ({
  useDesktopIslandViewport: () => true,
  useIslandRuntimeState: () => ({ windows: {}, focusOrder: [] }),
}));

vi.mock('../DraggableIsland', () => ({ default: () => null }));
vi.mock('../IslandDock', () => ({ default: () => null }));
vi.mock('../testBridge', () => ({
  mountIslandsTestBridge: () => () => {},
}));
vi.mock('../storage/PinnedNoteLayer', () => ({ default: () => null }));
vi.mock('../echoes/SongPreviewCard', () => ({ default: () => null }));

import IslandHost from '../IslandHost';
import {
  hasPendingEntityActivate,
  resetEntityActivateBridge,
} from '../concepts/terminalBridge';
import { getIslandRuntime } from '../islandRuntime';

describe('IslandHost — entity-activate 只留 pending，不強制展開島', () => {
  beforeEach(() => {
    progressMock.state = createInitialState();
    gatingMock.allowedId = 'concepts';
    resetEntityActivateBridge();
  });

  afterEach(() => {
    resetEntityActivateBridge();
    vi.restoreAllMocks();
  });

  it('收到 uep:entity-activate 後 pending 進 terminalBridge，但不呼叫 runtime.open', () => {
    const runtime = getIslandRuntime();
    const openSpy = vi.spyOn(runtime, 'open');

    render(<IslandHost />);

    expect(hasPendingEntityActivate()).toBe(false);

    const detail: EntityActivateDetail = {
      kind: 'character',
      ref: 'entity:test-char',
      entityKey: 'test-char',
    };
    act(() => {
      window.dispatchEvent(
        new CustomEvent<EntityActivateDetail>(UEP_ENTITY_ACTIVATE_EVENT, {
          detail,
        })
      );
    });

    expect(hasPendingEntityActivate()).toBe(true);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('concepts 島不可掛載時（shouldMountIsland 為假），entity-activate 靜默忽略', () => {
    gatingMock.allowedId = null; // 沒有任何 zone 可掛載

    render(<IslandHost />);

    act(() => {
      window.dispatchEvent(
        new CustomEvent<EntityActivateDetail>(UEP_ENTITY_ACTIVATE_EVENT, {
          detail: { kind: 'character', ref: 'entity:test-char' },
        })
      );
    });

    expect(hasPendingEntityActivate()).toBe(false);
  });
});
