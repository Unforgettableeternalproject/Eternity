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
  debugMode = false 
}: ConsoleEasterEggProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [canAppear, setCanAppear] = useState(true);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Configuration - 開發/測試環境必然出現，正式環境隨機出現
  const IDLE_TIME = envConfig.showDevTools || debugMode ? 2000 : 10000; 
  const APPEAR_CHANCE = envConfig.showDevTools || debugMode ? 1 : 0.2; 
  const VISIBLE_TIME = 5000; // visible for 5 seconds
  const COOLDOWN_TIME = 30000; // 30 seconds before can appear again

  const log = useCallback((...args: any[]) => {
    if (debugMode || envConfig.enableConsoleLog) {
      console.log('[Console Easter Egg]', ...args);
    }
  }, [debugMode]);

  const getRandomPosition = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const BTN = 40; // button size
    const MARGIN = 24;
    const TOP_SAFE = 80; // avoid sticky header

    const clamp = (n: number, min: number, max: number) => 
      Math.max(min, Math.min(max, n));

    // Predefined interesting spots
    const candidates = [
      { top: TOP_SAFE, left: MARGIN },
      { top: TOP_SAFE, left: vw - MARGIN - BTN },
      { top: vh - MARGIN - BTN, left: MARGIN },
      { top: vh - MARGIN - BTN, left: vw - MARGIN - BTN },
      { top: TOP_SAFE + 20, left: Math.round(vw / 2 - BTN / 2) },
      { top: Math.round(vh / 2 - BTN / 2), left: MARGIN },
      { top: Math.round(vh / 2 - BTN / 2), left: vw - MARGIN - BTN },
      { top: vh - MARGIN - BTN - 20, left: Math.round(vw / 2 - BTN / 2) },
    ];

    // 70% pick from candidates, 30% random safe coordinate
    if (Math.random() < 0.7) {
      return candidates[Math.floor(Math.random() * candidates.length)];
    } else {
      const randLeft = clamp(
        Math.floor(Math.random() * vw) - BTN / 2,
        MARGIN,
        vw - MARGIN - BTN
      );
      const randTop = clamp(
        Math.floor(Math.random() * vh) - BTN / 2,
        TOP_SAFE,
        vh - MARGIN - BTN
      );
      return { top: randTop, left: randLeft };
    }
  }, []);

  const hideButton = useCallback(() => {
    log('Hiding button');
    setIsVisible(false);

    // Start cooldown
    setTimeout(() => {
      setCanAppear(true);
      log('Cooldown complete. Can appear again.');
    }, COOLDOWN_TIME);
  }, [log, COOLDOWN_TIME]);

  const showButton = useCallback(() => {
    const pos = getRandomPosition();
    log('Appearing at', pos);
    setPosition(pos);
    setIsVisible(true);
    setCanAppear(false);

    // Auto-hide after visible time
    visibleTimerRef.current = setTimeout(() => {
      hideButton();
    }, VISIBLE_TIME);
  }, [getRandomPosition, log, hideButton, VISIBLE_TIME]);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }

    idleTimerRef.current = setTimeout(() => {
      const roll = Math.random();
      log(`Idle detected. Roll: ${roll.toFixed(2)}, Threshold: ${APPEAR_CHANCE}`);

      if (roll <= APPEAR_CHANCE) {
        showButton();
      } else {
        log('Did not pass chance roll.');
      }
    }, IDLE_TIME);
  }, [log, showButton, APPEAR_CHANCE, IDLE_TIME]);

  useEffect(() => {
    // Check for reduced motion preference
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) {
      log('Reduced motion detected, Easter Egg disabled');
      return;
    }

    // Don't set up listeners if button is visible or can't appear
    if (isVisible || !canAppear) {
      return;
    }

    // Event listeners for user activity
    const events = ['mousemove', 'keydown', 'scroll', 'touchstart'];
    
    const handleActivity = () => {
      resetIdleTimer();
    };
    
    events.forEach(event => {
      window.addEventListener(event, handleActivity, { passive: true });
    });

    // Initial timer
    resetIdleTimer();

    // Cleanup
    return () => {
      events.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
      
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    };
  }, [canAppear, isVisible, resetIdleTimer, log]);

  if (!isVisible) return null;

  return (
    <a
      href={consoleUrl}
      className="console-easter-egg-btn console-glow"
      style={{
        position: 'fixed',
        top: `${position.top}px`,
        left: `${position.left}px`,
        opacity: isVisible ? 1 : 0,
      }}
      aria-label={label}
    >
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path 
          strokeLinecap="round" 
          strokeLinejoin="round" 
          strokeWidth="2" 
          d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
        />
      </svg>
    </a>
  );
}
