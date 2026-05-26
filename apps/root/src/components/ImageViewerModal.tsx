import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface ImageModalEvent {
  src: string;
  alt?: string;
}

export default function ImageViewerModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentImage, setCurrentImage] = useState<ImageModalEvent>({
    src: '',
    alt: '',
  });
  const [currentZoom, setCurrentZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);
  const [isClosing, setIsClosing] = useState(false);

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
    }, 200);
  };

  const handleZoomIn = () => {
    setCurrentZoom((prev) => Math.min(prev + 0.25, 3));
  };

  const handleZoomOut = () => {
    setCurrentZoom((prev) => {
      const newZoom = Math.max(prev - 0.25, 0.5);
      if (newZoom === 1) {
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
      if (newZoom === 1) {
        setTranslateX(0);
        setTranslateY(0);
      }
      return newZoom;
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (currentZoom > 1) {
      setIsDragging(true);
      setStartX(e.clientX - translateX);
      setStartY(e.clientY - translateY);
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      e.preventDefault();
      setTranslateX(e.clientX - startX);
      setTranslateY(e.clientY - startY);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
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
        animation: isClosing
          ? 'qImgFadeOut 0.2s ease-out'
          : 'qImgFadeIn 0.2s ease-out',
      }}
    >
      {/* 背景遮罩 */}
      <div
        onClick={handleClose}
        style={{
          position: 'absolute',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.88)',
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
          animation: isClosing
            ? 'qImgScaleOut 0.2s ease-out'
            : 'qImgScaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
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
                cursor: isDragging
                  ? 'grabbing'
                  : currentZoom > 1
                    ? 'grab'
                    : 'default',
                transform: `scale(${currentZoom}) translate(${translateX}px, ${translateY}px)`,
                transition: isDragging ? 'none' : 'transform 0.3s ease-out',
              }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
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
        @keyframes qImgFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes qImgFadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }
        @keyframes qImgScaleIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        @keyframes qImgScaleOut {
          from { opacity: 1; transform: scale(1); }
          to { opacity: 0; transform: scale(0.97); }
        }
      `}</style>
    </div>
  );

  return createPortal(modalContent, document.body);
}
