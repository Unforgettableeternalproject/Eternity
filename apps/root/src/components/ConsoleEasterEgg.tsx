/**
 * ConsoleEasterEgg — 隨機閃現的終端機入口
 * 閒置一段時間後有機率出現在右下角，短暫停留後消失
 */
import { useEffect, useRef, useState, useCallback } from 'react';

import './ConsoleEasterEgg.css';
import { envConfig } from '../config/env';

interface ConsoleEasterEggProps {
  consoleUrl: string;
  label: string;
  debugMode?: boolean;
}

export default function ConsoleEasterEgg({
  consoleUrl,
  label,
  debugMode = false,
}: ConsoleEasterEggProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [canAppear, setCanAppear] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 開發模式：長駐顯示
  const isDev = envConfig.showDevTools || debugMode;
  const IDLE_TIME = 10000;
  const APPEAR_CHANCE = 0.2;
  const VISIBLE_TIME = 5000;
  const COOLDOWN_TIME = 30000;

  const hideButton = useCallback(() => {
    setIsVisible(false);
    setTimeout(() => setCanAppear(true), COOLDOWN_TIME);
  }, [COOLDOWN_TIME]);

  const showButton = useCallback(() => {
    setIsVisible(true);
    setCanAppear(false);
    visibleTimerRef.current = setTimeout(hideButton, VISIBLE_TIME);
  }, [hideButton, VISIBLE_TIME]);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

    idleTimerRef.current = setTimeout(() => {
      if (Math.random() <= APPEAR_CHANCE) {
        showButton();
      }
    }, IDLE_TIME);
  }, [showButton, APPEAR_CHANCE, IDLE_TIME]);

  useEffect(() => {
    // 開發模式直接顯示，不走隨機邏輯
    if (isDev) {
      setIsVisible(true);
      return;
    }

    // 尊重使用者偏好
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (isVisible || !canAppear) return;

    const events = ['mousemove', 'keydown', 'scroll', 'touchstart'];
    const handleActivity = () => resetIdleTimer();

    events.forEach((e) =>
      window.addEventListener(e, handleActivity, { passive: true })
    );
    resetIdleTimer();

    return () => {
      events.forEach((e) => window.removeEventListener(e, handleActivity));
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [isDev, canAppear, isVisible, resetIdleTimer]);

  // 清理 visible timer
  useEffect(() => {
    return () => {
      if (visibleTimerRef.current) clearTimeout(visibleTimerRef.current);
    };
  }, []);

  // 點擊 → 灰階 → 閃白 → 跳轉
  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const root = document.documentElement;

      // 1. 畫面漸變為灰階（0.6s ease）
      root.classList.add('console-exit');

      // 2. 灰階停留片刻後閃白（0.2s ease）
      setTimeout(() => root.classList.add('console-exit--flash'), 900);

      // 3. 閃完跳轉
      setTimeout(() => {
        window.location.href = consoleUrl;
      }, 1200);
    },
    [consoleUrl]
  );

  if (!isVisible) return null;

  return (
    <a
      href={consoleUrl}
      className={`console-btn${isDev ? ' console-btn--persistent' : ''}`}
      aria-label={label}
      onClick={handleClick}
    >
      {'>_'}
    </a>
  );
}
