import React, { useEffect, useRef, useState } from 'react';
import { C, MONO, rgba } from '../lib/palette';
import { roundRect } from '../lib/canvas';
import { Readout } from './Engine';

/**
 * The Quant Lab: four small instruments — the implied-vol surface, a
 * Monte-Carlo path engine, live Black-Scholes Greeks and the IV smile with
 * its gamma — each beside a note on the maths it shows.
 */

type LabTab = 'vol' | 'mc' | 'greeks' | 'ivgamma';

export const QuantLab: React.FC = () => {
    const [tab, setTab] = useState<LabTab>('vol');

    const tabs: { id: LabTab; label: string }[] = [
        { id: 'vol', label: 'Volatility Surface' },
        { id: 'mc', label: 'Monte-Carlo Engine' },
        { id: 'greeks', label: 'Greeks Snapshot' },
        { id: 'ivgamma', label: 'IV & Gamma' },
    ];

    return (
        <div className="relative border border-rule bg-deep">
            {/* tab bar — numbered, underlined, no pills */}
            <div className="flex overflow-x-auto overflow-y-hidden [scrollbar-width:none] border-b border-rule" role="tablist">
                {tabs.map((t, i) => {
                    const active = tab === t.id;
                    return (
                        <button
                            key={t.id}
                            role="tab"
                            aria-selected={active}
                            onClick={() => setTab(t.id)}
                            className={`relative shrink-0 flex items-baseline gap-3 px-5 sm:px-7 py-4 text-left transition-colors ${
                                active ? 'text-ivory' : 'text-ash hover:text-stone'
                            }`}
                        >
                            <span className="font-mono text-[10px] text-gold/80">0{i + 1}</span>
                            <span className="text-[13px] tracking-wide whitespace-nowrap">{t.label}</span>
                            <span
                                className={`absolute left-0 right-0 bottom-0 h-px bg-gold transition-opacity duration-500 ${
                                    active ? 'opacity-100' : 'opacity-0'
                                }`}
                            />
                        </button>
                    );
                })}
            </div>

            <div className="grid lg:grid-cols-5">
                {/* interactive canvas */}
                <div className="lg:col-span-3 relative border-b lg:border-b-0 lg:border-r border-rule min-h-[360px] sm:min-h-[440px]">
                    {tab === 'vol' && <VolSurface3D />}
                    {tab === 'mc' && <MonteCarlo />}
                    {tab === 'greeks' && <GreeksSnapshot />}
                    {tab === 'ivgamma' && <IVGamma />}
                </div>

                {/* contextual research panel */}
                <div className="lg:col-span-2 p-7 sm:p-9">
                    {tab === 'vol' && <LabExplainer
                        kicker="Implied volatility surface"
                        lead="We don't trade a single volatility number. Our models read the entire surface — the smile across strikes and the term structure across tenors — as a live tensor."
                        eqTitle="Surface map"
                        equations={[
                            <span key="1"><EqVar>σ</EqVar><sub>imp</sub> = <EqVar>f</EqVar>(<EqVar>K</EqVar>, <EqVar>T</EqVar>)</span>,
                            <span key="2">skew = <span className="text-ash">∂</span><EqVar>σ</EqVar> / <span className="text-ash">∂</span><EqVar>K</EqVar></span>,
                            <span key="3">term = <span className="text-ash">∂</span><EqVar>σ</EqVar> / <span className="text-ash">∂</span><EqVar>T</EqVar></span>,
                        ]}
                        hint="Drag to rotate · auto-orbits when idle"
                    />}
                    {tab === 'mc' && <LabExplainer
                        kicker="Monte-Carlo path simulation"
                        lead="Thousands of stochastic price paths price the tails. Geometric Brownian motion drives each path; the terminal distribution is what risk limits are written against."
                        eqTitle="Price dynamics"
                        equations={[
                            <span key="1"><EqVar>dS</EqVar><sub>t</sub> = <EqVar>μ</EqVar> <EqVar>S</EqVar><sub>t</sub> <EqVar>dt</EqVar> + <EqVar>σ</EqVar> <EqVar>S</EqVar><sub>t</sub> <EqVar>dW</EqVar><sub>t</sub></span>,
                            <span key="2"><EqVar>S</EqVar><sub>T</sub> = <EqVar>S</EqVar><sub>0</sub> <EqVar>e</EqVar><sup>(<EqVar>μ</EqVar>−<EqVar>σ</EqVar>²/2)<EqVar>T</EqVar> + <EqVar>σ</EqVar>√<EqVar>T</EqVar> <EqVar>Z</EqVar></sup></span>,
                        ]}
                        hint="Live · paths fan out, distribution forms on the right"
                    />}
                    {tab === 'greeks' && <LabExplainer
                        kicker="Live Greeks snapshot"
                        lead="The risk derivatives of an ATM option, computed live from Black-Scholes. As spot drifts, the sensitivities update — these are the quantities our risk gate bounds before any order is sent."
                        eqTitle="Sensitivities"
                        equations={[
                            <span key="1"><EqVar>Δ</EqVar> = <EqVar>N</EqVar>(<EqVar>d</EqVar><sub>1</sub>) &nbsp;·&nbsp; <EqVar>Γ</EqVar> = <EqVar>φ</EqVar>(<EqVar>d</EqVar><sub>1</sub>) / (<EqVar>S</EqVar><EqVar>σ</EqVar>√<EqVar>T</EqVar>)</span>,
                            <span key="2"><EqVar>ν</EqVar> = <EqVar>S</EqVar><EqVar>φ</EqVar>(<EqVar>d</EqVar><sub>1</sub>)√<EqVar>T</EqVar> &nbsp;·&nbsp; <EqVar>Θ</EqVar>, <EqVar>ρ</EqVar></span>,
                        ]}
                        hint="Live · spot drifts, gauges update each tick"
                    />}
                    {tab === 'ivgamma' && <LabExplainer
                        kicker="IV smile & gamma profile"
                        lead="The volatility smile across strikes, overlaid with the option's gamma. Gamma peaks at-the-money and decays into the wings — watch the peak track spot as it moves. This convexity is where the edge, and the risk, lives."
                        eqTitle="Curvature"
                        equations={[
                            <span key="1"><EqVar>σ</EqVar><sub>imp</sub>(<EqVar>K</EqVar>) — smile, convex in strike</span>,
                            <span key="2"><EqVar>Γ</EqVar>(<EqVar>K</EqVar>) = <EqVar>φ</EqVar>(<EqVar>d</EqVar><sub>1</sub>) / (<EqVar>S</EqVar><EqVar>σ</EqVar>√<EqVar>T</EqVar>) — peaks ATM</span>,
                        ]}
                        hint="Hover to read IV and gamma at any strike"
                    />}
                </div>
            </div>
        </div>
    );
};

