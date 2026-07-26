/**
 * VisualClueBookmarks — 側邊視覺線索插卡（S8 下半場 V-D，#6 重新設計）。
 *
 * 掃描線進入 clue 起訖區間時浮現、離開即收起。多 clue 區間重疊時
 * 折疊成一落（後方卡片縮小、往下錯位堆疊，仍全部可見），滑鼠 hover
 * 或鍵盤 focus 時展開成完整卡片列。堆疊與展開都在同一個 .uep-clue-stack
 * 連續 hover 區內，展開後滑鼠移動不會讓卡片消失、可穩定點擊。
 *
 * 卡片右側是插卡本體，左側連接線以 flex 撐長，末端針腳圓點落到文章
 * 右緣——視覺上像從內文牽出的線索，刻意與史學紅的「上次位置」scroll
 * marker（右緣細線小標籤）拉開語彙區隔，改用幻影紫插卡＋畫框縮圖。
 *
 * 卡片內的畫框縮圖顯示 Gallery Clue 設計時指定的預設圖片；舊資料
 * 尚未保存 imageFile 時才退回畫框佔位。Image Gate 不建立獨立書籤。
 *
 * 定位維持固定高度釘位（不追個別 clue 錨點像素），確保多 clue 穩定
 * 堆疊、捲動不亂跳（設計文件 §七風險 1 的迴避解）。守門（島未掛載/
 * 未展開/觀測者不出現）由呼叫端負責，這裡是純渲染。
 */

import React, { useEffect, useRef, useState } from 'react';

import { getApiBase } from '../../lib/apiBase';
import type { VisualClueEntry } from './useVisualClues';
import { fetchClueGallery } from './visualClueGallery';

import './VisualClueBookmarks.css';

interface VisualClueBookmarksProps {
  clues: VisualClueEntry[];
  onClueClick: (clue: VisualClueEntry) => void;
}

const API_BASE = getApiBase();

/** 退場動畫時長，需與 CSS 的 clueCardOut 一致 */
const EXIT_DURATION_MS = 340;

interface LeavingClue {
  clue: VisualClueEntry;
  /** 離開當下的堆疊序位——退場中仍留在原位滑走，不重新排版 */
  index: number;
}

/**
 * 追蹤「這一輪被移除、動畫還沒播完」的插卡。
 *
 * 插卡的離開有三種：捲出區間、映射成功撤下、通過訖點落定。三者都是
 * 條件渲染直接消失，沒有離場過程——進場有動畫、離場沒有，看起來像
 * 卡片被抽掉而不是收起。
 *
 * 移除時機不靠 animationend：reduced-motion 下動畫被關掉就永遠收不到
 * 事件，卡片會永久卡在畫面上（S6-3 收合動畫踩過同一個坑），一律用計時器。
 */
function useLeavingClues(clues: VisualClueEntry[]): LeavingClue[] {
  const [leaving, setLeaving] = useState<LeavingClue[]>([]);
  const previousRef = useRef<VisualClueEntry[]>([]);
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const previous = previousRef.current;
    previousRef.current = clues;
    const currentIds = new Set(clues.map((clue) => clue.clueId));

    // 回捲重新進區間：取消未完成的退場，避免同一張卡同時有兩份
    for (const id of currentIds) {
      const timer = timersRef.current.get(id);
      if (timer) {
        clearTimeout(timer);
        timersRef.current.delete(id);
      }
    }

    const removed = previous
      .map((clue, index) => ({ clue, index }))
      .filter(({ clue }) => !currentIds.has(clue.clueId));

    setLeaving((current) => {
      const kept = current.filter(({ clue }) => !currentIds.has(clue.clueId));
      const fresh = removed.filter(
        ({ clue }) => !kept.some((entry) => entry.clue.clueId === clue.clueId)
      );
      return kept.length === current.length && fresh.length === 0
        ? current
        : [...kept, ...fresh];
    });

    for (const { clue } of removed) {
      const timer = setTimeout(() => {
        timersRef.current.delete(clue.clueId);
        setLeaving((current) =>
          current.filter((entry) => entry.clue.clueId !== clue.clueId)
        );
      }, EXIT_DURATION_MS);
      timersRef.current.set(clue.clueId, timer);
    }
  }, [clues]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  return leaving;
}

