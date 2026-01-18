import React, { useState, useRef, useEffect, type ReactNode } from 'react';

interface SortableCardProps {
  id: string;
  children: ReactNode;
  onDragStart: (id: string) => void;
  onDragOver: (e: React.DragEvent, id: string) => void;
  onDragEnd: () => void;
  isDragging: boolean;
}

export function SortableCard({
  id,
  children,
  onDragStart,
  onDragOver,
  onDragEnd,
  isDragging,
}: SortableCardProps) {
  const [canDrag, setCanDrag] = useState(false);

  console.log('SortableCard rendering for:', id);
  console.log('Children:', children);

  const handleDragStart = (e: React.DragEvent) => {
    console.log('handleDragStart called, canDrag:', canDrag);
    if (!canDrag) {
      e.preventDefault();
      console.log('Drag prevented - canDrag is false');
      return;
    }
    console.log('Starting drag for:', id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
    onDragStart(id);
  };

  const handleDragEnd = () => {
    console.log('Drag ended');
    setCanDrag(false);
    onDragEnd();
  };

  const handleMouseDown = () => {
    setCanDrag(true);
  };

  return (
    <div
      draggable={canDrag}
      onDragStart={handleDragStart}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(e, id);
      }}
      onDragEnd={handleDragEnd}
      style={{
        marginBottom: '32px',
        border: '5px solid lime',
        padding: '10px',
        backgroundColor: 'orange',
      }}
      data-card-id={id}
    >
      <div
        style={{
          backgroundColor: 'white',
          borderRadius: '12px',
          border: '2px solid #cbd5e1',
          overflow: 'hidden',
          boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
        }}
      >
        {/* 拖動把手 */}
        <div
          style={{
            backgroundColor: '#f1f5f9',
            padding: '12px 16px',
            cursor: 'grab',
            borderBottom: '2px solid #cbd5e1',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            userSelect: 'none',
            minHeight: '44px',
          }}
          onMouseDown={handleMouseDown}
          onMouseUp={() => {
            console.log('Mouse up on drag handle');
            setCanDrag(false);
          }}
          onMouseLeave={() => {
            console.log('Mouse leave drag handle');
            setCanDrag(false);
          }}
          onTouchStart={handleMouseDown}
          onTouchEnd={() => setCanDrag(false)}
          onTouchCancel={() => setCanDrag(false)}
        >
          <span style={{ fontSize: '18px', color: '#94a3b8' }}>⋮⋮</span>
          <span
            style={{ fontSize: '12px', color: '#475569', fontWeight: '600' }}
          >
            拖動調整順序
          </span>
        </div>
        {/* 卡片內容 */}
        <div data-card-content style={{ padding: '20px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

interface SortablePanelProps {
  side: 'left' | 'right';
  storageKey: string;
  cardIds: string[];
  children: ReactNode;
}

export default function SortablePanel({
  side,
  storageKey,
  cardIds,
  children,
}: SortablePanelProps) {
  const [orderedIds, setOrderedIds] = useState<string[]>(cardIds);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [cookieConsent, setCookieConsent] = useState<boolean | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // 檢查 Cookie 同意狀態
  useEffect(() => {
    const updateConsent = () => {
      const consent = localStorage.getItem('cookie-consent');
      setCookieConsent(consent === 'accepted');
    };

    updateConsent();

    // 監聽 Cookie 同意狀態變化
    window.addEventListener('cookie-consent-changed', updateConsent);

    return () => {
      window.removeEventListener('cookie-consent-changed', updateConsent);
    };
  }, []);

  // 從 localStorage 載入順序（僅在同意 Cookie 時）
  useEffect(() => {
    if (cookieConsent !== true) return;

    const saved = localStorage.getItem(storageKey);
    if (saved) {
      try {
        const savedOrder: string[] = JSON.parse(saved);
        // 驗證保存的順序是否有效
        const validOrder = savedOrder.filter((id) => cardIds.includes(id));
        // 添加任何新卡片
        const newCards = cardIds.filter((id) => !savedOrder.includes(id));
        setOrderedIds([...validOrder, ...newCards]);
      } catch (e) {
        console.error('Failed to parse saved order:', e);
      }
    }
  }, [storageKey, cardIds, cookieConsent]);

  useEffect(() => {
    if (cookieConsent === true) return;
    setOrderedIds(cardIds);
  }, [cardIds, cookieConsent]);

  // 儲存順序到 localStorage（僅在同意 Cookie 時）
  useEffect(() => {
    if (cookieConsent === true) {
      localStorage.setItem(storageKey, JSON.stringify(orderedIds));
    }
  }, [orderedIds, storageKey, cookieConsent]);

  const handleDragStart = (id: string) => {
    setDraggedId(id);
  };

  const handleDragOver = (e: React.DragEvent, id: string) => {
    if (draggedId === null || draggedId === id) return;

    // 取得目標元素的邊界資訊
    const targetElement = (e.currentTarget as HTMLElement).querySelector(
      '[data-card-content]'
    );
    if (!targetElement) return;

    const rect = targetElement.getBoundingClientRect();
    const mouseY = e.clientY;
    const elementTop = rect.top;
    const elementHeight = rect.height;
    const elementMiddle = elementTop + elementHeight / 2;

    // 只有滑鼠超過元素中央時才觸發置換
    const draggedIndex = orderedIds.indexOf(draggedId);
    const targetIndex = orderedIds.indexOf(id);

    if (draggedIndex === -1 || targetIndex === -1) return;

    // 判斷是向上拖還是向下拖
    const isDraggingDown = draggedIndex < targetIndex;
    const shouldSwap = isDraggingDown
      ? mouseY > elementMiddle
      : mouseY < elementMiddle;

    if (!shouldSwap) return;

    const newOrder = [...orderedIds];
    const [removed] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, removed);

    setOrderedIds(newOrder);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
  };

  const childrenArray = React.Children.toArray(children);
  const cardMap = new Map<string, React.ReactElement>();
  const nonSortable: ReactNode[] = [];

  console.log('=== SortablePanel Debug ===');
  console.log('Children count:', childrenArray.length);
  console.log('Expected cardIds:', cardIds);

  childrenArray.forEach((child, index) => {
    console.log(`Child ${index}:`, child);
    if (!React.isValidElement(child)) {
      console.log(`  -> Not a valid element`);
      nonSortable.push(child);
      return;
    }
    console.log(`  -> Props:`, child.props);
    const cardId = (child.props as any)['data-card-id'];
    console.log(`  -> data-card-id:`, cardId);
    if (!cardId) {
      console.log(`  -> No card ID, adding to nonSortable`);
      nonSortable.push(child);
      return;
    }
    console.log(`  -> Adding to cardMap with id:`, cardId);
    cardMap.set(cardId, child);
  });

  console.log('CardMap size:', cardMap.size);
  console.log('CardMap keys:', Array.from(cardMap.keys()));

  return (
    <aside
      className={`fixed ${
        side === 'left' ? 'left-4' : 'right-4'
      } top-32 w-64 z-30`}
      style={{ backgroundColor: 'pink' }}
    >
      <div ref={containerRef} className="flex flex-col">
        <div
          style={{
            padding: '20px',
            backgroundColor: 'lightblue',
            marginBottom: '10px',
            border: '3px solid blue',
          }}
        >
          測試：SortablePanel 已渲染
          <br />
          Side: {side}
          <br />
          Cards: {orderedIds.length}
          <br />
          CardMap: {cardMap.size}
        </div>
        {orderedIds.map((cardId) => {
          console.log('Attempting to render card:', cardId);
          const child = cardMap.get(cardId);
          console.log('Found child:', child);
          if (!child) {
            console.log('Child not found for:', cardId);
            return null;
          }
          console.log('Rendering SortableCard for:', cardId);
          return (
            <SortableCard
              key={cardId}
              id={cardId}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={handleDragEnd}
              isDragging={draggedId === cardId}
            >
              {(child.props as any).children}
            </SortableCard>
          );
        })}
        {nonSortable}
      </div>

      {/* 提示文字 */}
      {cookieConsent === false && (
        <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg">
          <p className="text-xs text-amber-800 dark:text-amber-200">
            接受 Cookie 以保存卡片順序
          </p>
        </div>
      )}
    </aside>
  );
}