const EqVar: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <span className="italic font-serif text-gold-light">{children}</span>
);

const LabExplainer: React.FC<{
    kicker: string;
    lead: string;
    eqTitle: string;
    equations: React.ReactNode[];
    hint: string;
}> = ({ kicker, lead, eqTitle, equations, hint }) => (
    <div>
        <div className="text-[10px] uppercase tracking-eyebrow text-gold mb-4">{kicker}</div>
        <p className="text-[15px] text-stone leading-relaxed">{lead}</p>

        <div className="mt-7 border-t border-rule pt-5">
            <div className="text-[10px] uppercase tracking-eyebrow text-ash mb-3">{eqTitle}</div>
            <div className="space-y-2.5 text-[19px] text-ivory lnum">
                {equations.map((eq, i) => (
                    <div key={i} className="font-serif">
                        {eq}
                    </div>
                ))}
            </div>
        </div>

        <div className="mt-7 flex items-center gap-3 text-[11px] text-ash">
            <span className="h-px w-6 bg-gold/60" />
            {hint}
        </div>
    </div>
);

/* ----------------------- 3D volatility surface ----------------------- */

const VolSurface3D: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const view = useRef({ yaw: 0.7, pitch: 0.5, active: false, lastX: 0, lastY: 0 });

    useEffect(() => {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        let width = 0;
        let height = 0;
        let raf = 0;

        const NX = 20;
        const NY = 14;
        const grid: { x: number; y: number; z: number }[][] = [];
        for (let i = 0; i < NX; i++) {
            const row: { x: number; y: number; z: number }[] = [];
            for (let j = 0; j < NY; j++) {
                const gx = (i / (NX - 1)) * 2 - 1;
                const gy = (j / (NY - 1)) * 2 - 1;
                const smile = 0.5 * gx * gx; // convex smile across strikes
                const skew = -0.16 * gx; // put skew
                const term = 0.12 * gy; // term structure
                row.push({ x: gx, y: gy, z: 0.32 + smile + skew + term });
            }
            grid.push(row);
        }

        const resize = () => {
            const r = wrap.getBoundingClientRect();
            width = r.width;
            height = r.height;
            canvas.width = Math.max(1, Math.floor(width * dpr));
            canvas.height = Math.max(1, Math.floor(height * dpr));
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        const project = (x: number, y: number, z: number, yaw: number, pitch: number) => {
            const X = x;
            const Y = -(z - 0.5);
            const Z = y;
            const xr = X * Math.cos(yaw) - Z * Math.sin(yaw);
            const zr = X * Math.sin(yaw) + Z * Math.cos(yaw);
            const yr = Y * Math.cos(pitch) - zr * Math.sin(pitch);
            const zr2 = Y * Math.sin(pitch) + zr * Math.cos(pitch);
            const f = 3.4;
            const scale = f / (f + zr2);
            const span = Math.min(width, height) * 0.4;
            return {
                sx: width / 2 + xr * scale * span,
                sy: height / 2 + yr * scale * span * 1.15,
                depth: zr2,
            };
        };

        const colorFor = (z: number, alpha: number) => {
            const t = Math.max(0, Math.min(1, (z - 0.2) / 0.95));
            // stone in the trough, gold on the wings where vol is richest
            const r = Math.round(127 + (227 - 127) * t);
            const g = Math.round(147 + (203 - 147) * t);
            const b = Math.round(181 + (152 - 181) * t);
            return `rgba(${r},${g},${b},${alpha})`;
        };

        const draw = () => {
            if (!view.current.active) view.current.yaw += 0.004;
            const { yaw, pitch } = view.current;
            ctx.clearRect(0, 0, width, height);

            const P = grid.map((row) =>
                row.map((p) => ({ ...project(p.x, p.y, p.z, yaw, pitch), z: p.z }))
            );

            ctx.lineWidth = 1;
            for (let i = 0; i < NX; i++) {
                for (let j = 0; j < NY; j++) {
                    const a = P[i][j];
                    const fade = Math.max(0.06, Math.min(0.75, 0.25 + 0.5 * (1 - (a.depth + 1) / 2)));
                    if (i < NX - 1) {
                        const b = P[i + 1][j];
                        ctx.strokeStyle = colorFor((grid[i][j].z + grid[i + 1][j].z) / 2, fade);
                        ctx.beginPath();
                        ctx.moveTo(a.sx, a.sy);
                        ctx.lineTo(b.sx, b.sy);
                        ctx.stroke();
                    }
                    if (j < NY - 1) {
                        const b = P[i][j + 1];
                        ctx.strokeStyle = colorFor((grid[i][j].z + grid[i][j + 1].z) / 2, fade);
                        ctx.beginPath();
                        ctx.moveTo(a.sx, a.sy);
                        ctx.lineTo(b.sx, b.sy);
                        ctx.stroke();
                    }
                }
            }
            // crest vertices
            for (let i = 0; i < NX; i++) {
                for (let j = 0; j < NY; j++) {
                    const a = P[i][j];
                    ctx.fillStyle = colorFor(grid[i][j].z, 0.55);
                    ctx.beginPath();
                    ctx.arc(a.sx, a.sy, 0.9, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            raf = requestAnimationFrame(draw);
        };

        const down = (e: MouseEvent) => {
            view.current.active = true;
            view.current.lastX = e.clientX;
            view.current.lastY = e.clientY;
        };
        const move = (e: MouseEvent) => {
            if (!view.current.active) return;
            view.current.yaw += (e.clientX - view.current.lastX) * 0.01;
            view.current.pitch = Math.max(
                0.05,
                Math.min(1.2, view.current.pitch + (e.clientY - view.current.lastY) * 0.008)
            );
            view.current.lastX = e.clientX;
            view.current.lastY = e.clientY;
        };
        const up = () => {
            view.current.active = false;
        };

        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(wrap);
        wrap.addEventListener('mousedown', down);
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', up);
        raf = requestAnimationFrame(draw);

        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            wrap.removeEventListener('mousedown', down);
            window.removeEventListener('mousemove', move);
            window.removeEventListener('mouseup', up);
        };
    }, []);

    return (
        <div ref={wrapRef} className="absolute inset-0 cursor-grab active:cursor-grabbing">
            <canvas ref={canvasRef} className="w-full h-full block" />
            <div className="absolute top-4 left-4 pointer-events-none">
                <Readout label="Surface" value="σ(K, T)" />
            </div>
            <div className="absolute bottom-4 left-4 text-[11px] font-mono text-ash pointer-events-none">
                strike → · ← tenor · height = implied vol
            </div>
        </div>
    );
};

/* ----------------------- Monte-Carlo simulator ----------------------- */

const MonteCarlo: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        let width = 0;
        let height = 0;
        let raf = 0;

        const M = 46; // concurrent paths
        const STEPS = 200;
        const S0 = 100;
        const mu = 0.05;
        const sigma = 0.55;
        const dt = 1 / STEPS;
        const sMin = 40;
        const sMax = 190;
        const HIST_BINS = 46;
        const hist = new Array(HIST_BINS).fill(0);
        let histMax = 1;

        interface Path {
            s: number;
            step: number;
            px: number;
            py: number;
        }
        let paths: Path[] = [];

        let plotW = 0;
        const mapX = (step: number) => (step / STEPS) * plotW;
        const mapY = (s: number) =>
            height - ((Math.max(sMin, Math.min(sMax, s)) - sMin) / (sMax - sMin)) * height;

        const seed = (): Path => ({ s: S0, step: 0, px: 0, py: mapY(S0) });

        const init = () => {
            plotW = width * 0.76;
            paths = Array.from({ length: M }, seed);
        };

        const gauss = () => {
            let u = 0;
            let v = 0;
            while (u === 0) u = Math.random();
            while (v === 0) v = Math.random();
            return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        };

        const resize = () => {
            const r = wrap.getBoundingClientRect();
            width = r.width;
            height = r.height;
            canvas.width = Math.max(1, Math.floor(width * dpr));
            canvas.height = Math.max(1, Math.floor(height * dpr));
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            ctx.fillStyle = C.deep;
            ctx.fillRect(0, 0, width, height);
            init();
        };

        const draw = () => {
            // fade plot area to leave trails
            ctx.fillStyle = rgba(C.deep, 0.07);
            ctx.fillRect(0, 0, plotW, height);

            // advance + draw a few steps per frame
            const SUB = 2;
            for (let k = 0; k < SUB; k++) {
                for (const p of paths) {
                    const prevX = mapX(p.step);
                    const prevY = mapY(p.s);
                    p.step += 1;
                    p.s *= Math.exp((mu - 0.5 * sigma * sigma) * dt + sigma * Math.sqrt(dt) * gauss());
                    const nx = mapX(p.step);
                    const ny = mapY(p.s);
                    ctx.strokeStyle = rgba(C.ivory, 0.22);
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(prevX, prevY);
                    ctx.lineTo(nx, ny);
                    ctx.stroke();

                    if (p.step >= STEPS) {
                        const bin = Math.max(
                            0,
                            Math.min(
                                HIST_BINS - 1,
                                Math.floor(((p.s - sMin) / (sMax - sMin)) * HIST_BINS)
                            )
                        );
                        hist[bin] += 1;
                        histMax = Math.max(histMax, hist[bin]);
                        Object.assign(p, seed());
                    }
                }
            }

            // S0 reference line
            ctx.strokeStyle = rgba(C.gold, 0.45);
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, mapY(S0));
            ctx.lineTo(plotW, mapY(S0));
            ctx.stroke();
            ctx.setLineDash([]);

            // histogram on the right
            const histX = plotW + 6;
            const histW = width - histX - 4;
            ctx.clearRect(plotW, 0, width - plotW, height);
            const bandH = height / HIST_BINS;
            for (let b = 0; b < HIST_BINS; b++) {
                const len = (hist[b] / histMax) * histW;
                const y = height - (b + 1) * bandH;
                ctx.fillStyle = rgba(C.gold, 0.35 + 0.5 * (hist[b] / histMax));
                ctx.fillRect(histX, y + 1, Math.max(0, len), bandH - 1.5);
            }
            ctx.strokeStyle = rgba(C.ivory, 0.1);
            ctx.beginPath();
            ctx.moveTo(plotW + 2, 0);
            ctx.lineTo(plotW + 2, height);
            ctx.stroke();

            raf = requestAnimationFrame(draw);
        };

        resize();
        const ro = new ResizeObserver(resize);
        ro.observe(wrap);
        raf = requestAnimationFrame(draw);

        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
        };
    }, []);

    return (
        <div ref={wrapRef} className="absolute inset-0">
            <canvas ref={canvasRef} className="w-full h-full block" />
            <div className="absolute top-4 left-4 flex flex-col gap-2 pointer-events-none">
                <Readout label="Paths" value={`${46} live · ∞ sampled`} />
                <Readout label="Process" value="GBM · dS = μS dt + σS dW" />
            </div>
            <div className="absolute bottom-4 right-4 text-[11px] font-mono text-gold/80 pointer-events-none">
                terminal distribution →
            </div>
        </div>
    );
};

