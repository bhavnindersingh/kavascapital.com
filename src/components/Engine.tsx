import React, { useCallback, useEffect, useRef, useState } from 'react';
import { C, rgba } from '../lib/palette';

/**
 * The live engine panel: a small network that fires signals layer to layer
 * (it shies away from the pointer), the research and execution log beside it,
 * and the readouts laid over both.
 */

interface NetNode {
    x: number;
    y: number;
    baseX: number;
    baseY: number;
    layer: number;
    phase: number;
    glow: number;
}

interface Signal {
    path: number[]; // node index per layer
    t: number; // progress across layers
    speed: number;
    lastSeg: number;
}

const LAYER_SIZES = [4, 7, 8, 6, 1];

export const NeuralNetwork: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const mouse = useRef({ x: -9999, y: -9999 });

    useEffect(() => {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        let width = 0;
        let height = 0;
        let nodes: NetNode[] = [];
        let layers: number[][] = []; // node indices per layer
        let signals: Signal[] = [];
        let raf = 0;
        let last = performance.now();
        let spawnTimer = 0;

        const build = () => {
            nodes = [];
            layers = [];
            const padX = width * 0.1;
            const usableW = width - padX * 2;
            LAYER_SIZES.forEach((count, li) => {
                const layerIdx: number[] = [];
                const lx = padX + (usableW * li) / (LAYER_SIZES.length - 1);
                for (let i = 0; i < count; i++) {
                    const ly = height * (0.14 + (0.72 * (i + 0.5)) / count);
                    layerIdx.push(nodes.length);
                    nodes.push({
                        x: lx,
                        y: ly,
                        baseX: lx,
                        baseY: ly,
                        layer: li,
                        phase: Math.random() * Math.PI * 2,
                        glow: 0,
                    });
                }
                layers.push(layerIdx);
            });
        };

        const resize = () => {
            const rect = wrap.getBoundingClientRect();
            width = rect.width;
            height = rect.height;
            canvas.width = Math.max(1, Math.floor(width * dpr));
            canvas.height = Math.max(1, Math.floor(height * dpr));
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            build();
        };

        const spawnSignal = () => {
            const path = layers.map(
                (layer) => layer[Math.floor(Math.random() * layer.length)]
            );
            signals.push({ path, t: 0, speed: 0.7 + Math.random() * 0.7, lastSeg: -1 });
        };

        const draw = (now: number) => {
            const dt = Math.min((now - last) / 1000, 0.05);
            last = now;
            const time = now / 1000;

            // breathing + mouse repulsion
            for (const n of nodes) {
                const bx = n.baseX + Math.sin(time * 0.6 + n.phase) * 3;
                const by = n.baseY + Math.cos(time * 0.5 + n.phase) * 4;
                const dx = bx - mouse.current.x;
                const dy = by - mouse.current.y;
                const dist = Math.hypot(dx, dy);
                if (dist < 110) {
                    const force = (1 - dist / 110) * 14;
                    n.x = bx + (dx / (dist || 1)) * force;
                    n.y = by + (dy / (dist || 1)) * force;
                    n.glow = Math.max(n.glow, (1 - dist / 110) * 0.8);
                } else {
                    n.x = bx;
                    n.y = by;
                }
                n.glow *= 0.94;
            }

            ctx.clearRect(0, 0, width, height);

            // edges
            for (let li = 0; li < layers.length - 1; li++) {
                for (const a of layers[li]) {
                    for (const b of layers[li + 1]) {
                        const na = nodes[a];
                        const nb = nodes[b];
                        const e = 0.05 + Math.max(na.glow, nb.glow) * 0.5;
                        ctx.strokeStyle = rgba(C.ivory, e * 0.8);
                        ctx.lineWidth = 0.5;
                        ctx.beginPath();
                        ctx.moveTo(na.x, na.y);
                        ctx.lineTo(nb.x, nb.y);
                        ctx.stroke();
                    }
                }
            }

            // signals
            spawnTimer += dt;
            if (spawnTimer > 0.45 && signals.length < 18) {
                spawnTimer = 0;
                spawnSignal();
            }
            for (let s = signals.length - 1; s >= 0; s--) {
                const sig = signals[s];
                sig.t += sig.speed * dt;
                const seg = Math.floor(sig.t);
                if (seg >= sig.path.length - 1) {
                    nodes[sig.path[sig.path.length - 1]].glow = 1;
                    signals.splice(s, 1);
                    continue;
                }
                if (seg !== sig.lastSeg) {
                    nodes[sig.path[seg]].glow = 1;
                    sig.lastSeg = seg;
                }
                const local = sig.t - seg;
                const ease = local * local * (3 - 2 * local);
                const a = nodes[sig.path[seg]];
                const b = nodes[sig.path[seg + 1]];
                const px = a.x + (b.x - a.x) * ease;
                const py = a.y + (b.y - a.y) * ease;

                // travelling pulse along the active edge
                ctx.strokeStyle = rgba(C.gold, 0.55);
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(px, py);
                ctx.stroke();

                const grd = ctx.createRadialGradient(px, py, 0, px, py, 5);
                grd.addColorStop(0, rgba(C.goldLight, 0.95));
                grd.addColorStop(1, rgba(C.gold, 0));
                ctx.fillStyle = grd;
                ctx.beginPath();
                ctx.arc(px, py, 5, 0, Math.PI * 2);
                ctx.fill();
            }

            // nodes
            for (const n of nodes) {
                const r = n.layer === LAYER_SIZES.length - 1 ? 4.5 : 2.4;
                if (n.glow > 0.05) {
                    const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, 18);
                    g.addColorStop(0, rgba(C.gold, 0.28 * n.glow));
                    g.addColorStop(1, rgba(C.gold, 0));
                    ctx.fillStyle = g;
                    ctx.beginPath();
                    ctx.arc(n.x, n.y, 18, 0, Math.PI * 2);
                    ctx.fill();
                }
                // Hollow rings at rest; they fill with gold as a signal passes.
                ctx.beginPath();
                ctx.arc(n.x, n.y, r + n.glow, 0, Math.PI * 2);
                ctx.fillStyle = n.glow > 0.05 ? rgba(C.gold, 0.25 + 0.7 * n.glow) : C.ink;
                ctx.fill();
                ctx.strokeStyle = rgba(n.glow > 0.05 ? C.goldLight : C.ivory, 0.45 + 0.5 * n.glow);
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            raf = requestAnimationFrame(draw);
        };

        const onMove = (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            mouse.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        };
        const onLeave = () => {
            mouse.current = { x: -9999, y: -9999 };
        };

        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(wrap);
        wrap.addEventListener('mousemove', onMove);
        wrap.addEventListener('mouseleave', onLeave);
        raf = requestAnimationFrame(draw);

        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            wrap.removeEventListener('mousemove', onMove);
            wrap.removeEventListener('mouseleave', onLeave);
        };
    }, []);

    return (
        <div ref={wrapRef} className="absolute inset-0">
            <canvas ref={canvasRef} className="w-full h-full block" />
        </div>
    );
};

