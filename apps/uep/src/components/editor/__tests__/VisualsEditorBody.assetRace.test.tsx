import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import VisualsEditorBody, { type VisualsData } from '../VisualsEditorBody';

/**
 * 圖片新增與替換的互斥與寫入正確性。
 *
 * 兩條路徑都是非同步的，各自捕捉啟動當下的 `data.images` 快照。並行時後完成
 * 者會用舊陣列覆蓋先完成的結果——替換結果或新增圖片消失、已上傳的 R2 檔案變
 * 成孤兒，而使用者看到的是成功回饋。修法有兩層：共用 busy guard 讓兩者不能
 * 並行，寫入一律讀 ref 而非閉包快照。
 */

const uploadAsset = vi.hoisted(() => vi.fn());

vi.mock('../editorHelpers', () => ({
  API_BASE: '',
  uploadAsset,
  deleteAsset: vi.fn(async () => {}),
  fetchImageAssets: vi.fn(async () => []),
  buildAssetUrl: (key: string) => `/api/assets/${key}`,
  getDialog: () => ({
    confirm: vi.fn(async () => true),
    alert: vi.fn(async () => {}),
  }),
  getToast: () => ({
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    show: vi.fn(),
  }),
}));

function makeData(): VisualsData {
  return {
    images: [
      { id: 'img-1', file: 'images/a.png', caption: '甲', sortOrder: 0 },
      { id: 'img-2', file: 'images/b.png', caption: '乙', sortOrder: 1 },
    ],
    group: '',
    gate: null,
    gateHint: '',
    entityKey: '',
    storyKey: '',
    layout: '',
  };
}

/** 手動控制 resolve 時機的 promise */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function renderBody() {
  const onDataChange = vi.fn();
  render(
    <VisualsEditorBody
      accent="#c9a86a"
      initialData={makeData()}
      apiBase=""
      galleryId="visuals/illustrations/dawn"
      pageSlug="illustrations/dawn"
      onDataChange={onDataChange}
      onDirty={vi.fn()}
    />
  );
  return { onDataChange };
}

/** 取最後一次 onDataChange 的 images */
function latestImages(onDataChange: ReturnType<typeof vi.fn>) {
  const calls = onDataChange.mock.calls;
  return (calls[calls.length - 1][0] as VisualsData).images;
}

function pngFile(name: string): File {
  return new File(['x'], name, { type: 'image/png' });
}

beforeEach(() => {
  // 唯一性查核的 tree fetch——回空樹即可，本測試不碰 key 驗證
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, data: [] }),
    }))
  );
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('VisualsEditorBody — 素材操作互斥', () => {
  it('新增上傳進行中時，替換入口一併停用', async () => {
    const user = userEvent.setup();
    renderBody();

    const pending = deferred<{ key: string; url: string; size: number }>();
    uploadAsset.mockReturnValueOnce(pending.promise);

    // 展開第一張圖，露出替換入口
    await user.click(screen.getByText('a.png'));
    const replaceBtn = screen.getByTitle('上傳新檔案取代這張圖');
    expect(replaceBtn).not.toBeDisabled();

    const addInput = document.querySelector(
      'input[type="file"][multiple]'
    ) as HTMLInputElement;
    await user.upload(addInput, pngFile('new.png'));

    await waitFor(() => {
      expect(screen.getByTitle('上傳新檔案取代這張圖')).toBeDisabled();
      expect(screen.getByTitle('從媒體庫挑一張取代這張圖')).toBeDisabled();
    });

    pending.resolve({ key: 'images/new.png', url: '', size: 1 });
    await waitFor(() => {
      expect(screen.getByTitle('上傳新檔案取代這張圖')).not.toBeDisabled();
    });
  });

  it('替換進行中時，新增與媒體庫入口一併停用', async () => {
    const user = userEvent.setup();
    renderBody();

    const pending = deferred<{ key: string; url: string; size: number }>();
    uploadAsset.mockReturnValueOnce(pending.promise);

    await user.click(screen.getByText('a.png'));
    await user.click(screen.getByTitle('上傳新檔案取代這張圖'));

    const replaceInput = document.querySelector(
      'input[type="file"]:not([multiple])'
    ) as HTMLInputElement;
    await user.upload(replaceInput, pngFile('swap.png'));

    await waitFor(() => {
      expect(screen.getByText('+ 上傳圖片').closest('button')).toBeDisabled();
      expect(screen.getByText('📂 媒體庫').closest('button')).toBeDisabled();
    });

    pending.resolve({ key: 'images/swap.png', url: '', size: 1 });
    await waitFor(() => {
      expect(
        screen.getByText('📂 媒體庫').closest('button')
      ).not.toBeDisabled();
    });
  });
});