/* ----------------------- Black-Scholes helpers ----------------------- */

const normPdf = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);

const normCdf = (x: number) => {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp((-x * x) / 2);
    const p =
        d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - p : p;
};

interface Greeks {
    delta: number;
    gamma: number;
    vega: number;
    theta: number;
    rho: number;
}

const bsCallGreeks = (S: number, K: number, T: number, r: number, sig: number): Greeks => {
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r + 0.5 * sig * sig) * T) / (sig * sqrtT);
    const d2 = d1 - sig * sqrtT;
    const pdf = normPdf(d1);
    return {
        delta: normCdf(d1),
        gamma: pdf / (S * sig * sqrtT),
        vega: (S * pdf * sqrtT) / 100, // per 1% vol
        theta: (-(S * pdf * sig) / (2 * sqrtT) - r * K * Math.exp(-r * T) * normCdf(d2)) / 365, // per day
        rho: (K * T * Math.exp(-r * T) * normCdf(d2)) / 100, // per 1% rate
    };
};

const bsGamma = (S: number, K: number, T: number, r: number, sig: number) => {
    const sqrtT = Math.sqrt(T);
    const d1 = (Math.log(S / K) + (r + 0.5 * sig * sig) * T) / (sig * sqrtT);
    return normPdf(d1) / (S * sig * sqrtT);
};

