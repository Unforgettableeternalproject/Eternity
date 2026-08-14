import { describe, expect, it } from 'vitest';
import {
  FOG_JUMP_THRESHOLD_VH,
  computeContentRatio,
  computeElementRatio,
  isNonScrollable,
  isWithinFogReach,
  limitFogAdvance,
  ratioToScrollTop,
} from '../fogGate';

const VIEWPORT = 1000;
const SCROLL_HEIGHT = 10000;

describe('computeContentRatio', () => {
  it('量的是掃描線（視窗 80% 處）掃到哪，不是捲動條拉到哪', () => {
    // 尚未捲動時，掃描線已經在 800px 處
    expect(computeContentRatio(0, VIEWPORT, SCROLL_HEIGHT)).toBe(0.08);
    expect(computeContentRatio(4200, VIEWPORT, SCROLL_HEIGHT)).toBe(0.5);
  });

  /**
   * 掃描線停在 80% 處，捲到極限時公式只會給 1 - 0.2*viewport/scrollHeight。
   * 若不特判，文末那段永遠蓋著霧，哨兵的「fogRatio >= 1」也永遠不成立，
   * 文章無法完成——捲到底本來就等於讀完。
   */
  it('捲到底直接回 1，不留最後一段', () => {
    expect(computeContentRatio(9000, VIEWPORT, SCROLL_HEIGHT)).toBe(1);
    expect(computeContentRatio(8999, VIEWPORT, SCROLL_HEIGHT)).toBe(1);
    expect(computeContentRatio(99999, VIEWPORT, SCROLL_HEIGHT)).toBe(1);
    // 還沒到底就照常套公式
    expect(computeContentRatio(8000, VIEWPORT, SCROLL_HEIGHT)).toBe(0.88);
  });

  it('內容不可捲動時直接回 1（短文豁免的同一個判準）', () => {
    expect(computeContentRatio(0, VIEWPORT, VIEWPORT)).toBe(1);
    expect(computeContentRatio(0, VIEWPORT, 500)).toBe(1);
  });

  it('scrollHeight 為 0 或非法時回 0，不吐 NaN 汙染 store', () => {
    expect(computeContentRatio(100, VIEWPORT, 0)).toBe(0);
    expect(computeContentRatio(100, VIEWPORT, NaN)).toBe(0);
  });
});

describe('isNonScrollable — 短文死鎖防護', () => {
  it('內容不比視窗高就豁免迷霧', () => {
    expect(isNonScrollable(800, 1000)).toBe(true);
    expect(isNonScrollable(1000, 1000)).toBe(true);
    // 1px 浮點容忍
    expect(isNonScrollable(1001, 1000)).toBe(true);
    expect(isNonScrollable(1002, 1000)).toBe(false);
  });
});

describe('isWithinFogReach — 跳躍判定', () => {
  it('往回捲一律放行（只擋往下跳）', () => {
    expect(isWithinFogReach(0.1, 0.8, VIEWPORT, SCROLL_HEIGHT)).toBe(true);
    expect(isWithinFogReach(0.8, 0.8, VIEWPORT, SCROLL_HEIGHT)).toBe(true);
  });

  it('往下推進不超過門檻（1.5 個視窗高）就放行', () => {
    // 門檻 = 1.5 * 1000 / 10000 = 0.15
    expect(isWithinFogReach(0.24, 0.1, VIEWPORT, SCROLL_HEIGHT)).toBe(true);
    expect(isWithinFogReach(0.25, 0.1, VIEWPORT, SCROLL_HEIGHT)).toBe(true);
    expect(isWithinFogReach(0.26, 0.1, VIEWPORT, SCROLL_HEIGHT)).toBe(false);
  });

  it('直接跳到文末被擋下', () => {
    expect(isWithinFogReach(1, 0.05, VIEWPORT, SCROLL_HEIGHT)).toBe(false);
  });

  /**
   * 這是整套機制最容易誤植的地方：比較基準必須是「已站穩的迷霧線」，
   * 不是「上一次取樣位置」。若比 delta，rush 之後的小幅捲動會把迷霧線
   * 一路拖著追上讀者，防護形同虛設。
   */
  it('rush 到文末後的小幅捲動不會把迷霧線拖上去', () => {
    const stored = 0.1; // 迷霧線還停在 10%
    // 讀者已經 rush 到 95%，接著只小幅捲動（delta 很小）
    expect(isWithinFogReach(0.95, stored, VIEWPORT, SCROLL_HEIGHT)).toBe(false);
    expect(isWithinFogReach(0.96, stored, VIEWPORT, SCROLL_HEIGHT)).toBe(false);
    // 退回迷霧線附近才會重新被接受
    expect(isWithinFogReach(0.2, stored, VIEWPORT, SCROLL_HEIGHT)).toBe(true);
  });

  it('門檻隨文章長度縮放，短文比例上更寬鬆', () => {
    const short = 2000;
    // 同樣 1.5vh，在短文等於 75% 的 ratio 空間
    expect(isWithinFogReach(0.8, 0.1, VIEWPORT, short)).toBe(true);
    // 同樣的 ratio 差距在長文則被擋
    expect(isWithinFogReach(0.8, 0.1, VIEWPORT, 100000)).toBe(false);
  });

  it('門檻常數就是設計文件寫的值（改動要連同實測校準）', () => {
    expect(FOG_JUMP_THRESHOLD_VH).toBe(1.5);
  });
});

