import { describe, it, expect } from 'vitest';
import { createInitialState } from '../../../progress';
import type { ProgressState } from '../../../progress';
import {
  isHidden,
  isLocked,
  getLockKind,
  isProgressionChainHidden,
  getSpoilerLevel,
  isAccessible,
} from '../contentVisibility';

function stateWith(overrides: Partial<ProgressState>): ProgressState {
  return { ...createInitialState(), ...overrides };
}

/**
 * contentVisibility 工具函式測試
 *
 * 這些函式控制全站內容的可見性語意：
 * - hidden: 完全不對前台公開
 * - locked: 顯示但不可進入
 * - spoiler: 可訪問但需劇透警告
 */

describe('contentVisibility', () => {
  describe('isHidden', () => {
    it('metadata.hidden === true 時回傳 true', () => {
      expect(isHidden({ metadata: { hidden: true } })).toBe(true);
    });

    it('metadata.hidden === false 時回傳 false', () => {
      expect(isHidden({ metadata: { hidden: false } })).toBe(false);
    });

    it('沒有 metadata 時回傳 false', () => {
      expect(isHidden({})).toBe(false);
      expect(isHidden({ metadata: null })).toBe(false);
      expect(isHidden({ metadata: undefined })).toBe(false);
    });

    it('metadata 中沒有 hidden 欄位時回傳 false', () => {
      expect(isHidden({ metadata: { title: '測試' } })).toBe(false);
    });
  });

  describe('isLocked', () => {
    it('metadata.locked === true 時回傳 true', () => {
      expect(isLocked({ metadata: { locked: true } })).toBe(true);
    });

    it('metadata.locked === false 時回傳 false', () => {
      expect(isLocked({ metadata: { locked: false } })).toBe(false);
    });

    it('沒有 metadata 時回傳 false', () => {
      expect(isLocked({})).toBe(false);
    });
  });

  describe('getSpoilerLevel', () => {
    it('回傳 metadata.spoilerLevel 的數值', () => {
      expect(getSpoilerLevel({ metadata: { spoilerLevel: 1 } })).toBe(1);
      expect(getSpoilerLevel({ metadata: { spoilerLevel: 3 } })).toBe(3);
    });

    it('沒有 spoilerLevel 時回傳 0', () => {
      expect(getSpoilerLevel({})).toBe(0);
      expect(getSpoilerLevel({ metadata: {} })).toBe(0);
      expect(getSpoilerLevel({ metadata: null })).toBe(0);
    });

    it('spoilerLevel 不是數字時回傳 0', () => {
      expect(getSpoilerLevel({ metadata: { spoilerLevel: '2' } })).toBe(0);
      expect(getSpoilerLevel({ metadata: { spoilerLevel: true } })).toBe(0);
    });
  });

  describe('isAccessible', () => {
    it('既不 hidden 也不 locked 時回傳 true', () => {
      expect(isAccessible({ metadata: {} })).toBe(true);
      expect(isAccessible({ metadata: { hidden: false, locked: false } })).toBe(
        true
      );
    });

    it('hidden 時回傳 false', () => {
      expect(isAccessible({ metadata: { hidden: true } })).toBe(false);
    });

    it('locked 時回傳 false', () => {
      expect(isAccessible({ metadata: { locked: true } })).toBe(false);
    });

    it('同時 hidden 和 locked 時回傳 false', () => {
      expect(isAccessible({ metadata: { hidden: true, locked: true } })).toBe(
        false
      );
    });

    it('有 spoiler 但沒有 hidden/locked 時仍可訪問', () => {
      expect(isAccessible({ metadata: { spoilerLevel: 3 } })).toBe(true);
    });
  });

  /**
   * Epic 2 S3 — 動態閘門（metadata.gate）疊加於靜態 locked 之上。
   * 合約：不傳 progress 只判靜態（向後相容）；
   * 傳 progress 時語意為「靜態 locked || 閘門條件未滿足」。
   */
  describe('isLocked — 動態閘門', () => {
    const gatedNode = {
      metadata: { gate: { requiresFlags: ['completed:history/ch1'] } },
    };

    it('不傳 progress 時忽略 gate 條件（Visuals/Echoes 現行為）', () => {
      expect(isLocked(gatedNode)).toBe(false);
    });

    it('未持有旗標 → 鎖定', () => {
      expect(isLocked(gatedNode, createInitialState())).toBe(true);
    });

    it('持有旗標 → 解鎖', () => {
      expect(
        isLocked(gatedNode, stateWith({ flags: ['completed:history/ch1'] }))
      ).toBe(false);
    });

    it('觀測者 bypass requiresFlags', () => {
      expect(
        isLocked(gatedNode, stateWith({ view: 'observer', observerEver: true }))
      ).toBe(false);
    });

    it('靜態 locked 優先於任何進度：即使條件滿足仍鎖定', () => {
      const node = {
        metadata: { locked: true, gate: { requiresFlags: ['f1'] } },
      };
      expect(isLocked(node, stateWith({ flags: ['f1'] }))).toBe(true);
    });

    it('平鋪形狀的 gate 條件也生效', () => {
      const flat = { metadata: { requiresFlags: ['f1'] } };
      expect(isLocked(flat, createInitialState())).toBe(true);
      expect(isLocked(flat, stateWith({ flags: ['f1'] }))).toBe(false);
    });

    it('pristineOnly：有印記者鎖定，觀測者不 bypass', () => {
      const pristine = { metadata: { gate: { pristineOnly: true } } };
      expect(isLocked(pristine, createInitialState())).toBe(false);
      expect(isLocked(pristine, stateWith({ observerEver: true }))).toBe(true);
      expect(
        isLocked(pristine, stateWith({ view: 'observer', observerEver: true }))
      ).toBe(true);
    });

    it('無 gate 條件的頁面不受 progress 影響', () => {
      expect(isLocked({ metadata: {} }, createInitialState())).toBe(false);
    });
  });

  describe('isAccessible — 動態閘門', () => {
    it('閘門未滿足時不可訪問，滿足後可訪問', () => {
      const node = { metadata: { gate: { requiresFlags: ['f1'] } } };
      expect(isAccessible(node, createInitialState())).toBe(false);
      expect(isAccessible(node, stateWith({ flags: ['f1'] }))).toBe(true);
    });
  });

  /**
   * Epic 2 S3 驗收回饋（艾斯維爾 2026-07-03）— 鎖定三態分離。
   * static 原樣、progression（全 completed:*）循序顯示、
   * flag（含自訂旗標或 pristineOnly）永遠顯示但遮蔽；混合以 flag 為主。
   */
  describe('getLockKind — 鎖定三態', () => {
    it('未鎖定回傳 null', () => {
      expect(getLockKind({ metadata: {} }, createInitialState())).toBe(null);
      expect(
        getLockKind(
          { metadata: { gate: { requiresFlags: ['f1'] } } },
          stateWith({ flags: ['f1'] })
        )
      ).toBe(null);
    });

    it('靜態 locked 且無 gate 回傳 static', () => {
      expect(getLockKind({ metadata: { locked: true } })).toBe('static');
      expect(
        getLockKind({ metadata: { locked: true } }, createInitialState())
      ).toBe('static');
    });

    /**
     * 進度鎖優先於 static（2026-07-03 修正）：頁面同時有靜態鎖與進度鏈時，
     * 前置未完成 → 呈現 progression / flag（藏或模糊），前置完成才 static 🔒。
     */
    it('static + gate 未通過 → progression 優先（進度鎖搶先）', () => {
      const node = {
        metadata: {
          locked: true,
          gate: { requiresFlags: ['completed:history/1-5'] },
        },
      };
      expect(getLockKind(node, createInitialState())).toBe('progression');
    });

    it('static + gate 通過 → 才顯 static', () => {
      const node = {
        metadata: {
          locked: true,
          gate: { requiresFlags: ['completed:history/1-5'] },
        },
      };
      expect(
        getLockKind(node, stateWith({ flags: ['completed:history/1-5'] }))
      ).toBe('static');
    });

    it('static + 自訂旗標未持有 → flag 優先', () => {
      const node = {
        metadata: { locked: true, gate: { requiresFlags: ['met:norvia'] } },
      };
      expect(getLockKind(node, createInitialState())).toBe('flag');
    });

    it('條件全為 completed:* → progression', () => {
      const node = {
        metadata: {
          gate: { requiresFlags: ['completed:history/1-4'] },
        },
      };
      expect(getLockKind(node, createInitialState())).toBe('progression');
    });

    it('含自訂旗標 → flag', () => {
      const node = {
        metadata: { gate: { requiresFlags: ['met:norvia'] } },
      };
      expect(getLockKind(node, createInitialState())).toBe('flag');
    });

    it('混合進度與自訂旗標 → 以 flag 為主', () => {
      const node = {
        metadata: {
          gate: {
            requiresFlags: ['completed:history/1-4', 'met:norvia'],
          },
        },
      };
      expect(getLockKind(node, createInitialState())).toBe('flag');
    });

    it('pristineOnly 未滿足 → flag', () => {
      const node = { metadata: { gate: { pristineOnly: true } } };
      expect(getLockKind(node, stateWith({ observerEver: true }))).toBe('flag');
      expect(getLockKind(node, createInitialState())).toBe(null);
    });

    it('不傳 progress 時動態閘門不生效', () => {
      const node = {
        metadata: { gate: { requiresFlags: ['completed:history/1-4'] } },
      };
      expect(getLockKind(node)).toBe(null);
    });
  });

  describe('isProgressionChainHidden — 循序漸進顯示', () => {
    // 進度鏈：1-5 鎖 1-4、1-6 鎖 1-5
    const pages: Record<string, { metadata: Record<string, unknown> }> = {
      'history/1-4': { metadata: {} },
      'history/1-5': {
        metadata: { gate: { requiresFlags: ['completed:history/1-4'] } },
      },
      'history/1-6': {
        metadata: { gate: { requiresFlags: ['completed:history/1-5'] } },
      },
    };
    const resolve = (id: string) => pages[id];

    it('依賴頁可讀 → 顯示（不隱藏），只是鎖定', () => {
      const state = createInitialState();
      expect(
        isProgressionChainHidden(pages['history/1-5'], state, resolve)
      ).toBe(false);
      expect(getLockKind(pages['history/1-5'], state)).toBe('progression');
    });

    it('依賴頁本身仍鎖定 → 隱藏', () => {
      const state = createInitialState();
      expect(
        isProgressionChainHidden(pages['history/1-6'], state, resolve)
      ).toBe(true);
    });

    it('讀完 1-4 後：1-5 解鎖、1-6 以模糊態露出', () => {
      const state = stateWith({ flags: ['completed:history/1-4'] });
      expect(getLockKind(pages['history/1-5'], state)).toBe(null);
      expect(
        isProgressionChainHidden(pages['history/1-6'], state, resolve)
      ).toBe(false);
      expect(getLockKind(pages['history/1-6'], state)).toBe('progression');
    });

    it('flag 鎖不受鏈隱藏影響（永遠顯示）', () => {
      const flagNode = {
        metadata: {
          gate: {
            requiresFlags: ['completed:history/1-5', 'met:norvia'],
          },
        },
      };
      expect(
        isProgressionChainHidden(flagNode, createInitialState(), resolve)
      ).toBe(false);
      expect(getLockKind(flagNode, createInitialState())).toBe('flag');
    });

    it('觀測者視角：全部解鎖，無隱藏', () => {
      const observer = stateWith({ view: 'observer', observerEver: true });
      expect(getLockKind(pages['history/1-6'], observer)).toBe(null);
      expect(
        isProgressionChainHidden(pages['history/1-6'], observer, resolve)
      ).toBe(false);
    });

    it('依賴頁不存在時不隱藏（容錯）', () => {
      const orphan = {
        metadata: { gate: { requiresFlags: ['completed:history/ghost'] } },
      };
      expect(
        isProgressionChainHidden(orphan, createInitialState(), () => undefined)
      ).toBe(false);
    });
  });

  /**
   * 2026-07-03 修 #11：前一 container 的最後 leaf 決定下一 sibling 解鎖。
   * arc.02 依賴 arc.01 的最後一節（排除 static-locked/hidden），
   * 而非 arc.01 landing flag——強制使用者讀完整個 arc 才推進。
   * 首節 fallback：arc.01 的第一個 section 依賴 completed:arc.01
   * （arc landing 讀完才解鎖第一節）。
   */
  describe('isProgressionChainHidden — 前一 container 最後 leaf 規則（2026-07-03 修 #11）', () => {
    const arc1Node = { metadata: { progressPage: true } };
    const arc2Node = {
      metadata: {
        progressPage: true,
      },
    };
    const nodes = new Map<string, { metadata: Record<string, unknown> }>([
      ['arc1', arc1Node],
      ['arc2', arc2Node],
      ['s1', { metadata: { progressPage: true } }],
      ['s2', { metadata: { progressPage: true } }],
    ]);
    const treeAdapter = {
      getNode: (id: string) => nodes.get(id),
      getParent: () => undefined,
      getParentId: (id: string) => (['s1', 's2'].includes(id) ? 'arc1' : null),
      getPreviousProgressSiblingId: (id: string) => {
        const orderTop = ['arc1', 'arc2'];
        const orderSub = ['s1', 's2'];
        const order = orderTop.includes(id) ? orderTop : orderSub;
        const idx = order.indexOf(id);
        return idx > 0 ? order[idx - 1] : undefined;
      },
      getProgressDescendantIds: (id: string) =>
        id === 'arc1' ? ['s1', 's2'] : [],
    };
    const resolve = (id: string) => nodes.get(id);

    it('未讀完任何 → arc2 隱藏（依賴 arc1 最後 leaf s2 沒完成）', () => {
      const state = createInitialState();
      expect(
        isProgressionChainHidden(arc2Node, state, resolve, 'arc2', treeAdapter)
      ).toBe(true);
    });

    it('只讀完 arc1 landing → arc2 仍鎖（用戶必須讀完最後一節）', () => {
      const state = stateWith({ flags: ['completed:arc1'] });
      // arc2 gate = completed:s2（arc1 最後 leaf）→ s2 未完成 → 仍 progression
      expect(getLockKind(arc2Node, state, 'arc2', treeAdapter)).toBe(
        'progression'
      );
    });

    it('讀完 arc1 最後 leaf s2 → arc2 gate 通過解鎖', () => {
      // 完整流程：先讀 arc1 landing → 解鎖 s1 → 讀 s1 → 解鎖 s2 → 讀 s2 → 解鎖 arc2
      const state = stateWith({
        flags: ['completed:arc1', 'completed:s1', 'completed:s2'],
      });
      expect(getLockKind(arc2Node, state, 'arc2', treeAdapter)).toBe(null);
    });
  });
});
