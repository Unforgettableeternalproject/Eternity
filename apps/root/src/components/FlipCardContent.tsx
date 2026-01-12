import { useState, useEffect, useRef } from 'react';

interface FlipCardContentProps {
  content: string; // Markdoc 編譯後的 HTML
  speed?: number;
  delay?: number;
}

export default function FlipCardContent({ 
  content, 
  speed = 10,
  delay = 200
}: FlipCardContentProps) {
  const [displayedLength, setDisplayedLength] = useState(0);
  const [isTyping, setIsTyping] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.log('FlipCardContent mounted, content length:', content.length);
    
    const container = containerRef.current;
    if (!container) {
      console.log('FlipCardContent: No container ref');
      return;
    }

    // 向上查找 flip-card 元素
    const flipCard = container.closest('[data-flip-card]');
    console.log('FlipCardContent: Found flip-card?', !!flipCard);
    
    if (!flipCard) {
      console.error('FlipCardContent: Could not find flip-card parent!');
      return;
    }

    // 監聽卡片的點擊事件
    const handleClick = () => {
      console.log('FlipCardContent: Card clicked!');
      
      // 短暫延遲後檢查是否在背面
      setTimeout(() => {
        const flipCardInner = flipCard.querySelector('.flip-card__inner');
        const isFlipped = flipCardInner?.classList.contains('flipped');
        console.log('FlipCardContent: Is flipped after click?', isFlipped);
        
        if (isFlipped && !isTyping) {
          console.log('FlipCardContent: Starting typewriter effect');
          setTimeout(() => {
            setIsTyping(true);
          }, delay);
        }
      }, 100);
    };

    flipCard.addEventListener('click', handleClick);
    console.log('FlipCardContent: Click listener attached');
    
    return () => {
      flipCard.removeEventListener('click', handleClick);
    };
  }, [delay, content.length, isTyping]);

  useEffect(() => {
    if (!isTyping) return;

    console.log('FlipCardContent: Typewriter started');
    let currentIndex = 0;
    const textLength = content.length;

    const interval = setInterval(() => {
      if (currentIndex <= textLength) {
        setDisplayedLength(currentIndex);
        currentIndex += 3; // 一次增加3個字元加快速度
      } else {
        console.log('FlipCardContent: Typewriter finished');
        clearInterval(interval);
        setIsTyping(false);
      }
    }, speed);

    return () => clearInterval(interval);
  }, [isTyping, content.length, speed]);

  // 逐步顯示的內容
  const displayedContent = displayedLength > 0 
    ? content.slice(0, displayedLength) 
    : '';

  return (
    <div 
      ref={containerRef} 
      className="text-sm leading-relaxed text-white/90"
      style={{ minHeight: '3rem' }}
    >
      {displayedContent ? (
        <div dangerouslySetInnerHTML={{ __html: displayedContent }} />
      ) : (
        <div className="opacity-20">等待翻轉...</div>
      )}
    </div>
  );
}

