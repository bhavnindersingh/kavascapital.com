import React, { useEffect, useRef, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import NeuralField from './components/NeuralField';
import { EngineFeed, LiveSharpe, NeuralNetwork, Readout } from './components/Engine';
import { QuantLab } from './components/QuantLab';
import { ReturnsComparison } from './components/Returns';
import Wordmark from './components/Wordmark';

/**
 * Public marketing site for KavasCapital — the whole of kavascapital.com.
 *
 * Set like a research house's report rather than a product launch: navy
 * ground, one gold accent, a serif for anything that is read and mono only
 * for figures that move. Sections are numbered and separated by hairlines;
 * nothing glows. It has no login and no data from any application.
 */

const NAV = [
    ['#engine', 'Live Engine'],
    ['#lab', 'Quant Lab'],
    ['#technology', 'Technology'],
    ['#research', 'Research'],
    ['#performance', 'Performance'],
] as const;

// The engine's state, set as a ledger beside the hero.
const LEDGER = [
    ['Surface', 'σ(K,T) · surface tensor · live'],
    ['Greeks', 'Δ 0.02 · Γ bounded · ν capped'],
    ['Risk', 'VaR₉₅ inside risk gate'],
    ['Ratios', 'Sharpe 1.62 ▲ · Sortino 2.14'],
    ['Model', 'KavasNet-Δ · 1.24M params'],
    ['Execution', 'EXEC · autonomous · 24×7'],
] as const;

const LandingPage: React.FC = () => {
    const [scrolled, setScrolled] = useState(false);

    useEffect(() => {
        const onScroll = () => setScrolled(window.scrollY > 16);
        window.addEventListener('scroll', onScroll, { passive: true });
        return () => window.removeEventListener('scroll', onScroll);
    }, []);

    // Smooth anchor scrolling for the in-page nav links.
    useEffect(() => {
        const html = document.documentElement;
        const prev = html.style.scrollBehavior;
        html.style.scrollBehavior = 'smooth';
        return () => {
            html.style.scrollBehavior = prev;
        };
    }, []);

    return (
        <div className="min-h-screen bg-ink text-ivory font-sans antialiased overflow-x-hidden">
            {/* ====================== Ambient ground ====================== */}
            <div className="pointer-events-none fixed inset-0 z-0">
                <NeuralField />
                {/* a single warm light from the top, and the edges falling to ink */}
                <div className="absolute inset-x-0 top-0 h-[70vh] bg-[radial-gradient(ellipse_60%_55%_at_50%_0%,rgba(200,169,107,0.07),transparent_70%)]" />
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgba(8,13,25,0.85)_100%)]" />
            </div>

            {/* ====================== Navigation ====================== */}
            <header
                className={`fixed top-0 inset-x-0 z-50 transition-all duration-500 ${
                    scrolled ? 'bg-ink/85 backdrop-blur-md border-b border-rule' : 'border-b border-transparent'
                }`}
            >
                <nav className="max-w-7xl mx-auto px-6 lg:px-10 h-20 flex items-center justify-between">
                    <a href="#top" aria-label="Kavas Capital — home">
                        <Wordmark />
                    </a>

                    <div className="hidden md:flex items-center gap-9">
                        {NAV.map(([href, label]) => (
                            <a
                                key={href}
                                href={href}
                                className="group relative text-[11px] uppercase tracking-[0.22em] text-stone hover:text-ivory transition-colors"
                            >
                                {label}
                                <span className="absolute left-0 -bottom-1.5 h-px w-0 bg-gold transition-all duration-500 group-hover:w-full" />
                            </a>
                        ))}
                    </div>
                </nav>
            </header>

            {/* ====================== Hero ====================== */}
            <section id="top" className="relative z-10 min-h-screen flex flex-col justify-center px-6 lg:px-10 pt-32 pb-20">
                <div className="max-w-7xl w-full mx-auto grid lg:grid-cols-12 gap-14 lg:gap-10 items-end">
                    <div className="lg:col-span-8">
                        <Rise>
                            <div className="flex items-center gap-4 text-[11px] uppercase tracking-eyebrow text-gold">
                                <span className="h-px w-10 bg-gold/70" />
                                AI-Native Quantitative Trading
                            </div>
                        </Rise>

                        <Rise delay={120}>
                            <h1 className="mt-9 font-serif font-normal text-[2.75rem] sm:text-[clamp(3rem,7.2vw,4.4rem)] lg:text-[clamp(3.4rem,4.6vw,4.9rem)] leading-[1.02] tracking-[-0.015em] text-ivory lnum">
                                Deep neural research that
                                <br />
                                <em className="text-gold-light">beats alpha at Sharpe&nbsp;&gt;&nbsp;1.5</em>
                            </h1>
                        </Rise>

                        <Rise delay={240}>
                            <p className="mt-9 max-w-xl text-[17px] leading-[1.75] text-stone">
                                A self-learning options-derivatives engine. Deep networks research,
                                design, and execute strategies in real time — with institutional-grade
                                risk control and zero manual intervention.
                            </p>
                        </Rise>

                        <Rise delay={360}>
                            <div className="mt-12 flex flex-col sm:flex-row sm:items-center gap-6 sm:gap-10">
                                <a
                                    href="#technology"
                                    className="group inline-flex items-center justify-center gap-3 bg-gold hover:bg-gold-light text-ink px-8 py-4 text-[12px] uppercase tracking-[0.2em] font-medium transition-colors"
                                >
                                    Explore the technology
                                    <ArrowRight className="w-4 h-4 transition-transform duration-300 group-hover:translate-x-1" strokeWidth={1.5} />
                                </a>
                                <a
                                    href="#engine"
                                    className="group inline-flex items-center gap-3 text-[12px] uppercase tracking-[0.2em] text-ivory"
                                >
                                    <span className="border-b border-gold/40 group-hover:border-gold pb-1 transition-colors">
                                        Watch the engine think
                                    </span>
                                </a>
                            </div>
                        </Rise>
                    </div>

                    {/* ledger */}
                    <Rise delay={480} className="lg:col-span-4">
                        <dl className="border-t border-gold/40">
                            {LEDGER.map(([k, v]) => (
                                <div key={k} className="flex items-baseline justify-between gap-6 border-b border-rule py-3.5">
                                    <dt className="text-[10px] uppercase tracking-eyebrow text-ash">{k}</dt>
                                    <dd className="font-mono text-[11.5px] text-stone text-right">{v}</dd>
                                </div>
                            ))}
                        </dl>
                    </Rise>
                </div>

                <div className="max-w-7xl w-full mx-auto mt-20 flex flex-wrap items-center gap-x-5 gap-y-3 text-[11px] uppercase tracking-[0.22em] text-ash [&>span]:whitespace-nowrap">
                    <span>Options &amp; derivatives only</span>
                    <Diamond />
                    <span className="hidden sm:inline">Risk-first by design</span>
                    <Diamond className="hidden sm:inline-block" />
                    <span>100% automated</span>
                </div>
            </section>

            {/* ====================== Lexicon ====================== */}
            <Lexicon />

            {/* ====================== Live engine ====================== */}
            <section id="engine" className="relative z-10 py-28 lg:py-36 px-6 lg:px-10">
                <div className="max-w-7xl mx-auto">
                    <Reveal>
                        <div className="border border-rule bg-deep">
                            <div className="flex items-center justify-between px-6 sm:px-8 py-4 border-b border-rule">
                                <div className="flex items-baseline gap-3">
                                    <span className="font-serif text-xl text-ivory">Neural Strategy Engine</span>
                                    <span className="hidden sm:inline font-serif italic text-stone">· live inference</span>
                                </div>
                                <div className="flex items-center gap-2.5 text-[10px] uppercase tracking-eyebrow text-gold">
                                    <span className="h-1.5 w-1.5 rounded-full bg-gold animate-[pulse_3s_ease-in-out_infinite]" />
                                    Autonomous
                                </div>
                            </div>

                            <div className="grid lg:grid-cols-5">
                                <div className="lg:col-span-3 relative border-b lg:border-b-0 lg:border-r border-rule min-h-[340px] sm:min-h-[440px]">
                                    <NeuralNetwork />
                                    <div className="absolute top-5 left-5 flex flex-col gap-2 pointer-events-none">
                                        <Readout label="Model" value="KavasNet-Δ" />
                                        <Readout label="Parameters" value="1.24M" />
                                    </div>
                                    <div className="absolute bottom-5 left-5 right-5 flex items-center justify-between gap-4 pointer-events-none">
                                        <span className="text-[11px] font-mono text-ash">
                                            4 hidden layers · attention over volatility surface
                                        </span>
                                        <LiveSharpe />
                                    </div>
                                </div>

                                <div className="lg:col-span-2 p-6 sm:p-8">
                                    <div className="text-[10px] uppercase tracking-eyebrow text-gold mb-5">
                                        Research &amp; Execution Feed
                                    </div>
                                    <EngineFeed />
                                </div>
                            </div>
                        </div>
                    </Reveal>

                    <StatsBand />
                </div>
            </section>

            {/* ====================== Technology ====================== */}
            <Section id="technology" index="01" eyebrow="The Technology">
                <SectionHeading
                    title={<>Intelligence at every <em>layer of the trade</em></>}
                    subtitle="From signal discovery to order routing, deep learning models drive every decision — researched, stress-tested, and executed without a human in the loop."
                />

                <div className="mt-20 grid md:grid-cols-2 lg:grid-cols-3 border-t border-l border-rule">
                    {FEATURES.map((f, i) => (
                        <Reveal key={f.title} delay={(i % 3) * 90} className="border-r border-b border-rule">
                            <article className="group h-full p-8 lg:p-10 transition-colors duration-500 hover:bg-deep/70">
                                <div className="flex items-center justify-between">
                                    <span className="font-mono text-[11px] text-gold">{ROMAN[i]}</span>
                                    <span className="h-px w-8 bg-rule transition-all duration-500 group-hover:w-14 group-hover:bg-gold/60" />
                                </div>
                                <h3 className="mt-10 font-serif text-[1.65rem] leading-tight text-ivory">{f.title}</h3>
                                <p className="mt-4 text-[14.5px] leading-[1.75] text-stone">{f.body}</p>
                            </article>
                        </Reveal>
                    ))}
                </div>
            </Section>

            {/* ====================== Quant Lab ====================== */}
            <Section id="lab" index="02" eyebrow="Quantitative Research">
                <SectionHeading
                    title={<>Step inside the <em>Quant Lab</em></>}
                    subtitle="The same primitives our models reason over, made interactive. Drag the volatility surface, run the Monte-Carlo engine, probe an option's payoff — this is the maths the platform automates."
                />
                <Reveal className="mt-16">
                    <QuantLab />
                </Reveal>
            </Section>

            {/* ====================== Process ====================== */}
            <Section id="process" index="03" eyebrow="How it works">
                <SectionHeading
                    title={<>A closed-loop, <em>hands-free</em> pipeline</>}
                    subtitle="Four stages run continuously and automatically. Nothing is manual — the loop researches, validates, executes, and learns on its own."
                />

                <ol className="mt-20 grid md:grid-cols-2 lg:grid-cols-4 gap-x-10 gap-y-14">
                    {STEPS.map((s, i) => (
                        <Reveal key={s.title} delay={i * 110}>
                            <li className="relative pt-10">
                                {/* the loop's rail */}
                                <span className="absolute top-0 left-0 right-0 h-px bg-rule" />
                                <span className="absolute -top-[4px] left-0 h-[9px] w-[9px] rotate-45 border border-gold bg-ink" />
                                <span className="font-mono text-[11px] text-gold">{s.step}</span>
                                <h3 className="mt-4 font-serif text-3xl text-ivory">{s.title}</h3>
                                <p className="mt-4 text-[14.5px] leading-[1.75] text-stone">{s.body}</p>
                            </li>
                        </Reveal>
                    ))}
                </ol>

                <p className="mt-20 text-center font-serif italic text-xl text-stone">
                    One continuous loop — no manual intervention at any stage.
                </p>
            </Section>

            {/* ====================== Performance ====================== */}
            <Section id="performance" index="04" eyebrow="Performance philosophy">
                <div className="grid lg:grid-cols-2 gap-16 lg:gap-20 items-center">
                    <div>
                        <Reveal>
                            <h2 className="font-serif font-normal text-4xl sm:text-5xl lg:text-[3.6rem] leading-[1.05] text-ivory [&_em]:text-gold-light">
                                Engineered for <em>risk-adjusted</em> return
                            </h2>
                            <p className="mt-7 text-[16px] leading-[1.75] text-stone max-w-lg">
                                We don't optimise for the biggest number on a good day. We optimise for
                                consistency — a high Sharpe ratio that holds up across regimes.
                            </p>
                        </Reveal>

                        <ul className="mt-10 border-t border-rule">
                            {[
                                'Target Sharpe ratio above 1.5 — return earned per unit of risk taken.',
                                'Drawdown-bounded: every strategy carries hard risk limits.',
                                'Options-only specialisation for a genuine analytical edge.',
                                'No discretionary trading — performance is systematic and repeatable.',
                            ].map((line, i) => (
                                <Reveal key={line} delay={i * 80}>
                                    <li className="flex items-baseline gap-5 border-b border-rule py-4">
                                        <span className="font-mono text-[11px] text-gold shrink-0">0{i + 1}</span>
                                        <span className="text-[15px] text-ivory/90">{line}</span>
                                    </li>
                                </Reveal>
                            ))}
                        </ul>
                    </div>

                    {/* Illustrative performance card (not live data) */}
                    <Reveal delay={150}>
                        <div className="border border-rule bg-deep">
                            <div className="flex items-center justify-between px-7 py-4 border-b border-rule">
                                <span className="font-serif text-lg text-ivory">Risk-adjusted performance</span>
                                <span className="text-[9px] uppercase tracking-eyebrow text-ash border border-rule px-2 py-1">
                                    Illustrative
                                </span>
                            </div>

                            <div className="grid grid-cols-2 border-b border-rule">
                                {[
                                    ['1.5+', 'Sharpe ratio'],
                                    ['100%', 'Automation'],
                                    ['Options', 'Asset class'],
                                    ['0', 'Human overrides'],
                                ].map(([v, l], i) => (
                                    <div
                                        key={l}
                                        className={`px-7 py-6 ${i % 2 === 0 ? 'border-r border-rule' : ''} ${i < 2 ? 'border-b border-rule' : ''}`}
                                    >
                                        <div className={`font-serif text-[2.4rem] leading-none lnum ${i === 0 ? 'text-gold-light' : 'text-ivory'}`}>
                                            {v}
                                        </div>
                                        <div className="mt-2.5 text-[10px] uppercase tracking-[0.2em] text-ash">{l}</div>
                                    </div>
                                ))}
                            </div>

                            <div className="relative h-36 m-7">
                                <svg viewBox="0 0 400 120" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
                                    <defs>
                                        <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="0%" stopColor="#C8A96B" stopOpacity="0.22" />
                                            <stop offset="100%" stopColor="#C8A96B" stopOpacity="0" />
                                        </linearGradient>
                                    </defs>
                                    {[30, 60, 90].map((y) => (
                                        <line key={y} x1="0" x2="400" y1={y} y2={y} stroke="rgba(236,229,214,0.06)" vectorEffect="non-scaling-stroke" />
                                    ))}
                                    <path
                                        d="M0,100 L40,92 L80,96 L120,78 L160,82 L200,60 L240,66 L280,44 L320,50 L360,28 L400,18 L400,120 L0,120 Z"
                                        fill="url(#eq)"
                                    />
                                    <path
                                        d="M0,100 L40,92 L80,96 L120,78 L160,82 L200,60 L240,66 L280,44 L320,50 L360,28 L400,18"
                                        fill="none"
                                        stroke="#C8A96B"
                                        strokeWidth="1.5"
                                        vectorEffect="non-scaling-stroke"
                                    />
                                </svg>
                                <div className="absolute -bottom-1 left-0 font-serif italic text-[15px] text-stone">
                                    Smoother curve, higher Sharpe
                                </div>
                            </div>
                        </div>
                    </Reveal>
                </div>
            </Section>

            {/* ====================== Returns comparison ====================== */}
            <Section id="returns" index="05" eyebrow="The Edge">
                <SectionHeading
                    title={<>Compounding that <em>leaves the market behind</em></>}
                    subtitle="The broad market returns roughly 7–8% a year. KavasCapital targets 25–30% annualised — and at those rates, compounding does the rest. Watch the gap widen."
                />
                <Reveal className="mt-16">
                    <ReturnsComparison />
                </Reveal>
                <p className="mt-6 text-[11px] leading-relaxed text-ash max-w-2xl">
                    Illustrative growth of capital at target annualised rates. Hypothetical,
                    for comparison only — not a guarantee of future performance.
                </p>
            </Section>

            {/* ====================== Research ====================== */}
            <Section id="research" index="06" eyebrow="The Science">
                <SectionHeading
                    title={<>Built like a research lab, <em>not a trading desk</em></>}
                    subtitle="The strategy is a model — documented, versioned, and open-weight. Read the methodology behind the engine that runs your capital."
                />
                <Reveal className="mt-16">
                    <Paper />
                </Reveal>
            </Section>

            {/* ====================== Footer ====================== */}
            <footer className="relative z-10 border-t border-rule px-6 lg:px-10 pt-20 pb-12">
                <div className="max-w-7xl mx-auto">
                    <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-10">
                        <div>
                            <Wordmark size="lg" />
                        </div>
                        <p className="text-[12px] leading-relaxed text-ash max-w-md lg:text-right">
                            Trading in derivatives carries risk. Past or illustrative performance is
                            not indicative of future results. For informational purposes only.
                        </p>
                    </div>
                    <div className="mt-14 pt-6 border-t border-rule flex flex-col sm:flex-row justify-between gap-3 text-[11px] uppercase tracking-[0.2em] text-ash">
                        <span>© {new Date().getFullYear()} KavasCapital. All rights reserved.</span>
                        <a href="#top" className="hover:text-ivory transition-colors">Back to top ↑</a>
                    </div>
                </div>
            </footer>
        </div>
    );
};

