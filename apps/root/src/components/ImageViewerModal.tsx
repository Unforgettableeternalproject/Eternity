import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

interface ImageModalEvent {
  src: string;
  alt?: string;
}

export default function ImageViewerModal() {
  // SSR guard：讓 client:idle 在伺服器端安全地回傳空內容
  if (typeof window === 'undefined') return null;

  const [isOpen, setIsOpen] = useState(false);
  const [currentImage, setCurrentImage] = useState<ImageModalEvent>({
    src: '',
    alt: '',
  });
  const [currentZoom, setCurrentZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [isClosing, setIsClosing] = useState(false);

  // 用 ref 儲存拖曳起始點，避免 stale closure 問題
  const dragStart = useRef({ x: 0, y: 0 });
  // 記錄拖曳開始時的位移量，讓累積位移更精確
  const dragOrigin = useRef({ tx: 0, ty: 0 });

  useEffect(() => {
    const handleOpenModal = (e: CustomEvent<ImageModalEvent>) => {
      setCurrentImage(e.detail);
      setIsOpen(true);
    };

    window.addEventListener('openImageModal' as any, handleOpenModal);
    return () =>
      window.removeEventListener('openImageModal' as any, handleOpenModal);
  }, []);

  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      setIsClosing(false);
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          handleClose();
          break;
        case '+':
        case '=':
          handleZoomIn();
          break;
        case '-':
          handleZoomOut();
          break;
        case 'r':
        case 'R':
          handleReset();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, currentZoom]);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => {
      setIsOpen(false);
      setCurrentZoom(1);
      setTranslateX(0);
      setTranslateY(0);
      setIsClosing(false);
    }, 250);
  };

  const handleZoomIn = () => {
    setCurrentZoom((prev) => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setCurrentZoom((prev) => {
      const newZoom = Math.max(prev - 0.25, 0.5);
      if (newZoom <= 1) {
        setTranslateX(0);
        setTranslateY(0);
      }
      return newZoom;
    });
  };

  const handleReset = () => {
    setCurrentZoom(1);
    setTranslateX(0);
    setTranslateY(0);
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    setCurrentZoom((prev) => {
      const newZoom = Math.max(0.5, Math.min(3, prev + delta));
      if (newZoom <= 1) {
        setTranslateX(0);
        setTranslateY(0);
      }
      return newZoom;
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // 縮放大於 1 才允許拖曳
    if (currentZoom > 1) {
      e.preventDefault();
      setIsDragging(true);
      // 記錄按下時的滑鼠位置和當前位移原點
      dragStart.current = { x: e.clientX, y: e.clientY };
      dragOrigin.current = { tx: translateX, ty: translateY };
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    // 以起始原點累加差值，避免每幀累積誤差
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setTranslateX(dragOrigin.current.tx + dx);
    setTranslateY(dragOrigin.current.ty + dy);
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  // 雙擊圖片重置縮放和位置至初始狀態
  const handleDoubleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    handleReset();
  };

  if (!isOpen && !isClosing) return null;

  const { src, alt = '' } = currentImage;

  /* Quartz 按鈕共用樣式 */
  const btnBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '0.5rem',
    border: '1px solid rgba(255,255,255,0.2)',
    background: 'rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.8)',
    cursor: 'pointer',
    transition: 'background 0.15s, color 0.15s',
  };

  const modalContent = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
        // 外層容器負責整體淡入/淡出動畫
        animation: isClosing
          ? 'qImgFadeOut 0.25s ease-out forwards'
          : 'qImgFadeIn 0.25s ease-out forwards',
      }}
    >
      {/* 背景遮罩：實心深色 + backdrop-filter 模糊 */}
      <div
        onClick={handleClose}
        style={{
          position: 'absolute',
          inset: 0,
          // 實心深色背景，避免透視到頁面內容
          background: 'rgba(10, 10, 14, 0.95)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          cursor: 'pointer',
          zIndex: 1,
        }}
      />

      {/* 內容區 */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'relative',
          display: 'flex',
          flexDirection: 'column',
          maxWidth: '90vw',
          maxHeight: '90vh',
          zIndex: 2,
          // 圖片容器有獨立的縮放進出動畫
          animation: isClosing
            ? 'qImgScaleOut 0.25s ease-out forwards'
            : 'qImgScaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
        }}
      >
        {/* 頂部控制列 */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '1rem',
            marginBottom: '0.75rem',
            padding: '0 0.25rem',
          }}
        >
          {/* 縮放控制 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 0,
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(255,255,255,0.06)',
            }}
          >
            <button
              onClick={handleZoomOut}
              title="縮小 (-)"
              style={btnBase}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')
              }
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="square" strokeWidth="2" d="M20 12H4" />
              </svg>
            </button>

            <span
              style={{
                fontSize: '0.75rem',
                fontWeight: 600,
                color: '#fff',
                padding: '0 0.75rem',
                minWidth: '3.5rem',
                textAlign: 'center',
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              }}
            >
              {Math.round(currentZoom * 100)}%
            </span>

            <button
              onClick={handleZoomIn}
              title="放大 (+)"
              style={btnBase}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')
              }
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="square"
                  strokeWidth="2"
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </button>

            <div
              style={{
                width: '1px',
                height: '1.5rem',
                background: 'rgba(255,255,255,0.15)',
              }}
            />

            <button
              onClick={handleReset}
              title="重置 (R)"
              style={btnBase}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = 'rgba(255,255,255,0.15)')
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = 'rgba(255,255,255,0.08)')
              }
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="square"
                  strokeWidth="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          </div>

          {/* 關閉按鈕 */}
          <button
            onClick={handleClose}
            title="關閉 (ESC)"
            style={{
              ...btnBase,
              padding: '0.625rem',
              borderColor: 'rgba(255,255,255,0.2)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'rgba(180,50,50,0.7)';
              e.currentTarget.style.borderColor = 'rgba(180,50,50,0.5)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.08)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.2)';
            }}
          >
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="square"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* 圖片區 */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
            minHeight: 0,
          }}
        >
          <div
            style={{
              border: '1px solid rgba(255,255,255,0.1)',
              overflow: 'hidden',
            }}
            onWheel={handleWheel}
          >
            <img
              src={src}
              alt={alt}
              draggable="false"
              style={{
                display: 'block',
                maxHeight: '75vh',
                maxWidth: '85vw',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                // grab/grabbing cursor 提示可拖曳
                cursor: isDragging
                  ? 'grabbing'
                  : currentZoom > 1
                    ? 'grab'
                    : 'default',
                // 修正 transform 順序：先 translate 再 scale，
                // 讓位移量不受縮放倍率影響（原本的 scale→translate 會放大位移距離）
                transform: `translate(${translateX}px, ${translateY}px) scale(${currentZoom})`,
                transition: isDragging ? 'none' : 'transform 0.3s ease-out',
                // 選取文字會干擾拖曳，關閉
                userSelect: 'none',
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
              onDoubleClick={handleDoubleClick}
            />
          </div>
        </div>

        {/* 底部說明 */}
        {alt && (
          <div style={{ marginTop: '0.75rem', padding: '0 0.25rem' }}>
            <p
              style={{
                textAlign: 'center',
                fontSize: '0.8rem',
                color: 'rgba(255,255,255,0.5)',
                fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                letterSpacing: '0.02em',
                border: '1px solid rgba(255,255,255,0.08)',
                padding: '0.5rem 1rem',
                margin: 0,
              }}
            >
              {alt}
            </p>
          </div>
        )}
      </div>

      <style>{`
        /* 整體淡入：遮罩 + 容器同步淡出 */
        @keyframes qImgFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes qImgFadeOut {
          from { opacity: 1; }
          to   { opacity: 0; }
        }
        /* 圖片容器的縮放入場：帶有彈性的 spring 效果 */
        @keyframes qImgScaleIn {
          from { opacity: 0; transform: scale(0.92); }
          to   { opacity: 1; transform: scale(1); }
        }
        /* 圖片容器縮放退場：輕微縮小同步消失 */
        @keyframes qImgScaleOut {
          from { opacity: 1; transform: scale(1); }
          to   { opacity: 0; transform: scale(0.95); }
        }
      `}</style>
    </div>
  );

  return createPortal(modalContent, document.body);
}
