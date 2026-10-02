import { useMemo } from 'react';
import { mulberry32 } from '@/lib/random';

// Animated pixel-art dusk city shown while the 3D city loads: twinkling stars, a two-layer
// skyline with flickering windows, and a road with scrolling lane marks and little vehicles.
// Pure SVG + CSS, deterministic (seeded), so it costs almost nothing to render.

const W = 320;
const H = 180;

interface Building {
  x: number;
  w: number;
  h: number;
  windows: { x: number; y: number; d: number }[];
}

function skyline(seed: number, base: number, minH: number, maxH: number, gap: number, windowChance: number): Building[] {
  const rng = mulberry32(seed);
  const out: Building[] = [];
  let x = -4;
  while (x < W + 4) {
    const w = 10 + Math.floor(rng() * 16);
    const h = minH + Math.floor(rng() * (maxH - minH));
    const windows: Building['windows'] = [];
    for (let wy = base - h + 4; wy < base - 4; wy += 5) {
      for (let wx = x + 2; wx < x + w - 2; wx += 4) {
        if (rng() < windowChance) windows.push({ x: wx, y: wy, d: rng() * 6 });
      }
    }
    out.push({ x, w, h, windows });
    x += w + gap + Math.floor(rng() * 3);
  }
  return out;
}

// Traffic keeps left: the far lane runs right→left, the near lane left→right.
const VEHICLES = [
  { body: '#ff5a4e', len: 10, dir: -1, lane: 0, dur: 7, delay: 0 },
  { body: '#2fbf7a', len: 7, dir: -1, lane: 0, dur: 9.5, delay: 3.6, auto: true },
  { body: '#4aa3ff', len: 10, dir: 1, lane: 1, dur: 8, delay: 1.1 },
  { body: '#e0473b', len: 18, dir: 1, lane: 1, dur: 12, delay: 6, bus: true },
  { body: '#f5f2ea', len: 10, dir: -1, lane: 0, dur: 6.5, delay: 5.2 },
  { body: '#ffc94a', len: 7, dir: 1, lane: 1, dur: 9, delay: 9, auto: true },
];

export function LoadingBackdrop() {
  const far = useMemo(() => skyline(11, 132, 22, 58, 1, 0.12), []);
  const near = useMemo(() => skyline(29, 140, 12, 40, 3, 0.22), []);
  const stars = useMemo(() => {
    const rng = mulberry32(7);
    return Array.from({ length: 34 }, () => ({ x: Math.floor(rng() * W), y: Math.floor(rng() * 70), d: rng() * 4, big: rng() < 0.2 }));
  }, []);

  return (
    <div className="lb" aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMax slice" shapeRendering="crispEdges">
        <defs>
          <linearGradient id="lb-sky" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#1d1733" />
            <stop offset="0.45" stopColor="#4a2f63" />
            <stop offset="0.72" stopColor="#c45a6a" />
            <stop offset="0.86" stopColor="#ffa05a" />
          </linearGradient>
        </defs>
        <rect width={W} height={H} fill="url(#lb-sky)" />

        {stars.map((s, i) => (
          <rect key={i} className="lb__star" x={s.x} y={s.y} width={s.big ? 2 : 1} height={s.big ? 2 : 1} fill="#fff4e3" style={{ animationDelay: `${s.d}s` }} />
        ))}

        {/* Low pixel sun sinking behind the skyline. */}
        <g className="lb__sun">
          <rect x="226" y="96" width="28" height="28" fill="#ffd98a" />
          <rect x="222" y="100" width="36" height="20" fill="#ffd98a" />
          <rect x="230" y="92" width="20" height="36" fill="#ffd98a" />
        </g>

        <g fill="#3a2a55">
          {far.map((b, i) => (
            <rect key={i} x={b.x} y={132 - b.h} width={b.w} height={b.h} />
          ))}
        </g>
        {far.flatMap((b, i) => b.windows.map((w, j) => <rect key={`f${i}-${j}`} className="lb__win" x={w.x} y={w.y} width="2" height="2" fill="#ffb86b" opacity="0.55" style={{ animationDelay: `${w.d}s` }} />))}

        <g fill="#241a38">
          {near.map((b, i) => (
            <rect key={i} x={b.x} y={140 - b.h} width={b.w} height={b.h} />
          ))}
        </g>
        {near.flatMap((b, i) => b.windows.map((w, j) => <rect key={`n${i}-${j}`} className="lb__win" x={w.x} y={w.y} width="2" height="2" fill="#ffd27a" style={{ animationDelay: `${w.d}s` }} />))}

        {/* Road. */}
        <rect x="0" y="140" width={W} height="40" fill="#17121f" />
        <rect x="0" y="140" width={W} height="2" fill="#5b4f80" />
        <rect x="0" y="176" width={W} height="2" fill="#5b4f80" />
        <g className="lb__lanes">
          {Array.from({ length: 22 }, (_, i) => (
            <rect key={i} x={i * 16} y="158" width="8" height="2" fill="#ffd84a" />
          ))}
        </g>

        {/* Little vehicles: body, roof, wheels, a headlight beam in front. */}
        {VEHICLES.map((v, i) => {
          const y = v.lane ? 163 : 150;
          const h = v.bus ? 8 : 5;
          return (
            <g key={i} className={`lb__car${v.dir < 0 ? ' is-rev' : ''}`} style={{ ['--dur' as string]: `${v.dur}s`, animationDelay: `-${v.delay}s` }}>
              <g transform={v.dir < 0 ? `translate(${v.len} 0) scale(-1 1)` : undefined}>
                <rect x={v.len} y={y + h - 4} width="10" height="3" fill="#ffe7a3" opacity="0.18" />
                <rect x="0" y={y} width={v.len} height={h} fill={v.body} />
                {!v.bus && <rect x="2" y={y - 3} width={v.len - 4} height="3" fill={v.auto ? '#1b1b1b' : v.body} />}
                {!v.bus && <rect x="3" y={y - 2} width={v.len - 6} height="2" fill="#9fd3ff" opacity="0.8" />}
                {v.bus && <rect x="1" y={y + 1} width={v.len - 2} height="2" fill="#9fd3ff" opacity="0.8" />}
                <rect x={v.len - 1} y={y + h - 3} width="1" height="1" fill="#fff4c2" />
                <rect x="0" y={y + h - 3} width="1" height="1" fill="#ff4b4b" />
                <rect x="1" y={y + h} width="2" height="2" fill="#0b0810" />
                <rect x={v.len - 3} y={y + h} width="2" height="2" fill="#0b0810" />
              </g>
            </g>
          );
        })}
      </svg>

      <div className="lb__vignette" />
    </div>
  );
}
