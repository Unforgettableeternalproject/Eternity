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

describe('InterlinkTriggerButton — 不顯示 entity 說明（2026-08-02 定案）', () => {
  /*
   * entity 的權威敘述在 Concepts dossier 條目上，而這顆按鈕就長在 dossier
   * 裡面，tooltip 再講一次是重複。原本的 hover lazy 查詢與模組級快取整組
   * 移除——這幾條是防止有人「順手加回來」的鎖。
   */
  it('title 恆為動作說明，hover 不會被任何查詢結果換掉', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({
            ok: true,
            data: { keyMeta: { description: '不該出現在 tooltip' } },
          }),
      })
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    await renderAndWait(
      <InterlinkTriggerButton entityKey="desc-novia" label="諾薇亞" />
    );

    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('title', '找「諾薇亞」相關的回聲與影像');
    await user.hover(button);
    expect(button).toHaveAttribute('title', '找「諾薇亞」相關的回聲與影像');
  });

  it('hover 不打 interlink keys 端點', async () => {
    const fetchMock = vi.fn((_url: string) =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })
    );
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    await renderAndWait(
      <InterlinkTriggerButton entityKey="desc-nobody" label="無說明的人" />
    );

    await user.hover(screen.getByRole('button'));
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/api/interlink/keys'))).toBe(false);
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
