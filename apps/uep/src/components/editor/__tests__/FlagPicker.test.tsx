/**
 * FlagPicker 測試
 *
 * 核心契約：註冊表是**建議清單不是白名單**（D-1 反轉，2026-07-30）。三條路徑
 * 都要通——點清單既有項、直接採用輸入字串（存檔時 worker 自動註冊）、就地
 * 新建並填標籤（立即 POST 註冊）。
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
    fireEvent.focus(screen.getByPlaceholderText('搜尋或輸入新旗標…'));
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
    const input = screen.getByPlaceholderText('搜尋或輸入新旗標…');
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
    fireEvent.focus(screen.getByPlaceholderText('搜尋或輸入新旗標…'));
    await waitFor(() =>
      expect(screen.getByText('lost-signal')).toBeInTheDocument()
    );
    // 只看候選清單——已選的旗標仍會出現在上方的 chip 區
    const candidates = [
      ...container.querySelectorAll('.ned-flagpicker-item-name'),
    ].map((el) => el.textContent);
    expect(candidates).toEqual(['lost-signal']);
  });

  /**
   * 註冊表是建議清單不是白名單——與 entityKey／storyKey 同一個模式：自由填、
   * 存檔時由 worker 自動補進註冊表、事後在 /admin/keys 補標籤與說明。
   */
  it('打一個不存在的名字按 Enter 直接採用，不強迫先註冊', async () => {
    const onChange = vi.fn();
    render(<FlagPicker value={[]} onChange={onChange} />);
    await openPanel();
    const input = screen.getByPlaceholderText('搜尋或輸入新旗標…');
    fireEvent.change(input, { target: { value: 'brand-new-flag' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['brand-new-flag']);
    // 沒有打任何 POST——註冊是存檔時 worker 的事
    expect(calls.some((c) => c.init?.method === 'POST')).toBe(false);
  });

  it('清單裡沒有時提供「直接使用」入口，大小寫原樣保留', async () => {
    const onChange = vi.fn();
    render(<FlagPicker value={[]} onChange={onChange} />);
    await openPanel();
    fireEvent.change(screen.getByPlaceholderText('搜尋或輸入新旗標…'), {
      target: { value: 'Act2-Betrayal' },
    });
    fireEvent.click(screen.getByText(/直接使用/));
    expect(onChange).toHaveBeenCalledWith(['Act2-Betrayal']);
  });

  it('輸入的字串已在清單上時不顯示「直接使用」（避免兩個入口做同一件事）', async () => {
    render(<FlagPicker value={[]} onChange={() => {}} />);
    await openPanel();
    fireEvent.change(screen.getByPlaceholderText('搜尋或輸入新旗標…'), {
      target: { value: 'met-mistina' },
    });
    expect(screen.queryByText(/直接使用/)).not.toBeInTheDocument();
  });

  it('derived 旗標可以直接填進需求端（事前強制會關掉這條路）', async () => {
    const onChange = vi.fn();
    render(<FlagPicker value={[]} onChange={onChange} />);
    await openPanel();
    const input = screen.getByPlaceholderText('搜尋或輸入新旗標…');
    fireEvent.change(input, { target: { value: 'rain-sea-finale:song' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['rain-sea-finale:song']);
  });

  it('Enter 選第一個匹配項', async () => {
    const onChange = vi.fn();
    render(<FlagPicker value={[]} onChange={onChange} />);
    await openPanel();
    const input = screen.getByPlaceholderText('搜尋或輸入新旗標…');
    fireEvent.change(input, { target: { value: 'met' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['met-mistina']);
  });

  it('就地新建並填標籤：先 POST 註冊再選取', async () => {
    const onChange = vi.fn();
    render(<FlagPicker value={[]} onChange={onChange} />);
    await openPanel();
    fireEvent.change(screen.getByPlaceholderText('搜尋或輸入新旗標…'), {
      target: { value: 'chapter2-revealed' },
    });
    fireEvent.click(screen.getByText(/新建並填標籤/));
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
    fireEvent.focus(screen.getByPlaceholderText('搜尋或輸入新旗標…'));
    await screen.findByText('met-mistina');
    fireEvent.change(screen.getByPlaceholderText('搜尋或輸入新旗標…'), {
      target: { value: 'some-story:song' },
    });
    fireEvent.click(screen.getByText(/新建並填標籤/));
    fireEvent.click(screen.getByRole('button', { name: '註冊並選取' }));

    expect(await screen.findByText(/不需要也不能註冊/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('名稱已存在（409）直接選取，不逼使用者改名', async () => {
    vi.restoreAllMocks();
    mockApi({ createStatus: 409, createError: '旗標已存在' });
    const onChange = vi.fn();
    render(<FlagPicker value={[]} onChange={onChange} />);
    fireEvent.focus(screen.getByPlaceholderText('搜尋或輸入新旗標…'));
    await screen.findByText('met-mistina');
    fireEvent.change(screen.getByPlaceholderText('搜尋或輸入新旗標…'), {
      target: { value: 'already-there' },
    });
    fireEvent.click(screen.getByText(/新建並填標籤/));
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

  /**
   * FlagMarker 是一個標記授予一個旗標。資料層仍是陣列（逗號格式與掃描器、
   * 改名、巡查都假設陣列），single 只約束 UI，存進去就是長度 1。
   */
  it('single 模式選新的會取代舊的', async () => {
    const onChange = vi.fn();
    render(<FlagPicker value={['met-mistina']} onChange={onChange} single />);
    fireEvent.focus(screen.getByPlaceholderText('搜尋或輸入新旗標…'));
    fireEvent.click(await screen.findByText('lost-signal'));
    expect(onChange).toHaveBeenCalledWith(['lost-signal']);
  });

  /**
   * 只選一個的時候 chip 是多餘的一層——輸入框本身就是那個旗標。
   */
  it('single 模式輸入框直接顯示旗標名且不畫 chip', () => {
    const { container } = render(
      <FlagPicker value={['met-mistina']} onChange={() => {}} single />
    );
    expect(screen.getByPlaceholderText('搜尋或輸入新旗標…')).toHaveValue(
      'met-mistina'
    );
    expect(container.querySelector('.ned-flagpicker-chips')).toBeNull();
  });

  it('single 模式打字即時寫回，清空等於取消選取', () => {
    const onChange = vi.fn();
    const onSelectedLabel = vi.fn();
    render(
      <FlagPicker
        value={['met-mistina']}
        onChange={onChange}
        onSelectedLabel={onSelectedLabel}
        single
      />
    );
    const input = screen.getByPlaceholderText('搜尋或輸入新旗標…');
    fireEvent.change(input, { target: { value: 'brand-new' } });
    expect(onChange).toHaveBeenCalledWith(['brand-new']);

    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(onSelectedLabel).toHaveBeenLastCalledWith(null);
  });

  it('single 模式剛聚焦時不用已選值過濾清單（否則換選要先清空）', async () => {
    const { container } = render(
      <FlagPicker value={['met-mistina']} onChange={() => {}} single />
    );
    fireEvent.focus(screen.getByPlaceholderText('搜尋或輸入新旗標…'));
    await waitFor(() =>
      expect(
        container.querySelectorAll('.ned-flagpicker-item-name').length
      ).toBe(2)
    );
  });

  it('single 模式不提供「新建並填標籤」（呼叫端自己有標籤欄）', async () => {
    render(<FlagPicker value={[]} onChange={() => {}} single />);
    fireEvent.focus(screen.getByPlaceholderText('搜尋或輸入新旗標…'));
    await screen.findByText('met-mistina');
    expect(screen.queryByText(/新建並填標籤/)).not.toBeInTheDocument();
    expect(screen.queryByText(/直接使用/)).not.toBeInTheDocument();
  });

  it('回報選中旗標在註冊表裡的既有標籤', async () => {
    const onSelectedLabel = vi.fn();
    render(
      <FlagPicker
        value={[]}
        onChange={() => {}}
        onSelectedLabel={onSelectedLabel}
      />
    );
    await openPanel();
    fireEvent.click(screen.getByText('met-mistina'));
    expect(onSelectedLabel).toHaveBeenCalledWith('見過米絲媞');

    // 沒有標籤的旗標回 null，呼叫端才知道要清空欄位
    fireEvent.focus(screen.getByPlaceholderText('搜尋或輸入新旗標…'));
    fireEvent.click(await screen.findByText('lost-signal'));
    expect(onSelectedLabel).toHaveBeenLastCalledWith(null);
  });

  it('移除最後一個旗標時回報 null', async () => {
    const onSelectedLabel = vi.fn();
    render(
      <FlagPicker
        value={['met-mistina']}
        onChange={() => {}}
        onSelectedLabel={onSelectedLabel}
      />
    );
    fireEvent.click(screen.getByLabelText('移除旗標 met-mistina'));
    expect(onSelectedLabel).toHaveBeenCalledWith(null);
  });

  it('showSelected 預設畫出已選 chip 並可移除', () => {
    const onChange = vi.fn();
    render(<FlagPicker value={['met-mistina']} onChange={onChange} />);
    expect(screen.getByText('met-mistina')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('移除旗標 met-mistina'));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
