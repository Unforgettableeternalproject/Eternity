import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { ImageItem, SpriteAnimations } from './VisualsEditorBody';
import { API_BASE, getToast } from './editorHelpers';

type Phase = 'select-method' | 'configure' | 'define-anims';
type Method = 'multi' | 'grid';

function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function naturalSort(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function buildAssetUrl(key: string): string {
  return `${API_BASE}/api/assets/${key.split('/').map(encodeURIComponent).join('/')}`;
}

async function uploadBlob(
  blob: Blob,
  filename: string
): Promise<{ key: string } | null> {
  const file = new File([blob], filename, { type: 'image/png' });
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch(`/api/assets`, {
      method: 'POST',
      body: formData,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { ok: boolean; data: { key: string } };
    return json.ok ? json.data : null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────────────────────
interface SpriteEditorModalProps {
  onConfirm: (item: ImageItem) => void;
  onClose: () => void;
  existing?: ImageItem;
}

// ──────────────────────────────────────────────────────────────
// 元件
// ──────────────────────────────────────────────────────────────
export default function SpriteEditorModal({
  onConfirm,
  onClose,
  existing,
}: SpriteEditorModalProps) {
  // ── 階段 ──
  const [phase, setPhase] = useState<Phase>(
    existing ? 'define-anims' : 'select-method'
  );
  const [method, setMethod] = useState<Method>(existing ? 'grid' : 'multi');

  // ── 共用設定 ──
  const [columns, setColumns] = useState(existing?.columns || 4);
  const [rows, setRows] = useState(existing?.rows || 1);
  const [basePixelSize, setBasePixelSize] = useState(
    existing?.basePixelSize || 3
  );
  const [fps, setFps] = useState(existing?.fps || 8);
  const [uploading, setUploading] = useState(false);

  // ── 多檔模式 ──
  const [multiFiles, setMultiFiles] = useState<File[]>([]);
  const [multiPreviews, setMultiPreviews] = useState<string[]>([]);
  const multiInputRef = useRef<HTMLInputElement>(null);

  // ── 網格模式 ──
  const [gridFile, setGridFile] = useState<File | null>(null);
  const [gridPreview, setGridPreview] = useState<string>('');
  const [gridNaturalW, setGridNaturalW] = useState(
    existing ? (existing.frameWidth || 32) * (existing.columns || 1) : 0
  );
  const [gridNaturalH, setGridNaturalH] = useState(
    existing ? (existing.frameHeight || 32) * (existing.rows || 1) : 0
  );
  const gridInputRef = useRef<HTMLInputElement>(null);

  // ── 最終結果 ──
  const [r2Key, setR2Key] = useState(existing?.file || '');
  const [frameWidth, setFrameWidth] = useState(existing?.frameWidth || 32);
  const [frameHeight, setFrameHeight] = useState(existing?.frameHeight || 32);
  const [frameCount, setFrameCount] = useState(existing?.frameCount || 1);

  // ── 動畫定義 ──
  const [animations, setAnimations] = useState<SpriteAnimations>(
    existing?.animations || { default: [0, 0] }
  );
  const [newAnimName, setNewAnimName] = useState('');
  const [previewAnim, setPreviewAnim] = useState<string | null>(null);
  const [editingAnimName, setEditingAnimName] = useState<string | null>(null);
  const [editingNameValue, setEditingNameValue] = useState('');

  // Canvas ref（格線預覽）
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // 動畫預覽用 state
  const [previewFrame, setPreviewFrame] = useState(0);
  const previewRafRef = useRef<number | null>(null);
  const previewLastRef = useRef(0);

  // R2 URL
  const existingImageUrl = r2Key ? buildAssetUrl(r2Key) : '';
  const effectivePreview = gridPreview || existingImageUrl;

  // ──────────────────────────────────────────────────────────────
  // 多檔處理
  // ──────────────────────────────────────────────────────────────
  const handleMultiFiles = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []).sort((a, b) =>
        naturalSort(a.name, b.name)
      );
      setMultiFiles(files);
      const urls = files.map((f) => URL.createObjectURL(f));
      setMultiPreviews(urls);
      const cols = Math.ceil(Math.sqrt(files.length));
      setColumns(cols);
      setRows(Math.ceil(files.length / cols));
    },
    []
  );

  useEffect(() => {
    return () => multiPreviews.forEach((u) => URL.revokeObjectURL(u));
  }, [multiPreviews]);

  // ──────────────────────────────────────────────────────────────
  // 網格處理
  // ──────────────────────────────────────────────────────────────
  const handleGridFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setGridFile(file);
      const url = URL.createObjectURL(file);
      setGridPreview(url);
      const img = new Image();
      img.onload = () => {
        setGridNaturalW(img.naturalWidth);
        setGridNaturalH(img.naturalHeight);
        if (columns > 0) {
          setFrameWidth(Math.floor(img.naturalWidth / columns));
          setFrameHeight(Math.floor(img.naturalHeight / rows));
        }
      };
      img.src = url;
    },
    [columns, rows]
  );

  useEffect(() => {
    return () => {
      if (gridPreview) URL.revokeObjectURL(gridPreview);
    };
  }, [gridPreview]);

  // 根據 columns/rows 更新 cell 尺寸
  useEffect(() => {
    if (
      method === 'grid' &&
      gridNaturalW &&
      gridNaturalH &&
      columns > 0 &&
      rows > 0
    ) {
      setFrameWidth(Math.floor(gridNaturalW / columns));
      setFrameHeight(Math.floor(gridNaturalH / rows));
      setFrameCount(columns * rows);
    }
  }, [method, gridNaturalW, gridNaturalH, columns, rows]);

  // ──────────────────────────────────────────────────────────────
  // Canvas 格線預覽 + 拖曳調整
  // ──────────────────────────────────────────────────────────────
  const [canvasScale, setCanvasScale] = useState(1);

  // 繪製 Canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (method === 'grid' && effectivePreview) {
      // 不設 crossOrigin — canvas 會變 tainted 但我們只需要畫，不需要讀像素
      const img = new Image();
      img.onload = () => {
        const maxW = 520;
        const sc = Math.min(1, maxW / img.naturalWidth);
        setCanvasScale(sc);
        canvas.width = img.naturalWidth * sc;
        canvas.height = img.naturalHeight * sc;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // 棋盤格背景（透明圖片辨識用）
        const tileSize = 8;
        for (let y = 0; y < canvas.height; y += tileSize) {
          for (let x = 0; x < canvas.width; x += tileSize) {
            ctx.fillStyle =
              (Math.floor(x / tileSize) + Math.floor(y / tileSize)) % 2 === 0
                ? '#2a2a30'
                : '#22222a';
            ctx.fillRect(x, y, tileSize, tileSize);
          }
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // 格線
        if (columns > 0 && rows > 0) {
          const cellW = canvas.width / columns;
          const cellH = canvas.height / rows;
          // 半透明填色第一格（提示可拖曳）
          ctx.fillStyle = 'rgba(94, 84, 142, 0.12)';
          ctx.fillRect(0, 0, cellW, cellH);
          // 格線
          ctx.strokeStyle = 'rgba(94, 84, 142, 0.6)';
          ctx.lineWidth = 1;
          for (let c = 1; c < columns; c++) {
            ctx.beginPath();
            ctx.moveTo(c * cellW, 0);
            ctx.lineTo(c * cellW, canvas.height);
            ctx.stroke();
          }
          for (let r = 1; r < rows; r++) {
            ctx.beginPath();
            ctx.moveTo(0, r * cellH);
            ctx.lineTo(canvas.width, r * cellH);
            ctx.stroke();
          }
          // 第一格右邊和下邊的拖曳把手
          ctx.fillStyle = '#5e548e';
          // 右邊把手
          ctx.beginPath();
          ctx.arc(cellW, cellH / 2, 5, 0, Math.PI * 2);
          ctx.fill();
          // 下邊把手
          ctx.beginPath();
          ctx.arc(cellW / 2, cellH, 5, 0, Math.PI * 2);
          ctx.fill();
        }
      };
      img.src = effectivePreview;
    } else if (method === 'multi' && multiPreviews.length > 0) {
      const thumbSize = 48;
      const cols = columns || Math.ceil(Math.sqrt(multiPreviews.length));
      const rws = Math.ceil(multiPreviews.length / cols);
      canvas.width = cols * thumbSize;
      canvas.height = rws * thumbSize;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(94, 84, 142, 0.05)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = 'rgba(94, 84, 142, 0.3)';
      ctx.lineWidth = 1;
      for (let c = 0; c <= cols; c++) {
        ctx.beginPath();
        ctx.moveTo(c * thumbSize, 0);
        ctx.lineTo(c * thumbSize, canvas.height);
        ctx.stroke();
      }
      for (let r = 0; r <= rws; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * thumbSize);
        ctx.lineTo(canvas.width, r * thumbSize);
        ctx.stroke();
      }
      multiPreviews.forEach((url, i) => {
        const img = new Image();
        img.onload = () => {
          const x = (i % cols) * thumbSize;
          const y = Math.floor(i / cols) * thumbSize;
          ctx.drawImage(img, x + 2, y + 2, thumbSize - 4, thumbSize - 4);
        };
        img.src = url;
      });
    }
  }, [method, effectivePreview, multiPreviews, columns, rows, phase]);

  // Canvas 拖曳事件
  const dragTypeRef = useRef<'col' | 'row' | null>(null);

  const handleCanvasMouseDown = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || method !== 'grid' || !gridNaturalW) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cellW = canvas.width / columns;
      const cellH = canvas.height / rows;
      // 判斷是否在拖曳把手附近（8px 半徑）
      const distRight = Math.hypot(x - cellW, y - cellH / 2);
      const distBottom = Math.hypot(x - cellW / 2, y - cellH);
      if (distRight < 12) dragTypeRef.current = 'col';
      else if (distBottom < 12) dragTypeRef.current = 'row';
    },
    [method, gridNaturalW, columns, rows]
  );

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!dragTypeRef.current) return;
      const canvas = canvasRef.current;
      if (!canvas || !gridNaturalW || !gridNaturalH) return;
      const rect = canvas.getBoundingClientRect();

      if (dragTypeRef.current === 'col') {
        const x = e.clientX - rect.left;
        const newCellW = Math.max(8, x) / canvasScale;
        const newCols = Math.max(1, Math.round(gridNaturalW / newCellW));
        if (newCols !== columns) setColumns(newCols);
      } else {
        const y = e.clientY - rect.top;
        const newCellH = Math.max(8, y) / canvasScale;
        const newRows = Math.max(1, Math.round(gridNaturalH / newCellH));
        if (newRows !== rows) setRows(newRows);
      }
    },
    [gridNaturalW, gridNaturalH, canvasScale, columns, rows]
  );

  const handleCanvasMouseUp = useCallback(() => {
    dragTypeRef.current = null;
  }, []);

  // Canvas cursor
  const handleCanvasHover = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      if (!canvas || method !== 'grid' || !gridNaturalW) {
        if (canvas) canvas.style.cursor = 'default';
        return;
      }
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const cellW = canvas.width / columns;
      const cellH = canvas.height / rows;
      const distRight = Math.hypot(x - cellW, y - cellH / 2);
      const distBottom = Math.hypot(x - cellW / 2, y - cellH);
      if (distRight < 12) canvas.style.cursor = 'ew-resize';
      else if (distBottom < 12) canvas.style.cursor = 'ns-resize';
      else canvas.style.cursor = 'default';
    },
    [method, gridNaturalW, columns, rows]
  );

  // ──────────────────────────────────────────────────────────────
  // 多檔合成 + 上傳
  // ──────────────────────────────────────────────────────────────
  const stitchAndUpload = useCallback(async () => {
    if (multiFiles.length === 0) return;
    setUploading(true);
    try {
      const images = await Promise.all(
        multiFiles.map(
          (f) =>
            new Promise<HTMLImageElement>((resolve, reject) => {
              const img = new Image();
              img.onload = () => resolve(img);
              img.onerror = reject;
              img.src = URL.createObjectURL(f);
            })
        )
      );
      const fw = images[0].naturalWidth;
      const fh = images[0].naturalHeight;
      const cols = columns || Math.ceil(Math.sqrt(images.length));
      const rws = Math.ceil(images.length / cols);
      const offCanvas = document.createElement('canvas');
      offCanvas.width = cols * fw;
      offCanvas.height = rws * fh;
      const offCtx = offCanvas.getContext('2d')!;
      images.forEach((img, i) => {
        offCtx.drawImage(
          img,
          (i % cols) * fw,
          Math.floor(i / cols) * fh,
          fw,
          fh
        );
      });
      const blob = await new Promise<Blob>((resolve) =>
        offCanvas.toBlob((b) => resolve(b!), 'image/png')
      );
      const prefix =
        multiFiles[0].name.replace(/[-_]?\d+\.\w+$/, '') || 'sprite';
      const result = await uploadBlob(blob, `sprite-${prefix}.png`);
      if (!result) throw new Error('上傳失敗');
      setR2Key(result.key);
      setFrameWidth(fw);
      setFrameHeight(fh);
      setFrameCount(images.length);
      setColumns(cols);
      setRows(rws);
      setAnimations({ default: [0, images.length - 1] });
      images.forEach((img) => URL.revokeObjectURL(img.src));
      setPhase('define-anims');
    } catch (err) {
      console.error('合成失敗:', err);
      getToast().error('精靈圖合成失敗，請重試');
    } finally {
      setUploading(false);
    }
  }, [multiFiles, columns]);

  // ──────────────────────────────────────────────────────────────
  // 網格模式上傳
  // ──────────────────────────────────────────────────────────────
  const uploadGrid = useCallback(async () => {
    if (!gridFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', gridFile);
      const res = await fetch(`/api/assets`, {
        method: 'POST',
        body: formData,
      });
      if (!res.ok) throw new Error('上傳失敗');
      const json = (await res.json()) as { ok: boolean; data: { key: string } };
      if (!json.ok) throw new Error('上傳回傳 ok=false');
      setR2Key(json.data.key);
      setAnimations({ default: [0, frameCount - 1] });
      setPhase('define-anims');
    } catch (err) {
      console.error('上傳失敗:', err);
      getToast().error('上傳失敗，請重試');
    } finally {
      setUploading(false);
    }
  }, [gridFile, frameCount]);

  // ──────────────────────────────────────────────────────────────
  // 動畫定義操作
  // ──────────────────────────────────────────────────────────────
  const addAnimation = useCallback(() => {
    const name = newAnimName.trim();
    if (!name || animations[name]) return;
    setAnimations((prev) => ({ ...prev, [name]: [0, frameCount - 1] }));
    setNewAnimName('');
  }, [newAnimName, animations, frameCount]);

  const renameAnimation = useCallback(
    (oldName: string, newName: string) => {
      const trimmed = newName.trim();
      if (!trimmed || trimmed === oldName || animations[trimmed]) {
        setEditingAnimName(null);
        return;
      }
      setAnimations((prev) => {
        const next: SpriteAnimations = {};
        for (const [k, v] of Object.entries(prev)) {
          next[k === oldName ? trimmed : k] = v;
        }
        return next;
      });
      if (previewAnim === oldName) setPreviewAnim(trimmed);
      setEditingAnimName(null);
    },
    [animations, previewAnim]
  );

  const removeAnimation = useCallback((name: string) => {
    setAnimations((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
  }, []);

  const updateAnimRange = useCallback(
    (name: string, idx: 0 | 1, value: number) => {
      setAnimations((prev) => {
        const range = [...prev[name]] as [number, number];
        range[idx] = Math.max(0, Math.min(frameCount - 1, value));
        return { ...prev, [name]: range };
      });
    },
    [frameCount]
  );

  // ──────────────────────────────────────────────────────────────
  // 動畫預覽播放
  // ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!previewAnim || !animations[previewAnim] || !existingImageUrl) {
      if (previewRafRef.current) cancelAnimationFrame(previewRafRef.current);
      previewRafRef.current = null;
      return;
    }
    const [start, end] = animations[previewAnim];
    previewLastRef.current = performance.now();
    setPreviewFrame(start);
    let frame = start;
    const interval = 1000 / fps;

    const tick = (now: number) => {
      if (now - previewLastRef.current >= interval) {
        previewLastRef.current = now;
        frame = frame >= end ? start : frame + 1;
        setPreviewFrame(frame);
      }
      previewRafRef.current = requestAnimationFrame(tick);
    };
    previewRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (previewRafRef.current) cancelAnimationFrame(previewRafRef.current);
    };
  }, [previewAnim, animations, fps, existingImageUrl]);

  // 自動預覽第一個動畫
  useEffect(() => {
    if (phase === 'define-anims' && !previewAnim) {
      const names = Object.keys(animations);
      if (names.length > 0) setPreviewAnim(names[0]);
    }
  }, [phase, animations, previewAnim]);

  // ──────────────────────────────────────────────────────────────
  // 確認輸出
  // ──────────────────────────────────────────────────────────────
  const handleConfirm = useCallback(() => {
    const item: ImageItem = {
      id: existing?.id || generateId(),
      file: r2Key,
      caption: existing?.caption || '',
      sortOrder: 0,
      isSpriteSheet: true,
      frameWidth,
      frameHeight,
      frameCount,
      columns,
      rows,
      fps,
      animations,
      basePixelSize,
    };
    onConfirm(item);
  }, [
    existing,
    r2Key,
    frameWidth,
    frameHeight,
    frameCount,
    columns,
    rows,
    fps,
    animations,
    basePixelSize,
    onConfirm,
  ]);

  // ──────────────────────────────────────────────────────────────
  // 共用樣式
  // ──────────────────────────────────────────────────────────────
  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    zIndex: 9999,
    background: 'rgba(0,0,0,0.6)',
    backdropFilter: 'blur(4px)',
    display: 'grid',
    placeItems: 'center',
    padding: 24,
  };
  const panelStyle: React.CSSProperties = {
    background: 'var(--bg-card, #1a1a22)',
    border: '1px solid var(--line, #333)',
    borderRadius: 12,
    maxWidth: 780,
    width: '100%',
    maxHeight: '85vh',
    overflow: 'auto',
    padding: 28,
  };
  const labelStyle: React.CSSProperties = {
    fontFamily: 'var(--font-mono)',
    fontSize: 10,
    letterSpacing: '0.12em',
    color: 'var(--ink-mute)',
    marginBottom: 4,
    display: 'block',
  };
  const inputStyle: React.CSSProperties = {
    padding: '6px 10px',
    border: '1px solid var(--line, #444)',
    background: 'transparent',
    borderRadius: 4,
    color: 'inherit',
    fontFamily: 'var(--font-mono)',
    fontSize: 13,
    width: 80,
  };
  const btnStyle: React.CSSProperties = {
    padding: '8px 20px',
    border: '1px solid var(--line, #444)',
    background: 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    borderRadius: 6,
    fontSize: 13,
  };
  const primaryBtnStyle: React.CSSProperties = {
    ...btnStyle,
    background: '#5e548e',
    borderColor: '#5e548e',
    color: '#fff',
  };

  // ──────────────────────────────────────────────────────────────
  // Render: 階段 1 — 選擇方法
  // ──────────────────────────────────────────────────────────────
  if (phase === 'select-method') {
    return (
      <div style={overlayStyle} onClick={onClose}>
        <div
          style={{ ...panelStyle, maxWidth: 480 }}
          onClick={(e) => e.stopPropagation()}
        >
          <h3 style={{ margin: '0 0 20px', fontSize: 18, fontWeight: 600 }}>
            精靈圖設定
          </h3>
          <div style={{ display: 'flex', gap: 16 }}>
            <button
              style={{
                ...btnStyle,
                flex: 1,
                padding: '24px 16px',
                textAlign: 'center',
              }}
              onClick={() => {
                setMethod('multi');
                setPhase('configure');
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }}>⊞</div>
              <div style={{ fontWeight: 600 }}>多檔合成</div>
              <div
                style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 4 }}
              >
                上傳多個幀圖片，自動合成
              </div>
            </button>
            <button
              style={{
                ...btnStyle,
                flex: 1,
                padding: '24px 16px',
                textAlign: 'center',
              }}
              onClick={() => {
                setMethod('grid');
                setPhase('configure');
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }}>▦</div>
              <div style={{ fontWeight: 600 }}>網格切割</div>
              <div
                style={{ fontSize: 11, color: 'var(--ink-mute)', marginTop: 4 }}
              >
                上傳整張精靈圖，設定切割
              </div>
            </button>
          </div>
          <div style={{ marginTop: 16, textAlign: 'right' }}>
            <button style={btnStyle} onClick={onClose}>
              取消
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────
  // Render: 階段 2 — 設定參數（可拖曳格線）
  // ──────────────────────────────────────────────────────────────
  if (phase === 'configure') {
    return (
      <div style={overlayStyle} onClick={onClose}>
        <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
          <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 600 }}>
            {method === 'multi' ? '多檔合成' : '網格切割'}
          </h3>

          {/* 檔案選取 */}
          {method === 'multi' ? (
            <>
              <input
                ref={multiInputRef}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={handleMultiFiles}
              />
              <button
                style={{ ...btnStyle, marginBottom: 12 }}
                onClick={() => multiInputRef.current?.click()}
              >
                選擇幀圖片（多選）
              </button>
              {multiFiles.length > 0 && (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--ink-mute)',
                    marginBottom: 12,
                  }}
                >
                  已選擇 {multiFiles.length} 個檔案
                </div>
              )}
            </>
          ) : (
            <>
              <input
                ref={gridInputRef}
                type="file"
                accept="image/*"
                style={{ display: 'none' }}
                onChange={handleGridFile}
              />
              {!r2Key && (
                <button
                  style={{ ...btnStyle, marginBottom: 12 }}
                  onClick={() => gridInputRef.current?.click()}
                >
                  選擇精靈圖
                </button>
              )}
              {(gridFile || r2Key) && (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--ink-mute)',
                    marginBottom: 12,
                  }}
                >
                  {gridFile ? `${gridFile.name} (` : ''}
                  {gridNaturalW}×{gridNaturalH}
                  {gridFile ? ')' : ' px'}
                </div>
              )}
            </>
          )}

          {/* Canvas 預覽（可拖曳把手） */}
          <div style={{ marginBottom: 12, textAlign: 'center' }}>
            <canvas
              ref={canvasRef}
              onMouseDown={handleCanvasMouseDown}
              onMouseMove={(e) => {
                handleCanvasMouseMove(e);
                if (!dragTypeRef.current) handleCanvasHover(e);
              }}
              onMouseUp={handleCanvasMouseUp}
              onMouseLeave={handleCanvasMouseUp}
              style={{
                maxWidth: '100%',
                border: '1px dashed var(--line, #444)',
                imageRendering: 'pixelated',
              }}
            />
            {method === 'grid' && effectivePreview && (
              <div
                style={{ fontSize: 10, color: 'var(--ink-mute)', marginTop: 4 }}
              >
                拖曳紫色圓點調整格線 · Cell: {frameWidth}×{frameHeight}px ·{' '}
                {frameCount} 幀
              </div>
            )}
          </div>

          {/* 數值設定 */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))',
              gap: 12,
              marginBottom: 16,
            }}
          >
            <div>
              <label style={labelStyle}>Columns</label>
              <input
                type="number"
                min={1}
                value={columns}
                onChange={(e) => setColumns(Math.max(1, +e.target.value))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Rows</label>
              <input
                type="number"
                min={1}
                value={rows}
                onChange={(e) => setRows(Math.max(1, +e.target.value))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>Base Pixel</label>
              <input
                type="number"
                min={1}
                value={basePixelSize}
                onChange={(e) => setBasePixelSize(Math.max(1, +e.target.value))}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>FPS</label>
              <input
                type="number"
                min={1}
                max={60}
                value={fps}
                onChange={(e) =>
                  setFps(Math.max(1, Math.min(60, +e.target.value)))
                }
                style={inputStyle}
              />
            </div>
          </div>

          {/* 按鈕列 */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              style={btnStyle}
              onClick={() =>
                r2Key ? setPhase('define-anims') : setPhase('select-method')
              }
            >
              返回
            </button>
            <button
              style={{ ...primaryBtnStyle, opacity: uploading ? 0.5 : 1 }}
              disabled={
                uploading ||
                (!r2Key && method === 'multi' && multiFiles.length === 0) ||
                (!r2Key && method === 'grid' && !gridFile)
              }
              onClick={() => {
                if (r2Key) setPhase('define-anims');
                else if (method === 'multi') stitchAndUpload();
                else uploadGrid();
              }}
            >
              {uploading ? '處理中...' : '下一步'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ──────────────────────────────────────────────────────────────
  // Render: 階段 3 — 定義動畫（帶即時預覽）
  // ──────────────────────────────────────────────────────────────
  const pvScale = Math.max(basePixelSize, 2);
  const pvW = frameWidth * pvScale;
  const pvH = frameHeight * pvScale;
  const pvSheetW = columns * frameWidth * pvScale;
  const pvCol = previewFrame % columns;
  const pvRow = Math.floor(previewFrame / columns);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 600 }}>
          定義動畫
        </h3>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 200px',
            gap: 20,
            minHeight: 300,
          }}
        >
          {/* 左側：動畫列表 */}
          <div>
            <div
              style={{
                fontSize: 12,
                color: 'var(--ink-mute)',
                marginBottom: 12,
              }}
            >
              {frameWidth}×{frameHeight}px · {columns}×{rows} · {frameCount} 幀
              · {fps}fps
              <button
                style={{
                  ...btnStyle,
                  padding: '2px 8px',
                  fontSize: 10,
                  marginLeft: 8,
                }}
                onClick={() => setPhase('configure')}
              >
                調整參數
              </button>
            </div>

            {/* 動畫列表 */}
            <div style={{ marginBottom: 12 }}>
              {Object.entries(animations).map(([name, [start, end]]) => (
                <div
                  key={name}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 0',
                    borderBottom: '1px solid var(--line, #333)',
                    background:
                      previewAnim === name ? 'rgba(94,84,142,0.08)' : undefined,
                    cursor: 'pointer',
                  }}
                  onClick={() => setPreviewAnim(name)}
                >
                  {editingAnimName === name ? (
                    <input
                      autoFocus
                      value={editingNameValue}
                      onChange={(e) => setEditingNameValue(e.target.value)}
                      onBlur={() => renameAnimation(name, editingNameValue)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter')
                          renameAnimation(name, editingNameValue);
                        if (e.key === 'Escape') setEditingAnimName(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        ...inputStyle,
                        width: 70,
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    />
                  ) : (
                    <span
                      style={{
                        fontWeight: 600,
                        fontSize: 13,
                        minWidth: 70,
                        color: previewAnim === name ? '#5e548e' : 'inherit',
                        cursor: 'text',
                      }}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingAnimName(name);
                        setEditingNameValue(name);
                      }}
                      title="雙擊重新命名"
                    >
                      {previewAnim === name ? '▸ ' : ''}
                      {name}
                    </span>
                  )}
                  <label
                    style={{ ...labelStyle, marginBottom: 0, fontSize: 9 }}
                  >
                    起始
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={frameCount - 1}
                    value={start}
                    onChange={(e) => updateAnimRange(name, 0, +e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ ...inputStyle, width: 50, fontSize: 11 }}
                  />
                  <label
                    style={{ ...labelStyle, marginBottom: 0, fontSize: 9 }}
                  >
                    結束
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={frameCount - 1}
                    value={end}
                    onChange={(e) => updateAnimRange(name, 1, +e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ ...inputStyle, width: 50, fontSize: 11 }}
                  />
                  <button
                    style={{
                      ...btnStyle,
                      padding: '2px 6px',
                      fontSize: 10,
                      color: '#c44',
                      borderColor: '#c44',
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeAnimation(name);
                    }}
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>

            {/* 新增動畫 */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="text"
                placeholder="動畫名稱"
                value={newAnimName}
                onChange={(e) => setNewAnimName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addAnimation()}
                style={{ ...inputStyle, width: 120 }}
              />
              <button style={btnStyle} onClick={addAnimation}>
                + 新增
              </button>
            </div>
          </div>

          {/* 右側：即時預覽 */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 8,
              paddingTop: 8,
            }}
          >
            <div
              style={{
                fontSize: 10,
                color: 'var(--ink-mute)',
                letterSpacing: '0.1em',
              }}
            >
              預覽
            </div>
            {existingImageUrl ? (
              <div
                style={{
                  width: pvW,
                  height: pvH,
                  overflow: 'hidden',
                  flexShrink: 0,
                  border: '1px dashed var(--line, #444)',
                  backgroundImage: `url(${existingImageUrl})`,
                  backgroundSize: `${pvSheetW}px auto`,
                  backgroundPosition: `${-(pvCol * pvW)}px ${-(pvRow * pvH)}px`,
                  backgroundRepeat: 'no-repeat',
                  imageRendering: 'pixelated',
                }}
              />
            ) : (
              <div
                style={{
                  width: 120,
                  height: 120,
                  border: '1px dashed var(--line, #444)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: 11,
                  color: 'var(--ink-mute)',
                }}
              >
                尚無圖片
              </div>
            )}
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
                color: 'var(--ink-mute)',
              }}
            >
              Frame {previewFrame}
              {previewAnim && animations[previewAnim] && (
                <>
                  {' '}
                  / {animations[previewAnim][0]}–{animations[previewAnim][1]}
                </>
              )}
            </div>
          </div>
        </div>

        {/* 按鈕列 */}
        <div
          style={{
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
            marginTop: 16,
          }}
        >
          <button
            style={primaryBtnStyle}
            disabled={!r2Key || Object.keys(animations).length === 0}
            onClick={handleConfirm}
          >
            確認
          </button>
        </div>
      </div>
    </div>
  );
}