/* ====================================================================== */
/*  Content                                                               */
/* ====================================================================== */

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI'];

const FEATURES = [
    {
        title: 'Deep AI strategy generation',
        body: 'Neural networks continuously mine market microstructure and volatility regimes to synthesise fresh options strategies — not static rules, but models that adapt as the market changes.',
    },
    {
        title: 'Risk-first engineering',
        body: 'Every position passes a quantitative risk gate — exposure, drawdown, and greeks are bounded before a single order is placed. Capital preservation is the first objective, alpha the second.',
    },
    {
        title: 'Fully autonomous execution',
        body: 'Signals flow straight to execution. There are no manual overrides, no discretionary trades, no late-night decisions — the system runs the strategy exactly as designed, 24×7.',
    },
    {
        title: 'Options & derivatives focus',
        body: 'We trade options and derivatives exclusively. Specialisation means our models understand the instruments deeply — pricing, decay, and convexity are first-class citizens.',
    },
    {
        title: 'Alpha-seeking, Sharpe-aware',
        body: 'The objective function optimises for risk-adjusted return. We chase a Sharpe ratio above 1.5 — consistent, repeatable performance over reckless one-off bets.',
    },
    {
        title: 'Institutional data backbone',
        body: 'High-resolution market data feeds a research pipeline that validates every strategy across regimes before it ever touches live capital.',
    },
];

