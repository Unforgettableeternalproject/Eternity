/**
 * FlagPicker 測試
 *
 * 核心契約是「不存在自由輸入逃生口」——只能選已註冊的旗標，或先註冊再選。
 * 其餘涵蓋搜尋過濾、已選排除、就地新建後立刻可選、409 視為可選。
 */
/* global RequestInit */
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import FlagPicker from '../FlagPicker';

const FLAGS = [
  { name: 'met-mistina', label: '見過米絲媞', category: 'story' },
  { name: 'lost-signal', label: null, category: null },
];

interface Call {
  url: string;
  init?: RequestInit;
}

/** 預設回全部旗標；createStatus 用來模擬 POST 的各種結果 */
function mockApi(opts: { createStatus?: number; createError?: string } = {}) {
  const calls: Call[] = [];
  const created: string[] = [];
  globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (init?.method === 'POST') {
      const status = opts.createStatus ?? 201;
      if (status === 201) {
        created.push(JSON.parse(String(init.body)).name);
        return {
          ok: true,
          status,
          json: async () => ({ ok: true, data: { flag: {} } }),
        };
      }
      return {
        ok: false,
        status,
        json: async () => ({ ok: false, error: opts.createError || '失敗' }),
      };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        // 新建成功後重載要看得到新旗標
        data: {
          flags: [
            ...FLAGS,
            ...created.map((name) => ({ name, label: null, category: null })),
          ],
        },
      }),
    };
  }) as unknown as typeof fetch;
  return { calls };
}