describe('VisualsEditorBody — 交錯完成不互相覆蓋', () => {
  it('替換完成後接著新增，兩筆寫入都留存', async () => {
    const user = userEvent.setup();
    const { onDataChange } = renderBody();

    // 先替換 img-1
    uploadAsset.mockResolvedValueOnce({
      key: 'images/swap.png',
      url: '',
      size: 1,
    });
    await user.click(screen.getByText('a.png'));
    await user.click(screen.getByTitle('上傳新檔案取代這張圖'));
    const replaceInput = document.querySelector(
      'input[type="file"]:not([multiple])'
    ) as HTMLInputElement;
    await user.upload(replaceInput, pngFile('swap.png'));

    await waitFor(() => {
      expect(latestImages(onDataChange)[0].file).toBe('images/swap.png');
    });

    // 再新增一張
    uploadAsset.mockResolvedValueOnce({
      key: 'images/new.png',
      url: '',
      size: 1,
    });
    const addInput = document.querySelector(
      'input[type="file"][multiple]'
    ) as HTMLInputElement;
    await user.upload(addInput, pngFile('new.png'));

    await waitFor(() => {
      expect(latestImages(onDataChange)).toHaveLength(3);
    });

    const images = latestImages(onDataChange);
    // 替換結果沒有被新增的舊快照蓋回去
    expect(images[0].file).toBe('images/swap.png');
    // caption 與排序在替換時原封不動
    expect(images[0].caption).toBe('甲');
    expect(images[0].sortOrder).toBe(0);
    // 新增的圖片接在最後，sortOrder 依當下長度推導
    expect(images[2].file).toBe('images/new.png');
    expect(images[2].sortOrder).toBe(2);
  });

  /**
   * busy guard 只鎖素材操作，caption 這種一般欄位不該被鎖——所以上傳期間的
   * 欄位編輯是 guard 擋不住的並行寫入，只有讀 ref 才不會被上傳完成時的舊
   * 快照抹掉。這一支是 `dataRef` 存在的理由。
   */
  it('上傳期間編輯 caption，上傳完成不會抹掉剛打的字', async () => {
    const user = userEvent.setup();
    const { onDataChange } = renderBody();

    const pending = deferred<{ key: string; url: string; size: number }>();
    uploadAsset.mockReturnValueOnce(pending.promise);

    const addInput = document.querySelector(
      'input[type="file"][multiple]'
    ) as HTMLInputElement;
    await user.upload(addInput, pngFile('new.png'));

    // 上傳仍在飛的期間改第二張圖的說明
    await user.click(screen.getByText('b.png'));
    const captionInput = screen.getByPlaceholderText('圖片說明...');
    await user.clear(captionInput);
    await user.type(captionInput, '改過的說明');
    await waitFor(() => {
      expect(latestImages(onDataChange)[1].caption).toBe('改過的說明');
    });

    pending.resolve({ key: 'images/new.png', url: '', size: 1 });
    await waitFor(() => {
      expect(latestImages(onDataChange)).toHaveLength(3);
    });

    // 上傳完成的寫入基於最新狀態，caption 編輯留存
    expect(latestImages(onDataChange)[1].caption).toBe('改過的說明');
  });

  it('新增後接著替換，新增的圖片不會被替換的舊快照抹除', async () => {
    const user = userEvent.setup();
    const { onDataChange } = renderBody();

    uploadAsset.mockResolvedValueOnce({
      key: 'images/new.png',
      url: '',
      size: 1,
    });
    const addInput = document.querySelector(
      'input[type="file"][multiple]'
    ) as HTMLInputElement;
    await user.upload(addInput, pngFile('new.png'));
    await waitFor(() => {
      expect(latestImages(onDataChange)).toHaveLength(3);
    });

    uploadAsset.mockResolvedValueOnce({
      key: 'images/swap.png',
      url: '',
      size: 1,
    });
    await user.click(screen.getByText('a.png'));
    await user.click(screen.getByTitle('上傳新檔案取代這張圖'));
    const replaceInput = document.querySelector(
      'input[type="file"]:not([multiple])'
    ) as HTMLInputElement;
    await user.upload(replaceInput, pngFile('swap.png'));

    await waitFor(() => {
      expect(latestImages(onDataChange)[0].file).toBe('images/swap.png');
    });
    // 三張都還在——替換沒有回退到新增前的兩張快照
    expect(latestImages(onDataChange)).toHaveLength(3);
  });
});