/* ====================================================================== */
/*  Live research / execution feed                                        */
/* ====================================================================== */

const FEED_LINES: { tag: string; color: string; text: () => string }[] = [
    { tag: 'DATA', color: C.ash, text: () => `Ingest NIFTY chain · ${280 + Math.floor(Math.random() * 60)} strikes` },
    { tag: 'NN', color: C.slate, text: () => `Forward pass · loss ${(0.012 + Math.random() * 0.01).toFixed(4)}` },
    { tag: 'NN', color: C.slate, text: () => `Encoding volatility surface → latent z` },
    { tag: 'RSCH', color: C.slate, text: () => `Backtest across ${10 + Math.floor(Math.random() * 8)} regimes` },
    { tag: 'RISK', color: C.goldLight, text: () => `Δ-neutral · maxDD ${(3 + Math.random() * 2).toFixed(1)}% · within limit` },
    { tag: 'RISK', color: C.goldLight, text: () => `Greeks bounded · vega ${(Math.random() * 2 - 1).toFixed(2)}` },
    { tag: 'SIG', color: C.gold, text: () => `Sharpe ${(1.5 + Math.random() * 0.3).toFixed(2)} · approving iron condor` },
    { tag: 'EXEC', color: C.gold, text: () => `Route order · 100% automated · filled` },
    { tag: 'SIG', color: C.gold, text: () => `Edge detected · IV rank ${Math.floor(40 + Math.random() * 50)}` },
    { tag: 'NN', color: C.slate, text: () => `Attention weights updated · 1.24M params` },
];

interface FeedItem {
    id: number;
    tag: string;
    color: string;
    text: string;
    time: string;
}

export const EngineFeed: React.FC = () => {
    const [items, setItems] = useState<FeedItem[]>([]);
    const idRef = useRef(0);

    const push = useCallback(() => {
        const def = FEED_LINES[Math.floor(Math.random() * FEED_LINES.length)];
        const now = new Date();
        const time = `${String(now.getHours()).padStart(2, '0')}:${String(
            now.getMinutes()
        ).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        idRef.current += 1;
        setItems((prev) =>
            [{ id: idRef.current, tag: def.tag, color: def.color, text: def.text(), time }, ...prev].slice(0, 7)
        );
    }, []);

    useEffect(() => {
        // seed a few lines, then stream
        push();
        const t = setInterval(push, 1500);
        return () => clearInterval(t);
    }, [push]);

    return (
        <div className="font-mono text-[11.5px] leading-relaxed space-y-2 min-h-[300px]">
            {items.map((it, i) => (
                <div
                    key={it.id}
                    className="flex items-start gap-2.5 transition-all"
                    style={{ opacity: Math.max(0.25, 1 - i * 0.12) }}
                >
                    <span className="text-ash shrink-0 tabular-nums">{it.time}</span>
                    <span className="shrink-0 w-10 tracking-wider" style={{ color: it.color }}>
                        {it.tag}
                    </span>
                    <span className="text-stone">{it.text}</span>
                </div>
            ))}
        </div>
    );
};

/* ====================================================================== */
/*  Small live widgets                                                     */
/* ====================================================================== */

/** A small labelled figure laid over a canvas. */
export const Readout: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="border-l border-gold/50 bg-ink/70 pl-3 pr-3 py-1">
        <div className="text-[9px] uppercase tracking-eyebrow text-ash">{label}</div>
        <div className="text-xs font-mono text-ivory">{value}</div>
    </div>
);

export const LiveSharpe: React.FC = () => {
    const [v, setV] = useState(1.58);
    useEffect(() => {
        const t = setInterval(() => {
            setV((prev) => {
                const next = prev + (Math.random() - 0.5) * 0.04;
                return Math.min(1.74, Math.max(1.52, next));
            });
        }, 1200);
        return () => clearInterval(t);
    }, []);
    return (
        <span className="inline-flex items-baseline gap-2 border border-gold/30 bg-ink/70 px-3 py-1 text-[11px] font-mono text-gold-light tabular-nums">
            <span className="text-[9px] uppercase tracking-eyebrow text-ash">Sharpe</span>
            {v.toFixed(2)}
        </span>
    );
};