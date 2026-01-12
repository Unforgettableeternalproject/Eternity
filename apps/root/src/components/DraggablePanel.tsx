import { useState, useRef, useEffect, type ReactNode } from 'react';

interface DraggablePanelProps {
  children: ReactNode;
  initialPosition: { x: number; y: number };
  storageKey: string;
  className?: string;
}

export default function DraggablePanel({ 
  children, 
  initialPosition, 
  storageKey,
  className = '' 
}: DraggablePanelProps) {
  const [position, setPosition] = useState(initialPosition);
  const [isDragging, setIsDragging] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartPos = useRef({ x: 0, y: 0 });

  // 從 localStorage 載入位置
  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const savedPos = JSON.parse(saved);
        setPosition(savedPos);
      } catch (e) {
        console.error('Failed to parse saved position:', e);
      }
    }
  }, [storageKey]);

  // 儲存位置到 localStorage
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(position));
  }, [position, storageKey]);

  const handleMouseDown = (e: React.MouseEvent) => {
    // 只有點擊拖動手柄才能拖動
    if (!(e.target as HTMLElement).closest('.drag-handle')) return;
    
    setIsDragging(true);
    dragStartPos.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
    e.preventDefault();
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;

      const newX = e.clientX - dragStartPos.current.x;
      const newY = e.clientY - dragStartPos.current.y;

      // 限制在視窗範圍內
      const maxX = window.innerWidth - (panelRef.current?.offsetWidth || 0);
      const maxY = window.innerHeight - (panelRef.current?.offsetHeight || 0);

      setPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY)),
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  return (
    <div
      ref={panelRef}
      className={`fixed z-40 transition-shadow ${
        isDragging ? 'cursor-grabbing shadow-2xl' : 'cursor-auto shadow-lg'
      } ${className}`}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
      onMouseDown={handleMouseDown}
    >
      <div className={`bg-white/95 dark:bg-slate-800/95 backdrop-blur-md rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden ${
        isCollapsed ? 'w-12' : ''
      }`}>
        {/* 拖動手柄 */}
        <div className="drag-handle flex items-center justify-between px-3 py-2 bg-gradient-to-r from-primary-500 to-secondary-500 cursor-grab active:cursor-grabbing">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8h16M4 16h16" />
            </svg>
            {!isCollapsed && (
              <span className="text-xs font-semibold text-white">拖動面板</span>
            )}
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsCollapsed(!isCollapsed);
            }}
            className="text-white hover:bg-white/20 rounded p-1 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isCollapsed ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              )}
            </svg>
          </button>
        </div>

        {/* 內容區域 */}
        {!isCollapsed && (
          <div className="p-4 space-y-4 max-h-[70vh] overflow-y-auto">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
