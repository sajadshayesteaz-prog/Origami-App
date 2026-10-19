import { useEffect, useRef, useState } from "react";

/** A book image with wheel zoom and drag pan; double-click resets. */
export function ZoomImage({ src, alt }: { src: string; alt: string }) {
  const [view, setView] = useState({ k: 1, x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => setView({ k: 1, x: 0, y: 0 }), [src]);
  useEffect(() => {
    const el = host.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setView((v) => {
        const k = Math.min(8, Math.max(1, v.k * (e.deltaY < 0 ? 1.2 : 1 / 1.2)));
        return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  return (
    <div
      className="zoom-image"
      ref={host}
      onPointerDown={(e) => {
        drag.current = { x: e.clientX - view.x, y: e.clientY - view.y };
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => drag.current && setView((v) => ({ ...v, x: e.clientX - drag.current!.x, y: e.clientY - drag.current!.y }))}
      onPointerUp={() => (drag.current = null)}
      onDoubleClick={() => setView({ k: 1, x: 0, y: 0 })}
    >
      <img src={src} alt={alt} draggable={false} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }} />
    </div>
  );
}
