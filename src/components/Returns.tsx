import React, { useEffect, useRef } from 'react';
import { C, MONO, rgba } from '../lib/palette';
import { easeOut, roundRect } from '../lib/canvas';

/**
 * Growth of ₹100 at the target rate against the broad market, drawn in once
 * when it scrolls into view; hover reads off any year.
 */

export const ReturnsComparison: React.FC = () => {
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
        let progress = 0;
        let started = false;
        let last = performance.now();

        const YEARS = 7;
        const BASE = 100;
        const MKT = 0.075; // ~7-8% market average
        const KAV = 0.275; // ~25-30% target
        const val = (t: number, c: number) => BASE * Math.pow(1 + c, t);
        const yMin = BASE * 0.85;
        const yMax = val(YEARS, KAV) * 1.06;

        const padL = 18;
        const padR = 78;
        const padT = 42;
        const padB = 34;

        const mapX = (t: number) => padL + (t / YEARS) * (width - padL - padR);
        const invX = (x: number) => ((x - padL) / (width - padL - padR)) * YEARS;
        const mapY = (v: number) =>
            padT + (1 - (v - yMin) / (yMax - yMin)) * (height - padT - padB);

        const resize = () => {
            const rect = wrap.getBoundingClientRect();
            width = rect.width;
            height = rect.height;
            canvas.width = Math.max(1, Math.floor(width * dpr));
            canvas.height = Math.max(1, Math.floor(height * dpr));
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        };

        const curvePath = (c: number, tEnd: number) => {
            ctx.beginPath();
            for (let t = 0; t <= tEnd + 0.001; t += 0.1) {
                const x = mapX(Math.min(t, tEnd));
                const y = mapY(val(Math.min(t, tEnd), c));
                if (t === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            }
        };

        const pill = (x: number, y: number, text: string, color: string) => {
            ctx.font = `11px ${MONO}`;
            const w = ctx.measureText(text).width + 14;
            let px = x;
            if (px + w > width - 2) px = width - 2 - w;
            const py = Math.max(padT - 2, Math.min(height - padB - 22, y - 11));
            ctx.fillStyle = rgba(C.ink, 0.92);
            ctx.strokeStyle = color + '66';
            ctx.lineWidth = 1;
            roundRect(ctx, px, py, w, 22, 2);
            ctx.fill();
            ctx.stroke();
            ctx.fillStyle = color;
            ctx.fillText(text, px + 7, py + 15);
        };

        const draw = (now: number) => {
            const dt = Math.min((now - last) / 1000, 0.05);
            last = now;
            if (started && progress < 1) progress = Math.min(1, progress + dt / 1.7);
            const tEnd = YEARS * (0.0001 + 0.9999 * easeOut(progress));

            ctx.clearRect(0, 0, width, height);

            // horizontal gridlines
            ctx.strokeStyle = rgba(C.ivory, 0.06);
            ctx.lineWidth = 1;
            for (let i = 0; i <= 4; i++) {
                const gy = padT + (i / 4) * (height - padT - padB);
                ctx.beginPath();
                ctx.moveTo(padL, gy);
                ctx.lineTo(width - padR + 8, gy);
                ctx.stroke();
            }

            // year ticks
            ctx.fillStyle = C.ash;
            ctx.font = `11px ${MONO}`;
            for (let y = 0; y <= YEARS; y++) {
                ctx.fillText(`Y${y}`, mapX(y) - 7, height - 8);
            }

            // market area + line (ivory)
            curvePath(MKT, tEnd);
            ctx.lineTo(mapX(tEnd), mapY(yMin));
            ctx.lineTo(mapX(0), mapY(yMin));
            ctx.closePath();
            ctx.fillStyle = rgba(C.ivory, 0.03);
            ctx.fill();
            curvePath(MKT, tEnd);
            ctx.strokeStyle = rgba(C.ivory, 0.7);
            ctx.lineWidth = 1.25;
            ctx.stroke();

            // kavas area + line (gold)
            const grd = ctx.createLinearGradient(0, padT, 0, height - padB);
            grd.addColorStop(0, rgba(C.gold, 0.22));
            grd.addColorStop(1, rgba(C.gold, 0));
            curvePath(KAV, tEnd);
            ctx.lineTo(mapX(tEnd), mapY(yMin));
            ctx.lineTo(mapX(0), mapY(yMin));
            ctx.closePath();
            ctx.fillStyle = grd;
            ctx.fill();
            curvePath(KAV, tEnd);
            ctx.strokeStyle = C.gold;
            ctx.lineWidth = 1.75;
            ctx.stroke();

            // endpoint dots
            const mEnd = val(tEnd, MKT);
            const kEnd = val(tEnd, KAV);
            ctx.fillStyle = C.ivory;
            ctx.beginPath();
            ctx.arc(mapX(tEnd), mapY(mEnd), 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = C.gold;
            ctx.beginPath();
            ctx.arc(mapX(tEnd), mapY(kEnd), 3.5, 0, Math.PI * 2);
            ctx.fill();

            // endpoint labels (return %)
            pill(mapX(tEnd) + 8, mapY(kEnd), `+${((kEnd / BASE - 1) * 100).toFixed(0)}%`, C.gold);
            pill(mapX(tEnd) + 8, mapY(mEnd), `+${((mEnd / BASE - 1) * 100).toFixed(0)}%`, C.ivory);

            // legend
            ctx.font = `11px ${MONO}`;
            ctx.fillStyle = C.gold;
            ctx.fillText('● KavasCapital · 25–30% CAGR', padL, 18);
            ctx.fillStyle = C.ivory;
            ctx.fillText('● Market avg · 7–8% CAGR', padL, 34);

            // hover readout
            const mx = mouseX.current;
            if (started && progress >= 1 && mx >= padL && mx <= mapX(YEARS)) {
                const t = Math.max(0, Math.min(YEARS, invX(mx)));
                ctx.strokeStyle = rgba(C.ivory, 0.22);
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(mx, padT);
                ctx.lineTo(mx, height - padB);
                ctx.stroke();
                const kv = val(t, KAV);
                const mv = val(t, MKT);
                ctx.fillStyle = C.gold;
                ctx.beginPath();
                ctx.arc(mx, mapY(kv), 4, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = C.ivory;
                ctx.beginPath();
                ctx.arc(mx, mapY(mv), 4, 0, Math.PI * 2);
                ctx.fill();
                pill(mx + 8, mapY(kv), `${(kv / BASE).toFixed(2)}×`, C.gold);
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
        const io = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    started = true;
                    io.disconnect();
                }
            },
            { threshold: 0.35 }
        );
        io.observe(wrap);
        wrap.addEventListener('mousemove', onMove);
        wrap.addEventListener('mouseleave', onLeave);
        raf = requestAnimationFrame(draw);

        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            io.disconnect();
            wrap.removeEventListener('mousemove', onMove);
            wrap.removeEventListener('mouseleave', onLeave);
        };
    }, []);

    return (
        <div className="border border-rule bg-deep">
            <div ref={wrapRef} className="relative h-[320px] sm:h-[400px] cursor-crosshair">
                <canvas ref={canvasRef} className="w-full h-full block" />
                <div className="absolute top-4 right-4 text-[11px] font-mono text-ash pointer-events-none">
                    growth of ₹100 · {7}-year horizon
                </div>
            </div>
            <div className="grid grid-cols-3 border-t border-rule divide-x divide-rule">
                <ReturnTile value="25–30%" label="Target annualised return" accent="text-gold-light" />
                <ReturnTile value="7–8%" label="Broad market average" accent="text-ivory" />
                <ReturnTile value="≈ 3×" label="Capital vs market at Y7" accent="text-ivory" />
            </div>
        </div>
    );
};

const ReturnTile: React.FC<{ value: string; label: string; accent: string }> = ({
    value,
    label,
    accent,
}) => (
    <div className="px-4 sm:px-6 py-7 text-center">
        <div className={`font-serif text-3xl sm:text-[2.6rem] leading-none lnum ${accent}`}>{value}</div>
        <div className="mt-3 text-[10px] uppercase tracking-[0.2em] text-ash">{label}</div>
    </div>
);
