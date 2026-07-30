/**
 * Concepts 條目「相關」按鈕測試（S10-1 T-G3）
 *
 * 這顆按鈕不自己查資料、也不自己造事件——它發的是 `uep:entity-activate`，
 * 與 History 文內點互動式嵌入完全同一個事件，後續分派由 IslandHost 承擔。
 *
 * 因此測試重點在兩件事：
 * 1. **什麼時候不該出現**——守門是「查得到已解鎖內容」，出現即代表按下去
 *    必有反應（事件是 fire-and-forget，拿不到結果、給不了 toast）
 * 2. 發出去的 detail 帶對 entityKey 與 `sourceZone: 'concepts'`
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const islandsMock = vi.hoisted(() => ({
  mounted: {} as Record<string, boolean>,
  desktop: true,
}));
vi.mock('../../../islands', () => ({
  shouldMountIsland: (_progress: unknown, id: string) =>
    islandsMock.mounted[id] ?? false,
  useDesktopIslandViewport: () => islandsMock.desktop,
}));

const indexMock = vi.hoisted(() => ({ echo: true, visual: true }));
vi.mock('../../../islands/echoes/echoesEntityIndex', () => ({
  loadEchoesEntityIndex: () => Promise.resolve([]),
  isEchoesEntityUnlocked: () => indexMock.echo,
}));
vi.mock('../../../islands/visuals/visualsEntityIndex', () => ({
  loadVisualsEntityIndex: () => Promise.resolve([]),
  isVisualsEntityUnlocked: () => indexMock.visual,
}));

vi.mock('../../../progress/useProgress', () => ({ useProgress: () => ({}) }));

import { UEP_ENTITY_ACTIVATE_EVENT } from '../../../embed';
import InterlinkTriggerButton from '../InterlinkTriggerButton';

beforeEach(() => {
  islandsMock.mounted = { echoes: true, visuals: true };
  islandsMock.desktop = true;
  indexMock.echo = true;
  indexMock.visual = true;
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** 索引是非同步載入的——等按鈕出現才算 render 完成 */
async function renderAndWait(ui: React.ReactElement) {
  const result = render(ui);
  await waitFor(() => expect(screen.getByRole('button')).toBeTruthy());
  return result;
}

