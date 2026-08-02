/**
 * History 全樹進度頁總覽（/admin/settings 的「進度」分頁）
 *
 * 一頁列出整棵 History 樹的進度相關狀態，progressPage／gateExempt 可就地
 * 切換——寫入走 metadata-only 的 PATCH 端點，與編輯器 Inspector 是同一條路，
 * 不碰 content 也就不會用舊快照蓋掉開著的編輯器。
 *
 * 繼承判定是自建的 top-down 遞迴（`flattenProgressTree`），只複用
 * `progress/gating.ts` 的 `isProgressPage`／`isGateExempt` 兩個純函式。
 * ⚠️ 不可改抄 RichEditor 的「fetch 直接父頁一次」寫法——那是單層接收端，
 * 三層以上巢狀（chapter 標記、arc 被動繼承、section）會被判成未繼承。
 *
 * 樹的資料每次都現抓（不用 islands 的 `fetchHistoryTree`——那份有模組級
 * 快取，是 reader 端優化；這裡 PATCH 之後要立刻看到新狀態）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  isGateExempt,
  isProgressPage,
  parseGateCondition,
} from '../../progress/gating';

import { apiFetch, getToast } from './editorHelpers';
import './ProgressOverview.css';

// ===== 型別 =====

/** `GET /api/content/history/tree` 節點（只列這裡需要的欄位） */
export interface ProgressTreeNode {
  id: string;
  title: string;
  pageType: string;
  metadata?: Record<string, unknown> | null;
  children?: ProgressTreeNode[];
}

export interface ProgressRow {
  id: string;
  title: string;
  pageType: string;
  depth: number;
  /** 自己 raw 標記 progressPage */
  raw: boolean;
  exempt: boolean;
  /** 未自標但從祖先繼承（顯示 ☑(繼承) 並禁用） */
  inherited: boolean;
  /** raw || inherited */
  effective: boolean;
  /** 繼承來源——最近一個自標 progressPage 的祖先標題 */
  inheritedFrom: string | null;
  gateSummary: string | null;
  /** 逐項條件——展開時一行一條，摘要只是它的 join */
  gateParts: string[];
}

/** `GET /api/interlink/anchors-summary` 的逐頁計數 */
type AnchorsSummary = Record<string, Record<string, number>>;

// ===== 純函式（測試直接鎖這裡）=====

/**
 * 整棵樹單次 DFS 攤平成總覽列，繼承鏈在遍歷時算完：
 *
 *   effective(node) = raw(node) || (!exempt(node) && effective(parent))
 *
 * gateExempt 是切斷點——豁免節點不從祖先繼承，其子樹也拿不到祖先的鏈
 * （但豁免節點自標 progressPage 時，自己與子樹照常生效，語意正交）。
 */
export function flattenProgressTree(roots: ProgressTreeNode[]): ProgressRow[] {
  const rows: ProgressRow[] = [];

  const walk = (
    node: ProgressTreeNode,
    depth: number,
    ancestorEffective: boolean,
    ancestorSource: string | null
  ): void => {
    const raw = isProgressPage(node.metadata ?? null);
    const exempt = isGateExempt(node.metadata ?? null);
    const inherited = !raw && !exempt && ancestorEffective;
    const effective = raw || inherited;

    const gate = parseGateCondition(node.metadata ?? null);
    const gateParts = [
      ...(gate?.requiresFlags ?? []),
      ...(gate?.pristineOnly ? ['純潔者限定'] : []),
    ];

    rows.push({
      id: node.id,
      title: node.title,
      pageType: node.pageType,
      depth,
      raw,
      exempt,
      inherited,
      effective,
      inheritedFrom: inherited ? ancestorSource : null,
      gateSummary: gateParts.length > 0 ? gateParts.join('、') : null,
      gateParts,
    });

    // 傳給子層的繼承來源：自標者換成自己，被動繼承者原樣往下傳
    const nextSource = raw ? node.title : inherited ? ancestorSource : null;
    for (const child of node.children ?? []) {
      walk(child, depth + 1, effective, nextSource);
    }
  };

  for (const root of roots) walk(root, 0, false, null);
  return rows;
}

// ===== 元件 =====

const PAGE_TYPE_LABELS: Record<string, string> = {
  zone: 'zone',
  chapter: 'ch',
  arc: 'arc',
  section: 'sect',
  page: 'page',
  homepage: 'home',
};