describe('FlagPicker', () => {
  let calls: Call[];

  beforeEach(() => {
    ({ calls } = mockApi());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const openPanel = async () => {
    fireEvent.focus(screen.getByPlaceholderText('搜尋已註冊的旗標…'));
    expect(await screen.findByText('met-mistina')).toBeInTheDocument();
  };

  it('聚焦才載入註冊表，且走同源 proxy', async () => {
    render(<FlagPicker value={[]} onChange={() => {}} />);
    expect(calls.length).toBe(0);
    await openPanel();
    expect(calls.map((c) => c.url)).toEqual(['/api/flags']);
  });

  it('搜尋同時過濾名稱與標籤', async () => {
    render(<FlagPicker value={[]} onChange={() => {}} />);
    await openPanel();
    const input = screen.getByPlaceholderText('搜尋已註冊的旗標…');
    fireEvent.change(input, { target: { value: 'signal' } });
    expect(screen.getByText('lost-signal')).toBeInTheDocument();
    expect(screen.queryByText('met-mistina')).not.toBeInTheDocument();
    // 標籤命中也算
    fireEvent.change(input, { target: { value: '米絲媞' } });
    expect(screen.getByText('met-mistina')).toBeInTheDocument();
    expect(screen.queryByText('lost-signal')).not.toBeInTheDocument();
  });

  it('點選項目加入清單，已選的不再出現在候選', async () => {
    const onChange = vi.fn();
    const { rerender, container } = render(
      <FlagPicker value={[]} onChange={onChange} />
    );
    await openPanel();
    fireEvent.click(screen.getByText('met-mistina'));
    expect(onChange).toHaveBeenCalledWith(['met-mistina']);

    rerender(<FlagPicker value={['met-mistina']} onChange={onChange} />);
    fireEvent.focus(screen.getByPlaceholderText('搜尋已註冊的旗標…'));
    await waitFor(() =>
      expect(screen.getByText('lost-signal')).toBeInTheDocument()
    );
    // 只看候選清單——已選的旗標仍會出現在上方的 chip 區
    const candidates = [
      ...container.querySelectorAll('.ned-flagpicker-item-name'),
    ].map((el) => el.textContent);
    expect(candidates).toEqual(['lost-signal']);
  });

  it('沒有自由輸入逃生口：打不存在的名字按 Enter 不會加入，只會開新建表單', async () => {
    const onChange = vi.fn();
    render(<FlagPicker value={[]} onChange={onChange} />);
    await openPanel();
    const input = screen.getByPlaceholderText('搜尋已註冊的旗標…');
    fireEvent.change(input, { target: { value: 'typo-flag' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // 關鍵斷言：輸入的字串沒有被當成旗標加進去
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByLabelText('新旗標名稱')).toHaveValue('typo-flag');
  });

  it('Enter 選第一個匹配項', async () => {
    const onChange = vi.fn();
    render(<FlagPicker value={[]} onChange={onChange} />);
    await openPanel();
    const input = screen.getByPlaceholderText('搜尋已註冊的旗標…');
    fireEvent.change(input, { target: { value: 'met' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['met-mistina']);
  });

  it('就地新建：先 POST 註冊再選取', async () => {
    const onChange = vi.fn();
    render(<FlagPicker value={[]} onChange={onChange} />);
    await openPanel();
    fireEvent.change(screen.getByPlaceholderText('搜尋已註冊的旗標…'), {
      target: { value: 'chapter2-revealed' },
    });
    fireEvent.click(screen.getByText(/新建旗標/));
    fireEvent.change(screen.getByLabelText('新旗標標籤'), {
      target: { value: '第二章揭露' },
    });
    fireEvent.click(screen.getByRole('button', { name: '註冊並選取' }));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(['chapter2-revealed'])
    );
    const post = calls.find((c) => c.init?.method === 'POST');
    expect(post?.url).toBe('/api/flags');
    expect(JSON.parse(String(post?.init?.body))).toEqual({
      name: 'chapter2-revealed',
      label: '第二章揭露',
    });
  });

  it('derived 形狀被 worker 拒絕時顯示原因，不加入清單', async () => {
    vi.restoreAllMocks();
    mockApi({
      createStatus: 400,
      createError:
        '這是規則生成的旗標形狀，由程式依 key 推導，不需要也不能註冊',
    });
    const onChange = vi.fn();
    render(<FlagPicker value={[]} onChange={onChange} />);
    fireEvent.focus(screen.getByPlaceholderText('搜尋已註冊的旗標…'));
    await screen.findByText('met-mistina');
    fireEvent.change(screen.getByPlaceholderText('搜尋已註冊的旗標…'), {
      target: { value: 'some-story:song' },
    });
    fireEvent.click(screen.getByText(/新建旗標/));
    fireEvent.click(screen.getByRole('button', { name: '註冊並選取' }));

    expect(await screen.findByText(/不需要也不能註冊/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('名稱已存在（409）直接選取，不逼使用者改名', async () => {
    vi.restoreAllMocks();
    mockApi({ createStatus: 409, createError: '旗標已存在' });
    const onChange = vi.fn();
    render(<FlagPicker value={[]} onChange={onChange} />);
    fireEvent.focus(screen.getByPlaceholderText('搜尋已註冊的旗標…'));
    await screen.findByText('met-mistina');
    fireEvent.change(screen.getByPlaceholderText('搜尋已註冊的旗標…'), {
      target: { value: 'already-there' },
    });
    fireEvent.click(screen.getByText(/新建旗標/));
    fireEvent.click(screen.getByRole('button', { name: '註冊並選取' }));

    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(['already-there'])
    );
  });

  it('showSelected=false 時不畫 chip（呼叫端自己顯示）', async () => {
    const { container } = render(
      <FlagPicker
        value={['met-mistina']}
        onChange={() => {}}
        showSelected={false}
      />
    );
    expect(container.querySelector('.ned-flagpicker-chips')).toBeNull();
  });

  it('showSelected 預設畫出已選 chip 並可移除', () => {
    const onChange = vi.fn();
    render(<FlagPicker value={['met-mistina']} onChange={onChange} />);
    expect(screen.getByText('met-mistina')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('移除旗標 met-mistina'));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
