import { useEffect } from 'react';
import './RippleEffect.css';

interface GlobalRippleProps {
  color?: string;
  navColor?: string;
  duration?: number;
  size?: number;
}

export default function GlobalRipple({
  color = 'rgba(99, 102, 241, 0.15)',
  navColor = 'rgba(236, 72, 153, 0.2)',
  duration = 800,
  size = 80,
}: GlobalRippleProps) {
  useEffect(() => {
    const createRipple = (event: MouseEvent) => {
      const target = event.target as HTMLElement;

      // 檢查是否點擊在導航欄內
      const isNavClick = target.closest('nav') !== null;
      const rippleColor = isNavClick ? navColor : color;

      const ripple = document.createElement('div');

      const x = event.clientX - size / 2;
      const y = event.clientY - size / 2;

      ripple.style.width = ripple.style.height = `${size}px`;
      ripple.style.left = `${x}px`;
      ripple.style.top = `${y}px`;
      ripple.style.position = 'fixed';
      ripple.style.borderRadius = '50%';
      ripple.style.background = `radial-gradient(circle, ${rippleColor} 0%, transparent 70%)`;
      ripple.style.transform = 'scale(0)';
      ripple.style.pointerEvents = 'none';
      ripple.style.zIndex = '10000'; // 在 navbar (z-50) 和 cursor-glow (z-40) 上方
      ripple.style.animation = `ripple-animation ${duration}ms ease-out`;
      ripple.classList.add('global-ripple');

      document.body.appendChild(ripple);

      setTimeout(() => {
        ripple.remove();
      }, duration);
    };

    document.addEventListener('click', createRipple);

    return () => {
      document.removeEventListener('click', createRipple);
    };
  }, [color, navColor, duration, size]);

  return null;
}
