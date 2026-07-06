/**
 * EntityKeyField 測試（Epic 2 S7-B）
 *
 * 涵蓋：
 * - kebab-case 格式即時校驗（警告不阻擋）
 * - 同範圍唯一性警告（existingKeys）
 * - 空值收斂為 undefined、非空回傳 trim 後字串
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import EntityKeyField, { ENTITY_KEY_PATTERN } from '../EntityKeyField';

describe('ENTITY_KEY_PATTERN', () => {
  it('接受合法 kebab-case', () => {
    for (const key of ['xavier-colsono', 'norvia', 'rain-sea-tower', 'a1-b2']) {
      expect(ENTITY_KEY_PATTERN.test(key)).toBe(true);
    }
  });

  it('拒絕非法格式', () => {
    for (const key of [
      'Xavier',
      'xavier colsono',
      '-xavier',
      'xavier-',
      'xavier--colsono',
      '艾斯維爾',
      'xavier:01',
    ]) {
      expect(ENTITY_KEY_PATTERN.test(key)).toBe(false);
    }
  });
});

describe('EntityKeyField', () => {
  function setup(
    value: string | undefined,
    existingKeys: string[] = [],
    onChange = vi.fn()
  ) {
    render(
      <EntityKeyField
        value={value}
        onChange={onChange}
        existingKeys={new Set(existingKeys)}
      />
    );
    return { input: screen.getByPlaceholderText(/xavier-colsono/), onChange };
  }

  it('顯示現有值', () => {
    const { input } = setup('norvia');
    expect(input).toHaveValue('norvia');
  });

  it('輸入合法 key 時無錯誤訊息', () => {
    setup('xavier-colsono');
    expect(screen.queryByText(/kebab-case/)).not.toBeInTheDocument();
    expect(screen.queryByText(/已被同範圍/)).not.toBeInTheDocument();
  });

  it('非法格式顯示格式警告', () => {
    setup('Xavier Colsono');
    expect(screen.getByText(/kebab-case/)).toBeInTheDocument();
  });

  it('與同範圍其他條目重複時顯示唯一性警告', () => {
    setup('norvia', ['norvia', 'xavier-colsono']);
    expect(screen.getByText(/已被同範圍/)).toBeInTheDocument();
  });

  it('非法格式優先於重複警告（不同時顯示兩則）', () => {
    setup('Bad Key', ['Bad Key']);
    expect(screen.getByText(/kebab-case/)).toBeInTheDocument();
    expect(screen.queryByText(/已被同範圍/)).not.toBeInTheDocument();
  });

  it('輸入非空值觸發 onChange（trim 後）', () => {
    const { input, onChange } = setup(undefined);
    fireEvent.change(input, { target: { value: ' norvia ' } });
    expect(onChange).toHaveBeenCalledWith('norvia');
  });

  it('清空輸入收斂為 undefined', () => {
    const { input, onChange } = setup('norvia');
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('空值不顯示任何警告', () => {
    setup(undefined, ['norvia']);
    expect(screen.queryByText(/kebab-case/)).not.toBeInTheDocument();
    expect(screen.queryByText(/已被同範圍/)).not.toBeInTheDocument();
  });
});
