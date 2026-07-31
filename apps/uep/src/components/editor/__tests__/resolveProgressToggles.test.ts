/**
 * 存檔時 progressPage／gateExempt 的合流規則
 *
 * 這兩個欄位有兩個入口——編輯器 Inspector 與 `/admin/settings` 進度總覽的
 * 就地切換。編輯器存檔送的是整份 metadata，若一律用開頁當下的快照，
 * 編輯期間在總覽切的開關會被靜默還原（沒有錯誤、沒有提示，值就是變回去了）。
 */
import { describe, it, expect } from 'vitest';

import { resolveProgressToggles } from '../editorHelpers';

const LOCAL_OFF = { progressPage: false, gateExempt: false };
const UNTOUCHED = { progressPage: false, gateExempt: false };

describe('resolveProgressToggles', () => {
  it('沒動過的欄位採用伺服器最新值', () => {
    expect(
      resolveProgressToggles(
        { progressPage: true, gateExempt: true },
        LOCAL_OFF,
        UNTOUCHED
      )
    ).toEqual({ progressPage: true, gateExempt: true });
  });

  it('動過的欄位以編輯器為準（明確意圖不被伺服器蓋掉）', () => {
    expect(
      resolveProgressToggles(
        { progressPage: true, gateExempt: true },
        { progressPage: false, gateExempt: false },
        { progressPage: true, gateExempt: true }
      )
    ).toEqual({ progressPage: false, gateExempt: false });
  });

  it('兩個欄位各自獨立判定', () => {
    expect(
      resolveProgressToggles(
        { progressPage: true, gateExempt: true },
        { progressPage: false, gateExempt: false },
        { progressPage: false, gateExempt: true }
      )
    ).toEqual({ progressPage: true, gateExempt: false });
  });

  it('伺服器狀態讀不到時退回本地值（存檔不因額外查詢失敗而中斷）', () => {
    expect(
      resolveProgressToggles(
        null,
        { progressPage: true, gateExempt: false },
        UNTOUCHED
      )
    ).toEqual({ progressPage: true, gateExempt: false });
  });

  it('伺服器上是非 true 的雜值一律視為關閉', () => {
    expect(
      resolveProgressToggles(
        { progressPage: 'yes', gateExempt: 1 },
        LOCAL_OFF,
        UNTOUCHED
      )
    ).toEqual({ progressPage: false, gateExempt: false });
  });

  it('伺服器上沒有這兩個鍵時視為關閉——總覽關掉時清鍵，不是寫 false', () => {
    expect(
      resolveProgressToggles(
        { storyKey: 'act2' },
        { progressPage: true, gateExempt: true },
        UNTOUCHED
      )
    ).toEqual({ progressPage: false, gateExempt: false });
  });
});
