import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Navigate } from 'react-router-dom';
import { accountsApi } from '@/services/api';
import { useAuthStore } from '@/stores/authStore';
import {
    AccountEntry, AccountEntryInput, AccountCategory, AccountCurrency, AccountTotal,
    AccountPerson, AccountMonthTotal, AccountFile,
} from '@/types';
import {
    Wallet, Search, RefreshCw, Plus, Pencil, Trash2, Loader2, ChevronLeft, ChevronRight,
    Download, Banknote, Monitor, User, Building2, X, Paperclip, FileText, Upload, Receipt,
    Server, Megaphone, Plane, Briefcase, Landmark, Shapes, ChevronDown,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Segmented } from '@/components/ui/segmented';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

// ---------------------------------------------------------------------------
// Categories: the major heads the Kavas Consultancy books use, so every bill
// has an obvious home. The hue is fixed per category (never by rank), and
// always sits beside a text label — colour is a scanning aid, not the only
// channel. Ten heads outrun the seven cat-* tokens, so three borrow themed
// ramps (amber, emerald, and neutral grey for tax & bank charges).
const CATEGORIES: {
    key: AccountCategory;
    label: string;
    short: string;
    icon: React.ElementType;
    hue: string;      // for SVG fills / swatches
    chip: string;     // tinted chip classes
    hint: string;     // what belongs here, shown under the picker
    perPerson: boolean; // always one partner's, never joint (the API enforces it too)
}[] = [
    { key: 'salary', label: 'Salaries', short: 'Salary', icon: Banknote, hue: 'hsl(var(--cat-1))', chip: 'bg-cat-1/10 border-cat-1/25 text-cat-1',
      hint: "A partner's salary. Always one person's.", perPerson: true },
    { key: 'office', label: 'Office & utilities', short: 'Office', icon: Building2, hue: 'hsl(var(--cat-3))', chip: 'bg-cat-3/10 border-cat-3/25 text-cat-3',
      hint: 'Rent, co-working, electricity, internet, phone bills.', perPerson: false },
    { key: 'subscription', label: 'Software & data', short: 'Software', icon: Server, hue: 'hsl(var(--cat-4))', chip: 'bg-cat-4/10 border-cat-4/25 text-cat-4',
      hint: 'AWS and servers, market data, broker and platform fees, software subscriptions.', perPerson: false },
    { key: 'marketing', label: 'Marketing', short: 'Marketing', icon: Megaphone, hue: 'hsl(var(--cat-6))', chip: 'bg-cat-6/10 border-cat-6/25 text-cat-6',
      hint: 'Website, domains, ads, branding, events.', perPerson: false },
    { key: 'travel', label: 'Travel', short: 'Travel', icon: Plane, hue: 'rgb(var(--c-amber-500))', chip: 'bg-amber-500/10 border-amber-500/25 text-amber-500',
      hint: 'Flights, cabs, hotels, meals on work trips.', perPerson: false },
    { key: 'professional', label: 'Professional fees', short: 'Professional', icon: Briefcase, hue: 'rgb(var(--c-emerald-500))', chip: 'bg-emerald-500/10 border-emerald-500/25 text-emerald-500',
      hint: 'CA, legal, ROC and GST filings, consultants.', perPerson: false },
    // Stored as 'purchase'. Kept apart from running costs because the CA
    // depreciates assets over years instead of writing them off in the year.
    { key: 'purchase', label: 'Assets & equipment', short: 'Assets', icon: Monitor, hue: 'hsl(var(--cat-5))', chip: 'bg-cat-5/10 border-cat-5/25 text-cat-5',
      hint: 'Things bought to keep and use for years: laptop, monitor, phone, furniture.', perPerson: false },
    { key: 'tax_bank', label: 'Taxes & bank charges', short: 'Tax & bank', icon: Landmark, hue: 'rgb(var(--c-dark-400))', chip: 'bg-dark-400/10 border-dark-400/25 text-dark-400',
      hint: 'GST and TDS paid, bank and payment gateway charges, penalties.', perPerson: false },
    // Stored as 'company' (the original catch-all), so older entries land here.
    { key: 'company', label: 'Other company expenses', short: 'Other', icon: Shapes, hue: 'hsl(var(--cat-7))', chip: 'bg-cat-7/10 border-cat-7/25 text-cat-7',
      hint: 'Company spending that fits none of the heads above.', perPerson: false },
    { key: 'personal', label: 'Personal expenses', short: 'Personal', icon: User, hue: 'hsl(var(--cat-2))', chip: 'bg-cat-2/10 border-cat-2/25 text-cat-2',
      hint: "A partner's own spending. Always one person's.", perPerson: true },
];
const CAT = Object.fromEntries(CATEGORIES.map((c) => [c.key, c])) as Record<AccountCategory, typeof CATEGORIES[number]>;

const CURRENCIES: AccountCurrency[] = ['INR', 'USD'];
const PAYMENT_METHODS = ['Bank transfer', 'UPI', 'Card', 'Cash', 'Cheque', 'Other'];
const TREND_MONTHS = 6;

// Owner value for a joint entry (owner_email null). Also the API's filter value.
const JOINT = 'joint';

const fieldClass = 'h-auto bg-background border-dark-700/60 rounded-xl py-2.5 px-3.5';

// ---------------------------------------------------------------------------
// Formatting
const locale = (currency: string) => (currency === 'INR' ? 'en-IN' : 'en-US');

const formatMoney = (amount: string | number, currency: string) =>
    new Intl.NumberFormat(locale(currency), { style: 'currency', currency, minimumFractionDigits: 2 })
        .format(Number(amount));

const formatCompact = (amount: number, currency: string) =>
    new Intl.NumberFormat(locale(currency), {
        style: 'currency', currency, notation: 'compact', maximumFractionDigits: 1,
    }).format(amount);

const pad = (n: number) => String(n).padStart(2, '0');
const toIso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayIso = () => toIso(new Date());
const currentMonth = () => todayIso().slice(0, 7);

const shiftMonth = (month: string, delta: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
};

// "2026-10" -> first and last day of that month.
const monthRange = (month: string) => {
    const [y, m] = month.split('-').map(Number);
    return { date_from: `${month}-01`, date_to: `${month}-${pad(new Date(y, m, 0).getDate())}` };
};

// Indian financial year (April–March), named by the year it starts in:
// FY 2026 = 1 Apr 2026 to 31 Mar 2027, shown as "FY 2026-27". This is the
// period the CA files on.
const currentFy = () => {
    const d = new Date();
    return d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
};
const fyLabel = (fy: number) => `FY ${fy}-${pad((fy + 1) % 100)}`;
const fyRange = (fy: number) => ({ date_from: `${fy}-04-01`, date_to: `${fy + 1}-03-31` });
const fyMonths = (fy: number) => Array.from({ length: 12 }, (_, i) => shiftMonth(`${fy}-04`, i));

const monthLabel = (month: string, style: 'long' | 'short' = 'long') =>
    new Date(`${month}-01T00:00:00`).toLocaleDateString(undefined,
        style === 'long' ? { month: 'long', year: 'numeric' } : { month: 'short' });

const dayLabel = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

const initials = (name: string) =>
    name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';

const sumByCurrency = <T extends { currency: string }>(rows: T[], amount: (r: T) => string) => {
    const map: Record<string, number> = {};
    rows.forEach((r) => { map[r.currency] = (map[r.currency] || 0) + Number(amount(r)); });
    return map;
};

const joinMoney = (sums: Record<string, number>) =>
    Object.entries(sums).map(([cur, v]) => formatMoney(v, cur)).join(' + ');

const emptyForm = (): AccountEntryInput => ({
    entry_date: todayIso(),
    category: 'office',
    party: '',
    description: '',
    amount: '',
    currency: 'INR',
    payment_method: null,
    owner_email: null,
    notes: '',
    paid_from: '',
    reference_no: '',
    payee_account: '',
    bank_narration: '',
    gst_applicable: false,
    vendor_gstin: '',
    invoice_no: '',
    invoice_date: '',
    gst_rate: '18',
    taxable_value: '',
    gst_amount: '',
    salary_month: '',
});