/**
 * 跳躍門檻擋不住 speedrun：取樣跑在 rAF 上，快速捲動是「連續多幀各走
 * 一小步」，每步都在門檻內。只有速率上限攔得住。
 */
describe('limitFogAdvance — 推進速率上限', () => {
  // 上限 0.55 vh/s；1 秒的額度 = 0.55 * 1000 / 10000 = 0.055 ratio
  it('慢讀時完全跟上（推進量低於上限）', () => {
    expect(limitFogAdvance(0.13, 0.1, 1000, VIEWPORT, SCROLL_HEIGHT)).toBe(
      0.13
    );
  });

  it('快速捲動被截斷成該時段的額度', () => {
    // 一秒內想推進 0.4，只給 0.055
    const next = limitFogAdvance(0.5, 0.1, 1000, VIEWPORT, SCROLL_HEIGHT);
    expect(next).toBeCloseTo(0.155, 5);
  });

  it('連續多幀小步同樣被逐幀限制（speedrun 的實際形狀）', () => {
    let stored = 0;
    // 每 16ms 捲一屏（0.1 ratio）——每步都過得了跳躍門檻
    for (let i = 0; i < 10; i += 1) {
      const candidate = stored + 0.1;
      expect(isWithinFogReach(candidate, stored, VIEWPORT, SCROLL_HEIGHT)).toBe(
        true
      );
      stored = limitFogAdvance(candidate, stored, 16, VIEWPORT, SCROLL_HEIGHT)!;
    }
    // 160ms 的額度只有 0.0088，十幀累積遠不到讀者跑到的 1.0
    expect(stored).toBeLessThan(0.01);
  });

  it('位置沒前進或沒有時間經過時不推進', () => {
    expect(limitFogAdvance(0.1, 0.1, 500, VIEWPORT, SCROLL_HEIGHT)).toBeNull();
    expect(limitFogAdvance(0.05, 0.1, 500, VIEWPORT, SCROLL_HEIGHT)).toBeNull();
    expect(limitFogAdvance(0.3, 0.1, 0, VIEWPORT, SCROLL_HEIGHT)).toBeNull();
  });

  /** 掛機不該累積推進額度——速率限制的語意是閱讀速度，不是掛機時數 */
  it('離開分頁很久再回來，時間差被 cap 住', () => {
    const long = limitFogAdvance(1, 0, 600_000, VIEWPORT, SCROLL_HEIGHT);
    const capped = limitFogAdvance(1, 0, 1200, VIEWPORT, SCROLL_HEIGHT);
    expect(long).toBe(capped);
    expect(long).toBeLessThan(0.1);
  });
});

/**
 * 用真實的 scrollTop 序列驗證整條推進鏈。
 *
 * 前面那些單點測試餵的是任意 ratio，而瀏覽器只會產生「連續的捲動位置
 * 序列」——兩者不是同一件事。這裡重現 HistoryReader.sampleFog 的組合
 * 邏輯（含記憶體累積值當積分基準、首次取樣不限速），確保防護是對著
 * 真實可達狀態成立的。
 */
