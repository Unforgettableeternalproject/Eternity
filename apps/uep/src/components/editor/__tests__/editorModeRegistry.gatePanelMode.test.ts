/**
 * PROGRESS GATE 面板分級測試（S8 下半場 V-B.18）
 *
 * 分級定案（艾斯維爾 07/19）：Concepts/Storage 整塊移除、Echoes/Visuals
 * 只留必要條件欄位、History 全套。共用 mode（zone/homepage/default）
 * 依 area fallback；未分級 area 維持 full 不變。
 */
import { describe, expect, it } from 'vitest';

import { resolveGatePanelMode } from '../editorModeRegistry';

function ctx(area: string, pageType: string, pageSlug = 'x/y') {
  return { area, zoneId: area, pageType, pageSlug };
}

describe('resolveGatePanelMode', () => {
  it('History 全套（含共用 mode：zone / section / page）', () => {
    expect(resolveGatePanelMode(ctx('history', 'section'))).toBe('full');
    expect(resolveGatePanelMode(ctx('history', 'chapter'))).toBe('full');
    expect(resolveGatePanelMode(ctx('history', 'zone'))).toBe('full');
    expect(resolveGatePanelMode(ctx('history', 'page'))).toBe('full');
  });

  it('Echoes minimal（song / subcategory / cluster / zone）', () => {
    expect(resolveGatePanelMode(ctx('echoes', 'song'))).toBe('minimal');
    expect(resolveGatePanelMode(ctx('echoes', 'subcategory'))).toBe('minimal');
    expect(resolveGatePanelMode(ctx('echoes', 'cluster'))).toBe('minimal');
    expect(resolveGatePanelMode(ctx('echoes', 'zone'))).toBe('minimal');
  });

  it('Visuals minimal（gallery / subcategory / division / zone）', () => {
    expect(resolveGatePanelMode(ctx('visuals', 'gallery'))).toBe('minimal');
    expect(resolveGatePanelMode(ctx('visuals', 'subcategory'))).toBe('minimal');
    expect(resolveGatePanelMode(ctx('visuals', 'division'))).toBe('minimal');
    expect(resolveGatePanelMode(ctx('visuals', 'zone'))).toBe('minimal');
  });

  it('Concepts / Storage 整塊移除（含各特化 mode 與共用 mode）', () => {
    expect(resolveGatePanelMode(ctx('concepts', 'type'))).toBe('none');
    expect(resolveGatePanelMode(ctx('concepts', 'stack'))).toBe('none');
    expect(resolveGatePanelMode(ctx('storage', 'stuff', 'boxes/a'))).toBe(
      'none'
    );
    expect(resolveGatePanelMode(ctx('storage', 'stuff', 'changelog/a'))).toBe(
      'none'
    );
    expect(resolveGatePanelMode(ctx('storage', 'stuff', 'extras/a'))).toBe(
      'none'
    );
    expect(resolveGatePanelMode(ctx('storage', 'clearing'))).toBe('none');
    expect(resolveGatePanelMode(ctx('storage', 'subcategory'))).toBe('none');
  });

  it('未分級 area 維持 full（分級前行為不變）', () => {
    expect(resolveGatePanelMode(ctx('homepage', 'homepage'))).toBe('full');
    expect(resolveGatePanelMode(ctx('other', 'page'))).toBe('full');
  });
});
