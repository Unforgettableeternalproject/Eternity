/**
 * ConceptsEditorBody — MiniEditor 切換條目 remount 回歸測試（S7-B 發現的既有 bug）
 *
 * 根因：TipTap 的 content 只在編輯器建立時讀取（useEditor 無 deps），
 * 直接點另一個條目時 panelMode 不變（entry → entry），React 重用
 * MiniEditor 實例 → 顯示殘留的前一條目內容，繼續編輯會把舊內容
 * 寫進新條目。修法：call site 以 active 索引為 key 強制 remount。
 */
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import type { DossierContent } from '../../concepts/types';
import ConceptsEditorBody from '../ConceptsEditorBody';

const dossierData: DossierContent = {
  variants: [
    {
      id: 'u',
      label: 'U',
      subcategories: [
        {
          label: '三區',
          groups: [
            {
              label: '',
              entries: [
                { name: '條目甲', content_html: '<p>甲的描述內容</p>' },
                { name: '條目乙', content_html: '<p>乙的描述內容</p>' },
                { name: '條目丙', content_html: '<p>丙的描述內容</p>' },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe('ConceptsEditorBody — 切換條目時 MiniEditor remount', () => {
  it('直接點另一條目（不經群組面板）顯示新條目內容，不殘留', async () => {
    render(
      <ConceptsEditorBody
        accent="#2d6a4f"
        stackStyle="dossier"
        initialData={{
          stackStyle: 'dossier',
          contentBlockType: 'dossier',
          data: dossierData,
        }}
        onDataChange={() => {}}
        onDirty={vi.fn()}
      />
    );

    // 點條目甲 → 編輯器顯示甲的內容
    fireEvent.click(screen.getByText('條目甲'));
    await waitFor(() =>
      expect(document.body.textContent).toContain('甲的描述內容')
    );

    // 直接點條目乙（panelMode 維持 entry）→ 必須顯示乙、不殘留甲
    fireEvent.click(screen.getByText('條目乙'));
    await waitFor(() =>
      expect(document.body.textContent).toContain('乙的描述內容')
    );
    expect(document.body.textContent).not.toContain('甲的描述內容');
  });

  it('刪除前面的條目（index shift）後編輯器內容跟著 active 索引更新', async () => {
    render(
      <ConceptsEditorBody
        accent="#2d6a4f"
        stackStyle="dossier"
        initialData={{
          stackStyle: 'dossier',
          contentBlockType: 'dossier',
          data: dossierData,
        }}
        onDataChange={() => {}}
        onDirty={vi.fn()}
      />
    );

    // 開條目乙（index 1）
    fireEvent.click(screen.getByText('條目乙'));
    await waitFor(() =>
      expect(document.body.textContent).toContain('乙的描述內容')
    );

    // 刪除條目甲（index 0）→ 乙丙前移，activeEntry=1 現在指向丙
    const delButtons = document.querySelectorAll('.ced-browser-file-del');
    fireEvent.click(delButtons[0]);

    // 編輯器必須顯示現在 index 1 的內容（丙），不可殘留乙
    await waitFor(() =>
      expect(document.body.textContent).toContain('丙的描述內容')
    );
    expect(document.body.textContent).not.toContain('乙的描述內容');
  });
});
