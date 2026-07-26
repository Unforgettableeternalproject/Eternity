/**
 * 五座島的島頭一致性（S9-C.9）
 *
 * 「所有浮島都要有標題跟關閉按鈕」是艾斯維爾 2026-07-25 的驗收條件，而
 * bare 外殼把 chrome 交給各島自畫之後，這件事沒有任何一處程式碼能保證
 * ——漏掉就是某座島默默沒有名字（visuals 在 S9-C.11 之前正是如此）。
 *
 * 所以這裡不測各島的材質，只測共用契約：島名文字要對得上
 * ISLAND_DEFINITIONS、收合鈕要在、按下去要真的請求收合。
 */
import { cleanup, fireEvent, render } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TerminalIsland from '../concepts/TerminalIsland';
import EchoesIsland from '../echoes/EchoesIsland';
import HistoryIsland from '../history/HistoryIsland';
import { IslandChromeContext } from '../islandChrome';
import type { IslandChromeValue } from '../islandChrome';
import StorageIsland from '../storage/StorageIsland';
import { ISLAND_DEFINITIONS } from '../types';
import type { IslandId } from '../types';
import VisualsIsland from '../visuals/VisualsIsland';

const noop = () => {};

function renderIsland(id: IslandId, node: React.ReactElement) {
  const requestClose = vi.fn();
  const chrome: IslandChromeValue = {
    bare: true,
    dragHandleProps: {
      'data-island-grip': '',
      onPointerDown: noop,
      onPointerMove: noop,
      onPointerUp: noop,
      onPointerCancel: noop,
    },
    requestClose,
    leaving: false,
    entering: false,
  };
  const view = render(
    <IslandChromeContext.Provider value={chrome}>
      {node}
    </IslandChromeContext.Provider>
  );
  return { ...view, requestClose, def: ISLAND_DEFINITIONS[id] };
}

const CASES: Array<[IslandId, () => React.ReactElement]> = [
  ['history', () => <HistoryIsland />],
  ['concepts', () => <TerminalIsland />],
  ['echoes', () => <EchoesIsland />],
  ['visuals', () => <VisualsIsland />],
  ['storage', () => <StorageIsland />],
];

afterEach(() => {
  cleanup();
});

describe('島頭一致性', () => {
  it.each(CASES)('%s 島畫得出島名', (id, make) => {
    const { container, def } = renderIsland(id, make());
    const title = container.querySelector('.uep-island-title');
    expect(title).not.toBeNull();
    // 終端的島名前面還有一個 ›_ 提示符，所以用包含而非相等
    expect(title!.textContent).toContain(def.title);
  });

  it.each(CASES)('%s 島的收合鈕會請求收合', (id, make) => {
    const { container, requestClose } = renderIsland(id, make());
    const close = container.querySelector('.uep-island-close');
    expect(close).not.toBeNull();
    // 收合鈕一律是該島語彙的短詞，不是符號——符號在材質上像異物
    expect(close!.textContent?.trim().length).toBeGreaterThan(1);
    fireEvent.click(close!);
    expect(requestClose).toHaveBeenCalledTimes(1);
  });
});

describe('浮動幻影：清除投射與收合分開', () => {
  it('沒有投射時只有收合鈕', () => {
    const { container } = renderIsland('visuals', <VisualsIsland />);
    expect(container.querySelector('.uep-visland__clear')).toBeNull();
    expect(container.querySelector('.uep-island-close')).not.toBeNull();
  });
});
