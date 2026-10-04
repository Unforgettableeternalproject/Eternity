/**
 * SortButtons — 點擊不冒泡
 *
 * SortButtons 常放在可點擊的卡片標題列（AboutEditor skills／experience 點標題
 * 切換展開），排序點擊不能連帶觸發外層的展開切換。
 */
import '@testing-library/jest-dom/vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';

// __APP_VERSION__ 由 astro.config 的 vite define 注入，vitest 沒有，需在匯入前補上
vi.hoisted(() => {
  (globalThis as Record<string, unknown>).__APP_VERSION__ = '0.0.0-test';
});

import AboutEditor from './AboutEditor';
import { SortButtons } from './editorPrimitives';

describe('SortButtons', () => {
  it('上移／下移呼叫 onMove，且不觸發外層 onClick', () => {
    const onMove = vi.fn();
    const onParentClick = vi.fn();
    render(
      <div onClick={onParentClick}>
        <SortButtons idx={1} total={3} onMove={onMove} />
      </div>
    );
    fireEvent.click(screen.getByTitle('上移'));
    fireEvent.click(screen.getByTitle('下移'));
    expect(onMove.mock.calls).toEqual([
      [1, 0],
      [1, 2],
    ]);
    expect(onParentClick).not.toHaveBeenCalled();
  });
});

describe('AboutEditor — 排序不切換卡片展開', () => {
  function Harness() {
    const [dataZh, setDataZh] = useState<Record<string, unknown>>({
      skills: ['甲', '乙'].map((n, i) => ({
        id: `0${i + 1}`,
        name: `技能${n}`,
        en: `Skill ${n}`,
        brief: '',
        description: '',
        selfAssessment: '',
      })),
    });
    return (
      <AboutEditor
        dataZh={dataZh}
        dataEn={{}}
        currently={{}}
        setDataZh={setDataZh}
        setDataEn={() => {}}
        setCurrently={() => {}}
        api={async () => ({ ok: true })}
        apiBase=""
        token=""
      />
    );
  }

  it('skills 點下移後順序改變，卡片仍維持收合', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Skills'));
    expect(screen.getAllByText('▼')).toHaveLength(2);

    fireEvent.click(screen.getAllByTitle('下移')[0]);

    const names = screen.getAllByText(/^技能/).map((el) => el.textContent);
    expect(names).toEqual(['技能乙', '技能甲']);
    // 外層標題列的展開切換沒有被觸發
    expect(screen.queryAllByText('▲')).toHaveLength(0);
    expect(screen.getAllByText('▼')).toHaveLength(2);
  });
});
