/**
 * dossier「詳細」按鈕測試（S10-1，艾斯維爾 2026-07-27 定案）
 *
 * 重點在「什麼時候不該出現」——按鈕出現就代表那個 entity 在 browser 有
 * 看得到的檔案。未解鎖的條目若長出按鈕，等於替還沒讀到的角色開了一道門。
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const coreMock = vi.hoisted(() => ({ unlocked: true }));
vi.mock('../../../islands/concepts/terminalCore', () => ({
  findByEntityKey: (
    entries: { entityKey?: string }[],
    key: string
  ): unknown[] => entries.filter((e) => e.entityKey === key),
  isIndexEntryUnlocked: () => coreMock.unlocked,
}));

vi.mock('../../../progress/useProgress', () => ({
  useProgress: () => ({}),
}));

import BrowserDetailButton from '../BrowserDetailButton';

type Entry = {
  name: string;
  stack: string;
  pageId: string;
  pageTitle: string;
  entityKey?: string;
};

const index = [
  {
    name: '艾斯維爾',
    stack: 'dossier',
    pageId: 'concepts/server/records/character_list',
    pageTitle: '人物',
    entityKey: 'xavier-colsono',
  },
  {
    name: '艾斯維爾',
    stack: 'browser',
    pageId: 'concepts/server/browser/charateristics',
    pageTitle: '個性',
    entityKey: 'xavier-colsono',
  },
] as Entry[];

beforeEach(() => {
  coreMock.unlocked = true;
});

function renderButton(
  props: Partial<React.ComponentProps<typeof BrowserDetailButton>> = {}
) {
  const onNavigate = vi.fn();
  const result = render(
    <BrowserDetailButton
      entityKey="xavier-colsono"
      label="艾斯維爾"
      index={index as never}
      onNavigate={onNavigate}
      {...props}
    />
  );
  return { ...result, onNavigate };
}

describe('BrowserDetailButton — 渲染守門', () => {
  it('entity 在 browser 有已解鎖條目 → 渲染', () => {
    renderButton();
    expect(
      screen.getByRole('button', { name: '前往「艾斯維爾」的完整檔案' })
    ).toBeTruthy();
  });

  it('沒有 entityKey → 不渲染', () => {
    const { container } = renderButton({ entityKey: undefined });
    expect(container).toBeEmptyDOMElement();
  });

  it('索引尚未載入（null）→ 不渲染', () => {
    const { container } = renderButton({ index: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('該 entity 只在 dossier 有、browser 沒有 → 不渲染', () => {
    const { container } = renderButton({
      index: [index[0]] as never,
    });
    expect(container).toBeEmptyDOMElement();
  });

  /* 索引回的是全部條目摘要，不分是否已解鎖——少了這層判定就會替還沒讀到
     的角色長出一顆入口按鈕。 */
  it('browser 條目尚未解鎖 → 不渲染', () => {
    coreMock.unlocked = false;
    const { container } = renderButton();
    expect(container).toBeEmptyDOMElement();
  });
});

describe('BrowserDetailButton — 觸發', () => {
  it('點擊帶 browser 條目的 pageId 與 entityKey 導航', async () => {
    const user = userEvent.setup();
    const { onNavigate } = renderButton();
    await user.click(screen.getByRole('button'));
    expect(onNavigate).toHaveBeenCalledWith(
      'concepts/server/browser/charateristics',
      'xavier-colsono'
    );
  });

  it('點按鈕不連帶觸發條目卡本身的點擊', async () => {
    const user = userEvent.setup();
    const onCardClick = vi.fn();
    const onNavigate = vi.fn();
    render(
      <div onClick={onCardClick}>
        <BrowserDetailButton
          entityKey="xavier-colsono"
          label="艾斯維爾"
          index={index as never}
          onNavigate={onNavigate}
        />
      </div>
    );
    await user.click(screen.getByRole('button'));
    expect(onNavigate).toHaveBeenCalled();
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
