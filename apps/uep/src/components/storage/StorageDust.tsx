import { useEffect, useRef } from 'react';

const DESKTOP_PARTICLE_COUNT = 100;
const MOBILE_PARTICLE_COUNT = 34;
const SCATTER_RADIUS = 120;
const SCATTER_FORCE = 2.8;
const FRICTION = 0.96;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  opacity: number;
  baseOpacity: number;
  driftX: number;
  driftY: number;
}

export default function StorageDust() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particles = useRef<Particle[]>([]);
  const mouse = useRef({ x: -999, y: -999 });
  const raf = useRef(0);
  const colorRef = useRef({ r: 213, g: 182, b: 24 });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function getParticleCount() {
      return window.innerWidth <= 760
        ? MOBILE_PARTICLE_COUNT
        : DESKTOP_PARTICLE_COUNT;
    }

    function createParticles(count: number) {
      const w = canvas!.width;
      const h = canvas!.height;
      const mobile = count === MOBILE_PARTICLE_COUNT;
      particles.current = Array.from({ length: count }, () => {
        const baseOpacity = mobile
          ? 0.08 + Math.random() * 0.1
          : 0.15 + Math.random() * 0.25;
        return {
          x: Math.random() * w,
          y: Math.random() * h,
          vx: 0,
          vy: 0,
          size: mobile ? 0.8 + Math.random() * 1.6 : 1 + Math.random() * 2.5,
          opacity: baseOpacity,
          baseOpacity,
          driftX: (Math.random() - 0.5) * 0.3,
          driftY: -0.1 - Math.random() * 0.2,
        };
      });
    }

    function resize() {
      if (!canvas) return;
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
      const count = getParticleCount();
      if (particles.current.length !== count) {
        createParticles(count);
      }
    }
    resize();
    window.addEventListener('resize', resize);

    // 初始化飄浮粒子
    if (particles.current.length === 0) {
      createParticles(getParticleCount());
    }

    // 讀取主題色
    function updateColor() {
      const style = window.getComputedStyle(document.documentElement);
      const colorStr = style.getPropertyValue('--storage-main').trim();
      const match = colorStr.match(
        /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i
      );
      if (match) {
        colorRef.current = {
          r: parseInt(match[1], 16),
          g: parseInt(match[2], 16),
          b: parseInt(match[3], 16),
        };
      }
    }
    updateColor();

    function handleMouse(e: MouseEvent) {
      const rect = canvas!.getBoundingClientRect();
      const dpr = window.devicePixelRatio;
      mouse.current.x = (e.clientX - rect.left) * dpr;
      mouse.current.y = (e.clientY - rect.top) * dpr;
    }

    window.addEventListener('mousemove', handleMouse);

    function animate() {
      if (!ctx || !canvas) return;
      const cw = canvas.width;
      const ch = canvas.height;
      ctx.clearRect(0, 0, cw, ch);
      const dpr = window.devicePixelRatio;
      const scatterR = SCATTER_RADIUS * dpr;

      const mx = mouse.current.x;
      const my = mouse.current.y;

      for (const p of particles.current) {
        const dx = p.x - mx;
        const dy = p.y - my;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < scatterR && dist > 0) {
          const force = (1 - dist / scatterR) * SCATTER_FORCE;
          p.vx += (dx / dist) * force;
          p.vy += (dy / dist) * force;
        }

        p.vx += p.driftX * 0.05;
        p.vy += p.driftY * 0.05;
        p.vx *= FRICTION;
        p.vy *= FRICTION;
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < -10) p.x = cw + 10;
        if (p.x > cw + 10) p.x = -10;
        if (p.y < -10) p.y = ch + 10;
        if (p.y > ch + 10) p.y = -10;

        const brightDist = Math.sqrt((p.x - mx) ** 2 + (p.y - my) ** 2);
        const glow =
          brightDist < scatterR * 1.5
            ? 0.15 * (1 - brightDist / (scatterR * 1.5))
            : 0;
        p.opacity = p.baseOpacity + glow;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * dpr, 0, Math.PI * 2);
        const { r, g, b } = colorRef.current;
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${p.opacity})`;
        ctx.fill();
      }

      raf.current = requestAnimationFrame(animate);
    }
    raf.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', handleMouse);
    };
  }, []);

  return (
    <canvas ref={canvasRef} className="sto-dust-canvas" aria-hidden="true" />
  );
}
