import { useState, useEffect, useRef, useCallback } from 'react';

import './UEPCharacter.css';
import { envConfig } from '../config/env';

interface UEPCharacterProps {
  uepDocsUrl: string;
  debugMode?: boolean;
}

type AppearanceMode = 'corner' | 'peek' | 'float' | null;

interface Position {
  top: number;
  left: number;
}

export default function UEPCharacter({
  uepDocsUrl,
  debugMode = false,
}: UEPCharacterProps) {
  const [appearanceMode, setAppearanceMode] = useState<AppearanceMode>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isHiding, setIsHiding] = useState(false);
  const [canAppear, setCanAppear] = useState(true);
  const [position, setPosition] = useState<Position>({ top: 0, left: 0 });
  const [isHovered, setIsHovered] = useState(false);

  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const movementTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 配置參數
  const IDLE_TIME = envConfig.showDevTools || debugMode ? 2000 : 10000;
  const USER_ACTION_CHANCE = envConfig.showDevTools || debugMode ? 100 : 5; // 5%
  const PAGE_LOAD_CHANCE = envConfig.showDevTools || debugMode ? 100 : 25; // 25%
  const VISIBLE_TIME = 8000; // 顯示 8 秒
  const COOLDOWN_TIME = 30000; // 30 秒冷卻

  const log = useCallback((...args: any[]) => {
    // Console logs disabled for production
    void args;
  }, []);

  // 抽選出現方式
  const rollAppearanceMode = useCallback((): AppearanceMode => {
    const roll = Math.random() * 100;
    if (roll < 25) return 'corner'; // 0-24: 25%
    if (roll < 70) return 'peek'; // 25-69: 45%
    return 'float'; // 70-99: 30%
  }, []);

  // 獲取隨機位置（Float Mode）
  const getRandomPosition = useCallback((): Position => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const SIZE = 110; // UEP 圖片大小（放大後）
    const MARGIN = 24;
    const TOP_SAFE = 100; // 避開頂部導航
    const BOTTOM_SAFE = 100; // 避開底部

    const clamp = (n: number, min: number, max: number) =>
      Math.max(min, Math.min(max, n));

    const left = clamp(
      Math.floor(Math.random() * vw),
      MARGIN,
      vw - MARGIN - SIZE
    );
    const top = clamp(
      Math.floor(Math.random() * vh),
      TOP_SAFE,
      vh - BOTTOM_SAFE - SIZE
    );

    return { top, left };
  }, []);

  // 獲取 Peek Mode 位置
  const getPeekPosition = useCallback((): Position | null => {
    // 候選目標元素
    const candidates = [
      '.animate-float', // 主頁右側浮動方框
      // 可以添加更多候選元素
    ];

    for (const selector of candidates) {
      const element = document.querySelector(selector);
      if (element) {
        const rect = element.getBoundingClientRect();
        // 在元素右上角探頭
        return {
          top: rect.top - 40,
          left: rect.right - 60,
        };
      }
    }

    return null;
  }, []);

  // 隱藏 UEP
  const hideUEP = useCallback(() => {
    log('Hiding UEP');
    setIsHiding(true);

    // 清除移動計時器
    if (movementTimerRef.current) {
      clearTimeout(movementTimerRef.current);
      movementTimerRef.current = null;
    }

    // 等待淡出動畫完成後再移除元件
    setTimeout(() => {
      setIsVisible(false);
      setIsHiding(false);
      setAppearanceMode(null);
    }, 600); // 淡出動畫時間

    // 開始冷卻
    setTimeout(() => {
      setCanAppear(true);
      log('Cooldown complete. UEP can appear again.');
    }, COOLDOWN_TIME);
  }, [log, COOLDOWN_TIME]);

  // 顯示 UEP
  const showUEP = useCallback(
    (mode?: AppearanceMode) => {
      const selectedMode = mode || rollAppearanceMode();
      log('UEP appearing in mode:', selectedMode);

      setAppearanceMode(selectedMode);
      setCanAppear(false);

      // 根據模式設置位置
      let pos: Position | null = null;

      if (selectedMode === 'corner') {
        // 右下角固定位置
        pos = {
          top: window.innerHeight - 120,
          left: window.innerWidth - 120,
        };
      } else if (selectedMode === 'peek') {
        pos = getPeekPosition();
        // 如果找不到目標元素，改用 float
        if (!pos) {
          log('No peek target found, switching to float');
          setAppearanceMode('float');
          pos = getRandomPosition();
        }
      } else if (selectedMode === 'float') {
        pos = getRandomPosition();
      }

      if (pos) {
        setPosition(pos);
        setIsVisible(true);

        // Float Mode 需要定期移動
        if (selectedMode === 'float') {
          const scheduleMovement = () => {
            const delay = 5000 + Math.random() * 5000; // 5-10 秒
            movementTimerRef.current = setTimeout(() => {
              if (!isHovered) {
                const newPos = getRandomPosition();
                log('Moving to new position:', newPos);
                setPosition(newPos);
              }
              scheduleMovement();
            }, delay);
          };
          scheduleMovement();
        }

        // 自動隱藏
        visibleTimerRef.current = setTimeout(() => {
          hideUEP();
        }, VISIBLE_TIME);
      }
    },
    [
      rollAppearanceMode,
      getPeekPosition,
      getRandomPosition,
      hideUEP,
      log,
      VISIBLE_TIME,
      isHovered,
    ]
  );

  // 觸發出現
  const triggerAppearance = useCallback(() => {
    if (!canAppear || isVisible) return;
    showUEP();
  }, [canAppear, isVisible, showUEP]);

  // 重置閒置計時器
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }

    idleTimerRef.current = setTimeout(() => {
      const roll = Math.random() * 100;
      log(
        `Idle detected. Roll: ${roll.toFixed(2)}, Threshold: ${USER_ACTION_CHANCE}`
      );

      if (roll < USER_ACTION_CHANCE) {
        triggerAppearance();
      }
    }, IDLE_TIME);
  }, [log, triggerAppearance, USER_ACTION_CHANCE, IDLE_TIME]);

  // 首頁載入觸發
  useEffect(() => {
    const handlePageLoad = () => {
      // 檢查是否為主頁
      const isHomePage =
        window.location.pathname === '/' ||
        window.location.pathname === '/zh-tw' ||
        window.location.pathname === '/en';

      if (!isHomePage) return;

      // 檢查本次會話是否已顯示過
      const hasShown = sessionStorage.getItem('uep-shown');
      if (hasShown === 'true') {
        log('Already shown in this session');
        return;
      }

      const roll = Math.random() * 100;
      log(
        `Page load. Roll: ${roll.toFixed(2)}, Threshold: ${PAGE_LOAD_CHANCE}`
      );

      if (roll < PAGE_LOAD_CHANCE) {
        sessionStorage.setItem('uep-shown', 'true');
        setTimeout(() => triggerAppearance(), 1000); // 延遲 1 秒再出現
      }
    };

    // 初始載入和 View Transitions 頁面切換
    handlePageLoad();
    document.addEventListener('astro:page-load', handlePageLoad);

    return () => {
      document.removeEventListener('astro:page-load', handlePageLoad);
    };
  }, [triggerAppearance, log, PAGE_LOAD_CHANCE]);

  // 使用者活動監聽
  useEffect(() => {
    // 檢查減少動畫偏好
    const prefersReduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    if (prefersReduced) {
      log('Reduced motion detected, UEP disabled');
      return;
    }

    if (isVisible || !canAppear) {
      return;
    }

    const events = ['mousemove', 'keydown', 'scroll', 'touchstart'];

    const handleActivity = () => {
      resetIdleTimer();
    };

    events.forEach((event) => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    resetIdleTimer();

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, handleActivity);
      });

      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
    };
  }, [canAppear, isVisible, resetIdleTimer, log]);

  // 清理計時器
  useEffect(() => {
    return () => {
      if (visibleTimerRef.current) clearTimeout(visibleTimerRef.current);
      if (movementTimerRef.current) clearTimeout(movementTimerRef.current);
    };
  }, []);

  if (!isVisible || !appearanceMode) return null;

  return (
    <a
      href={uepDocsUrl}
      className={`uep-character uep-character--${appearanceMode} ${isHovered ? 'uep-character--hovered' : ''} ${isHiding ? 'uep-character--hiding' : ''}`}
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
      }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={() => log('UEP clicked, navigating to docs')}
      aria-label="前往 U.E.P 的幻想空間"
      title="點擊探索 U.E.P 的世界"
    >
      {appearanceMode === 'corner' && (
        <img
          src={isHovered ? '/uep/Poke.PNG' : '/uep/Fence.PNG'}
          alt="U.E.P"
          className="uep-character__image"
        />
      )}
      {appearanceMode === 'peek' && (
        <img
          src="/uep/Peek.png"
          alt="U.E.P"
          className="uep-character__image uep-character__image--peek"
        />
      )}
      {appearanceMode === 'float' && (
        <img
          src="/uep/Lil.PNG"
          alt="U.E.P"
          className="uep-character__image uep-character__image--float"
        />
      )}

      {/* 提示氣泡（懸浮時顯示） */}
      {isHovered && (
        <div className="uep-character__tooltip">
          點擊探索 U.E.P 的幻想空間 ✨
        </div>
      )}
    </a>
  );
}
