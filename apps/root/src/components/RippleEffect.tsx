import { useRef, type ReactNode, type MouseEvent } from 'react';
import './RippleEffect.css';

interface RippleEffectProps {
  children: ReactNode;
  className?: string;
  color?: string;
  duration?: number;
}

export default function RippleEffect({
  children,
  className = '',
  color = 'rgba(255, 255, 255, 0.6)',
  duration = 600,
}: RippleEffectProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const createRipple = (event: MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current;
    if (!container) return;

    const ripple = document.createElement('span');
    const rect = container.getBoundingClientRect();

    const size = Math.max(rect.width, rect.height);
    const x = event.clientX - rect.left - size / 2;
    const y = event.clientY - rect.top - size / 2;

    ripple.style.width = ripple.style.height = `${size}px`;
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    ripple.style.setProperty('--ripple-color', color);
    ripple.style.setProperty('--ripple-duration', `${duration}ms`);
    ripple.classList.add('ripple');

    container.appendChild(ripple);

    setTimeout(() => {
      ripple.remove();
    }, duration);
  };

  return (
    <div
      ref={containerRef}
      className={`ripple-container ${className}`}
      onClick={createRipple}
    >
      {children}
    </div>
  );
}
