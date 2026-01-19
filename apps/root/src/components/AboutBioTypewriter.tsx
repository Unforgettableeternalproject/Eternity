import { useState, useEffect } from 'react';
import './TypewriterText.css';
import { envConfig } from '../config/env';

interface AboutBioTypewriterProps {
  content: string; // HTML 內容（從 Markdoc 編譯）
  speed?: number;
  delay?: number;
  className?: string;
}

export default function AboutBioTypewriter({
  content,
  speed = 50,
  delay = 300,
  className = '',
}: AboutBioTypewriterProps) {
  // 檢查是否已經顯示過
  const checkIfShown = () => {
    if (typeof window === 'undefined') return false;
    return localStorage.getItem('about-bio-typewriter-shown') === 'true';
  };

  const [isComplete, setIsComplete] = useState(checkIfShown);
  const [displayedContent, setDisplayedContent] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [hasStarted, setHasStarted] = useState(false);
  const [showCursor, setShowCursor] = useState(false);

  // 初始化：如果已完成，直接顯示完整內容
  useEffect(() => {
    if (checkIfShown() && content) {
      setDisplayedContent(content);
      setIsComplete(true);
    }
  }, [content]);

  // 打字音效
  const typeSound =
    typeof window !== 'undefined' ? new Audio('/se/type.wav') : null;
  if (typeSound) {
    typeSound.volume = 0.2;
    typeSound.preload = 'auto';
  }

  // 客戶端才顯示游標
  useEffect(() => {
    setShowCursor(!isComplete);
  }, [isComplete]);

  useEffect(() => {
    // 如果已經完成（從快取載入），跳過
    if (isComplete) return;

    // 開始打字效果
    const startTimer = setTimeout(() => {
      setHasStarted(true);
    }, delay);

    return () => clearTimeout(startTimer);
  }, [delay, isComplete]);

  useEffect(() => {
    if (!hasStarted || isComplete) return;

    if (currentIndex < content.length) {
      const timer = setTimeout(() => {
        // 計算下一個要顯示的字元數量
        let nextIndex = currentIndex + 1;

        // 如果當前字元是 '<'，則找到完整的 HTML 標籤
        if (content[currentIndex] === '<') {
          const closeTagIndex = content.indexOf('>', currentIndex);
          if (closeTagIndex !== -1) {
            nextIndex = closeTagIndex + 1; // 包含 '>'
          }
        }
        // 如果當前字元是 '&'，則找到完整的 HTML 實體（如 &nbsp;）
        else if (content[currentIndex] === '&') {
          const semiColonIndex = content.indexOf(';', currentIndex);
          if (semiColonIndex !== -1 && semiColonIndex - currentIndex < 10) {
            // 限制長度避免誤判
            nextIndex = semiColonIndex + 1; // 包含 ';'
          }
        }

        // 直接播放打字音效（每 5 個字元播放一次）
        if (typeSound && currentIndex % 5 === 0) {
          typeSound.currentTime = 0;
          typeSound.play().catch(() => {
            // 靜默忽略錯誤
          });
        }

        setDisplayedContent(content.slice(0, nextIndex));
        setCurrentIndex(nextIndex);
      }, speed);

      return () => clearTimeout(timer);
    } else {
      // 只有當打字機完整播放到最後一個字時，才標記為完成並儲存
      setIsComplete(true);
      setShowCursor(false);
      // 儲存到 localStorage，下次訪問時直接顯示完整內容
      if (typeof window !== 'undefined') {
        localStorage.setItem('about-bio-typewriter-shown', 'true');
      }
    }
  }, [currentIndex, content, speed, hasStarted, isComplete, typeSound]);

  return (
    <div className="relative">
      <div
        className={`prose prose-lg dark:prose-invert max-w-none ${className} ${showCursor ? 'typewriter--cursor' : ''}`}
        dangerouslySetInnerHTML={{ __html: displayedContent || '&nbsp;' }}
      />
      {/* 開發環境重置按鈕 */}
      {envConfig.showDevTools && (
        <button
          onClick={() => {
            if (
              window.confirm(
                '確定要重置打字機動畫嗎？重置後刷新頁面將重新播放動畫。'
              )
            ) {
              localStorage.removeItem('about-bio-typewriter-shown');
              window.location.reload();
            }
          }}
          className="absolute bottom-2 right-2 px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium rounded-lg shadow-lg transition-all duration-200 hover:scale-105 flex items-center gap-1.5"
          title="重置打字機動畫（僅開發環境）"
          type="button"
        >
          <span>🔄</span>
          <span>重置動畫</span>
        </button>
      )}
    </div>
  );
}