describe('InterlinkTriggerButton — 渲染守門', () => {
  it('entity 有已解鎖的歌或畫廊 → 渲染', async () => {
    await renderAndWait(
      <InterlinkTriggerButton entityKey="xavier-colsono" label="艾斯維爾" />
    );
    expect(
      screen.getByRole('button', { name: '找「艾斯維爾」相關的回聲與影像' })
    ).toBeTruthy();
  });

  it('條目沒有 entityKey → 不渲染', () => {
    const { container } = render(<InterlinkTriggerButton label="無名氏" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('entityKey 只有空白 → 視同沒有', () => {
    const { container } = render(
      <InterlinkTriggerButton entityKey="   " label="無名氏" />
    );
    expect(container).toBeEmptyDOMElement();
  });

  /* 事件是 fire-and-forget，按了查無結果時沒辦法補 toast——所以守門改成
     「查得到才長按鈕」，避免出現「按了完全沒反應」。 */
  it('兩邊都查無內容 → 不渲染（不留一顆按了沒反應的鈕）', async () => {
    indexMock.echo = false;
    indexMock.visual = false;
    const { container } = render(
      <InterlinkTriggerButton entityKey="nobody" label="沒人提過" />
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('只有其中一邊查得到 → 仍然渲染', async () => {
    indexMock.visual = false;
    await renderAndWait(
      <InterlinkTriggerButton entityKey="xavier-colsono" label="艾斯維爾" />
    );
    expect(screen.getByRole('button')).toBeTruthy();
  });

  /* 逐島判定而非聯集：島沒掛載時事件廣播出去沒有消費者，
     只解鎖 Echoes 的讀者不該因為這個 entity「只有畫廊」而看到按鈕。 */
  it('島未掛載時該側不算數（只有畫廊但 Visuals 停用 → 不渲染）', async () => {
    islandsMock.mounted = { echoes: true, visuals: false };
    indexMock.echo = false;
    const { container } = render(
      <InterlinkTriggerButton entityKey="xavier-colsono" label="艾斯維爾" />
    );
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it('非桌面寬度 → 不渲染', () => {
    islandsMock.desktop = false;
    const { container } = render(
      <InterlinkTriggerButton entityKey="xavier-colsono" label="艾斯維爾" />
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('InterlinkTriggerButton — 觸發', () => {
  it('點擊發出 entity-activate，帶 entityKey 與 sourceZone', async () => {
    const listener = vi.fn();
    window.addEventListener(UEP_ENTITY_ACTIVATE_EVENT, listener);
    const user = userEvent.setup();
    await renderAndWait(
      <InterlinkTriggerButton entityKey="xavier-colsono" label="艾斯維爾" />
    );
    await user.click(screen.getByRole('button'));
    window.removeEventListener(UEP_ENTITY_ACTIVATE_EVENT, listener);

    expect(listener).toHaveBeenCalledTimes(1);
    const detail = (listener.mock.calls[0][0] as CustomEvent).detail;
    expect(detail).toMatchObject({
      entityKey: 'xavier-colsono',
      ref: 'entity:xavier-colsono',
      text: '艾斯維爾',
      // Terminal 島據此跳過自己——使用者正看著這個條目
      sourceZone: 'concepts',
    });
  });

  it('點按鈕不連帶觸發條目卡本身的點擊', async () => {
    const onCardClick = vi.fn();
    const user = userEvent.setup();
    render(
      <div onClick={onCardClick}>
        <InterlinkTriggerButton entityKey="xavier-colsono" label="艾斯維爾" />
      </div>
    );
    await waitFor(() => expect(screen.getByRole('button')).toBeTruthy());
    await user.click(screen.getByRole('button'));
    expect(onCardClick).not.toHaveBeenCalled();
  });
});

describe('InterlinkTriggerButton — hover 顯示說明（S10-3b T-B7）', () => {
  function stubKeyMeta(description: string | null) {
    const fetchMock = vi.fn((_url: string) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ ok: true, data: { keyMeta: { description } } }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
  }

  it('hover 後 lazy 載入 description 當 title；同 key 只查一次（模組快取）', async () => {
    const fetchMock = stubKeyMeta('命運織者的主要程式碼執行者');
    const user = userEvent.setup();
    await renderAndWait(
      <InterlinkTriggerButton entityKey="desc-novia" label="諾薇亞" />
    );

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('title', '找「諾薇亞」相關的回聲與影像');

    await user.hover(button);
    await waitFor(() =>
      expect(button).toHaveAttribute('title', '命運織者的主要程式碼執行者')
    );
    expect(String(fetchMock.mock.calls[0][0])).toContain('keyType=entity');
    expect(String(fetchMock.mock.calls[0][0])).toContain('key=desc-novia');

    // 再 hover 不重查（元件內已定案 + 模組級 Promise 快取）
    await user.unhover(button);
    await user.hover(button);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('沒有 description 時維持原本的動作說明字樣', async () => {
    stubKeyMeta(null);
    const user = userEvent.setup();
    await renderAndWait(
      <InterlinkTriggerButton entityKey="desc-nobody" label="無說明的人" />
    );

    const button = screen.getByRole('button');
    await user.hover(button);
    // 查完仍是 null → title 不變
    await waitFor(() =>
      expect(button).toHaveAttribute(
        'title',
        '找「無說明的人」相關的回聲與影像'
      )
    );
  });

  it('查詢掛掉不影響按鈕本體（點擊照常發事件）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('down')))
    );
    const listener = vi.fn();
    window.addEventListener(UEP_ENTITY_ACTIVATE_EVENT, listener);
    const user = userEvent.setup();
    await renderAndWait(
      <InterlinkTriggerButton entityKey="desc-broken" label="斷線的人" />
    );

    const button = screen.getByRole('button');
    await user.hover(button);
    await user.click(button);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(UEP_ENTITY_ACTIVATE_EVENT, listener);
  });
});