const STEPS = [
    { step: '01', title: 'Ingest', body: 'Live options chains, volatility surfaces, and market depth stream into the engine in real time.' },
    { step: '02', title: 'Generate', body: 'Deep models design candidate strategies tuned to the current volatility regime.' },
    { step: '03', title: 'Risk-gate', body: 'Each candidate is stress-tested against exposure, greeks, and drawdown limits before approval.' },
    { step: '04', title: 'Execute', body: 'Approved strategies route to market automatically and are monitored position-by-position, 24×7.' },
];

const LEXICON = [
    'Black–Scholes–Merton', 'Δ Delta-neutral', 'Γ Gamma scalping', 'ν Vega surface',
    'Θ Theta decay', 'IV-rank regime', 'Heston stochastic vol', 'Monte-Carlo VaR',
    'Sharpe > 1.5', 'Sortino', 'Calmar', 'Recovery factor', 'Max-drawdown gate',
    'Iron condor', 'Risk-reversal skew', 'Itô calculus', 'Martingale pricing',
    'Convexity & gamma', 'Term-structure of vol', 'Kelly sizing', 'Greeks-bounded',
];

/* ====================================================================== */
/*  Layout pieces                                                         */
/* ====================================================================== */

const Diamond: React.FC<{ className?: string }> = ({ className = '' }) => (
    <span className={`inline-block h-[5px] w-[5px] rotate-45 bg-gold/70 ${className}`} aria-hidden="true" />
);

