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

  const modalContent = (
    <div
      className={`fixed inset-0 z-[9999] flex items-center justify-center p-8 ${
        isClosing ? 'closing' : 'opening'
      }`}
      style={{
        animation: isClosing ? 'fadeOut 0.2s ease-out' : 'fadeIn 0.2s ease-out',
      }}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 cursor-pointer"
        style={{
          background: 'rgba(0, 0, 0, 0.85)',
          backdropFilter: 'blur(12px)',
          zIndex: 1,
        }}
        onClick={handleClose}
      />

      {/* Modal Wrapper */}
      <div
        className="relative flex flex-col max-w-[90vw] max-h-[90vh] w-auto h-auto"
        style={{
          zIndex: 2,
          animation: isClosing
            ? 'scaleOut 0.2s ease-out'
            : 'scaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 頂部控制欄 */}
        <div className="flex items-center justify-between gap-4 mb-4 px-2">
          <div className="flex items-center gap-2 bg-white/10 backdrop-blur-md rounded-full px-4 py-2 border border-white/20">
            <button
              className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all duration-200 active:scale-95"
              onClick={handleZoomOut}
              title="縮小 (-)"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M20 12H4"
                />
              </svg>
            </button>
            <span className="text-sm font-semibold text-white px-2 min-w-[3.5rem] text-center">
              {Math.round(currentZoom * 100)}%
            </span>
            <button
              className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all duration-200 active:scale-95"
              onClick={handleZoomIn}
              title="放大 (+)"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M12 4v16m8-8H4"
                />
              </svg>
            </button>
            <div className="w-px h-6 bg-white/20" />
            <button
              className="p-2 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-all duration-200 active:scale-95"
              onClick={handleReset}
              title="重置 (R)"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                />
              </svg>
            </button>
          </div>
          <button
            className="p-2.5 rounded-full bg-white/10 hover:bg-red-500/90 text-white/80 hover:text-white backdrop-blur-md transition-all duration-200 border border-white/20 hover:border-red-500/50 hover:shadow-lg hover:shadow-red-500/20"
            onClick={handleClose}
            title="關閉 (ESC)"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* 圖片展示區 */}
        <div className="relative flex items-center justify-center flex-1 min-h-0">
          <div
            className="relative rounded-xl overflow-hidden shadow-2xl"
            style={{
              background:
                'linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.05) 100%)',
              border: '2px solid rgba(255, 255, 255, 0.15)',
              backdropFilter: 'blur(10px)',
            }}
            onWheel={handleWheel}
          >
            <img
              src={src}
              alt={alt}
              className="block transition-transform duration-300 ease-out"
              style={{
                maxHeight: '75vh',
                maxWidth: '85vw',
                width: 'auto',
                height: 'auto',
                objectFit: 'contain',
                cursor: isDragging
                  ? 'grabbing'
                  : currentZoom > 1
                    ? 'grab'
                    : 'grab',
                transform: `scale(${currentZoom}) translate(${translateX}px, ${translateY}px)`,
              }}
              draggable="false"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
          </div>
        </div>

        {/* 底部說明 */}
        {alt && (
          <div className="mt-4 px-2">
            <p className="text-center text-sm text-white/70 bg-white/5 backdrop-blur-md rounded-full px-6 py-2 border border-white/10">
              {alt}
            </p>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        @keyframes fadeOut {
          from { opacity: 1; }
          to { opacity: 0; }
        }

        @keyframes scaleIn {
          from {
            opacity: 0;
            transform: scale(0.9);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }

        @keyframes scaleOut {
          from {
            opacity: 1;
            transform: scale(1);
          }
          to {
            opacity: 0;
            transform: scale(0.95);
          }
        }
      `}</style>
    </div>
  );

  return createPortal(modalContent, document.body);
}
