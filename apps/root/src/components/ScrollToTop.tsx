import { useState, useEffect } from 'react';
import './ScrollToTop.css';

interface ScrollToTopProps {
  /** 滾動多少像素後顯示按鈕 */
  showAfter?: number;
  /** 按鈕位置 */
  position?: 'left' | 'right';
}

export default function ScrollToTop({ 
  showAfter = 300,
  position = 'right'
}: ScrollToTopProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY;
      const docHeight = document.documentElement.scrollHeight - window.innerHeight;
      const progress = (scrollTop / docHeight) * 100;

      setScrollProgress(progress);
      setIsVisible(scrollTop > showAfter);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // 初始檢查

    return () => window.removeEventListener('scroll', handleScroll);
  }, [showAfter]);

  const scrollToTop = () => {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  };

  if (!isVisible) return null;

  return (
    <button
      onClick={scrollToTop}
      className={`scroll-to-top scroll-to-top--${position}`}
      aria-label="回到頂部"
      type="button"
    >
      {/* 進度環背景 */}
      <svg className="scroll-progress-ring" viewBox="0 0 60 60">
        <circle
          className="scroll-progress-ring__background"
          cx="30"
          cy="30"
          r="26"
        />
        <circle
          className="scroll-progress-ring__progress"
          cx="30"
          cy="30"
          r="26"
          style={{
            strokeDashoffset: 163.36 - (163.36 * scrollProgress) / 100
          }}
        />
      </svg>

      {/* 箭頭圖標 */}
      <svg 
        className="scroll-to-top__icon" 
        fill="none" 
        stroke="currentColor" 
        viewBox="0 0 24 24"
      >
        <path 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          strokeWidth={2.5} 
          d="M5 10l7-7m0 0l7 7m-7-7v18"
        />
      </svg>
    </button>
  );
}