/** A numbered section: hairline on top, "01 — Eyebrow" over the content. */
const Section: React.FC<{ id: string; index: string; eyebrow: string; children: React.ReactNode }> = ({
    id,
    index,
    eyebrow,
    children,
}) => (
    <section id={id} className="relative z-10 px-6 lg:px-10 py-24 lg:py-32">
        <div className="max-w-7xl mx-auto">
            <div className="flex items-center gap-5 border-t border-rule pt-6 mb-14 text-[11px] uppercase tracking-eyebrow">
                <span className="font-mono text-gold">{index}</span>
                <span className="h-px w-8 bg-gold/50" />
                <span className="text-stone">{eyebrow}</span>
            </div>
            {children}
        </div>
    </section>
);

/** Serif title on the left, its standfirst on the right; `<em>` is set in gold italic. */
const SectionHeading: React.FC<{ title: React.ReactNode; subtitle: string }> = ({ title, subtitle }) => (
    <Reveal>
        <div className="grid lg:grid-cols-12 gap-8 lg:gap-10 items-end">
            <h2 className="lg:col-span-7 font-serif font-normal text-4xl sm:text-5xl lg:text-[3.9rem] leading-[1.04] tracking-[-0.01em] text-ivory [&_em]:text-gold-light">
                {title}
            </h2>
            <p className="lg:col-span-5 text-[16px] leading-[1.75] text-stone lg:pb-2">{subtitle}</p>
        </div>
    </Reveal>
);