describe('推進鏈：真實捲動序列', () => {
  /** @returns 迷霧線最終位置（記憶體累積值，未經 store 量化） */
  function simulate(steps: { scrollTop: number; dtMs: number }[]): number {
    let accum = 0;
    steps.forEach((step, index) => {
      const ratio = computeContentRatio(
        step.scrollTop,
        VIEWPORT,
        SCROLL_HEIGHT
      );
      if (!isWithinFogReach(ratio, accum, VIEWPORT, SCROLL_HEIGHT)) return;
      // 進頁第一次取樣不限速（第一屏本來就該可讀）
      const next =
        index === 0
          ? ratio
          : limitFogAdvance(ratio, accum, step.dtMs, VIEWPORT, SCROLL_HEIGHT);
      if (next != null && next > accum) accum = next;
    });
    return accum;
  }

  it('進頁第一屏立即解霧', () => {
    expect(simulate([{ scrollTop: 0, dtMs: 0 }])).toBe(0.08);
  });

  /** 每 500ms 捲 200px ≈ 0.4 屏/秒，低於 0.55 上限 → 應完全跟上 */
  it('正常閱讀速度完全跟得上，霧不會壓著讀者', () => {
    const steps = [{ scrollTop: 0, dtMs: 0 }];
    for (let i = 1; i <= 20; i += 1) {
      steps.push({ scrollTop: i * 200, dtMs: 500 });
    }
    const fog = simulate(steps);
    const readerAt = computeContentRatio(20 * 200, VIEWPORT, SCROLL_HEIGHT);
    expect(fog).toBeCloseTo(readerAt, 5);
  });

  /** 每幀捲 500px ≈ 31 屏/秒 —— 每幀都過得了跳躍門檻，靠限速攔下 */
  it('speedrun 被遠遠拋在後面（迷霧線落後讀者位置）', () => {
    const steps = [{ scrollTop: 0, dtMs: 0 }];
    for (let i = 1; i <= 18; i += 1) {
      steps.push({ scrollTop: i * 500, dtMs: 16 });
    }
    const fog = simulate(steps);
    // 讀者已經到底，迷霧線還在起點附近
    expect(computeContentRatio(9000, VIEWPORT, SCROLL_HEIGHT)).toBe(1);
    expect(fog).toBeLessThan(0.1);
  });

  /** 拖捲軸瞬間到底：單次位移超過跳躍門檻，整步被丟棄 */
  it('拖捲軸直接到底完全不推進', () => {
    expect(
      simulate([
        { scrollTop: 0, dtMs: 0 },
        { scrollTop: 9000, dtMs: 16 },
      ])
    ).toBe(0.08);
  });

  /** rush 之後回頭正常讀，迷霧線照常前進——凍結不是永久懲罰 */
  it('rush 後退回迷霧線附近重新讀，推進恢復', () => {
    const steps = [
      { scrollTop: 0, dtMs: 0 },
      { scrollTop: 9000, dtMs: 16 }, // rush 到底，被擋
      { scrollTop: 200, dtMs: 500 }, // 回頭
    ];
    for (let i = 1; i <= 10; i += 1) {
      steps.push({ scrollTop: 200 + i * 150, dtMs: 500 });
    }
    const fog = simulate(steps);
    expect(fog).toBeGreaterThan(0.2);
  });

  /**
   * 讀者停住時取樣不能斷——速率上限讓迷霧落在讀者後面一小段，若取樣
   * 只由捲動觸發，讀到頁底（再無捲動空間產生事件）迷霧就永遠追不上 1，
   * 哨兵的「fogRatio >= 1」合取永遠不成立，頁面無法完成。
   * HistoryReader 的追趕取樣就是這裡的固定節拍步。
   */
  it('讀到頁底後停住，追趕取樣讓迷霧收斂到 1（頁面得以完成）', () => {
    const steps = [{ scrollTop: 0, dtMs: 0 }];
    // 正常速度讀到底（0.4 屏/秒 < 0.55 上限）
    for (let i = 1; i <= 45; i += 1) {
      steps.push({ scrollTop: Math.min(i * 200, 9000), dtMs: 500 });
    }
    // 停在頁底：沒有捲動事件，只剩追趕取樣的固定節拍
    for (let i = 0; i < 8; i += 1) {
      steps.push({ scrollTop: 9000, dtMs: 240 });
    }
    expect(simulate(steps)).toBe(1);
  });

  /** 追趕的目標是「讀者目前位置」且要先過跳躍門檻——救不了 rush */
  it('rush 到頁底後停住等待，追趕取樣不會替他解圍', () => {
    const steps = [
      { scrollTop: 0, dtMs: 0 },
      { scrollTop: 9000, dtMs: 16 }, // rush 到底
    ];
    for (let i = 0; i < 20; i += 1) {
      steps.push({ scrollTop: 9000, dtMs: 240 }); // 原地等待
    }
    expect(simulate(steps)).toBe(0.08);
  });
});

describe('ratioToScrollTop — 續讀定位', () => {
  it('是 computeContentRatio 的反函式（未到底的區間）', () => {
    const scrollTop = 4200;
    const ratio = computeContentRatio(scrollTop, VIEWPORT, SCROLL_HEIGHT);
    expect(ratioToScrollTop(ratio, VIEWPORT, SCROLL_HEIGHT)).toBe(scrollTop);
  });

  it('接近開頭時反推的負值 clamp 成 0', () => {
    expect(ratioToScrollTop(0.01, VIEWPORT, SCROLL_HEIGHT)).toBe(0);
  });

  it('ratio 為 1 時不超過可捲動上限', () => {
    expect(ratioToScrollTop(1, VIEWPORT, SCROLL_HEIGHT)).toBe(9000);
  });
});

describe('computeElementRatio', () => {
  it('用捲動容器的座標系換算元素位置', () => {
    const scrollEl = document.createElement('div');
    const el = document.createElement('div');
    scrollEl.append(el);
    Object.defineProperty(scrollEl, 'scrollHeight', { value: 10000 });
    scrollEl.scrollTop = 2000;
    scrollEl.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
    el.getBoundingClientRect = () => ({ top: 600 }) as DOMRect;

    // (600 - 100 + 2000) / 10000
    expect(computeElementRatio(el, scrollEl)).toBe(0.25);
  });

  it('scrollHeight 為 0 時回 0，不吐 NaN', () => {
    const scrollEl = document.createElement('div');
    const el = document.createElement('div');
    Object.defineProperty(scrollEl, 'scrollHeight', { value: 0 });
    scrollEl.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    el.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
    expect(computeElementRatio(el, scrollEl)).toBe(0);
  });
});