/* ----------------------- Greeks snapshot (gauges) ----------------------- */

const gPolar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
    const a = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

const gArc = (cx: number, cy: number, r: number, a0: number, a1: number) => {
    const [sx, sy] = gPolar(cx, cy, r, a0);
    const [ex, ey] = gPolar(cx, cy, r, a1);
    const large = ((a1 - a0) % 360) > 180 ? 1 : 0;
    return `M ${sx} ${sy} A ${r} ${r} 0 ${large} 1 ${ex} ${ey}`;
};

const GAUGE_ARC = gArc(50, 50, 40, -135, 135);

const GreekGauge: React.FC<{
    label: string;
    display: string;
    fraction: number;
    color: string;
}> = ({ label, display, fraction, color }) => {
    const f = Math.max(0, Math.min(1, fraction));
    return (
        <div className="flex flex-col items-center w-[92px]">
            <svg viewBox="0 0 100 100" className="w-[86px] h-[86px]">
                <path
                    d={GAUGE_ARC}
                    fill="none"
                    stroke={rgba(C.ivory, 0.1)}
                    strokeWidth="2"
                    strokeLinecap="round"
                />
                <path
                    d={GAUGE_ARC}
                    pathLength={100}
                    fill="none"
                    stroke={color}
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    style={{
                        strokeDasharray: `${f * 100} 100`,
                        transition: 'stroke-dasharray 1.1s cubic-bezier(0.22,1,0.36,1)',
                    }}
                />
                <text
                    x="50"
                    y="54"
                    textAnchor="middle"
                    fill={C.ivory}
                    style={{ fontFamily: MONO, fontSize: '13px', fontWeight: 400 }}
                >
                    {display}
                </text>
            </svg>
            <div className="font-serif italic text-[15px] text-stone -mt-1">{label}</div>
        </div>
    );
};