/** The technical vocabulary, set in italic serif and drifting slowly between two rules. */
const Lexicon: React.FC = () => (
    <section className="relative z-10 border-y border-rule bg-deep/40 py-6 overflow-hidden" aria-label="Vocabulary">
        <div className="[mask-image:linear-gradient(to_right,transparent,black_8%,black_92%,transparent)]">
            <div className="flex w-max items-center" style={{ animation: 'kv-lexicon 90s linear infinite' }}>
                {[...LEXICON, ...LEXICON].map((t, i) => (
                    <span key={i} className="flex items-center shrink-0">
                        <span className="px-7 font-serif italic text-[19px] text-stone whitespace-nowrap">{t}</span>
                        <Diamond />
                    </span>
                ))}
            </div>
        </div>
    </section>
);

/** Four headline figures between hairlines, counted up once on arrival. */
const StatsBand: React.FC = () => {
    const ref = useRef<HTMLDivElement>(null);
    const [show, setShow] = useState(false);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const io = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    setShow(true);
                    io.disconnect();
                }
            },
            { threshold: 0.4 }
        );
        io.observe(el);
        return () => io.disconnect();
    }, []);

    return (
        <div ref={ref} className="mt-14 grid grid-cols-2 lg:grid-cols-4 border-y border-rule">
            <CountStat run={show} value={1.5} decimals={1} prefix="> " label="Target Sharpe ratio" />
            <CountStat run={show} value={100} suffix="%" label="Automated execution" />
            <CountStat run={show} value={1.24} decimals={2} suffix="M" label="Model parameters" />
            <CountStat run={show} value={24} suffix="×7" label="Risk monitoring" />
        </div>
    );
};

