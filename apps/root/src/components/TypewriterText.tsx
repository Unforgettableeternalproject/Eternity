import { useState, useEffect } from 'react';
import './TypewriterText.css';

interface TypewriterTextProps {
  text: string;
  speed?: number;
  delay?: number;
  className?: string;
  onComplete?: () => void;
  cursor?: boolean;
}

export default function TypewriterText({ 
  text, 
  speed = 30, 
  delay = 0,
  className = '',
  onComplete,
  cursor = true
}: TypewriterTextProps) {
  // 初始化時檢查快取，避免閃爍
  const [displayedText, setDisplayedText] = useState(() => {
    if (typeof window === 'undefined') return '';
    const storageKey = `typewriter-shown-${text.substring(0, 10)}`;
    return sessionStorage.getItem(storageKey) === 'true' ? text : '';
  });
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isComplete, setIsComplete] = useState(() => {
    if (typeof window === 'undefined') return false;
    const storageKey = `typewriter-shown-${text.substring(0, 10)}`;
    return sessionStorage.getItem(storageKey) === 'true';
  });
  const [hasStarted, setHasStarted] = useState(false);

  useEffect(() => {
    // 如果已經完成（從快取載入），跳過
    if (isComplete) return;
    
    // 首次顯示，開始打字效果
    const startTimer = setTimeout(() => {
      setHasStarted(true);
    }, delay);

    return () => clearTimeout(startTimer);
  }, [delay, isComplete]);

  useEffect(() => {
    if (!hasStarted || isComplete) return;

    if (currentIndex < text.length) {
      const timer = setTimeout(() => {
        setDisplayedText(text.slice(0, currentIndex + 1));
        setCurrentIndex(currentIndex + 1);
      }, speed);

      return () => clearTimeout(timer);
    } else {
      setIsComplete(true);
      const storageKey = `typewriter-shown-${text.substring(0, 10)}`;
      sessionStorage.setItem(storageKey, 'true');
      onComplete?.();
    }
  }, [currentIndex, text, speed, hasStarted, isComplete, onComplete]);

  return (
    <span className={`typewriter ${className} ${cursor && !isComplete ? 'typewriter--cursor' : ''}`}>
      {displayedText}
    </span>
  );
}