const GreeksSnapshot: React.FC = () => {
    const [spot, setSpot] = useState(100);
    const [sig, setSig] = useState(0.18);

    useEffect(() => {
        const t = setInterval(() => {
            setSpot((s) => Math.max(93, Math.min(107, s + (Math.random() - 0.5) * 1.6)));
            setSig((v) => Math.max(0.14, Math.min(0.24, v + (Math.random() - 0.5) * 0.006)));
        }, 1500);
        return () => clearInterval(t);
    }, []);

    const K = 100;
    const T = 30 / 365;
    const r = 0.06;
    const g = bsCallGreeks(spot, K, T, r, sig);

    return (
        <div className="absolute inset-0 p-6 sm:p-7 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
                <div className="text-[10px] uppercase tracking-eyebrow text-gold">ATM Call · 30D</div>
                <div className="flex items-center gap-4 font-mono text-xs">
                    <span className="text-ash">
                        Spot <span className="text-ivory tabular-nums">{spot.toFixed(2)}</span>
                    </span>
                    <span className="text-ash">
                        IV <span className="text-gold-light tabular-nums">{(sig * 100).toFixed(1)}%</span>
                    </span>
                </div>
            </div>

            <div className="flex-1 flex flex-wrap items-center justify-center gap-x-5 gap-y-4">
                <GreekGauge label="Delta Δ" display={g.delta.toFixed(2)} fraction={g.delta} color={C.gold} />
                <GreekGauge label="Gamma Γ" display={g.gamma.toFixed(4)} fraction={g.gamma / 0.1} color={C.goldLight} />
                <GreekGauge label="Vega ν" display={g.vega.toFixed(3)} fraction={g.vega / 0.15} color={C.ivory} />
                <GreekGauge label="Theta Θ" display={g.theta.toFixed(3)} fraction={Math.abs(g.theta) / 0.08} color={C.slate} />
                <GreekGauge label="Rho ρ" display={g.rho.toFixed(3)} fraction={g.rho / 0.08} color={C.sage} />
            </div>

            <div className="mt-3 text-center text-[11px] text-ash font-mono">
                Black-Scholes · K 100 · r 6% · T 30/365 · live re-pricing
            </div>
        </div>
    );
};

