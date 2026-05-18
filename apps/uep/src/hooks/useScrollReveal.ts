import { useEffect, useRef, useState } from 'react';

interface ScrollRevealOptions {
  /** 觸發門檻 (0-1)，預設 0.12 */
  threshold?: number;
  /** root margin，預設 '0px 0px -60px 0px' */
  rootMargin?: string;
  /** 只觸發一次後即斷開 observer，預設 true */
  once?: boolean;
}

interface ScrollRevealResult {
  /** 元素目前是否在可視區域 */
  visible: boolean;
  /** 是否曾經進入過可視區域（once 動畫用） */
  triggered: boolean;
}

/**
 * 使用 IntersectionObserver 追蹤元素是否滾入可視範圍。
 * `once: true` 時，首次觸發後自動 disconnect 節省資源。
 */
export function useScrollReveal(
  ref: React.RefObject<Element | null>,
  options?: ScrollRevealOptions
): ScrollRevealResult {
  const {
    threshold = 0.12,
    rootMargin = '0px 0px -60px 0px',
    once = true,
  } = options ?? {};

  const [visible, setVisible] = useState(false);
  const [triggered, setTriggered] = useState(false);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;

    // 已經觸發且 once 模式，不需要再建立 observer
    if (once && triggered) return;

    observerRef.current = new IntersectionObserver(
      ([entry]) => {
        const isIntersecting = entry.isIntersecting;
        setVisible(isIntersecting);

        if (isIntersecting) {
          setTriggered(true);
          if (once) {
            observerRef.current?.disconnect();
          }
        }
      },
      { threshold, rootMargin }
    );

    observerRef.current.observe(el);

    return () => {
      observerRef.current?.disconnect();
    };
  }, [ref, threshold, rootMargin, once, triggered]);

  return { visible, triggered };
}