// The last category, whose and payment method used, so a run of similar
// entries needs fewer taps (as in the Kavas Consultancy books). Per browser,
// and optional: storage may be unavailable.
const LAST_KEY = 'accounts-last-entry';
const lastUsed = (people: AccountPerson[]): Partial<AccountEntryInput> => {
    try {
        const v = JSON.parse(localStorage.getItem(LAST_KEY) ?? '{}');
        const out: Partial<AccountEntryInput> = {};
        if (CATEGORIES.some((c) => c.key === v.category)) out.category = v.category;
        if (PAYMENT_METHODS.includes(v.payment_method)) out.payment_method = v.payment_method;
        if (CURRENCIES.includes(v.currency)) out.currency = v.currency;
        if (v.owner_email === null || people.some((p) => p.email === v.owner_email)) out.owner_email = v.owner_email;
        return out;
    } catch {
        return {};
    }
};
const rememberEntry = (f: AccountEntryInput) => {
    try {
        localStorage.setItem(LAST_KEY, JSON.stringify({
            category: f.category, payment_method: f.payment_method, currency: f.currency, owner_email: f.owner_email,
        }));
    } catch { /* storage unavailable: nothing to remember */ }
};

/** A row of tap-to-pick pills: quicker than a dropdown for a handful of options. */
const Choice: React.FC<{
    label: string;
    value: string;
    options: { value: string; label: string; icon?: React.ElementType }[];
    onChange: (v: string) => void;
    hint?: string;
}> = ({ label, value, options, onChange, hint }) => (
    <div role="radiogroup" aria-label={label} className="space-y-2">
        <Label className="ml-1">{label}</Label>
        <div className="flex flex-wrap gap-1.5">
            {options.map((o) => {
                const on = o.value === value;
                const Icon = o.icon;
                return (
                    <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => onChange(o.value)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-meta font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? 'border-foreground bg-foreground text-background' : 'border-dark-700/60 text-muted-foreground hover:border-foreground/40 hover:text-foreground'}`}>
                        {Icon && <Icon size={13} />}{o.label}
                    </button>
                );
            })}
        </div>
        {hint && <p className="ml-1 text-meta text-muted-foreground">{hint}</p>}
    </div>
);

// ---------------------------------------------------------------------------
// Attachments: invoices and payment screenshots.
const GST_RATES = ['0', '5', '12', '18', '28'];
const ACCEPT = '.jpg,.jpeg,.png,.webp,.heic,.heif,.gif,.pdf';
const ACCEPT_EXT = ACCEPT.split(',').map((e) => e.slice(1));
const MAX_FILE_BYTES = 10 * 1024 * 1024;
// What the browser can preview. HEIC can't be shown in most browsers, so it downloads.
const PREVIEW_MIME: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    pdf: 'application/pdf',
};
const extOf = (name: string) => (name.split('.').pop() || '').toLowerCase();
const isImage = (name: string) => ['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(extOf(name));
const formatSize = (n: number | null) =>
    n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

// GST included in a total: taxable = total / (1 + rate), GST = the rest.
const splitGst = (amount: string, rate: string) => {
    const total = Number(amount), r = Number(rate);
    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(r)) return null;
    const taxable = Math.round((total / (1 + r / 100)) * 100) / 100;
    return { taxable: taxable.toFixed(2), gst: (Math.round((total - taxable) * 100) / 100).toFixed(2) };
};

/** A saved attachment: image thumbnail (fetched with the bearer token) or a PDF tile. */
const SavedFile: React.FC<{ file: AccountFile; onRemove: () => void }> = ({ file, onRemove }) => {
    const [thumb, setThumb] = useState<string | null>(null);
    useEffect(() => {
        if (!isImage(file.name)) return;
        let url: string | null = null;
        accountsApi.fetchFile(file.entry_id, file.id)
            .then((b) => { url = URL.createObjectURL(new Blob([b], { type: PREVIEW_MIME[extOf(file.name)] })); setThumb(url); })
            .catch(() => { /* tile falls back to the icon */ });
        return () => { if (url) URL.revokeObjectURL(url); };
    }, [file.entry_id, file.id, file.name]);

    const open = async () => {
        try {
            const blob = await accountsApi.fetchFile(file.entry_id, file.id);
            const mime = PREVIEW_MIME[extOf(file.name)];
            const url = URL.createObjectURL(mime ? new Blob([blob], { type: mime }) : blob);
            if (mime) {
                window.open(url, '_blank', 'noopener');
            } else {
                const a = document.createElement('a');
                a.href = url; a.download = file.name; document.body.appendChild(a); a.click(); a.remove();
            }
            setTimeout(() => URL.revokeObjectURL(url), 60000);
        } catch {
            toast.error('Could not open the file');
        }
    };

    return (
        <FileTile name={file.name} meta={formatSize(file.file_size)} thumb={thumb} onOpen={open} onRemove={onRemove} />
    );
};

const FileTile: React.FC<{
    name: string; meta: string; thumb: string | null; pending?: boolean;
    onOpen?: () => void; onRemove: () => void;
}> = ({ name, meta, thumb, pending, onOpen, onRemove }) => (
    <div className="group relative flex items-center gap-3 rounded-xl border border-dark-700/60 bg-background p-2 pr-9">
        <button type="button" onClick={onOpen} disabled={!onOpen}
            className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-secondary/60 grid place-items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Open ${name}`}>
            {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : <FileText size={20} className="text-muted-foreground" />}
        </button>
        <div className="min-w-0">
            <button type="button" onClick={onOpen} disabled={!onOpen}
                className="block max-w-full truncate text-left text-meta font-medium text-foreground hover:underline disabled:no-underline">
                {name}
            </button>
            <div className="text-[11px] text-muted-foreground">{pending ? `${meta}, uploads when you save` : meta}</div>
        </div>
        <button type="button" onClick={onRemove} aria-label={`Remove ${name}`}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-danger-400 hover:bg-accent">
            <X size={14} />
        </button>
    </div>
);

// ---------------------------------------------------------------------------
// Monthly trend: stacked bars by category in one currency — the last six months,
// or the twelve months of a financial year. Click a bar to open that month.
const TrendChart: React.FC<{
    months: string[];
    data: AccountMonthTotal[];
    currency: AccountCurrency;
    selected: string;
    onSelect: (month: string) => void;
}> = ({ months, data, currency, selected, onSelect }) => {
    const [hover, setHover] = useState<number | null>(null);
    // Draw at the container's real pixel width so text stays 11-12px however
    // wide the page is (a scaled viewBox would blow the labels up full-screen).
    const wrapRef = useRef<HTMLDivElement>(null);
    const [W, setW] = useState(600);
    useEffect(() => {
        const el = wrapRef.current;
        if (!el) return;
        const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const stacks = useMemo(() => months.map((m) => {
        const parts = CATEGORIES.map((c) => ({
            key: c.key,
            value: data
                .filter((d) => d.month === m && d.category === c.key && d.currency === currency)
                .reduce((n, d) => n + Number(d.total), 0),
        }));
        return { month: m, parts, total: parts.reduce((n, p) => n + p.value, 0) };
    }), [months, data, currency]);

    const max = Math.max(...stacks.map((s) => s.total), 0);
    const H = 220, top = 22, bottom = 26, left = 4, right = 4;
    const plotH = H - top - bottom;
    const slot = (W - left - right) / months.length;
    const barW = Math.min(44, slot * 0.5);
    const y = (v: number) => (max > 0 ? (v / max) * plotH : 0);

    return (
        <div ref={wrapRef} className="relative">
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img"
                aria-label={`Spending per month, ${monthLabel(months[0])} to ${monthLabel(months[months.length - 1])}, in ${currency}`}>
                {/* recessive gridlines: baseline, half, max */}
                {[0, 0.5, 1].map((f) => (
                    <line key={f} x1={left} x2={W - right} y1={top + plotH - f * plotH} y2={top + plotH - f * plotH}
                        stroke="hsl(var(--border))" strokeWidth={1} strokeDasharray={f === 0 ? undefined : '2 4'} />
                ))}
                {stacks.map((s, i) => {
                    const cx = left + slot * i + slot / 2;
                    let acc = 0;
                    const visible = s.parts.filter((p) => p.value > 0);
                    const isSel = s.month === selected;
                    return (
                        <g key={s.month}>
                            {visible.map((p, j) => {
                                const h = y(p.value);
                                const yTop = top + plotH - acc - h;
                                acc += h;
                                const isTop = j === visible.length - 1;
                                // 2px surface gap between stacked fills; 4px rounded data-end on top only.
                                const gap = j > 0 ? 2 : 0;
                                const hh = Math.max(h - gap, 0.5);
                                return isTop ? (
                                    <path key={p.key}
                                        d={`M${cx - barW / 2},${yTop + hh} V${yTop + Math.min(4, hh)} Q${cx - barW / 2},${yTop} ${cx - barW / 2 + 4},${yTop} H${cx + barW / 2 - 4} Q${cx + barW / 2},${yTop} ${cx + barW / 2},${yTop + Math.min(4, hh)} V${yTop + hh} Z`}
                                        fill={CAT[p.key].hue} opacity={hover === null || hover === i ? 1 : 0.45} />
                                ) : (
                                    <rect key={p.key} x={cx - barW / 2} y={yTop} width={barW} height={hh}
                                        fill={CAT[p.key].hue} opacity={hover === null || hover === i ? 1 : 0.45} />
                                );
                            })}
                            {s.total > 0 && (
                                <text x={cx} y={top + plotH - y(s.total) - 6} textAnchor="middle"
                                    className="fill-muted-foreground" style={{ fontSize: 11 }}>
                                    {formatCompact(s.total, currency)}
                                </text>
                            )}
                            <text x={cx} y={H - 8} textAnchor="middle"
                                className={isSel ? 'fill-foreground' : 'fill-muted-foreground'}
                                style={{ fontSize: 12, fontWeight: isSel ? 600 : 400 }}>
                                {monthLabel(s.month, 'short')}
                            </text>
                            {isSel && <rect x={cx - 10} y={H - 3} width={20} height={2} rx={1} fill="hsl(var(--foreground))" />}
                            {/* hit target: the whole column */}
                            <rect x={left + slot * i} y={0} width={slot} height={H} fill="transparent"
                                className="cursor-pointer"
                                onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
                                onClick={() => onSelect(s.month)}>
                                <title>{monthLabel(s.month)}</title>
                            </rect>
                        </g>
                    );
                })}
            </svg>
            {hover !== null && (
                <div
                    className="pointer-events-none absolute top-0 z-10 min-w-[200px] whitespace-nowrap rounded-xl border border-border bg-card px-3 py-2.5 shadow-lg"
                    style={{
                        left: `${((left + slot * hover + slot / 2) / W) * 100}%`,
                        transform: `translateX(${hover >= months.length - 2 ? '-100%' : hover <= 1 ? '0' : '-50%'})`,
                    }}
                >
                    <div className="text-body font-semibold text-foreground mb-1.5">{monthLabel(stacks[hover].month)}</div>
                    {stacks[hover].parts.filter((p) => p.value > 0).reverse().map((p) => (
                        <div key={p.key} className="flex items-center justify-between gap-4 text-meta">
                            <span className="flex items-center gap-2 text-muted-foreground">
                                <span className="h-2 w-2 rounded-sm" style={{ background: CAT[p.key].hue }} />
                                {CAT[p.key].label}
                            </span>
                            <span className="text-foreground tabular-nums">{formatMoney(p.value, currency)}</span>
                        </div>
                    ))}
                    {stacks[hover].total === 0 && <div className="text-meta text-muted-foreground">Nothing recorded</div>}
                    {stacks[hover].total > 0 && (
                        <div className="mt-1.5 pt-1.5 border-t border-border flex justify-between text-meta font-semibold text-foreground tabular-nums">
                            <span>Total</span><span>{formatMoney(stacks[hover].total, currency)}</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// ---------------------------------------------------------------------------
const OwnerTag: React.FC<{ name: string | null }> = ({ name }) =>
    name ? (
        <span className="inline-flex items-center gap-1.5 text-body text-foreground whitespace-nowrap">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-secondary text-[10px] font-semibold text-foreground">
                {initials(name)}
            </span>
            {name.split(/\s+/)[0]}
        </span>
    ) : (
        <span className="inline-flex items-center rounded-full border border-dashed border-dark-700 px-2 py-0.5 text-meta text-muted-foreground">
            Joint
        </span>
    );

// ---------------------------------------------------------------------------
const AccountManagementPage: React.FC = () => {
    // null = still asking the server whether this login is a partner.
    const [allowed, setAllowed] = useState<boolean | null>(null);
    const myEmail = (useAuthStore((st) => st.user?.email) || '').toLowerCase();
    const [people, setPeople] = useState<AccountPerson[]>([]);

    const [entries, setEntries] = useState<AccountEntry[]>([]);
    const [totals, setTotals] = useState<AccountTotal[]>([]);
    const [trend, setTrend] = useState<AccountMonthTotal[]>([]);
    const [loading, setLoading] = useState(true);

    const [category, setCategory] = useState<AccountCategory | 'all'>('all');
    // 'all' | JOINT | a partner's email.
    const [owner, setOwner] = useState<string>('all');
    // The period: a month, a financial year, or all time.
    const [mode, setMode] = useState<'month' | 'fy' | 'all'>('month');
    const [month, setMonthState] = useState<string>(currentMonth());
    const [fy, setFy] = useState<number>(currentFy());
    // Opening a month (chart click, arrows) always switches to month view.
    const setMonth = (m: string) => { setMonthState(m); setMode('month'); };
    const [currency, setCurrency] = useState<AccountCurrency>('INR');
    const [searchText, setSearchText] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    const [editing, setEditing] = useState<AccountEntry | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const [form, setForm] = useState<AccountEntryInput>(emptyForm());
    const [saving, setSaving] = useState(false);
    const [deleting, setDeleting] = useState<AccountEntry | null>(null);
    // Attachments in the dialog: already saved, and picked but not yet uploaded.
    const [savedFiles, setSavedFiles] = useState<AccountFile[]>([]);
    const [staged, setStaged] = useState<{ file: File; preview: string | null }[]>([]);
    const [dragOver, setDragOver] = useState(false);
    // Once taxable/GST is typed by hand, stop recalculating it from the amount.
    const [gstManual, setGstManual] = useState(false);
    const [gstOnly, setGstOnly] = useState(false);
    // The everyday fields are always shown; bank transfer, GST and notes open
    // on demand, or by themselves when an entry being edited has any of them.
    const [more, setMore] = useState(false);
    // "Saved X. Next one:" after Save and add another.
    const [savedNote, setSavedNote] = useState<string | null>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const amountRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        accountsApi.access()
            .then((a) => { setAllowed(a.allowed); setPeople(a.people); })
            .catch(() => setAllowed(false));
    }, []);

    const ownerName = useCallback((email: string | null) => {
        if (!email) return null;
        return people.find((p) => p.email === email)?.name || email;
    }, [people]);

    // Month view: the six months ending at that month. FY view: its twelve
    // months. All time: the last six months.
    const anchor = mode === 'month' ? month : currentMonth();
    const trendMonths = useMemo(
        () => mode === 'fy'
            ? fyMonths(fy)
            : Array.from({ length: TREND_MONTHS }, (_, i) => shiftMonth(anchor, i - TREND_MONTHS + 1)),
        [mode, fy, anchor],
    );
    const range = mode === 'month' ? monthRange(month) : mode === 'fy' ? fyRange(fy) : {};
    const rangeKey = JSON.stringify(range);

    const fetchAll = useCallback(async () => {
        if (!allowed) return;
        setLoading(true);
        const ownerParam = owner === 'all' ? undefined : owner;
        try {
            const [list, monthly] = await Promise.all([
                accountsApi.list({
                    category: category === 'all' ? undefined : category,
                    owner: ownerParam,
                    search: searchQuery || undefined,
                    gst_only: gstOnly || undefined,
                    ...range,
                }),
                accountsApi.monthly({
                    date_from: `${trendMonths[0]}-01`,
                    date_to: monthRange(trendMonths[trendMonths.length - 1]).date_to,
                    owner: ownerParam,
                }),
            ]);
            setEntries(list.entries);
            setTotals(list.totals);
            setTrend(monthly.months);
        } catch (error) {
            toast.error('Could not load the ledger. Check your connection and refresh.');
        } finally {
            setLoading(false);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [allowed, category, owner, rangeKey, searchQuery, gstOnly, trendMonths]);

    useEffect(() => {
        fetchAll();
    }, [fetchAll]);

    // Only offer the currencies that actually have money in them.
    const presentCurrencies = useMemo(() => {
        const set = new Set<AccountCurrency>([...totals.map((t) => t.currency), ...trend.map((t) => t.currency)]);
        return CURRENCIES.filter((c) => set.has(c));
    }, [totals, trend]);
    const shownCurrency: AccountCurrency =
        presentCurrencies.includes(currency) || presentCurrencies.length === 0 ? currency : presentCurrencies[0];
    const otherCurrency = presentCurrencies.find((c) => c !== shownCurrency);

    // The overview follows the owner filter (so "Rahul" shows Rahul's month) but
    // not the category filter — the split bar is how you pick a category.
    const ownerTotals = useMemo(() => totals.filter((t) =>
        owner === 'all' ? true : owner === JOINT ? !t.owner_email : t.owner_email === owner,
    ), [totals, owner]);

    const inCurrency = (rows: AccountTotal[], cur: AccountCurrency) =>
        rows.filter((t) => t.currency === cur).reduce((n, t) => n + Number(t.total), 0);

    const periodTotal = inCurrency(ownerTotals, shownCurrency);
    const otherTotal = otherCurrency ? inCurrency(ownerTotals, otherCurrency) : 0;

    const categorySplit = CATEGORIES.map((c) => ({
        ...c,
        value: inCurrency(ownerTotals.filter((t) => t.category === c.key), shownCurrency),
        count: ownerTotals.filter((t) => t.category === c.key).reduce((n, t) => n + t.count, 0),
    }));

    const ownerSplit = [
        { key: JOINT, name: 'Joint', value: inCurrency(totals.filter((t) => !t.owner_email), shownCurrency) },
        ...people.map((p) => ({ key: p.email, name: p.name, value: inCurrency(totals.filter((t) => t.owner_email === p.email), shownCurrency) })),
    ];
    const ownerMax = Math.max(...ownerSplit.map((o) => o.value), 0);

    // Month-on-month change, from the trend data (same owner filter, same currency).
    const monthTotal = (m: string) => trend
        .filter((t) => t.month === m && t.currency === shownCurrency)
        .reduce((n, t) => n + Number(t.total), 0);
    const prevMonth = mode === 'month' ? shiftMonth(month, -1) : null;
    const prevTotal = prevMonth ? monthTotal(prevMonth) : 0;
    const change = prevMonth && prevTotal > 0 ? ((monthTotal(month) - prevTotal) / prevTotal) * 100 : null;

    // Ledger grouped by day, newest first (the API already orders it).
    const days = useMemo(() => {
        const groups: { date: string; rows: AccountEntry[] }[] = [];
        entries.forEach((e) => {
            const last = groups[groups.length - 1];
            if (last && last.date === e.entry_date) last.rows.push(e);
            else groups.push({ date: e.entry_date, rows: [e] });
        });
        return groups;
    }, [entries]);

    const shownTotals = useMemo(() => sumByCurrency(entries, (e) => e.amount), [entries]);

    const resetFiles = (files: AccountFile[] = []) => {
        staged.forEach((s) => s.preview && URL.revokeObjectURL(s.preview));
        setStaged([]);
        setSavedFiles(files);
        setGstManual(false);
    };

    const stageFiles = (list: FileList | File[] | null) => {
        if (!list) return;
        const next: { file: File; preview: string | null }[] = [];
        Array.from(list).forEach((f) => {
            if (!ACCEPT_EXT.includes(extOf(f.name))) {
                toast.error(`${f.name}: attach an image (JPG, PNG, WEBP, HEIC) or a PDF`);
            } else if (f.size > MAX_FILE_BYTES) {
                toast.error(`${f.name} is bigger than 10 MB`);
            } else {
                next.push({ file: f, preview: isImage(f.name) ? URL.createObjectURL(f) : null });
            }
        });
        setStaged((s) => [...s, ...next]);
    };

    const removeSaved = async (f: AccountFile) => {
        try {
            await accountsApi.deleteFile(f.entry_id, f.id);
            setSavedFiles((list) => list.filter((x) => x.id !== f.id));
            fetchAll();
        } catch {
            toast.error('Could not remove the file');
        }
    };

    // Recalculate taxable value and GST from the amount and rate, unless typed by hand.
    const updateForm = (patch: Partial<AccountEntryInput>) => {
        setForm((f) => {
            const next = { ...f, ...patch };
            if (next.gst_applicable && !gstManual && ('amount' in patch || 'gst_rate' in patch || 'gst_applicable' in patch)) {
                const split = splitGst(next.amount, next.gst_rate || '0');
                if (split) { next.taxable_value = split.taxable; next.gst_amount = split.gst; }
            }
            return next;
        });
    };

    const openCreate = () => {
        setEditing(null);
        resetFiles();
        setMore(false);
        setSavedNote(null);
        // Last time's choices, then whatever the filters are showing.
        const last = lastUsed(people);
        const next: AccountEntryInput = {
            ...emptyForm(),
            currency: shownCurrency,
            ...last,
            // Adding while looking at a past month dates the entry in that month.
            entry_date: mode === 'month' && month !== currentMonth() ? `${month}-01` : todayIso(),
        };
        if (category !== 'all') next.category = category;
        if (owner !== 'all') next.owner_email = owner === JOINT ? null : owner;
        if (CAT[next.category].perPerson && !next.owner_email) {
            next.owner_email = people.find((p) => p.email === myEmail)?.email ?? people[0]?.email ?? null;
        }
        setForm(next);
        setFormOpen(true);
    };

    const openEdit = (entry: AccountEntry) => {
        setEditing(entry);
        setForm({
            entry_date: entry.entry_date,
            category: entry.category,
            party: entry.party || '',
            description: entry.description,
            amount: entry.amount,
            currency: entry.currency,
            payment_method: entry.payment_method,
            owner_email: entry.owner_email,
            notes: entry.notes || '',
            paid_from: entry.paid_from || '',
            reference_no: entry.reference_no || '',
            payee_account: entry.payee_account || '',
            bank_narration: entry.bank_narration || '',
            gst_applicable: entry.gst_applicable,
            vendor_gstin: entry.vendor_gstin || '',
            invoice_no: entry.invoice_no || '',
            invoice_date: entry.invoice_date || '',
            gst_rate: entry.gst_rate != null ? String(Number(entry.gst_rate)) : '18',
            taxable_value: entry.taxable_value || '',
            gst_amount: entry.gst_amount || '',
            salary_month: entry.salary_month ? entry.salary_month.slice(0, 7) : '',
        });
        resetFiles(entry.files);
        // A saved GST split is the invoice's — don't overwrite it.
        setGstManual(entry.gst_applicable);
        setSavedNote(null);
        setMore(Boolean(
            (entry.category === 'personal' && entry.party) || entry.notes || entry.gst_applicable || entry.paid_from || entry.reference_no
            || entry.payee_account || entry.bank_narration
            // A salary paid in a later month than it is for.
            || (entry.salary_month && entry.salary_month.slice(0, 7) !== entry.entry_date.slice(0, 7)),
        ));
        setFormOpen(true);
    };

    // Salary and personal can't be joint: switching to one picks the signed-in
    // partner (or the first) when the entry was joint.
    const pickCategory = (category: AccountCategory) => {
        const owner = CAT[category].perPerson && !form.owner_email
            ? (people.find((p) => p.email === myEmail)?.email ?? people[0]?.email ?? null)
            : form.owner_email;
        setForm({ ...form, category, owner_email: owner });
    };

    const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        // "Save and add another" keeps the dialog open for the next entry.
        const another = !editing && (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value') === 'another';
        setSavedNote(null);
        const amount = Number(form.amount);
        if (CAT[form.category].perPerson && !form.owner_email) {
            toast.error(`${form.category === 'salary' ? 'A salary' : 'A personal expense'} belongs to one person. Pick whose it is.`);
            return;
        }
        if (!form.description.trim()) {
            toast.error('Add a description so you can find this entry later');
            return;
        }
        if (!Number.isFinite(amount) || amount < 0) {
            toast.error('Enter the amount as a positive number');
            return;
        }
        const txt = (v: string | null | undefined) => (v ?? '').trim() || null;
        const num = (v: string | null | undefined) => {
            const t = (v ?? '').trim();
            return t === '' || !Number.isFinite(Number(t)) ? null : Number(t).toFixed(2);
        };
        const gst = form.gst_applicable;
        const payload: AccountEntryInput = {
            ...form,
            description: form.description.trim(),
            amount: amount.toFixed(2),
            notes: txt(form.notes),
            paid_from: txt(form.paid_from),
            reference_no: txt(form.reference_no),
            payee_account: txt(form.payee_account),
            bank_narration: txt(form.bank_narration),
            // GST fields are cleared when the entry isn't a GST invoice.
            vendor_gstin: gst ? txt(form.vendor_gstin) : null,
            invoice_no: gst ? txt(form.invoice_no) : null,
            invoice_date: gst ? txt(form.invoice_date) : null,
            gst_rate: gst ? num(form.gst_rate) : null,
            taxable_value: gst ? num(form.taxable_value) : null,
            gst_amount: gst ? num(form.gst_amount) : null,
            // Salaries: the month it is for (blank = the pay date's month, server-side).
            salary_month: form.category === 'salary' && form.salary_month ? `${form.salary_month.slice(0, 7)}-01` : null,
            party: form.category === 'salary' ? (ownerName(form.owner_email) || null) : txt(form.party),
        };
        setSaving(true);
        try {
            const saved = editing
                ? await accountsApi.update(editing.id, payload)
                : await accountsApi.create(payload);

            // Files go up after the entry exists (a new entry has no id until now).
            const failed: { file: File; preview: string | null }[] = [];
            const uploaded: AccountFile[] = [];
            for (const s of staged) {
                try {
                    uploaded.push((await accountsApi.uploadFile(saved.id, s.file)).file);
                } catch (err: any) {
                    failed.push(s);
                    toast.error(`${s.file.name}: ${err?.response?.data?.detail || 'upload failed'}`);
                }
            }
            fetchAll();
            if (failed.length) {
                // The entry IS saved — stay open on it in edit mode so a retry
                // uploads the remaining files instead of creating a duplicate.
                setEditing(saved);
                setSavedFiles([...saved.files, ...uploaded]);
                staged.filter((s) => !failed.includes(s)).forEach((s) => s.preview && URL.revokeObjectURL(s.preview));
                setStaged(failed);
                toast.error('Entry saved, but some files did not upload. Fix them and save again.');
                return;
            }
            if (!editing) rememberEntry(form);
            if (another) {
                // Keep the date, category, whose, method and currency; clear what's specific.
                resetFiles();
                setForm({
                    ...emptyForm(),
                    entry_date: form.entry_date, category: form.category, owner_email: form.owner_email,
                    payment_method: form.payment_method, currency: form.currency,
                });
                setSavedNote(`Saved "${payload.description}". Next one:`);
                amountRef.current?.focus();
                return;
            }
            toast.success(editing ? 'Changes saved' : 'Entry added');
            resetFiles();
            setFormOpen(false);
        } catch (error: any) {
            const detail = error?.response?.data?.detail;
            toast.error(Array.isArray(detail) ? detail[0]?.msg : detail || 'Could not save the entry');
        } finally {
            setSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!deleting) return;
        try {
            await accountsApi.remove(deleting.id);
            toast.success('Entry deleted');
            setDeleting(null);
            fetchAll();
        } catch (error) {
            toast.error('Could not delete the entry');
        }
    };

    const exportCsv = () => {
        const esc = (v: string | null | undefined) => `"${(v ?? '').replace(/"/g, '""')}"`;
        const lines = [
            [
                'Date', 'Category', 'Whose', 'Description', 'Paid to', 'Method', 'Amount', 'Currency',
                'Paid from', 'Reference / UTR', 'Payee account / UPI', 'Bank narration',
                'GST invoice', 'Vendor GSTIN', 'Invoice no', 'Invoice date', 'GST rate %', 'Taxable value', 'GST amount',
                'Attachments', 'Notes', 'Added by', 'Salary for',
            ].join(','),
            // Oldest first — the order a CA reads a ledger in.
            ...[...entries].reverse().map((e) => [
                e.entry_date, esc(CAT[e.category].label), esc(ownerName(e.owner_email) || 'Joint'),
                esc(e.description), esc(e.party), esc(e.payment_method), e.amount, e.currency,
                esc(e.paid_from), esc(e.reference_no), esc(e.payee_account), esc(e.bank_narration),
                e.gst_applicable ? 'Yes' : 'No', esc(e.vendor_gstin), esc(e.invoice_no), e.invoice_date ?? '',
                e.gst_rate ?? '', e.taxable_value ?? '', e.gst_amount ?? '',
                esc(e.files.map((f) => f.name).join('; ')), esc(e.notes), esc(e.created_by_name),
                e.salary_month ? monthLabel(e.salary_month.slice(0, 7)) : '',
            ].join(',')),
            '',
            // Totals block, per category and currency, so the file stands on its own.
            ['Total', 'Category', '', '', '', '', 'Amount', 'Currency', '', '', '', '', '', '', '', '', '', 'Taxable value', 'GST amount'].join(','),
            ...CATEGORIES.flatMap((c) => {
                const rows = entries.filter((e) => e.category === c.key);
                return Object.entries(sumByCurrency(rows, (e) => e.amount)).map(([cur, v]) => {
                    const inCur = rows.filter((e) => e.currency === cur);
                    const tax = inCur.reduce((n, e) => n + Number(e.taxable_value || 0), 0);
                    const g = inCur.reduce((n, e) => n + Number(e.gst_amount || 0), 0);
                    return ['', esc(c.label), '', '', '', '', v.toFixed(2), cur, '', '', '', '', '', '', '', '', '', tax.toFixed(2), g.toFixed(2)].join(',');
                });
            }),
            ...Object.entries(shownTotals).map(([cur, v]) => [esc('All categories'), '', '', '', '', '', v.toFixed(2), cur].join(',')),
        ];
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const who = owner === 'all' ? 'everyone' : owner === JOINT ? 'joint' : (ownerName(owner) || 'owner').split(/\s+/)[0].toLowerCase();
        const when = mode === 'fy' ? `FY${fy}-${pad((fy + 1) % 100)}` : mode === 'month' ? month : 'all-time';
        a.download = `accounts-${when}-${who}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (allowed === false) return <Navigate to="/" replace />;
    if (allowed === null) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const periodLabel = mode === 'month' ? monthLabel(month) : mode === 'fy' ? fyLabel(fy) : 'All time';
    const step = (delta: number) => (mode === 'fy' ? setFy(fy + delta) : setMonth(shiftMonth(anchor, delta)));
    const atLatest = mode === 'fy' ? fy >= currentFy() : anchor >= currentMonth();
    const filtersActive = category !== 'all' || owner !== 'all' || !!searchQuery || gstOnly;
    const missingRef = entries.filter((e) => !e.reference_no && !e.bank_narration).length;

    return (
        <div className="w-full space-y-5 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                    <h1 className="text-display font-medium leading-tight text-foreground mb-1">Account Management</h1>
                    <p className="text-muted-foreground">Salaries, company spending by head, assets and personal expenses.</p>
                </div>
                <div className="flex gap-2 self-start md:self-auto">
                    <Button variant="ghost" size="inline" onClick={exportCsv} disabled={entries.length === 0}
                        className="flex items-center gap-2 border border-dark-800 hover:border-primary-500/40 text-muted-foreground hover:text-foreground rounded-xl py-2.5 px-4 text-body font-semibold disabled:opacity-40">
                        <Download size={16} /> Export CSV
                    </Button>
                    <Button onClick={openCreate} className="rounded-xl px-4 py-2.5 font-bold">
                        <Plus size={18} /> Add entry
                    </Button>
                </div>
            </div>

            {/* Overview: the month, what it cost, and where it went */}
            <section className="rounded-3xl border border-dark-800 bg-background overflow-hidden">
                <div className="grid lg:grid-cols-[1fr_1fr] 2xl:grid-cols-[1fr_1.4fr]">
                    <div className="p-5 sm:p-7 lg:border-r border-dark-800">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex flex-wrap items-center gap-3">
                                <Segmented aria-label="Period" value={mode} onChange={setMode}
                                    options={[
                                        { value: 'month', label: 'Month' },
                                        { value: 'fy', label: 'Financial year', title: 'April to March, the period your CA files on' },
                                        { value: 'all', label: 'All time' },
                                    ]} />
                                {mode !== 'all' && (
                                    <div className="flex items-center gap-1">
                                        <Button variant="ghost" size="inline" aria-label={mode === 'fy' ? 'Previous financial year' : 'Previous month'}
                                            onClick={() => step(-1)}
                                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent">
                                            <ChevronLeft size={18} />
                                        </Button>
                                        <span className="min-w-[140px] text-center text-title font-semibold text-foreground">{periodLabel}</span>
                                        <Button variant="ghost" size="inline" aria-label={mode === 'fy' ? 'Next financial year' : 'Next month'}
                                            onClick={() => step(1)} disabled={atLatest}
                                            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-30">
                                            <ChevronRight size={18} />
                                        </Button>
                                    </div>
                                )}
                            </div>
                            {presentCurrencies.length > 1 && (
                                <Segmented aria-label="Show amounts in" value={shownCurrency} onChange={setCurrency}
                                    options={CURRENCIES.map((c) => ({ value: c, label: c }))} />
                            )}
                        </div>

                        <div className="mt-6">
                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                                <span className="text-[2.75rem] leading-none font-semibold tracking-tight text-foreground tabular-nums">
                                    {formatMoney(periodTotal, shownCurrency)}
                                </span>
                                {change !== null && (
                                    <span className="text-meta text-muted-foreground tabular-nums">
                                        {change >= 0 ? '▲' : '▼'} {Math.abs(change).toFixed(0)}% vs {monthLabel(prevMonth!, 'short')}
                                    </span>
                                )}
                            </div>
                            <p className="mt-2 text-meta text-muted-foreground">
                                {owner === 'all' ? 'Spent in total' : owner === JOINT ? 'Spent jointly' : `Spent by ${ownerName(owner)}`}
                                {otherCurrency && otherTotal > 0 && <>, plus {formatMoney(otherTotal, otherCurrency)} in {otherCurrency}</>}
                            </p>
                        </div>

                        {/* Category split: one bar, 2px gaps, every segment also named below */}
                        <div className="mt-6">
                            <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded-full bg-secondary/60">
                                {periodTotal > 0 && categorySplit.filter((c) => c.value > 0).map((c) => (
                                    <div key={c.key} title={`${c.label}: ${formatMoney(c.value, shownCurrency)}`}
                                        className="h-full transition-opacity"
                                        style={{
                                            width: `${(c.value / periodTotal) * 100}%`,
                                            background: c.hue,
                                            opacity: category === 'all' || category === c.key ? 1 : 0.3,
                                        }} />
                                ))}
                            </div>
                            {/* Ten heads: only the ones with entries this period (and the one being filtered on). */}
                            <div className="mt-4 grid grid-cols-2 gap-2">
                                {categorySplit.filter((c) => c.count > 0 || category === c.key).length === 0 && (
                                    <p className="col-span-2 text-meta text-muted-foreground">Nothing recorded for this period.</p>
                                )}
                                {categorySplit.filter((c) => c.count > 0 || category === c.key).map((c) => {
                                    const Icon = c.icon;
                                    const active = category === c.key;
                                    return (
                                        <button key={c.key} type="button" aria-pressed={active}
                                            onClick={() => setCategory(active ? 'all' : c.key)}
                                            className={`flex items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'border-primary-500/40 bg-accent' : 'border-transparent hover:bg-accent/60'} ${category !== 'all' && !active ? 'opacity-50' : ''}`}>
                                            <span className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: c.hue }} />
                                            <span className="min-w-0">
                                                <span className="flex items-center gap-1.5 text-meta text-muted-foreground">
                                                    <Icon size={13} /> {c.label}
                                                </span>
                                                <span className="block text-body font-semibold text-foreground tabular-nums">
                                                    {formatMoney(c.value, shownCurrency)}
                                                </span>
                                                <span className="block text-[11px] text-muted-foreground">
                                                    {periodTotal > 0 ? `${((c.value / periodTotal) * 100).toFixed(0)}%` : '0%'}, {c.count} {c.count === 1 ? 'entry' : 'entries'}
                                                </span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    <div className="p-5 sm:p-7 border-t lg:border-t-0 border-dark-800 flex flex-col">
                        <h2 className="text-body font-semibold text-foreground">
                            {mode === 'fy' ? `${fyLabel(fy)}, month by month` : `Last ${TREND_MONTHS} months`}
                        </h2>
                        <p className="text-meta text-muted-foreground mb-3">In {shownCurrency}. Click a month to open it.</p>
                        <TrendChart months={trendMonths} data={trend} currency={shownCurrency}
                            selected={mode === 'month' ? month : ''} onSelect={setMonth} />

                        <h2 className="mt-6 text-body font-semibold text-foreground">Who spent it</h2>
                        <p className="text-meta text-muted-foreground mb-3">{periodLabel}, all categories. Click to filter.</p>
                        <div className="space-y-2">
                            {ownerSplit.map((o) => {
                                const active = owner === o.key;
                                return (
                                    <button key={o.key} type="button" aria-pressed={active}
                                        onClick={() => setOwner(active ? 'all' : o.key)}
                                        className={`w-full grid grid-cols-[110px_1fr_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${active ? 'bg-accent' : 'hover:bg-accent/60'} ${owner !== 'all' && !active ? 'opacity-50' : ''}`}>
                                        <span className="truncate text-body text-foreground">{o.name}</span>
                                        <span className="h-2 rounded-full bg-secondary/60 overflow-hidden">
                                            <span className="block h-full rounded-full bg-foreground/70"
                                                style={{ width: ownerMax > 0 ? `${(o.value / ownerMax) * 100}%` : 0 }} />
                                        </span>
                                        <span className="text-body font-medium text-foreground tabular-nums">
                                            {formatMoney(o.value, shownCurrency)}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </section>

            {/* Filters */}
            <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center">
                <Segmented
                    aria-label="Whose"
                    value={owner}
                    onChange={setOwner}
                    options={[
                        { value: 'all', label: 'Everyone' },
                        { value: JOINT, label: 'Joint' },
                        ...people.map((p) => ({ value: p.email, label: p.name.split(/\s+/)[0] })),
                    ]}
                    className="overflow-x-auto self-start"
                />
                <form onSubmit={(e) => { e.preventDefault(); setSearchQuery(searchText); }} className="relative flex-1 min-w-[180px]">
                    <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input type="text" value={searchText} onChange={(e) => setSearchText(e.target.value)}
                        placeholder="Search description, UTR, narration, invoice no or GSTIN, then press Enter"
                        className="h-auto w-full bg-background border border-dark-800 rounded-xl py-2.5 pl-10 pr-4 text-body placeholder:text-muted-foreground" />
                </form>
                <Button variant="ghost" size="inline" aria-pressed={gstOnly} onClick={() => setGstOnly((v) => !v)}
                    className={`flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-body font-medium whitespace-nowrap ${gstOnly ? 'border-primary-500/40 bg-accent text-foreground' : 'border-dark-800 text-muted-foreground hover:text-foreground'}`}>
                    <Receipt size={15} /> GST invoices only
                </Button>
                {filtersActive && (
                    <Button variant="ghost" size="inline"
                        onClick={() => { setCategory('all'); setOwner('all'); setSearchText(''); setSearchQuery(''); setGstOnly(false); }}
                        className="flex items-center gap-1.5 rounded-xl px-3 py-2.5 text-body text-muted-foreground hover:text-foreground">
                        <X size={14} /> Clear filters
                    </Button>
                )}
                <Button variant="ghost" size="inline" onClick={() => fetchAll()} title="Refresh"
                    className="flex items-center justify-center border border-dark-800 hover:border-primary-500/40 text-muted-foreground hover:text-foreground rounded-xl py-2.5 px-3.5">
                    <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
                </Button>
            </div>

            {/* Ledger, grouped by day */}
            <section className="rounded-3xl border border-dark-800 bg-background overflow-hidden">
                {days.map((day) => {
                    const dayTotals = sumByCurrency(day.rows, (r) => r.amount);
                    return (
                        <div key={day.date}>
                            <div className="flex items-center justify-between px-5 sm:px-6 py-2 bg-card border-b border-dark-800 text-meta">
                                <span className="font-semibold text-foreground">{dayLabel(day.date)}</span>
                                <span className="text-muted-foreground tabular-nums">{joinMoney(dayTotals)}</span>
                            </div>
                            <ul className="divide-y divide-dark-800/60 border-b border-dark-800">
                                {day.rows.map((entry) => {
                                    const c = CAT[entry.category];
                                    const Icon = c.icon;
                                    return (
                                        <li key={entry.id}
                                            className="group grid grid-cols-[auto_1fr_auto] md:grid-cols-[auto_minmax(0,1fr)_130px_auto_auto] items-center gap-x-4 gap-y-1 px-5 sm:px-6 py-3.5 hover:bg-dark-800/20">
                                            <span className={`grid h-9 w-9 place-items-center rounded-xl border ${c.chip}`} title={c.label}>
                                                <Icon size={16} />
                                            </span>
                                            <div className="min-w-0">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <span className="truncate text-body font-semibold text-foreground">{entry.description}</span>
                                                    {entry.gst_applicable && (
                                                        <span className="shrink-0 rounded-md border border-dark-700 px-1.5 py-px text-[10px] font-semibold text-muted-foreground"
                                                            title={[entry.vendor_gstin, entry.invoice_no && `Invoice ${entry.invoice_no}`, entry.gst_amount && `GST ${formatMoney(entry.gst_amount, entry.currency)}`].filter(Boolean).join(', ')}>
                                                            GST
                                                        </span>
                                                    )}
                                                    {entry.files.length > 0 && (
                                                        <button type="button" onClick={() => openEdit(entry)}
                                                            className="shrink-0 inline-flex items-center gap-0.5 text-meta text-muted-foreground hover:text-foreground"
                                                            title={entry.files.map((f) => f.name).join('\n')}
                                                            aria-label={`${entry.files.length} attachment${entry.files.length === 1 ? '' : 's'}`}>
                                                            <Paperclip size={13} />{entry.files.length}
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="truncate text-meta text-muted-foreground">
                                                    {c.short}
                                                    {entry.party && <> to {entry.party}</>}
                                                    {entry.payment_method && <>, {entry.payment_method}</>}
                                                    {entry.paid_from && <> from {entry.paid_from}</>}
                                                    {entry.reference_no && <span className="text-foreground/70">. Ref {entry.reference_no}</span>}
                                                    {entry.notes && <span title={entry.notes}>. {entry.notes}</span>}
                                                </div>
                                            </div>
                                            <div className="hidden md:block"><OwnerTag name={ownerName(entry.owner_email)} /></div>
                                            <div className="text-right">
                                                <div className="text-body font-semibold text-foreground tabular-nums whitespace-nowrap">
                                                    {formatMoney(entry.amount, entry.currency)}
                                                </div>
                                                <div className="md:hidden mt-0.5"><OwnerTag name={ownerName(entry.owner_email)} /></div>
                                            </div>
                                            <div className="col-span-3 md:col-span-1 flex justify-end gap-1 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity">
                                                <Button variant="ghost" size="inline" onClick={() => openEdit(entry)}
                                                    aria-label={`Edit ${entry.description}`}
                                                    className="p-2 rounded-lg text-muted-foreground hover:text-foreground">
                                                    <Pencil size={15} />
                                                </Button>
                                                <Button variant="ghost" size="inline" onClick={() => setDeleting(entry)}
                                                    aria-label={`Delete ${entry.description}`}
                                                    className="p-2 rounded-lg text-muted-foreground hover:text-danger-400">
                                                    <Trash2 size={15} />
                                                </Button>
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    );
                })}

                {!loading && entries.length === 0 && (
                    <div className="py-16 px-6 text-center">
                        <Wallet size={40} className="mx-auto text-dark-700 mb-4" />
                        <p className="text-foreground font-medium">
                            {filtersActive ? 'Nothing matches these filters.' : `Nothing recorded for ${periodLabel.toLowerCase() === 'all time' ? 'any period' : periodLabel} yet.`}
                        </p>
                        <p className="text-muted-foreground text-meta mt-1 mb-5">
                            {filtersActive ? 'Clear the filters or pick another period.' : 'Add a salary, a bill, an asset or a personal expense to start the ledger.'}
                        </p>
                        {!filtersActive && (
                            <Button onClick={openCreate} className="rounded-xl px-4 font-bold"><Plus size={16} /> Add entry</Button>
                        )}
                    </div>
                )}
                {loading && entries.length === 0 && (
                    <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                )}

                {entries.length > 0 && (
                    <div className="flex flex-wrap items-center justify-between gap-2 px-5 sm:px-6 py-4 bg-card">
                        <span className="text-muted-foreground text-meta">
                            {missingRef > 0 && <span className="text-warning-400">{missingRef} without a reference or narration. </span>}
                            {entries.length} {entries.length === 1 ? 'entry' : 'entries'} in {periodLabel.toLowerCase() === 'all time' ? 'all time' : periodLabel}
                        </span>
                        <span className="text-foreground text-body font-semibold tabular-nums">Total {joinMoney(shownTotals)}</span>
                    </div>
                )}
            </section>

            {/* Add / edit — laid out like the Kavas Consultancy entry form:
                amount and what it was for first, tap-to-pick choices, the
                bank/GST/notes detail folded under "More details". */}
            <Dialog open={formOpen} onOpenChange={(o) => { if (!o) resetFiles(); setFormOpen(o); }}>
                <DialogContent className="max-w-2xl max-h-[92vh] overflow-y-auto rounded-2xl">
                    <DialogHeader>
                        <DialogTitle>{editing ? 'Edit entry' : 'New entry'}</DialogTitle>
                        <DialogDescription>Amount, what it was for, and its head. The rest is optional.</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleSave} className="space-y-5"
                        // Paste a screenshot straight into the dialog.
                        onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); stageFiles(e.clipboardData.files); } }}>
                        {savedNote && (
                            <p role="status" className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2 text-meta text-emerald-500">
                                {savedNote}
                            </p>
                        )}

                        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,15rem)_1fr] gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="amount" className="ml-1">Amount</Label>
                                <div className="flex items-stretch">
                                    <select aria-label="Currency" value={form.currency}
                                        onChange={(e) => setForm({ ...form, currency: e.target.value as AccountCurrency })}
                                        className="rounded-l-xl border border-r-0 border-dark-700/60 bg-background px-2.5 text-meta font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                        {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <Input id="amount" ref={amountRef} type="number" required min="0" step="0.01" inputMode="decimal"
                                        autoFocus={!editing}
                                        value={form.amount} onChange={(e) => updateForm({ amount: e.target.value })}
                                        className="h-auto flex-1 rounded-l-none bg-background border-dark-700/60 rounded-r-xl py-2.5 px-3.5 text-title font-semibold tabular-nums"
                                        placeholder="0" />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="description" className="ml-1">What was it for?</Label>
                                <Input id="description" required maxLength={500} value={form.description}
                                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                                    className={fieldClass}
                                    placeholder={form.category === 'salary' ? 'e.g. October salary' : 'e.g. Office internet, October'} />
                            </div>
                        </div>

                        <Choice label="Category" value={form.category} hint={CAT[form.category].hint}
                            options={CATEGORIES.map((c) => ({ value: c.key, label: c.label, icon: c.icon }))}
                            onChange={(v) => pickCategory(v as AccountCategory)} />

                        {!CAT[form.category].perPerson && (
                            <div className="space-y-2">
                                <Label htmlFor="party" className="ml-1">Paid to</Label>
                                <Input id="party" maxLength={200} value={form.party || ''} autoComplete="off"
                                    onChange={(e) => setForm({ ...form, party: e.target.value })} className={fieldClass}
                                    placeholder="Vendor, shop or service" />
                            </div>
                        )}

                        <Choice label={form.category === 'salary' ? 'Whose salary' : 'Whose'}
                            value={form.owner_email ?? JOINT}
                            onChange={(v) => setForm({ ...form, owner_email: v === JOINT ? null : v })}
                            options={[
                                ...(CAT[form.category].perPerson ? [] : [{ value: JOINT, label: 'Joint' }]),
                                ...people.map((p) => ({ value: p.email, label: p.name })),
                            ]} />

                        <div className="grid grid-cols-1 sm:grid-cols-[auto_1fr] sm:items-end gap-4">
                            <div className="space-y-2">
                                <Label htmlFor="entry_date" className="ml-1">Date paid</Label>
                                <Input id="entry_date" type="date" required value={form.entry_date}
                                    onChange={(e) => setForm({ ...form, entry_date: e.target.value })} className={fieldClass} />
                            </div>
                            <Choice label="How" value={form.payment_method || ''}
                                options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))}
                                // Tap the chosen one again to clear it.
                                onChange={(v) => setForm({ ...form, payment_method: form.payment_method === v ? null : v })} />
                        </div>

                        {/* Attachments */}
                        <div
                            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={() => setDragOver(false)}
                            onDrop={(e) => { e.preventDefault(); setDragOver(false); stageFiles(e.dataTransfer.files); }}
                            className={`rounded-xl transition-colors ${dragOver ? 'bg-accent ring-1 ring-foreground/30' : ''}`}>
                            <div className="flex flex-wrap items-center gap-3">
                                <Button type="button" variant="ghost" size="inline" onClick={() => fileInput.current?.click()}
                                    className="flex items-center gap-2 rounded-xl border border-dark-700/60 px-3.5 py-2 text-body font-medium text-foreground hover:border-foreground/40">
                                    <Upload size={15} /> Attach receipt
                                </Button>
                                <span className="text-meta text-muted-foreground">Image or PDF, up to 10 MB. You can also drop or paste it here.</span>
                                <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden"
                                    onChange={(e) => { stageFiles(e.target.files); e.target.value = ''; }} />
                            </div>
                            {(savedFiles.length > 0 || staged.length > 0) && (
                                <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {savedFiles.map((f) => <SavedFile key={f.id} file={f} onRemove={() => removeSaved(f)} />)}
                                    {staged.map((st, i) => (
                                        <FileTile key={`${st.file.name}-${i}`} name={st.file.name} meta={formatSize(st.file.size)}
                                            thumb={st.preview} pending
                                            onRemove={() => {
                                                if (st.preview) URL.revokeObjectURL(st.preview);
                                                setStaged((list) => list.filter((x) => x !== st));
                                            }} />
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* More details: bank transfer, GST invoice, notes */}
                        <div className="rounded-2xl border border-dark-800">
                            <button type="button" aria-expanded={more} onClick={() => setMore((m) => !m)}
                                className="flex w-full items-center gap-2 px-4 py-3 text-left text-body font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-2xl">
                                <ChevronDown size={16} className={`text-muted-foreground transition-transform ${more ? '' : '-rotate-90'}`} />
                                More details
                                <span className="font-normal text-muted-foreground">
                                    {form.category === 'salary' ? 'salary month, ' : form.category === 'personal' ? 'paid to, ' : ''}bank transfer, GST invoice, notes
                                </span>
                            </button>
                            {more && (
                                <div className="space-y-5 border-t border-dark-800 p-4">
                                    {form.category === 'personal' && (
                                        <div className="space-y-2">
                                            <Label htmlFor="party" className="ml-1">Paid to</Label>
                                            <Input id="party" maxLength={200} value={form.party || ''} autoComplete="off"
                                                onChange={(e) => setForm({ ...form, party: e.target.value })} className={fieldClass}
                                                placeholder="Vendor, shop or service" />
                                        </div>
                                    )}
                                    {form.category === 'salary' && (
                                        <div className="space-y-2 sm:max-w-[15rem]">
                                            <Label htmlFor="salary_month" className="ml-1">Salary for month</Label>
                                            <Input id="salary_month" type="month" value={form.salary_month || form.entry_date.slice(0, 7)}
                                                onChange={(e) => setForm({ ...form, salary_month: e.target.value })} className={fieldClass} />
                                        </div>
                                    )}

                                    <div className="space-y-3">
                                        <p className="text-body font-semibold text-foreground">
                                            Bank transfer <span className="font-normal text-muted-foreground">, what the statement shows, so the CA can match it</span>
                                        </p>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div className="space-y-2">
                                                <Label htmlFor="paid_from" className="ml-1">Paid from</Label>
                                                <Input id="paid_from" maxLength={120} value={form.paid_from || ''}
                                                    onChange={(e) => setForm({ ...form, paid_from: e.target.value })}
                                                    className={fieldClass} placeholder="e.g. HDFC current ••4521" />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="reference_no" className="ml-1">Reference / UTR</Label>
                                                <Input id="reference_no" maxLength={120} value={form.reference_no || ''}
                                                    onChange={(e) => setForm({ ...form, reference_no: e.target.value })}
                                                    className={`${fieldClass} font-mono`} placeholder="e.g. 428193756102" />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="payee_account" className="ml-1">Payee account / UPI ID</Label>
                                                <Input id="payee_account" maxLength={200} value={form.payee_account || ''}
                                                    onChange={(e) => setForm({ ...form, payee_account: e.target.value })}
                                                    className={fieldClass} placeholder="e.g. vendor@okhdfcbank" />
                                            </div>
                                            <div className="space-y-2">
                                                <Label htmlFor="bank_narration" className="ml-1">Bank narration</Label>
                                                <Input id="bank_narration" maxLength={2000} value={form.bank_narration || ''}
                                                    onChange={(e) => setForm({ ...form, bank_narration: e.target.value })}
                                                    className={`${fieldClass} font-mono text-meta`} placeholder="Paste the statement line as is" />
                                            </div>
                                        </div>
                                    </div>

                                    <div className="space-y-3">
                                        <label className="flex items-center gap-2.5 cursor-pointer text-body font-semibold text-foreground">
                                            <Switch checked={form.gst_applicable} onCheckedChange={(v) => updateForm({ gst_applicable: v })} />
                                            GST invoice
                                        </label>
                                        {form.gst_applicable && (
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                                <div className="space-y-2">
                                                    <Label htmlFor="vendor_gstin" className="ml-1">Vendor GSTIN</Label>
                                                    <Input id="vendor_gstin" maxLength={15} value={form.vendor_gstin || ''}
                                                        onChange={(e) => setForm({ ...form, vendor_gstin: e.target.value.toUpperCase() })}
                                                        className={`${fieldClass} font-mono uppercase`} placeholder="07AABCU9603R1ZM" />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="invoice_no" className="ml-1">Invoice no.</Label>
                                                    <Input id="invoice_no" maxLength={60} value={form.invoice_no || ''}
                                                        onChange={(e) => setForm({ ...form, invoice_no: e.target.value })} className={fieldClass} />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="invoice_date" className="ml-1">Invoice date</Label>
                                                    <Input id="invoice_date" type="date" value={form.invoice_date || ''}
                                                        onChange={(e) => setForm({ ...form, invoice_date: e.target.value })} className={fieldClass} />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label className="ml-1">GST rate</Label>
                                                    <Select value={form.gst_rate || '18'} onValueChange={(v) => updateForm({ gst_rate: v })}>
                                                        <SelectTrigger className={fieldClass}><SelectValue /></SelectTrigger>
                                                        <SelectContent>
                                                            {GST_RATES.map((r) => <SelectItem key={r} value={r}>{r}%</SelectItem>)}
                                                        </SelectContent>
                                                    </Select>
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="taxable_value" className="ml-1">Taxable value</Label>
                                                    <Input id="taxable_value" type="number" min="0" step="0.01" value={form.taxable_value || ''}
                                                        onChange={(e) => { setGstManual(true); setForm({ ...form, taxable_value: e.target.value }); }}
                                                        className={`${fieldClass} tabular-nums`} />
                                                </div>
                                                <div className="space-y-2">
                                                    <Label htmlFor="gst_amount" className="ml-1">GST amount</Label>
                                                    <Input id="gst_amount" type="number" min="0" step="0.01" value={form.gst_amount || ''}
                                                        onChange={(e) => { setGstManual(true); setForm({ ...form, gst_amount: e.target.value }); }}
                                                        className={`${fieldClass} tabular-nums`} />
                                                </div>
                                                <p className="sm:col-span-3 -mt-1 text-meta text-muted-foreground">
                                                    {gstManual ? (
                                                        <>Using the values you typed. <button type="button" className="underline hover:text-foreground"
                                                            onClick={() => { setGstManual(false); const sp = splitGst(form.amount, form.gst_rate || '0'); if (sp) setForm({ ...form, taxable_value: sp.taxable, gst_amount: sp.gst }); }}>
                                                            Recalculate from the amount</button></>
                                                    ) : 'Worked out from the amount, treating it as GST-inclusive. Edit either box to match the invoice exactly.'}
                                                </p>
                                            </div>
                                        )}
                                    </div>

                                    <div className="space-y-2">
                                        <Label htmlFor="notes" className="ml-1">Notes</Label>
                                        <Textarea id="notes" rows={2} maxLength={5000} value={form.notes || ''}
                                            onChange={(e) => setForm({ ...form, notes: e.target.value })}
                                            className="bg-background border-dark-700/60 rounded-xl py-2.5 px-3.5"
                                            placeholder="Anything else worth remembering" />
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Save comes first in the DOM so Enter saves and closes; order-* keeps it on the right. */}
                        <DialogFooter className="pt-1 gap-2 sm:space-x-0">
                            <Button type="submit" disabled={saving} className="order-3 rounded-xl px-8 font-bold">
                                {saving && <Loader2 size={16} className="animate-spin" />}
                                {saving && staged.length > 0 ? 'Uploading…' : 'Save'}
                            </Button>
                            {!editing && (
                                <Button type="submit" name="then" value="another" variant="ghost" disabled={saving}
                                    className="order-2 rounded-xl border border-dark-700/60 px-5 font-semibold">
                                    Save and add another
                                </Button>
                            )}
                            <Button type="button" variant="ghost" onClick={() => { resetFiles(); setFormOpen(false); }}
                                className="order-1 text-muted-foreground hover:text-foreground px-6 font-medium">Cancel</Button>
                        </DialogFooter>
                    </form>
                </DialogContent>
            </Dialog>

            {/* Delete confirmation */}
            <Dialog open={!!deleting} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
                <DialogContent className="rounded-2xl">
                    <DialogHeader>
                        <DialogTitle>Delete this entry?</DialogTitle>
                        <DialogDescription>
                            {deleting && `${deleting.description}, ${formatMoney(deleting.amount, deleting.currency)} on ${dayLabel(deleting.entry_date)}. This can't be undone.`}
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button type="button" variant="ghost" onClick={() => setDeleting(null)}
                            className="text-muted-foreground hover:text-foreground px-6 font-medium">Cancel</Button>
                        <Button type="button" variant="destructive" onClick={handleDelete} className="rounded-xl px-6 font-bold">
                            Delete entry
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
};

export default AccountManagementPage;