/* ----------------------- IV smile & gamma profile ----------------------- */

const IVGamma: React.FC = () => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapRef = useRef<HTMLDivElement>(null);
    const mouseX = useRef<number>(-1);

    useEffect(() => {
        const canvas = canvasRef.current;
        const wrap = wrapRef.current;
        if (!canvas || !wrap) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        let width = 0;
        let height = 0;
        let raf = 0;

        const kMin = 80;
        const kMax = 120;
        const T = 30 / 365;
        const r = 0.06;
        const gMax = 0.1;
        const ivMin = 0.1;
        const ivMax = 0.3;
        const padL = 16;
        const padR = 16;
        const padT = 30;
        const padB = 28;

        // implied vol smile across strikes (convex, with put skew)
        const smile = (K: number) => {
            const m = (K - 100) / 100;
            return Math.max(0.08, 0.15 + 1.4 * m * m - 0.35 * m);
        };

        const mapX = (K: number) => padL + ((K - kMin) / (kMax - kMin)) * (width - padL - padR);
        const invX = (x: number) => kMin + ((x - padL) / (width - padL - padR)) * (kMax - kMin);
        const ivY = (iv: number) =>
            padT + (1 - (iv - ivMin) / (ivMax - ivMin)) * (height - padT - padB);
        const gY = (gv: number) => padT + (1 - gv / gMax) * (height - padT - padB);

        const resize = () => {
            const rect = wrap.getBoundingClientRect();
            width = rect.width;
            height = rect.height;
            canvas.width = Math.max(1, Math.floor(width * dpr));
            canvas.height = Math.max(1, Math.floor(height * dpr));
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        const draw = (now: number) => {
            // spot wanders → gamma peak tracks it
            const S = 100 + 9 * Math.sin(now * 0.00035) + 3 * Math.sin(now * 0.0011);
            ctx.clearRect(0, 0, width, height);

            // gamma filled area (right axis)
            ctx.beginPath();
            ctx.moveTo(mapX(kMin), gY(0));
            for (let K = kMin; K <= kMax; K += 0.5) {
                ctx.lineTo(mapX(K), gY(bsGamma(S, K, T, r, smile(K))));
            }
            ctx.lineTo(mapX(kMax), gY(0));
            ctx.closePath();
            ctx.fillStyle = rgba(C.gold, 0.12);
            ctx.fill();

            // gamma line
            ctx.beginPath();
            for (let K = kMin; K <= kMax; K += 0.5) {
                const x = mapX(K);
                const y = gY(bsGamma(S, K, T, r, smile(K)));
                if (K === kMin) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = C.gold;
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // IV smile line (left axis)
            ctx.beginPath();
            for (let K = kMin; K <= kMax; K += 0.5) {
                const x = mapX(K);
                const y = ivY(smile(K));
                if (K === kMin) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
            ctx.strokeStyle = C.ivory;
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // spot marker (tracks gamma peak)
            const sx = mapX(S);
            ctx.strokeStyle = rgba(C.sage, 0.6);
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(sx, padT - 6);
            ctx.lineTo(sx, height - padB);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = C.sage;
            ctx.font = `10px ${MONO}`;
            ctx.fillText(`spot ${S.toFixed(1)}`, Math.min(sx + 4, width - 54), padT - 10);

            // strike ticks
            ctx.fillStyle = C.ash;
            ctx.font = `11px ${MONO}`;
            [80, 90, 100, 110, 120].forEach((K) => {
                ctx.fillText(String(K), mapX(K) - 8, height - 8);
            });

            // legend
            ctx.font = `11px ${MONO}`;
            ctx.fillStyle = C.ivory;
            ctx.fillText('— IV smile', padL, 16);
            ctx.fillStyle = C.gold;
            ctx.fillText('— Gamma', padL + 78, 16);

            // hover
            const mx = mouseX.current;
            if (mx >= padL && mx <= width - padR) {
                const K = invX(mx);
                const iv = smile(K);
                const gm = bsGamma(S, K, T, r, iv);
                ctx.strokeStyle = rgba(C.ivory, 0.25);
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(mx, padT);
                ctx.lineTo(mx, height - padB);
                ctx.stroke();

                ctx.fillStyle = C.ivory;
                ctx.beginPath();
                ctx.arc(mx, ivY(iv), 3, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = C.gold;
                ctx.beginPath();
                ctx.arc(mx, gY(gm), 3, 0, Math.PI * 2);
                ctx.fill();

                const label = `K ${K.toFixed(0)}   IV ${(iv * 100).toFixed(1)}%   Γ ${gm.toFixed(4)}`;
                ctx.font = `11px ${MONO}`;
                const tw = ctx.measureText(label).width + 16;
                let tx = mx + 10;
                if (tx + tw > width - 4) tx = mx - tw - 10;
                const ty = padT + 2;
                ctx.fillStyle = rgba(C.ink, 0.95);
                ctx.strokeStyle = rgba(C.gold, 0.4);
                ctx.lineWidth = 1;
                roundRect(ctx, tx, ty, tw, 24, 2);
                ctx.fill();
                ctx.stroke();
                ctx.fillStyle = C.ivory;
                ctx.fillText(label, tx + 8, ty + 16);
            }

            raf = requestAnimationFrame(draw);
        };

        const onMove = (e: MouseEvent) => {
            const rect = canvas.getBoundingClientRect();
            mouseX.current = e.clientX - rect.left;
        };
        const onLeave = () => {
            mouseX.current = -1;
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
        <div ref={wrapRef} className="absolute inset-0 cursor-crosshair">
            <canvas ref={canvasRef} className="w-full h-full block" />
            <div className="absolute bottom-4 right-4 text-[11px] font-mono text-gold/80 pointer-events-none">
                gamma peaks at-the-money →
            </div>
        </div>
    );
};