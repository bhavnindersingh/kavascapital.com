import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { accountsApi, documentsApi } from '@/services/api';
import { CabinetDocument, DocumentFolder } from '@/types';
import {
    ChevronRight, Download, Eye, FileImage, FileSpreadsheet, FileText, Folder, FolderInput,
    FolderOpen, FolderPlus, Loader2, Pencil, Plus, Presentation, Search, Trash2, Upload, X,
} from 'lucide-react';
import toast from 'react-hot-toast';

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/**
 * Documents — the partners' filing cabinet (legal, work, tax), after the House
 * of Nimai POS cabinet.
 *
 * Folders in the left rail (nested, MAX_DEPTH levels), the open folder's
 * subfolders and files on the right. Same gate as Account Management: the two
 * partners' logins. Nothing here is a permanent link — opening a file fetches
 * it with the session token and hands the browser a blob.
 */

// Mirrors document_service.MAX_DEPTH; the rail stops offering "new subfolder"
// at the floor rather than inviting a click the server will refuse.
const MAX_DEPTH = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const CONFIRM_MS = 4000;

const ALLOWED_EXT = [
    'pdf', 'doc', 'docx', 'odt', 'rtf', 'txt',
    'xls', 'xlsx', 'ods', 'csv',
    'ppt', 'pptx', 'odp',
    'png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'gif',
];
const ACCEPT = ALLOWED_EXT.map((e) => `.${e}`).join(',');

// What a browser tab can show. Everything else is a download.
const PREVIEW_MIME: Record<string, string> = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    webp: 'image/webp', gif: 'image/gif', txt: 'text/plain',
};

const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.toLowerCase() : '');
const formatSize = (n: number | null) =>
    n == null ? '' : n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

const kindOf = (ext: string) => {
    if (['xls', 'xlsx', 'ods', 'csv'].includes(ext)) return { icon: FileSpreadsheet, tone: 'text-emerald-500 bg-emerald-500/10' };
    if (['ppt', 'pptx', 'odp'].includes(ext)) return { icon: Presentation, tone: 'text-orange-500 bg-orange-500/10' };
    if (['png', 'jpg', 'jpeg', 'webp', 'heic', 'heif', 'gif'].includes(ext)) return { icon: FileImage, tone: 'text-violet-500 bg-violet-500/10' };
    if (ext === 'pdf') return { icon: FileText, tone: 'text-red-500 bg-red-500/10' };
    return { icon: FileText, tone: 'text-sky-500 bg-sky-500/10' };
};

const refusalFor = (file: File) => {
    const ext = extOf(file.name);
    if (!ALLOWED_EXT.includes(ext)) return `.${ext || '?'} files can't be added`;
    if (file.size > MAX_FILE_BYTES) return 'over the 10 MB limit';
    if (file.size === 0) return 'the file is empty';
    return null;
};

const errText = (err: any, fallback: string) => err?.response?.data?.detail || err?.message || fallback;