const CountStat: React.FC<{
    run: boolean;
    value: number;
    label: string;
    decimals?: number;
    prefix?: string;
    suffix?: string;
}> = ({ run, value, label, decimals = 0, prefix = '', suffix = '' }) => {
    const [display, setDisplay] = useState(0);

    useEffect(() => {
        if (!run) return;
        let raf = 0;
        let startTime = 0;
        const duration = 1800;
        const tick = (t: number) => {
            if (!startTime) startTime = t;
            const p = Math.min((t - startTime) / duration, 1);
            setDisplay(value * (1 - Math.pow(1 - p, 3)));
            if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
    }, [run, value]);

    return (
        <div className="px-6 py-10 text-center border-rule [&:not(:last-child)]:border-r max-lg:[&:nth-child(2)]:border-r-0 max-lg:[&:nth-child(-n+2)]:border-b">
            <div className="font-serif text-5xl lg:text-[3.6rem] leading-none text-ivory lnum">
                <span className="text-gold-light">{prefix}</span>
                {display.toFixed(decimals)}
                <span className="text-gold-light">{suffix}</span>
            </div>
            <div className="mt-4 text-[10px] uppercase tracking-eyebrow text-ash">{label}</div>
        </div>
    );
};

/** The preprint, set as an ivory sheet on the navy ground. */
const Paper: React.FC = () => (
    <article className="relative bg-ivory text-ink shadow-[0_40px_80px_-30px_rgba(0,0,0,0.7)]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-7 sm:px-12 py-4 border-b border-ink/10 text-[11px] font-mono text-ink/55">
            <span className="text-gold-deep">KavasCapital Research</span>
            <span>·</span>
            <span>Preprint</span>
            <span>·</span>
            <span>arXiv:2606.01492&nbsp;[q-fin.TR]</span>
            <span className="ml-auto uppercase tracking-[0.2em] text-[10px] text-gold-deep">Open weights</span>
        </div>

        <div className="px-7 sm:px-12 py-10 sm:py-14">
            <h3 className="font-serif font-medium text-3xl sm:text-[2.7rem] leading-[1.12] max-w-4xl">
                Nightingale-2.0: A Self-Hedging, Risk-Gated Options Engine for
                Regime-Adaptive Alpha
            </h3>
            <p className="mt-5 font-serif italic text-lg text-ink/60">
                KavasCapital Quant Research · Latent volatility-surface attention · 1.24M parameters
            </p>

            <div className="mt-12 grid lg:grid-cols-3 gap-12">
                <div className="lg:col-span-2">
                    <div className="text-[10px] uppercase tracking-eyebrow text-gold-deep mb-4">Abstract</div>
                    <p className="font-serif text-[19px] leading-[1.6] text-ink/85 first-letter:float-left first-letter:mr-1.5 first-letter:mt-1 first-letter:text-[3.4rem] first-letter:leading-[0.85] first-letter:text-gold-deep">
                        We present Nightingale-2.0, an autonomous options-derivatives engine that
                        encodes the live implied-volatility surface into a latent state and conditions
                        strategy generation on the prevailing volatility regime. A deep network proposes
                        candidate structures — verticals, condors, and dynamically-hedged sell programs —
                        which pass a hard <em>Greeks-bounded risk gate</em> (Δ, Γ, ν, Θ) before any
                        capital is committed. Protective <em>crawler</em> and <em>leverage-buy</em> legs
                        self-adjust to cap tail loss, and the objective optimises risk-adjusted return
                        (Sharpe&nbsp;&gt;&nbsp;1.5, Sortino&nbsp;&gt;&nbsp;2.0) rather than raw P&amp;L. The
                        loop ingests, generates, risk-gates, and executes with zero manual intervention.
                    </p>

                    <div className="mt-9 flex flex-wrap gap-3 text-[11px] uppercase tracking-[0.18em]">
                        <span className="border border-ink/25 px-4 py-2">Methodology</span>
                        <span className="border border-ink/25 px-4 py-2">Model card</span>
                        <span className="border border-ink/10 px-4 py-2 text-ink/40">Code — coming soon</span>
                    </div>
                </div>

                <div>
                    <div className="text-[10px] uppercase tracking-eyebrow text-gold-deep mb-4">Specification</div>
                    <dl className="border-t border-ink/15 text-[14px]">
                        {[
                            ['Architecture', 'Attn. over vol-surface'],
                            ['Parameters', '1.24M'],
                            ['Risk gate', 'Δ Γ ν Θ bounded'],
                            ['Objective', 'Sharpe-optimal'],
                            ['Asset class', 'Options only'],
                            ['Autonomy', '100% · 24×7'],
                        ].map(([k, v]) => (
                            <div key={k} className="flex items-baseline justify-between gap-4 border-b border-ink/15 py-3">
                                <dt className="text-ink/55">{k}</dt>
                                <dd className="font-mono text-[12.5px] text-ink">{v}</dd>
                            </div>
                        ))}
                    </dl>
                </div>
            </div>

            <div className="mt-12">
                <div className="text-[10px] uppercase tracking-eyebrow text-gold-deep mb-4">Cite</div>
                <pre className="overflow-x-auto bg-ink text-stone p-6 text-[12px] leading-relaxed font-mono">
{`@article{kavascapital2026nightingale,
  title   = {Nightingale-2.0: A Self-Hedging, Risk-Gated
             Options Engine for Regime-Adaptive Alpha},
  author  = {KavasCapital Quant Research},
  journal = {KavasCapital Preprints},
  year    = {2026},
  note    = {Open-weight, options and derivatives only},
}`}
                </pre>
            </div>
        </div>
    </article>
);

/* ====================================================================== */
/*  Motion                                                                */
/* ====================================================================== */

/** Fades and lifts its children once, as they enter the viewport. */
const Reveal: React.FC<{ children: React.ReactNode; className?: string; delay?: number }> = ({
    children,
    className = '',
    delay = 0,
}) => {
    const ref = useRef<HTMLDivElement>(null);
    const [shown, setShown] = useState(false);
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        const io = new IntersectionObserver(
            (entries) => {
                if (entries[0].isIntersecting) {
                    setShown(true);
                    io.disconnect();
                }
            },
            { threshold: 0.12 }
        );
        io.observe(el);
        return () => io.disconnect();
    }, []);
    return (
        <div
            ref={ref}
            className={`transition-[opacity,transform] duration-[1100ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
            } ${className}`}
            style={{ transitionDelay: `${delay}ms` }}
        >
            {children}
        </div>
    );
};

/** The hero's entrance: the same rise, played on load rather than on scroll. */
const Rise: React.FC<{ children: React.ReactNode; className?: string; delay?: number }> = ({
    children,
    className = '',
    delay = 0,
}) => {
    const [shown, setShown] = useState(false);
    useEffect(() => {
        const t = requestAnimationFrame(() => setShown(true));
        return () => cancelAnimationFrame(t);
    }, []);
    return (
        <div
            className={`transition-[opacity,transform] duration-[1400ms] ease-[cubic-bezier(0.22,1,0.36,1)] ${
                shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-5'
            } ${className}`}
            style={{ transitionDelay: `${delay}ms` }}
        >
            {children}
        </div>
    );
};

export default LandingPage;
