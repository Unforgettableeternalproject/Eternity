/**
 * dock chip 瞬時閃爍狀態測試（S9-D.6）
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CHIP_PULSE_MS,
  UEP_CHIP_PULSE_EVENT,
  clearAllChipPulses,
  flashChip,
  getChipPulse,
} from '../chipAttention';

describe('chipAttention', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    clearAllChipPulses();
  });

  afterEach(() => {
    clearAllChipPulses();
    vi.useRealTimers();
  });

  it('flashChip 後可讀到閃爍原因，並廣播事件', () => {
    const onPulse = vi.fn();
    window.addEventListener(UEP_CHIP_PULSE_EVENT, onPulse);
    flashChip('history', '閱讀進度已更新');
    expect(getChipPulse('history')).toBe('閱讀進度已更新');
    expect(onPulse).toHaveBeenCalledTimes(1);
    window.removeEventListener(UEP_CHIP_PULSE_EVENT, onPulse);
  });

  it('重複 flash 會重新計時，不會累積成兩次獨立倒數', () => {
    flashChip('history', '第一次');
    // 快到期前再次觸發：計時器必須整個重算，不能沿用舊的到期時間
    vi.advanceTimersByTime(CHIP_PULSE_MS - 100);
    flashChip('history', '第二次');
    vi.advanceTimersByTime(CHIP_PULSE_MS - 100);
    // 若沒有重新計時，舊計時器早已在此刻觸發並把狀態刪掉
    expect(getChipPulse('history')).toBe('第二次');

    vi.advanceTimersByTime(100);
    expect(getChipPulse('history')).toBeNull();
  });

  it('CHIP_PULSE_MS 後自動清除並廣播事件', () => {
    const onPulse = vi.fn();
    window.addEventListener(UEP_CHIP_PULSE_EVENT, onPulse);
    flashChip('echoes', '有回聲等待插播');
    onPulse.mockClear(); // 排除 flashChip 本身觸發的那一次

    vi.advanceTimersByTime(CHIP_PULSE_MS);
    expect(getChipPulse('echoes')).toBeNull();
    expect(onPulse).toHaveBeenCalledTimes(1);
    window.removeEventListener(UEP_CHIP_PULSE_EVENT, onPulse);
  });

  it('不同島各自獨立計時，互不影響', () => {
    flashChip('history', 'A');
    flashChip('echoes', 'B');
    expect(getChipPulse('history')).toBe('A');
    expect(getChipPulse('echoes')).toBe('B');

    vi.advanceTimersByTime(CHIP_PULSE_MS);
    expect(getChipPulse('history')).toBeNull();
    expect(getChipPulse('echoes')).toBeNull();
  });

  it('clearAllChipPulses 清光所有計時器與狀態', () => {
    flashChip('history', 'A');
    flashChip('echoes', 'B');
    clearAllChipPulses();
    expect(getChipPulse('history')).toBeNull();
    expect(getChipPulse('echoes')).toBeNull();

    // 計時器應已被清除；推進到原本會觸發的時間點也不該再有動靜
    const onPulse = vi.fn();
    window.addEventListener(UEP_CHIP_PULSE_EVENT, onPulse);
    vi.advanceTimersByTime(CHIP_PULSE_MS + 10);
    expect(onPulse).not.toHaveBeenCalled();
    window.removeEventListener(UEP_CHIP_PULSE_EVENT, onPulse);
  });

  it('沒有任何閃爍時 getChipPulse 回傳 null', () => {
    expect(getChipPulse('visuals')).toBeNull();
  });
});