const DocumentsPage: React.FC = () => {
    const [allowed, setAllowed] = useState<boolean | null>(null);
    const [folders, setFolders] = useState<DocumentFolder[]>([]);
    const [loadingFolders, setLoadingFolders] = useState(true);
    const [activeId, setActiveId] = useState<number | null>(null);
    const [docs, setDocs] = useState<CabinetDocument[]>([]);
    const [loadingDocs, setLoadingDocs] = useState(false);
    const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);

    const [search, setSearch] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [results, setResults] = useState<CabinetDocument[] | null>(null);

    const [newFolder, setNewFolder] = useState('');
    const [addingUnder, setAddingUnder] = useState<number | null>(null);
    const [subDraft, setSubDraft] = useState('');
    const [renaming, setRenaming] = useState<string | null>(null); // `folder:id` | `doc:id`
    const [draft, setDraft] = useState('');
    const [moving, setMoving] = useState<string | null>(null); // `folder:id` | `doc:id`
    const [collapsed, setCollapsed] = useState<Set<number>>(() => new Set());
    const [armed, setArmed] = useState<string | null>(null);
    const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const [dragging, setDragging] = useState(false);
    const dragDepth = useRef(0);
    const fileInput = useRef<HTMLInputElement>(null);

    useEffect(() => {
        accountsApi.access().then((a) => setAllowed(a.allowed)).catch(() => setAllowed(false));
    }, []);

    // --- tree ---------------------------------------------------------------

    const byId = useMemo(() => new Map(folders.map((f) => [f.id, f])), [folders]);
    const childrenOf = useMemo(() => {
        const m = new Map<number | 'root', DocumentFolder[]>();
        for (const f of folders) {
            const key = f.parent_id ?? 'root';
            m.set(key, [...(m.get(key) || []), f]);
        }
        return m;
    }, [folders]);

    const pathOf = useCallback((id: number | null) => {
        const out: DocumentFolder[] = [];
        let cur = id != null ? byId.get(id) : undefined;
        while (cur && out.length <= folders.length) {
            out.unshift(cur);
            cur = cur.parent_id != null ? byId.get(cur.parent_id) : undefined;
        }
        return out;
    }, [byId, folders.length]);

    const descendants = (id: number) => {
        const out = new Set<number>();
        const walk = (pid: number) => (childrenOf.get(pid) || []).forEach((c) => { if (!out.has(c.id)) { out.add(c.id); walk(c.id); } });
        walk(id);
        return out;
    };
    const heightOf = (id: number): number =>
        1 + Math.max(0, ...(childrenOf.get(id) || []).map((c) => heightOf(c.id)));

    /** Every folder in tree order, with its depth — for the move pickers. */
    const flatTree = useMemo(() => {
        const out: { folder: DocumentFolder; depth: number }[] = [];
        const walk = (key: number | 'root', depth: number) =>
            (childrenOf.get(key) || []).forEach((f) => { out.push({ folder: f, depth }); walk(f.id, depth + 1); });
        walk('root', 0);
        return out;
    }, [childrenOf]);

    const active = activeId != null ? byId.get(activeId) || null : null;
    const crumbs = pathOf(activeId);
    const activeChildren = (activeId != null && childrenOf.get(activeId)) || [];
    const totalDocs = folders.reduce((n, f) => n + f.document_count, 0);

    // --- loading --------------------------------------------------------------

    const loadFolders = useCallback(async (select?: number | null) => {
        setLoadingFolders(true);
        try {
            const { folders: list } = await documentsApi.folders();
            setFolders(list);
            setActiveId((cur) => {
                if (select !== undefined) return select;
                if (cur != null && list.some((f) => f.id === cur)) return cur;
                return list.find((f) => f.parent_id == null)?.id ?? null;
            });
        } catch (err) {
            toast.error(errText(err, 'Could not load folders'));
        } finally {
            setLoadingFolders(false);
        }
    }, []);

    useEffect(() => { if (allowed) loadFolders(); }, [allowed, loadFolders]);

    const loadDocs = useCallback(async (folderId: number | null) => {
        if (folderId == null) { setDocs([]); return; }
        setLoadingDocs(true);
        try {
            const { documents } = await documentsApi.list({ folder_id: folderId });
            setDocs(documents);
        } catch (err) {
            toast.error(errText(err, 'Could not load documents'));
            setDocs([]);
        } finally {
            setLoadingDocs(false);
        }
    }, []);

    useEffect(() => { if (allowed) loadDocs(activeId); }, [allowed, activeId, loadDocs]);

    useEffect(() => {
        const t = setTimeout(() => setSearchQuery(search.trim()), 250);
        return () => clearTimeout(t);
    }, [search]);

    useEffect(() => {
        if (!searchQuery) { setResults(null); return; }
        let live = true;
        documentsApi.list({ search: searchQuery })
            .then(({ documents }) => { if (live) setResults(documents); })
            .catch((err) => toast.error(errText(err, 'Search failed')));
        return () => { live = false; };
    }, [searchQuery]);

    // A file dropped outside the drop zone would otherwise navigate the tab away.
    useEffect(() => {
        const swallow = (e: DragEvent) => e.preventDefault();
        window.addEventListener('dragover', swallow);
        window.addEventListener('drop', swallow);
        return () => {
            window.removeEventListener('dragover', swallow);
            window.removeEventListener('drop', swallow);
        };
    }, []);

    useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current); }, []);

    // --- helpers --------------------------------------------------------------

    /** Two-click delete: the first click arms for 4s, the second commits. */
    const confirmed = (key: string) => {
        if (armTimer.current) clearTimeout(armTimer.current);
        if (armed === key) { setArmed(null); return true; }
        setArmed(key);
        armTimer.current = setTimeout(() => setArmed(null), CONFIRM_MS);
        return false;
    };

    const bumpCount = (folderId: number, delta: number) =>
        setFolders((prev) => prev.map((f) => (f.id === folderId ? { ...f, document_count: Math.max(0, f.document_count + delta) } : f)));

    const openFolder = (id: number) => {
        setArmed(null);
        setSearch('');
        setActiveId(id);
        // Open the branch down to it, so the rail shows where it is.
        setCollapsed((prev) => {
            const next = new Set(prev);
            pathOf(id).forEach((f) => next.delete(f.id));
            return next;
        });
    };

    // --- folder actions -------------------------------------------------------

    const createFolder = async (name: string, parentId: number | null) => {
        if (!name.trim()) return false;
        try {
            const { folder } = await documentsApi.createFolder({ name, parent_id: parentId });
            await loadFolders(folder.id);
            if (parentId != null) setCollapsed((prev) => { const n = new Set(prev); n.delete(parentId); return n; });
            toast.success(`Folder "${folder.name}" created`);
            return true;
        } catch (err) {
            toast.error(errText(err, 'Could not create the folder'));
            return false;
        }
    };

    const commitRename = async () => {
        const key = renaming;
        const name = draft.trim();
        setRenaming(null);
        if (!key || !name) return;
        const [kind, raw] = key.split(':');
        const id = Number(raw);
        try {
            if (kind === 'folder') {
                if (byId.get(id)?.name === name) return;
                await documentsApi.updateFolder(id, { name });
                setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name } : f)));
            } else {
                const { document } = await documentsApi.update(id, { name });
                const swap = (list: CabinetDocument[]) => list.map((d) => (d.id === id ? document : d));
                setDocs(swap);
                setResults((r) => (r ? swap(r) : r));
            }
        } catch (err) {
            toast.error(errText(err, 'Could not rename'));
        }
    };

    const moveFolder = async (folder: DocumentFolder, value: string) => {
        setMoving(null);
        const parentId = value === 'root' ? null : Number(value);
        if ((folder.parent_id ?? null) === parentId) return;
        try {
            await documentsApi.updateFolder(folder.id, { parent_id: parentId });
            await loadFolders(folder.id);
            toast.success(`"${folder.name}" moved`);
        } catch (err) {
            toast.error(errText(err, 'Could not move the folder'));
        }
    };

    const deleteFolder = async (folder: DocumentFolder) => {
        if (!confirmed(`folder:${folder.id}`)) return;
        try {
            await documentsApi.removeFolder(folder.id);
            toast.success(`"${folder.name}" deleted`);
            const gone = descendants(folder.id).add(folder.id);
            await loadFolders(activeId != null && gone.has(activeId) ? folder.parent_id : undefined);
        } catch (err) {
            toast.error(errText(err, 'Could not delete the folder'));
        }
    };

    // --- document actions -----------------------------------------------------

    const addFiles = async (list: FileList | File[] | null | undefined) => {
        const files = Array.from(list || []);
        if (fileInput.current) fileInput.current.value = '';
        if (!files.length) return;
        if (activeId == null) { toast.error('Open a folder first, then add the files.'); return; }
        const bad = files.map((f) => ({ f, why: refusalFor(f) })).filter((x) => x.why);
        bad.forEach(({ f, why }) => toast.error(`${f.name}: ${why}`));
        const good = files.filter((f) => !refusalFor(f));
        if (!good.length) return;

        const folderId = activeId;
        let ok = 0;
        setUploading({ done: 0, total: good.length });
        // One at a time: a failure part-way leaves the earlier ones filed.
        for (const file of good) {
            try {
                await documentsApi.upload(folderId, file);
                ok += 1;
            } catch (err) {
                toast.error(`${file.name}: ${errText(err, 'upload failed')}`);
            }
            setUploading({ done: ok, total: good.length });
        }
        setUploading(null);
        if (ok) {
            toast.success(ok === 1 ? 'Document added' : `${ok} documents added`);
            bumpCount(folderId, ok);
            if (folderId === activeId) loadDocs(folderId);
        }
    };

    /**
     * Open (PDF, image, text) or save (everything else). The tab is opened
     * BEFORE the await — after an async gap the click has lost its user gesture
     * and the popup is blocked.
     */
    const openDoc = async (doc: CabinetDocument, download = false) => {
        const mime = PREVIEW_MIME[doc.ext];
        const view = mime && !download;
        const tab = view ? window.open('', '_blank') : null;
        const filename = doc.ext ? `${doc.name}.${doc.ext}` : doc.name;
        try {
            const blob = await documentsApi.fetchFile(doc.id);
            const url = URL.createObjectURL(view ? new Blob([blob], { type: mime }) : blob);
            if (tab) {
                tab.opener = null;
                tab.location.href = url;
                setTimeout(() => URL.revokeObjectURL(url), 60000);
            } else {
                const a = document.createElement('a');
                a.href = url; a.download = filename;
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            }
        } catch (err) {
            tab?.close();
            toast.error(errText(err, 'Could not open the file'));
        }
    };

    const moveDoc = async (doc: CabinetDocument, value: string) => {
        setMoving(null);
        const folderId = Number(value);
        if (!folderId || folderId === doc.folder_id) return;
        try {
            const { document } = await documentsApi.update(doc.id, { folder_id: folderId });
            bumpCount(doc.folder_id, -1);
            bumpCount(folderId, 1);
            setDocs((prev) => prev.filter((d) => d.id !== doc.id));
            setResults((r) => (r ? r.map((d) => (d.id === doc.id ? document : d)) : r));
            toast.success(`Moved to "${byId.get(folderId)?.name}"`);
        } catch (err) {
            toast.error(errText(err, 'Could not move the document'));
        }
    };

    const deleteDoc = async (doc: CabinetDocument) => {
        if (!confirmed(`doc:${doc.id}`)) return;
        try {
            await documentsApi.remove(doc.id);
            setDocs((prev) => prev.filter((d) => d.id !== doc.id));
            setResults((r) => (r ? r.filter((d) => d.id !== doc.id) : r));
            bumpCount(doc.folder_id, -1);
            toast.success('Document deleted');
        } catch (err) {
            toast.error(errText(err, 'Could not delete the document'));
        }
    };

    // Counted, not boolean: entering a child fires leave on the parent.
    const dragProps = {
        onDragEnter: (e: React.DragEvent) => { e.preventDefault(); dragDepth.current += 1; setDragging(true); },
        onDragOver: (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; },
        onDragLeave: (e: React.DragEvent) => {
            e.preventDefault();
            dragDepth.current -= 1;
            if (dragDepth.current <= 0) { dragDepth.current = 0; setDragging(false); }
        },
        onDrop: (e: React.DragEvent) => {
            e.preventDefault(); dragDepth.current = 0; setDragging(false); addFiles(e.dataTransfer.files);
        },
    };

    // --- render ---------------------------------------------------------------

    if (allowed === false) return <Navigate to="/" replace />;
    if (allowed === null) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
        );
    }

    const iconBtn = 'h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
    const pickerCls = 'w-full rounded-lg border border-dark-700 bg-background px-2 py-1.5 text-body text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

    const renameInput = (key: string, label: string, max: number) => (
        <form onSubmit={(e) => { e.preventDefault(); commitRename(); }} className="flex-1 min-w-0">
            <Input autoFocus value={draft} maxLength={max} aria-label={label}
                onChange={(e) => setDraft(e.target.value)} onBlur={commitRename}
                onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null); }}
                className="h-8" data-key={key} />
        </form>
    );

    const folderPicker = (folder: DocumentFolder) => {
        const forbidden = descendants(folder.id).add(folder.id);
        const h = heightOf(folder.id);
        return (
            <select autoFocus className={pickerCls} defaultValue={folder.parent_id ?? 'root'}
                aria-label={`Move folder ${folder.name} into`}
                onChange={(e) => moveFolder(folder, e.target.value)}
                onBlur={() => setMoving(null)}
                onKeyDown={(e) => { if (e.key === 'Escape') setMoving(null); }}>
                <option value="root">Top level</option>
                {flatTree
                    .filter(({ folder: t, depth }) => !forbidden.has(t.id) && depth + 1 + h <= MAX_DEPTH)
                    .map(({ folder: t, depth }) => (
                        <option key={t.id} value={t.id}>{`${' '.repeat(depth)}${t.name}`}</option>
                    ))}
            </select>
        );
    };

    const renderFolder = (folder: DocumentFolder, depth: number): React.ReactNode => {
        const kids = childrenOf.get(folder.id) || [];
        const closed = collapsed.has(folder.id);
        const isActive = activeId === folder.id && !results;
        const delKey = `folder:${folder.id}`;
        return (
            <li key={folder.id}>
                {renaming === delKey ? (
                    <div className="py-1">{renameInput(delKey, `Rename folder ${folder.name}`, 120)}</div>
                ) : moving === delKey ? (
                    <div className="py-1">{folderPicker(folder)}</div>
                ) : (
                    <div className={`group flex items-center gap-0.5 rounded-lg pr-1 transition-colors ${isActive ? 'bg-primary-500/10 text-foreground' : 'hover:bg-accent/60'}`}>
                        {kids.length ? (
                            <button type="button" className={iconBtn} aria-expanded={!closed}
                                aria-label={`${closed ? 'Expand' : 'Collapse'} ${folder.name}`}
                                onClick={() => setCollapsed((prev) => { const n = new Set(prev); n.has(folder.id) ? n.delete(folder.id) : n.add(folder.id); return n; })}>
                                <ChevronRight size={14} className={`transition-transform ${closed ? '' : 'rotate-90'}`} />
                            </button>
                        ) : <span className="w-7 shrink-0" aria-hidden="true" />}
                        <button type="button" onClick={() => openFolder(folder.id)} title={folder.name}
                            aria-current={isActive ? 'true' : undefined}
                            className="flex flex-1 min-w-0 items-center gap-2 py-1.5 text-left text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                            {isActive ? <FolderOpen size={16} className="shrink-0 text-primary-500" /> : <Folder size={16} className="shrink-0 text-muted-foreground" />}
                            <span className={`truncate ${isActive ? 'font-semibold' : 'text-foreground/90'}`}>{folder.name}</span>
                            <span className="ml-auto pl-1 text-caption tabular-nums text-muted-foreground group-hover:hidden group-focus-within:hidden">{folder.document_count || ''}</span>
                        </button>
                        <div className={`hidden items-center group-hover:flex group-focus-within:flex ${armed === delKey ? '!flex' : ''}`}>
                            {depth < MAX_DEPTH - 1 && (
                                <button type="button" className={iconBtn} title="New subfolder" aria-label={`New subfolder in ${folder.name}`}
                                    onClick={() => { setAddingUnder(folder.id); setSubDraft(''); setCollapsed((p) => { const n = new Set(p); n.delete(folder.id); return n; }); }}>
                                    <Plus size={14} />
                                </button>
                            )}
                            <button type="button" className={iconBtn} title="Move folder" aria-label={`Move folder ${folder.name}`}
                                onClick={() => { setArmed(null); setMoving(delKey); }}>
                                <FolderInput size={14} />
                            </button>
                            <button type="button" className={iconBtn} title="Rename folder" aria-label={`Rename folder ${folder.name}`}
                                onClick={() => { setArmed(null); setDraft(folder.name); setRenaming(delKey); }}>
                                <Pencil size={13} />
                            </button>
                            <button type="button" onClick={() => deleteFolder(folder)}
                                title={armed === delKey ? `Click again to delete this folder${kids.length ? ', its subfolders' : ''} and every file in it` : 'Delete folder'}
                                aria-label={armed === delKey ? `Confirm deleting ${folder.name} and everything in it` : `Delete folder ${folder.name}`}
                                className={armed === delKey
                                    ? 'h-7 px-2 rounded-md bg-red-500 text-white text-caption font-semibold'
                                    : `${iconBtn} hover:!text-red-500`}>
                                {armed === delKey ? 'Sure?' : <Trash2 size={13} />}
                            </button>
                        </div>
                    </div>
                )}
                {addingUnder === folder.id && (
                    <form className="flex gap-1 py-1" style={{ paddingLeft: 28 }}
                        onSubmit={async (e) => { e.preventDefault(); if (await createFolder(subDraft, folder.id)) setAddingUnder(null); }}>
                        <Input autoFocus value={subDraft} maxLength={120} placeholder={`New folder in ${folder.name}`}
                            aria-label={`New subfolder name in ${folder.name}`} className="h-8"
                            onChange={(e) => setSubDraft(e.target.value)}
                            onBlur={() => { if (!subDraft.trim()) setAddingUnder(null); }}
                            onKeyDown={(e) => { if (e.key === 'Escape') setAddingUnder(null); }} />
                    </form>
                )}
                {kids.length > 0 && !closed && (
                    <ul className="ml-3.5 border-l border-dark-800 pl-1">{kids.map((k) => renderFolder(k, depth + 1))}</ul>
                )}
            </li>
        );
    };

    const renderDoc = (doc: CabinetDocument, showPath: boolean) => {
        const { icon: Icon, tone } = kindOf(doc.ext);
        const viewable = !!PREVIEW_MIME[doc.ext];
        const key = `doc:${doc.id}`;
        const where = showPath ? pathOf(doc.folder_id) : [];
        return (
            <li key={doc.id} className="group flex flex-wrap items-center gap-3 px-4 py-3 sm:flex-nowrap hover:bg-accent/40 transition-colors">
                <div className={`h-10 w-10 shrink-0 grid place-items-center rounded-lg ${tone}`}>
                    <Icon size={20} />
                </div>
                <div className="flex-1 min-w-0">
                    {renaming === key ? renameInput(key, `Rename ${doc.name}`, 255) : (
                        <button type="button" onClick={() => openDoc(doc)}
                            title={viewable ? 'Open in a new tab' : 'Download'}
                            className="block max-w-full truncate text-left text-body font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded">
                            {doc.name}<span className="font-normal text-muted-foreground">{doc.ext ? `.${doc.ext}` : ''}</span>
                        </button>
                    )}
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
                        {showPath && (
                            <button type="button" onClick={() => openFolder(doc.folder_id)} className="inline-flex items-center gap-1 hover:text-foreground">
                                <Folder size={12} /> {where.map((f) => f.name).join(' / ')}
                            </button>
                        )}
                        <span>{formatSize(doc.file_size)}</span>
                        <span>{doc.uploaded_by_name ? `${doc.uploaded_by_name}, ${formatDate(doc.created_at)}` : formatDate(doc.created_at)}</span>
                    </div>
                </div>
                {moving === key ? (
                    <div className="w-full sm:w-64">
                        <select autoFocus className={pickerCls} defaultValue={doc.folder_id} aria-label={`Move ${doc.name} to`}
                            onChange={(e) => moveDoc(doc, e.target.value)} onBlur={() => setMoving(null)}
                            onKeyDown={(e) => { if (e.key === 'Escape') setMoving(null); }}>
                            {flatTree.map(({ folder: f, depth }) => (
                                <option key={f.id} value={f.id}>{`${' '.repeat(depth)}${f.name}`}</option>
                            ))}
                        </select>
                    </div>
                ) : (
                    <div className="flex items-center gap-0.5">
                        <Button variant="ghost" size="inline" onClick={() => openDoc(doc)}
                            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-caption font-semibold text-muted-foreground hover:text-foreground hover:bg-accent">
                            {viewable ? <><Eye size={14} /> View</> : <><Download size={14} /> Download</>}
                        </Button>
                        {viewable && (
                            <button type="button" className={iconBtn} title="Download" aria-label={`Download ${doc.name}`} onClick={() => openDoc(doc, true)}>
                                <Download size={14} />
                            </button>
                        )}
                        <button type="button" className={iconBtn} title="Move to another folder" aria-label={`Move ${doc.name}`}
                            onClick={() => { setArmed(null); setMoving(key); }}>
                            <FolderInput size={14} />
                        </button>
                        <button type="button" className={iconBtn} title="Rename" aria-label={`Rename ${doc.name}`}
                            onClick={() => { setArmed(null); setDraft(doc.name); setRenaming(key); }}>
                            <Pencil size={13} />
                        </button>
                        <button type="button" onClick={() => deleteDoc(doc)}
                            title={armed === key ? 'Click again to delete' : 'Delete'}
                            aria-label={armed === key ? `Confirm deleting ${doc.name}` : `Delete ${doc.name}`}
                            className={armed === key
                                ? 'h-7 px-2 rounded-md bg-red-500 text-white text-caption font-semibold'
                                : `${iconBtn} hover:!text-red-500`}>
                            {armed === key ? 'Sure?' : <Trash2 size={13} />}
                        </button>
                    </div>
                )}
            </li>
        );
    };

    return (
        <div className="w-full space-y-5 animate-in fade-in duration-500">
            {/* Header */}
            <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                    <h1 className="text-display font-medium leading-tight text-foreground mb-1">Documents</h1>
                    <p className="text-muted-foreground">
                        Legal, work and tax paperwork, in folders.{' '}
                        <span className="tabular-nums">{folders.length} {folders.length === 1 ? 'folder' : 'folders'}, {totalDocs} {totalDocs === 1 ? 'file' : 'files'}.</span>
                    </p>
                </div>
                <div className="relative w-full md:w-80">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                    <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search all documents"
                        aria-label="Search all documents" className="pl-9 pr-9 rounded-xl" />
                    {search && (
                        <button type="button" onClick={() => setSearch('')} aria-label="Clear search"
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground hover:text-foreground">
                            <X size={14} />
                        </button>
                    )}
                </div>
            </div>

            <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)]">
                {/* Folder rail */}
                <aside className="rounded-3xl border border-dark-800 bg-background p-3 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto">
                    <form className="flex gap-1.5 p-1" onSubmit={async (e) => { e.preventDefault(); if (await createFolder(newFolder, null)) setNewFolder(''); }}>
                        <Input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} maxLength={120}
                            placeholder="New folder" aria-label="New folder name" className="h-9 rounded-lg" />
                        <Button type="submit" disabled={!newFolder.trim()} className="h-9 rounded-lg px-3" aria-label="Create folder" title="Create folder">
                            <FolderPlus size={16} />
                        </Button>
                    </form>
                    <div className="mt-2">
                        {loadingFolders && folders.length === 0 ? (
                            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>
                        ) : folders.length === 0 ? (
                            <p className="px-2 py-6 text-body text-muted-foreground">
                                No folders yet. Name your first one above, for example Legal, Work or Tax.
                            </p>
                        ) : (
                            <ul>{(childrenOf.get('root') || []).map((f) => renderFolder(f, 0))}</ul>
                        )}
                    </div>
                </aside>

                {/* Open folder, or search results */}
                <section {...(results ? {} : dragProps)}
                    className="relative min-h-[420px] rounded-3xl border border-dark-800 bg-background overflow-hidden">
                    {results ? (
                        <>
                            <div className="flex items-center justify-between gap-3 border-b border-dark-800 px-5 py-4">
                                <h2 className="text-title font-semibold text-foreground">
                                    {results.length} {results.length === 1 ? 'match' : 'matches'} for “{searchQuery}”
                                </h2>
                            </div>
                            {results.length === 0 ? (
                                <p className="px-5 py-10 text-center text-muted-foreground">No document names or notes match. Try a shorter word.</p>
                            ) : (
                                <ul className="divide-y divide-dark-800">{results.map((d) => renderDoc(d, true))}</ul>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-dark-800 px-5 py-4">
                                <nav aria-label="Folder path" className="flex min-w-0 flex-wrap items-center gap-1">
                                    {crumbs.slice(0, -1).map((f) => (
                                        <Fragment key={f.id}>
                                            <button type="button" onClick={() => openFolder(f.id)}
                                                className="max-w-[180px] truncate text-body text-muted-foreground hover:text-foreground hover:underline">
                                                {f.name}
                                            </button>
                                            <ChevronRight size={14} className="text-muted-foreground shrink-0" aria-hidden="true" />
                                        </Fragment>
                                    ))}
                                    <h2 className="truncate text-title font-semibold text-foreground">{active ? active.name : 'Documents'}</h2>
                                </nav>
                                <input ref={fileInput} type="file" multiple hidden accept={ACCEPT} onChange={(e) => addFiles(e.target.files)} />
                                <Button onClick={() => fileInput.current?.click()} disabled={!active || !!uploading} className="rounded-xl px-4 font-bold">
                                    {uploading
                                        ? <><Loader2 size={16} className="animate-spin" /> Adding {Math.min(uploading.done + 1, uploading.total)} of {uploading.total}</>
                                        : <><Upload size={16} /> Add files</>}
                                </Button>
                            </div>

                            {!active ? (
                                <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
                                    <FolderOpen size={40} className="text-muted-foreground/60" />
                                    <p className="text-title font-semibold text-foreground">No folder open</p>
                                    <p className="max-w-sm text-body text-muted-foreground">Create a folder on the left, then add the paperwork that belongs in it.</p>
                                </div>
                            ) : (
                                <>
                                    {activeChildren.length > 0 && (
                                        <div className="grid grid-cols-2 gap-2 border-b border-dark-800 p-4 sm:grid-cols-3 2xl:grid-cols-5">
                                            {activeChildren.map((f) => (
                                                <button key={f.id} type="button" onClick={() => openFolder(f.id)}
                                                    className="flex items-center gap-2.5 rounded-xl border border-dark-800 px-3 py-2.5 text-left hover:border-primary-500/40 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                                    <Folder size={18} className="shrink-0 text-primary-500" />
                                                    <span className="truncate text-body font-medium text-foreground">{f.name}</span>
                                                    <span className="ml-auto text-caption tabular-nums text-muted-foreground">{f.document_count || ''}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    {loadingDocs && docs.length === 0 ? (
                                        <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-muted-foreground" /></div>
                                    ) : docs.length === 0 ? (
                                        <button type="button" onClick={() => fileInput.current?.click()}
                                            className="m-4 flex w-[calc(100%-2rem)] flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-dark-700 px-6 py-14 text-center hover:border-primary-500/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                            <Upload size={28} className="text-muted-foreground" />
                                            <span className="text-body font-semibold text-foreground">
                                                {activeChildren.length ? `No files directly in ${active.name}` : `${active.name} is empty`}
                                            </span>
                                            <span className="text-caption text-muted-foreground">
                                                Drop files here or click to choose. PDF, Word, Excel, PowerPoint, text or images, up to 10 MB each.
                                            </span>
                                        </button>
                                    ) : (
                                        <>
                                            <ul className="divide-y divide-dark-800">{docs.map((d) => renderDoc(d, false))}</ul>
                                            <p className="border-t border-dark-800 px-5 py-3 text-caption text-muted-foreground">
                                                Drop files anywhere in this panel to add them to {active.name}.
                                            </p>
                                        </>
                                    )}
                                </>
                            )}
                        </>
                    )}

                    {dragging && (
                        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-background/85 backdrop-blur-sm">
                            <div className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-primary-500 px-10 py-8 text-foreground">
                                <Upload size={28} className="text-primary-500" />
                                <span className="text-body font-semibold">{active ? `Drop to add to ${active.name}` : 'Open a folder first'}</span>
                            </div>
                        </div>
                    )}
                </section>
            </div>
        </div>
    );
};

export default DocumentsPage;
