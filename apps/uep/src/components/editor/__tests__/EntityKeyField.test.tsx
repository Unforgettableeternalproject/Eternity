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

import type { DiffContent, DossierContent } from '../../concepts/types';
import EntityKeyField, {
  ENTITY_KEY_PATTERN,
  collectEntityKeyIssues,
} from '../EntityKeyField';

describe('ENTITY_KEY_PATTERN', () => {
  it('接受合法 kebab-case', () => {
    for (const key of ['xavier-colsono', 'novia', 'rain-sea-tower', 'a1-b2']) {
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
    const { input } = setup('novia');
    expect(input).toHaveValue('novia');
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
    setup('novia', ['novia', 'xavier-colsono']);
    expect(screen.getByText(/已被同範圍/)).toBeInTheDocument();
  });

  it('非法格式優先於重複警告（不同時顯示兩則）', () => {
    setup('Bad Key', ['Bad Key']);
    expect(screen.getByText(/kebab-case/)).toBeInTheDocument();
    expect(screen.queryByText(/已被同範圍/)).not.toBeInTheDocument();
  });

  it('輸入非空值觸發 onChange（trim 後）', () => {
    const { input, onChange } = setup(undefined);
    fireEvent.change(input, { target: { value: ' novia ' } });
    expect(onChange).toHaveBeenCalledWith('novia');
  });

  it('清空輸入收斂為 undefined', () => {
    const { input, onChange } = setup('novia');
    fireEvent.change(input, { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it('空值不顯示任何警告', () => {
    setup(undefined, ['novia']);
    expect(screen.queryByText(/kebab-case/)).not.toBeInTheDocument();
    expect(screen.queryByText(/已被同範圍/)).not.toBeInTheDocument();
  });
});

describe('collectEntityKeyIssues — 存檔前硬驗證', () => {
  function dossier(
    entries: { name: string; entityKey?: string }[][]
  ): DossierContent {
    return {
      variants: entries.map((list, i) => ({
        id: `v${i}`,
        label: `V${i}`,
        subcategories: [{ label: 't', groups: [{ label: '', entries: list }] }],
      })),
    };
  }

  it('全部合法時回傳空陣列', () => {
    const data = dossier([
      [
        { name: '甲', entityKey: 'xavier-colsono' },
        { name: '乙', entityKey: 'novia' },
        { name: '丙' },
      ],
    ]);
    expect(collectEntityKeyIssues(data)).toEqual([]);
  });

  it('非法格式回報條目名稱與 key', () => {
    const data = dossier([[{ name: '甲', entityKey: 'Bad Key' }]]);
    const issues = collectEntityKeyIssues(data);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('甲');
    expect(issues[0]).toContain('Bad Key');
  });

  it('dossier 同 variant 內重複回報、跨 variant 允許', () => {
    const dup = dossier([
      [
        { name: '甲', entityKey: 'xavier-colsono' },
        { name: '乙', entityKey: 'xavier-colsono' },
      ],
    ]);
    expect(collectEntityKeyIssues(dup)).toHaveLength(1);
    expect(collectEntityKeyIssues(dup)[0]).toContain('重複');

    const crossVariant = dossier([
      [{ name: '甲', entityKey: 'xavier-colsono' }],
      [{ name: '甲(E)', entityKey: 'xavier-colsono' }],
    ]);
    expect(collectEntityKeyIssues(crossVariant)).toEqual([]);
  });

  // diff 已退出實體身分體系——條目不掛 entityKey，檢查不該再涵蓋它。
  // 用 D1 舊資料殘留 key 的形狀驗證：即使欄位還在也不得誤報。
  it('diff 不參與檢查（殘留的舊 entityKey 不誤報）', () => {
    const data = {
      subcategories: [
        {
          label: 'A',
          sections: [
            {
              label: '',
              entries: [{ term: '甲', values: [''], entityKey: 'essence' }],
            },
          ],
        },
        {
          label: 'B',
          sections: [
            {
              label: '',
              entries: [{ term: '乙', values: [''], entityKey: 'essence' }],
            },
          ],
        },
      ],
    } as unknown as DiffContent;
    expect(collectEntityKeyIssues(data)).toEqual([]);
  });
});