export default function ProgressOverview({
  markerCountByPage,
}: {
  /**
   * progress marker 的逐頁計數，由 KeysManager 從 /api/flags/audit 的
   * grantedBy 聚合傳入——marker 不進 history_interlink_index，兩個來源
   * 拼起來才是完整的標記欄
   */
  markerCountByPage: Map<string, number>;
}) {
  const [roots, setRoots] = useState<ProgressTreeNode[] | null>(null);
  const [anchors, setAnchors] = useState<AnchorsSummary>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  /** 正在 PATCH 的列——期間兩顆 checkbox 一起禁用，避免連點競態 */
  const [pendingId, setPendingId] = useState<string | null>(null);
  /** 展開完整 gate 條件的列（多列可同時展開，方便並排比對） */
  const [expandedGates, setExpandedGates] = useState<Set<string>>(new Set());

  const toggleGate = (id: string) =>
    setExpandedGates((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const load = useCallback(async () => {
    setLoading(true);
    const [treeRes, anchorsRes] = await Promise.all([
      apiFetch<ProgressTreeNode[]>('/api/content/history/tree'),
      apiFetch<{ pages: AnchorsSummary }>('/api/interlink/anchors-summary'),
    ]);
    if (treeRes.ok && Array.isArray(treeRes.data)) setRoots(treeRes.data);
    else
      getToast().error(`載入 History 樹失敗：${treeRes.error || '未知錯誤'}`);
    if (anchorsRes.ok && anchorsRes.data?.pages) {
      setAnchors(anchorsRes.data.pages);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = useMemo(
    () => (roots ? flattenProgressTree(roots) : []),
    [roots]
  );

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (row) =>
        row.title.toLowerCase().includes(term) ||
        row.id.toLowerCase().includes(term)
    );
  }, [rows, search]);

  const toggle = async (
    row: ProgressRow,
    key: 'progressPage' | 'gateExempt',
    value: boolean
  ) => {
    setPendingId(row.id);
    const res = await apiFetch(`/api/content/${row.id}/metadata`, {
      method: 'PATCH',
      body: JSON.stringify({ [key]: value }),
    });
    if (!res.ok) {
      getToast().error(`更新失敗：${res.error || '未知錯誤'}`);
      setPendingId(null);
      return;
    }
    // 直接 refetch 整棵樹，不做就地 state 手術——44 頁很輕，
    // 換到的是前端狀態永遠不會與 DB 漂移
    await load();
    setPendingId(null);
  };

  const renderMarks = (row: ProgressRow) => {
    const anchorCounts = anchors[row.id] ?? {};
    const markers = markerCountByPage.get(row.id) ?? 0;
    const spots = anchorCounts['echo-spot'] ?? 0;
    const clues = anchorCounts['visual-clue-start'] ?? 0;
    if (markers === 0 && spots === 0 && clues === 0) {
      return <span className="po-dim">—</span>;
    }
    return (
      <span className="po-marks">
        {markers > 0 && <span title={`${markers} 個進度標記`}>⚑{markers}</span>}
        {spots > 0 && <span title={`${spots} 個 echo spot`}>♪{spots}</span>}
        {clues > 0 && <span title={`${clues} 個 visual clue`}>◈{clues}</span>}
      </span>
    );
  };

  return (
    <div className="po">
      <div className="po-toolbar">
        <input
          type="text"
          className="po-search"
          placeholder="搜尋標題、頁面 id…"
          value={search}
          spellCheck={false}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="po-legend">
          ☑(繼承) = 由祖先容器帶入，改動要去祖先或勾「豁免」
        </div>
      </div>

      {loading ? (
        <div className="po-empty">載入中…</div>
      ) : visibleRows.length === 0 ? (
        <div className="po-empty">
          {rows.length === 0 ? 'History 還沒有任何頁面' : '沒有符合搜尋的頁面'}
        </div>
      ) : (
        <div className="po-table-scroll">
          <table className="po-table">
            <thead>
              <tr>
                <th className="po-col-title">頁面</th>
                <th className="po-col-check">進度頁</th>
                <th className="po-col-check">豁免</th>
                <th className="po-col-gate">gate 條件</th>
                <th className="po-col-marks">標記</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr
                  key={row.id}
                  className={row.effective ? 'po-row--effective' : ''}
                >
                  <td className="po-col-title">
                    <span
                      className="po-indent"
                      style={{ paddingLeft: `${row.depth * 18}px` }}
                    >
                      <span className="po-type">
                        {PAGE_TYPE_LABELS[row.pageType] ?? row.pageType}
                      </span>
                      <a
                        className="po-title-link"
                        href={`/admin/edit/${row.id}`}
                        title={row.id}
                      >
                        {row.title || row.id}
                      </a>
                    </span>
                  </td>
                  <td className="po-col-check">
                    {row.inherited ? (
                      <span
                        className="po-inherited"
                        title={`繼承自「${row.inheritedFrom ?? '祖先容器'}」`}
                      >
                        ☑(繼承)
                      </span>
                    ) : (
                      <input
                        type="checkbox"
                        aria-label={`${row.title || row.id} 進度頁`}
                        checked={row.raw}
                        disabled={pendingId === row.id}
                        onChange={(e) =>
                          void toggle(row, 'progressPage', e.target.checked)
                        }
                      />
                    )}
                  </td>
                  <td className="po-col-check">
                    <input
                      type="checkbox"
                      aria-label={`${row.title || row.id} 不繼承容器進度`}
                      checked={row.exempt}
                      disabled={pendingId === row.id}
                      onChange={(e) =>
                        void toggle(row, 'gateExempt', e.target.checked)
                      }
                    />
                  </td>
                  <td className="po-col-gate">
                    {row.gateSummary ? (
                      // 旗標名可以很長，一列擠不下——單行截斷時整條看不到，
                      // 點開就一項一行完整顯示（title 屬性只有滑鼠看得到）
                      <button
                        type="button"
                        className={`po-gate${
                          expandedGates.has(row.id) ? ' po-gate--open' : ''
                        }`}
                        aria-expanded={expandedGates.has(row.id)}
                        title={
                          expandedGates.has(row.id)
                            ? '收合條件'
                            : '展開完整條件'
                        }
                        onClick={() => toggleGate(row.id)}
                      >
                        {expandedGates.has(row.id) ? (
                          <span className="po-gate-list">
                            {row.gateParts.map((part) => (
                              <span className="po-gate-part" key={part}>
                                {part}
                              </span>
                            ))}
                          </span>
                        ) : (
                          row.gateSummary
                        )}
                      </button>
                    ) : (
                      <span className="po-dim">—</span>
                    )}
                  </td>
                  <td className="po-col-marks">{renderMarks(row)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