function thumbnailUrl(file: string): string {
  if (/^https?:\/\//i.test(file)) return file;
  const clean = file.startsWith('/api/assets/')
    ? file.slice('/api/assets/'.length)
    : file;
  return `${API_BASE}/api/assets/${clean
    .split('/')
    .map(encodeURIComponent)
    .join('/')}`;
}

function ClueThumbnail({ clue }: { clue: VisualClueEntry }) {
  const [file, setFile] = useState(clue.imageFile);

  useEffect(() => {
    setFile(clue.imageFile);
    if (clue.imageFile) return;
    let active = true;
    void fetchClueGallery(API_BASE, clue).then((gallery) => {
      if (!active || !gallery || !Array.isArray(gallery.images)) return;
      const images = gallery.images
        .filter(
          (image): image is Record<string, unknown> =>
            !!image && typeof image === 'object'
        )
        .map((image, index) => ({
          id: typeof image.id === 'string' ? image.id : '',
          file: typeof image.file === 'string' ? image.file : '',
          sortOrder:
            typeof image.sortOrder === 'number' ? image.sortOrder : index,
        }))
        .filter((image) => image.file)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const resolved = clue.imageId
        ? images.find((image) => image.id === clue.imageId)
        : images[0];
      if (resolved) setFile(resolved.file);
    });
    return () => {
      active = false;
    };
  }, [clue]);

  return (
    <span
      className={`uep-clue-card__thumb${file ? ' has-image' : ''}`}
      aria-hidden
    >
      {file ? (
        <img src={thumbnailUrl(file)} alt="" />
      ) : (
        <span className="uep-clue-card__glyph">❏</span>
      )}
    </span>
  );
}

/** 插卡內容（進行中與退場中共用同一份外觀） */
function ClueCardBody({ clue }: { clue: VisualClueEntry }) {
  return (
    <>
      {/* 連接線：flex 撐長，末端針腳圓點落到文章右緣 */}
      <span className="uep-clue-card__line" aria-hidden />
      <span className="uep-clue-card__frame">
        <ClueThumbnail clue={clue} />
        <span className="uep-clue-card__text">
          <span className="uep-clue-card__label">視覺線索</span>
          <span className="uep-clue-card__title">
            {clue.title || '未命名畫廊'}
          </span>
        </span>
      </span>
    </>
  );
}

export default function VisualClueBookmarks({
  clues,
  onClueClick,
}: VisualClueBookmarksProps) {
  const leaving = useLeavingClues(clues);

  if (clues.length === 0 && leaving.length === 0) return null;

  return (
    <div className="uep-clue-rail" role="complementary" aria-label="視覺線索">
      <div
        className="uep-clue-stack"
        style={
          // 退場中的卡片不計入堆疊高度：一邊滑走一邊讓出位置
          { '--clue-count': Math.max(clues.length, 1) } as React.CSSProperties
        }
      >
        {clues.map((clue, i) => (
          <button
            key={clue.clueId}
            type="button"
            className="uep-clue-card"
            style={{ '--clue-i': i } as React.CSSProperties}
            onClick={() => onClueClick(clue)}
            title={clue.title ? `檢視插圖：${clue.title}` : '檢視插圖'}
            aria-label={clue.title ? `檢視插圖：${clue.title}` : '檢視插圖'}
          >
            <ClueCardBody clue={clue} />
          </button>
        ))}
        {/* 退場中的卡片渲染在最後：不搶 :first-child 的進場動畫，
            也不再接受點擊或鍵盤焦點 */}
        {leaving.map(({ clue, index }) => (
          <span
            key={`leaving-${clue.clueId}`}
            className="uep-clue-card is-leaving"
            style={{ '--clue-i': index } as React.CSSProperties}
            aria-hidden
          >
            <ClueCardBody clue={clue} />
          </span>
        ))}
      </div>
    </div>
  );
}
