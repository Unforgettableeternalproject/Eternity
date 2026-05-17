import { useEffect, useRef } from 'react';

const PARTICLE_COUNT = 100;
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function resize() {
      if (!canvas) return;
      canvas.width = canvas.offsetWidth * window.devicePixelRatio;
      canvas.height = canvas.offsetHeight * window.devicePixelRatio;
    }
    resize();
    window.addEventListener('resize', resize);

    // 初始化飄浮粒子
    const w = () => canvas!.width;
    const h = () => canvas!.height;

    particles.current = Array.from({ length: PARTICLE_COUNT }, () => ({
      x: Math.random() * w(),
      y: Math.random() * h(),
      vx: 0,
      vy: 0,
      size: 1 + Math.random() * 2.5,
      opacity: 0.15 + Math.random() * 0.25,
      baseOpacity: 0.15 + Math.random() * 0.25,
      driftX: (Math.random() - 0.5) * 0.3,
      driftY: -0.1 - Math.random() * 0.2,
    }));

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
        const glow = brightDist < scatterR * 1.5
          ? 0.15 * (1 - brightDist / (scatterR * 1.5))
          : 0;
        p.opacity = p.baseOpacity + glow;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size * dpr, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(213, 182, 24, ${p.opacity})`;
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
    <canvas
      ref={canvasRef}
      className="sto-dust-canvas"
      aria-hidden="true"
    />
  );
}
