/**
 * WidgetEditor — 音樂曲目與網站狀態項目的上下移排序
 *
 * 兩者前台都依陣列順序顯示（音樂另依此循序播放），排序寫回同一張卡片
 * 的 content，標記未儲存後隨一般存檔送出。
 */
import '@testing-library/jest-dom/vitest';
import { render, fireEvent, waitFor, within } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import type { RootCard } from '../../lib/api';

import WidgetEditor from './WidgetEditor';

const tracks = ['甲', '乙', '丙'].map((n) => ({
  title: `曲${n}`,
  artist: `演出${n}`,
  url: `/api/root/assets/audio/${n}.mp3`,
}));
const statusItems = ['A', 'B', 'C'].map((k) => ({
  key: `KEY_${k}`,
  value: `值${k}`,
  color: 'green',
}));

function card(sectionId: string, content: Record<string, unknown>): RootCard {
  return { sectionId, content, updatedAt: '' };
}

function setup() {
  const api = vi.fn(async () => ({ ok: true }));
  const utils = render(
    <WidgetEditor
      cards={[
        card('card-music', { enabled: true, tracks }),
        card('card-status', { enabled: true, items: statusItems }),
      ]}
      api={api}
      apiBase=""
      token=""
      visitorApiUrl=""
    />
  );
  return { api, ...utils };
}

const values = (placeholder: string) =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>(
      `input[placeholder="${placeholder}"]`
    )
  ).map((el) => el.value);

const upButtons = () =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>('button[title="上移"]')
  );
const downButtons = () =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>('button[title="下移"]')
  );

function save() {
  fireEvent.click(document.querySelector('.qe-topbar__btn--primary')!);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('WidgetEditor — 音樂曲目排序', () => {
  it('首項不可上移、末項不可下移', () => {
    setup();
    expect(upButtons()).toHaveLength(3);
    expect(upButtons()[0]).toBeDisabled();
    expect(upButtons()[1]).toBeEnabled();
    expect(downButtons()[2]).toBeDisabled();
    expect(downButtons()[0]).toBeEnabled();
  });

  it('下移／上移後順序正確、整首資料跟著走，存檔送出新順序', async () => {
    const { api } = setup();
    fireEvent.click(downButtons()[0]); // 甲 ↓ → 乙 甲 丙
    expect(values('曲名')).toEqual(['曲乙', '曲甲', '曲丙']);
    fireEvent.click(upButtons()[2]); // 丙 ↑ → 乙 丙 甲
    expect(values('曲名')).toEqual(['曲乙', '曲丙', '曲甲']);
    expect(values('演出者')).toEqual(['演出乙', '演出丙', '演出甲']);
    expect(values('/music/track.mp3')).toEqual([
      '/api/root/assets/audio/乙.mp3',
      '/api/root/assets/audio/丙.mp3',
      '/api/root/assets/audio/甲.mp3',
    ]);
    expect(document.body).toHaveTextContent('未儲存');

    save();
    await waitFor(() => expect(api).toHaveBeenCalled());
    const [path, method, body] = api.mock.calls[0] as unknown as [
      string,
      string,
      { content: { tracks: typeof tracks } },
    ];
    expect(path).toBe('/api/root/cards/card-music');
    expect(method).toBe('PUT');
    expect(body.content.tracks.map((t) => t.title)).toEqual([
      '曲乙',
      '曲丙',
      '曲甲',
    ]);
  });

  it('上傳音檔同時寫入 url 與自動標題（不互相覆蓋）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, data: { key: 'audio/new-song.mp3' } }),
      }))
    );
    setup();
    fireEvent.click(document.querySelector('.qe-btn[style*="dashed"]')!); // + 新增曲目
    expect(values('曲名')).toEqual(['曲甲', '曲乙', '曲丙', '']);

    const uploadButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button')
    ).filter((b) => b.textContent === '↑ 上傳音檔');
    fireEvent.click(uploadButtons[3]);
    const fileInput =
      document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const file = new File(['x'], 'new-song.mp3', { type: 'audio/mpeg' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() =>
      expect(values('/music/track.mp3')[3]).toBe(
        '/api/root/assets/audio/new-song.mp3'
      )
    );
    expect(values('曲名')[3]).toBe('new-song');
  });
});

describe('WidgetEditor — 網站狀態項目排序', () => {
  it('上下移後順序正確，存檔送出新順序', async () => {
    const { api, container } = setup();
    // 左側清單切到「網站狀態」
    fireEvent.click(within(container).getByText('網站狀態'));
    expect(values('STATUS')).toEqual(['KEY_A', 'KEY_B', 'KEY_C']);
    expect(upButtons()[0]).toBeDisabled();
    expect(downButtons()[2]).toBeDisabled();

    fireEvent.click(upButtons()[2]); // C ↑ → A C B
    expect(values('STATUS')).toEqual(['KEY_A', 'KEY_C', 'KEY_B']);
    expect(values('Online')).toEqual(['值A', '值C', '值B']);

    save();
    await waitFor(() => expect(api).toHaveBeenCalled());
    const [path, , body] = api.mock.calls[0] as unknown as [
      string,
      string,
      { content: { items: typeof statusItems } },
    ];
    expect(path).toBe('/api/root/cards/card-status');
    expect(body.content.items.map((i) => i.key)).toEqual([
      'KEY_A',
      'KEY_C',
      'KEY_B',
    ]);
  });
});
