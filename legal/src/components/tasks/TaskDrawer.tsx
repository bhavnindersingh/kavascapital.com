import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Check,
  Download,
  Link2,
  Loader2,
  Lock,
  Paperclip,
  Plus,
  Send,
  Trash2,
  Unlink,
  Upload,
  X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import type {
  PlatformUser,
  Task,
  TaskComment,
  TaskEvent,
  TaskFile,
  TaskInput,
  TaskPriority,
  TaskStatus,
  TaskStub,
  TaskSubtask,
} from '@/types';
import { tasksApi, taskError } from '@/services/api';
import { cn } from '@/lib/utils';
import {
  PRIORITY_LABELS,
  PRIORITY_ORDER,
  PRIORITY_VAR,
  STATUS_LABELS,
  STATUS_ORDER,
  STATUS_VAR,
  initialsOf,
  maySignOff as maySignOffOf,
  personDisc,
  relTime,
} from './taskUtils';
import './tasks.css';

/**
 * One task, opened — A CENTRED MODAL, two columns.
 *
 * It was a rail down the right edge holding ten stacked sections: a long scroll
 * on a screen that was otherwise empty, with the controls you came to use
 * somewhere below the fold. Centred, it is two columns — the WORK on the left
 * (notes, checklist, the discussion/files/trail panels) and the FACTS about it
 * on the right (status, priority, owner, dates, progress, links), each
 * scrolling on its own so the due date stays in view while a discussion is read
 * past it.
 *
 * THREE KINDS OF WRITE live in here and they behave differently on purpose:
 *
 *  · The task's own FIELDS are edited and saved together. They are one row and
 *    one thought — changing the owner and the date in the same breath should be
 *    one entry per field on the trail, from one save.
 *  · Steps, links and comments WRITE IMMEDIATELY. Each is its own row, and
 *    holding a tick as a draft of the task would lose three of them to a Cancel
 *    pressed for an unrelated reason. A link is worse still: it is a fact about
 *    TWO rows, and holding it as a draft of one leaves the other task's drawer
 *    disagreeing until somebody presses a button.
 *  · The activity trail is READ-ONLY. There is no write path for it anywhere,
 *    here or on the server — a log its own subject can edit proves nothing.
 */

/**
 * A task the drawer is showing — which may not exist yet.
 *
 * ONE CREATE PATH, and it is this one. Quick-add on a column does NOT write a
 * row; it opens this drawer prefilled with the title and column, unsaved. A
 * second door that wrote straight through would go on minting undated tasks for
 * ever — the deadline rule would hold on the form nobody uses in a hurry and
 * fail on the one everybody does.
 */
export type DrawerTask = Partial<Task> & { id?: number };

type Panel = 'discussion' | 'files' | 'activity';

export interface TaskDrawerProps {
  task: DrawerTask | null;
  board:
    | { id: number; name: string; color: string | null; owner_user_id: number | null }
    | null;
  /** Every task in the current fetch, for the dependency picker. */
  siblings: Task[];
  foreign: TaskStub[];
  people: PlatformUser[];
  user: PlatformUser | null;
  onClose: () => void;
  onSaved: (task: Task) => void;
  onCreated: (task: Task) => void;
  onDeleted: (taskId: number) => void;
  /** A link changed: both ends moved, so the parent refetches. */
  onGraphChanged: () => void;
}

const NEW_DEFAULTS: Record<string, unknown> = {
  status: 'todo',
  priority: 'medium',
  progress: 0,
  title: '',
  description: null,
  assignee_user_id: null,
  start_date: null,
  due_date: null,
};

export const TaskDrawer: React.FC<TaskDrawerProps> = ({
  task,
  board,
  siblings,
  foreign,
  people,
  user,
  onClose,
  onSaved,
  onCreated,
  onDeleted,
  onGraphChanged,
}) => {
  const [draft, setDraft] = useState<TaskInput>({});
  const [saving, setSaving] = useState(false);
  const [panel, setPanel] = useState<Panel>('discussion');
  const [comments, setComments] = useState<TaskComment[]>([]);
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [files, setFiles] = useState<TaskFile[]>([]);
  const [loadingPanel, setLoadingPanel] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [newStep, setNewStep] = useState('');
  const [steps, setSteps] = useState<TaskSubtask[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [dependencyPick, setDependencyPick] = useState('');
  const stepInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const isNew = !task?.id;
  const mayFinish = maySignOffOf(board, user?.id);

  // Reset every time a different task is opened — a drawer that kept the last
  // task's draft would silently save it onto this one.
  useEffect(() => {
    if (!task) return;
    setDraft({});
    setSteps(task.subtasks ?? []);
    setConfirmDelete(false);
    setPanel('discussion');
    setNewComment('');
    setNewStep('');
    setDependencyPick('');
  }, [task?.id]);

  // Escape closes, as a modal must.
  useEffect(() => {
    if (!task) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [task, onClose]);

  // The discussion, the trail and the files are fetched per task rather than
  // folded into the board read: a board of forty cards would otherwise carry
  // forty conversations nobody has opened.
  useEffect(() => {
    if (!task?.id) {
      setComments([]);
      setEvents([]);
      setFiles([]);
      return;
    }
    const id = task.id;
    let cancelled = false;
    setLoadingPanel(true);
    Promise.all([tasksApi.getComments(id), tasksApi.getEvents(id), tasksApi.getFiles(id)])
      .then(([c, e, f]) => {
        if (cancelled) return;
        setComments(c.comments);
        setEvents(e.events);
        setFiles(f.files);
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setLoadingPanel(false));
    return () => {
      cancelled = true;
    };
  }, [task?.id]);

  // A NEW task has no row behind it, so fields fall back to the defaults the
  // server would apply — otherwise the drawer opens on `undefined` controls.
  const value = <K extends keyof TaskInput>(key: K): TaskInput[K] => {
    if (key in draft) return draft[key] as TaskInput[K];
    const fromTask = (task as any)?.[key];
    return (fromTask === undefined ? NEW_DEFAULTS[key as string] : fromTask) as TaskInput[K];
  };
  const set = <K extends keyof TaskInput>(key: K, v: TaskInput[K]) =>
    setDraft((d) => ({ ...d, [key]: v }));

  // A new task arrives with a title already in it, so "nothing edited" must
  // still be savable.
  const dirty = Object.keys(draft).length > 0 || isNew;

  const save = useCallback(async () => {
    if (!task) return;
    setSaving(true);
    try {
      if (!task.id) {
        if (!board) return;
        const { task: created } = await tasksApi.createTask({
          board_id: board.id,
          title: (value('title') as string)?.trim() || 'Untitled task',
          description: (value('description') as string) ?? null,
          status: (value('status') as TaskStatus) ?? 'todo',
          priority: (value('priority') as TaskPriority) ?? 'medium',
          assignee_user_id: (value('assignee_user_id') as number) ?? null,
          start_date: (value('start_date') as string) ?? null,
          due_date: (value('due_date') as string) ?? null,
          progress: (value('progress') as number) ?? 0,
        });
        onCreated(created);
        setDraft({});
        toast.success('Task created');
        return;
      }
      const { task: updated } = await tasksApi.updateTask(task.id, draft);
      onSaved(updated);
      setDraft({});
      // Re-read rather than guessed at: the server's two completion rules can
      // add a status or a progress of their own, so what was written is not
      // always what was sent.
      tasksApi.getEvents(task.id).then((e) => setEvents(e.events)).catch(() => undefined);
      if (updated.status === 'quality_check' && draft.progress === 100 && !mayFinish) {
        toast.success('Moved to Quality Check — it will reach the board owner.');
      } else {
        toast.success('Saved');
      }
    } catch (err) {
      // The board's refusals are written to be read; show the server's sentence.
      toast.error(taskError(err));
    } finally {
      setSaving(false);
    }
  }, [task, draft, mayFinish, onSaved, onCreated, board]);

  if (!task) return null;

  /** The same task once it has a row — everything below is gated on `!isNew`. */
  const saved: Task | null = task.id ? (task as Task) : null;

  // ── Checklist ─────────────────────────────────────────────────────────────
  const addStep = async () => {
    if (!saved) return;
    const title = newStep.trim();
    if (!title) return;
    setNewStep('');
    try {
      const { subtask } = await tasksApi.addSubtask(saved.id, title);
      const next = [...steps, subtask];
      setSteps(next);
      onSaved({ ...saved, subtasks: next });
      stepInput.current?.focus();
    } catch (err) {
      toast.error(taskError(err, 'That step did not save.'));
    }
  };

  const toggleStep = async (step: TaskSubtask) => {
    if (!saved) return;
    const next = steps.map((s) => (s.id === step.id ? { ...s, is_done: !s.is_done } : s));
    setSteps(next);
    onSaved({ ...saved, subtasks: next });
    try {
      await tasksApi.updateSubtask(saved.id, step.id, { is_done: !step.is_done });
    } catch (err) {
      setSteps(steps);
      onSaved({ ...saved, subtasks: steps });
      toast.error(taskError(err));
    }
  };

  const removeStep = async (step: TaskSubtask) => {
    if (!saved) return;
    const next = steps.filter((s) => s.id !== step.id);
    setSteps(next);
    onSaved({ ...saved, subtasks: next });
    try {
      await tasksApi.deleteSubtask(saved.id, step.id);
    } catch (err) {
      setSteps(steps);
      toast.error(taskError(err));
    }
  };

  // ── Dependencies ──────────────────────────────────────────────────────────
  const titleOf = (id: number): string =>
    siblings.find((t) => t.id === id)?.title ?? foreign.find((f) => f.id === id)?.title ?? `#${id}`;

  const link = async (dependsOn: number) => {
    if (!saved) return;
    try {
      await tasksApi.linkDependency(saved.id, dependsOn);
      onGraphChanged();
    } catch (err) {
      toast.error(taskError(err, 'That link was refused.'));
    }
  };

  const unlink = async (dependsOn: number) => {
    if (!saved) return;
    try {
      await tasksApi.unlinkDependency(saved.id, dependsOn);
      onGraphChanged();
    } catch (err) {
      toast.error(taskError(err));
    }
  };

  // ── Discussion ────────────────────────────────────────────────────────────
  const postComment = async () => {
    if (!saved) return;
    const body = newComment.trim();
    if (!body) return;
    setNewComment('');
    try {
      const { comment } = await tasksApi.addComment(saved.id, body);
      setComments((c) => [...c, comment]);
    } catch (err) {
      setNewComment(body);
      toast.error(taskError(err));
    }
  };

  const removeComment = async (comment: TaskComment) => {
    if (!saved) return;
    try {
      await tasksApi.deleteComment(saved.id, comment.id);
      setComments((c) => c.filter((x) => x.id !== comment.id));
    } catch (err) {
      toast.error(taskError(err));
    }
  };

  // ── Attachments ───────────────────────────────────────────────────────────
  const upload = async (picked: FileList | null) => {
    if (!saved || !picked?.length) return;
    setUploading(true);
    try {
      // Sequentially, not in parallel: the server refuses on size and on type
      // with a sentence naming the file, and three concurrent refusals arrive
      // as three toasts nobody can match to a filename.
      for (const f of Array.from(picked)) {
        const { file: added } = await tasksApi.uploadFile(saved.id, f);
        setFiles((rows) => [...rows, added]);
      }
      tasksApi.getEvents(saved.id).then((e) => setEvents(e.events)).catch(() => undefined);
    } catch (err) {
      toast.error(taskError(err, 'That file was not attached.'));
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const removeFile = async (file: TaskFile) => {
    if (!saved) return;
    try {
      await tasksApi.deleteFile(saved.id, file.id);
      setFiles((rows) => rows.filter((f) => f.id !== file.id));
    } catch (err) {
      toast.error(taskError(err));
    }
  };

  const download = async (file: TaskFile) => {
    if (!saved) return;
    try {
      await tasksApi.downloadFile(saved.id, file.id, file.name);
    } catch (err) {
      toast.error(taskError(err, 'That file could not be downloaded.'));
    }
  };

  const doDelete = async () => {
    if (!saved) return;
    try {
      await tasksApi.deleteTask(saved.id);
      onDeleted(saved.id);
      toast.success('Task deleted');
    } catch (err) {
      toast.error(taskError(err));
    }
  };

  const blockedBy = task.blocked_by ?? [];
  const blocks = task.blocks ?? [];
  const linkable = siblings.filter(
    (t) => t.id !== task.id && !blockedBy.includes(t.id) && !blocks.includes(t.id)
  );
  const stepsDone = steps.filter((s) => s.is_done).length;
  const currentStatus = (value('status') as TaskStatus) ?? 'todo';
  const currentPriority = (value('priority') as TaskPriority) ?? 'medium';
  const progress = (value('progress') as number) ?? 0;

  return (
    <div className="tk">
      <div className="tk-scrim" onClick={onClose} aria-hidden="true" />
      <div
        className="tk-drawer"
        role="dialog"
        aria-modal="true"
        aria-label={isNew ? 'New task' : 'Edit task'}
      >
        {/* ── Head: the board it belongs to, then the task itself ────────── */}
        <header className="tk-drawer-head">
          <div className="tk-dw-ident">
            {board && <p className="tk-dw-board">{board.name}</p>}
            <textarea
              rows={1}
              className="tk-dw-title"
              value={(value('title') as string) ?? ''}
              placeholder={isNew ? 'What needs doing?' : 'Untitled task'}
              onChange={(e) => set('title', e.target.value)}
              aria-label="Task title"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="tk-drawer-body">
          {/* ══ LEFT: the WORK ══════════════════════════════════════════ */}
          <div className="tk-dw-main">
            <label className="block">
              <span className="tk-label">Notes</span>
              <textarea
                rows={6}
                className="tk-input tk-textarea mt-1.5"
                value={(value('description') as string) ?? ''}
                placeholder="Anything the person picking this up needs to know."
                onChange={(e) => set('description', e.target.value || null)}
              />
            </label>

            {/* The checklist: the STEPS of this task, distinct from what it
                waits on. Ticks write immediately, unlike every field above — a
                step is its own row, and holding a tick as a draft of the task
                would lose three of them to a Cancel pressed for an unrelated
                reason. Absent on a new task: a checklist needs a task id to
                hang from, and that exists one Save later. */}
            {!isNew && (
              <section>
                <h3 className="tk-section-title">
                  Checklist
                  {steps.length > 0 && (
                    <span className="tk-section-note">
                      {stepsDone} of {steps.length} done
                    </span>
                  )}
                </h3>
                <div className="mt-2 space-y-1.5">
                  {steps.map((s) => (
                    <div key={s.id} className="group flex items-center gap-2.5">
                      <input
                        type="checkbox"
                        checked={s.is_done}
                        onChange={() => toggleStep(s)}
                        className="h-3.5 w-3.5 shrink-0 accent-[hsl(var(--primary))]"
                        aria-label={s.title}
                      />
                      <span
                        className={cn('tk-sub-title flex-1', s.is_done && 'text-muted-foreground line-through')}
                      >
                        {s.title}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeStep(s)}
                        aria-label={`Remove ${s.title}`}
                        className="rounded p-0.5 text-muted-foreground opacity-0 hover:text-danger-400 group-hover:opacity-100"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <input
                      ref={stepInput}
                      className="tk-input"
                      value={newStep}
                      placeholder="Add a step"
                      onChange={(e) => setNewStep(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          addStep();
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="tk-btn"
                      onClick={addStep}
                      disabled={!newStep.trim()}
                      aria-label="Add step"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </section>
            )}

            {/* ── The record: discussion, files, trail ──────────────────── */}
            {!isNew && (
              <section className="flex min-h-0 flex-1 flex-col">
                <div className="tk-panel-tabs" role="tablist" aria-label="Task record">
                  {(
                    [
                      ['discussion', `Talk${comments.length ? ` · ${comments.length}` : ''}`],
                      ['files', `Files${files.length ? ` · ${files.length}` : ''}`],
                      ['activity', 'Activity'],
                    ] as [Panel, string][]
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={panel === key}
                      onClick={() => setPanel(key)}
                      className={cn('tk-panel-tab', panel === key && 'is-on')}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div className="min-h-0 flex-1 pt-3">
                  {loadingPanel && (
                    <Loader2 className="mx-auto h-4 w-4 animate-spin text-muted-foreground" />
                  )}

                  {/* Discussion */}
                  {!loadingPanel && panel === 'discussion' && (
                    <div className="flex h-full flex-col">
                      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
                        {comments.length === 0 && (
                          <p className="tk-hint">
                            Nothing said yet. A comment answers “what happened, and who said so” —
                            the reason a date moved, the quote that came back.
                          </p>
                        )}
                        {comments.map((c) => (
                          <div key={c.id} className="group flex gap-2.5">
                            <span
                              className="tk-avatar tk-comment-who"
                              style={personDisc(c.author_name)}
                            >
                              {initialsOf(c.author_name)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="tk-comment-meta">
                                <b>{c.author_name}</b> · {relTime(c.created_at)}
                                {c.edited_at && ' · edited'}
                              </p>
                              <p className="tk-comment-text">{c.body}</p>
                            </div>
                            {(c.author_user_id === user?.id || user?.role === 'super_admin') && (
                              <button
                                type="button"
                                onClick={() => removeComment(c)}
                                aria-label="Delete comment"
                                className="self-start rounded p-0.5 opacity-0 group-hover:opacity-100"
                              >
                                <X className="h-3 w-3 text-muted-foreground hover:text-danger-400" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex gap-2">
                        <textarea
                          rows={2}
                          className="tk-input"
                          style={{ minHeight: 0, resize: 'none' }}
                          value={newComment}
                          placeholder="Say something…  (⌘↵ to send)"
                          onChange={(e) => setNewComment(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault();
                              postComment();
                            }
                          }}
                        />
                        <button
                          type="button"
                          className="tk-btn tk-btn-primary"
                          onClick={postComment}
                          disabled={!newComment.trim()}
                          aria-label="Send"
                        >
                          <Send className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Files */}
                  {!loadingPanel && panel === 'files' && (
                    <div className="h-full overflow-y-auto">
                      <div
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault();
                          upload(e.dataTransfer.files);
                        }}
                        className="rounded-[3px] border border-dashed border-border p-5 text-center"
                      >
                        <Paperclip className="mx-auto h-4 w-4 text-muted-foreground" />
                        <button
                          type="button"
                          className="tk-btn mt-2"
                          disabled={uploading}
                          onClick={() => fileInput.current?.click()}
                        >
                          {uploading ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Upload className="h-3.5 w-3.5" />
                          )}
                          Choose a file
                        </button>
                        <input
                          ref={fileInput}
                          type="file"
                          multiple
                          className="sr-only"
                          aria-label="Attach a file to this task"
                          onChange={(e) => upload(e.target.files)}
                        />
                        <span className="tk-hint">
                          Or drop one here. Images, PDFs, spreadsheets, documents and plain text,
                          up to 10 MB each.
                        </span>
                      </div>

                      <div className="mt-3 space-y-1.5">
                        {files.map((f) => (
                          <div
                            key={f.id}
                            className="group flex items-center gap-2.5 rounded-[3px] border border-border px-2.5 py-2"
                          >
                            <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0 flex-1">
                              <p className="tk-file-name truncate">{f.name}</p>
                              <p className="tk-file-meta">
                                {formatBytes(f.file_size)} · {f.uploader_name} ·{' '}
                                {relTime(f.created_at)}
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => download(f)}
                              aria-label={`Download ${f.name}`}
                              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                            >
                              <Download className="h-3.5 w-3.5" />
                            </button>
                            {(f.uploaded_by === user?.id || user?.role === 'super_admin') && (
                              <button
                                type="button"
                                onClick={() => removeFile(f)}
                                aria-label={`Remove ${f.name}`}
                                className="rounded p-1 opacity-0 group-hover:opacity-100"
                              >
                                <X className="h-3.5 w-3.5 text-muted-foreground hover:text-danger-400" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <span className="tk-hint">
                        Attachments are private to this app — never served by a public URL, and
                        every download re-checks who is asking.
                      </span>
                    </div>
                  )}

                  {/* Activity */}
                  {!loadingPanel && panel === 'activity' && (
                    <div className="h-full overflow-y-auto">
                      {events.length === 0 && <p className="tk-hint">Nothing recorded yet.</p>}
                      <ol className="space-y-2.5">
                        {events.map((e) => (
                          <li key={e.id} className="tk-comment-meta">
                            {/* The FROZEN name — it survives the login it records. */}
                            <b>{e.actor_name}</b> {sentenceFor(e)}
                            <span className="ml-1 opacity-70">· {relTime(e.created_at)}</span>
                          </li>
                        ))}
                      </ol>
                      <span className="tk-hint">
                        Read-only. The entries are written by the actions themselves, and by
                        nothing else.
                      </span>
                    </div>
                  )}
                </div>
              </section>
            )}

            {isNew && (
              <span className="tk-hint">
                Steps, files, links and the activity trail appear once this task is created.
              </span>
            )}
          </div>

          {/* ══ RIGHT: the FACTS ════════════════════════════════════════ */}
          <aside className="tk-dw-side">
            {/* Segmented rather than dropdowns. Both lists are fixed sets, so a
                select hid the options behind a tap and said nothing about the
                ORDER they run in — and the order is the information. */}
            <div>
              <span className="tk-label">Status</span>
              {/* STACKED, not laid across: five options in a 380px rail gives
                  each ~58px, which ellipsises "In Progress" and "Quality
                  Check", and a segment whose labels you cannot read is a select
                  with extra steps. */}
              <div className="tk-seg tk-seg-stack mt-1.5" role="group" aria-label="Status">
                {STATUS_ORDER.map((s) => {
                  // THE SIGN-OFF IS THE BOARD OWNER'S, and the control says so
                  // rather than vanishing — faded, never removed, so the route
                  // to finished stays visible.
                  const barred = s === 'done' && !mayFinish;
                  return (
                    <button
                      key={s}
                      type="button"
                      aria-pressed={currentStatus === s}
                      aria-disabled={barred || undefined}
                      title={barred ? "Only this board's owner can move work into Done" : undefined}
                      onClick={() => !barred && set('status', s)}
                      className={cn(
                        'tk-seg-btn',
                        currentStatus === s && 'tk-seg-on',
                        barred && 'tk-seg-off'
                      )}
                    >
                      <span
                        className="tk-seg-dot"
                        style={{ background: `var(${STATUS_VAR[s]})` }}
                        aria-hidden="true"
                      />
                      <span className="tk-seg-label">{STATUS_LABELS[s]}</span>
                      {barred && <Lock className="ml-auto h-3 w-3 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <span className="tk-label">Priority</span>
              <div className="tk-seg mt-1.5" role="group" aria-label="Priority">
                {PRIORITY_ORDER.map((pr) => (
                  <button
                    key={pr}
                    type="button"
                    aria-pressed={currentPriority === pr}
                    onClick={() => set('priority', pr)}
                    className={cn('tk-seg-btn', currentPriority === pr && 'tk-seg-on')}
                  >
                    <span
                      className="tk-seg-bar"
                      style={{ background: `var(${PRIORITY_VAR[pr]})` }}
                      aria-hidden="true"
                    />
                    <span className="tk-seg-label">{PRIORITY_LABELS[pr]}</span>
                  </button>
                ))}
              </div>
            </div>

            <label className="block">
              <span className="tk-label">Assignee</span>
              <select
                className="tk-input mt-1.5"
                value={String((value('assignee_user_id') as number) ?? '')}
                onChange={(e) =>
                  set('assignee_user_id', e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">Unassigned</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            </label>

            <div className="tk-field-row">
              <label className="block">
                <span className="tk-label">Starts</span>
                <input
                  type="date"
                  className="tk-input mt-1.5"
                  value={(value('start_date') as string) ?? ''}
                  onChange={(e) => set('start_date', e.target.value || null)}
                />
              </label>
              <label className="block">
                <span className="tk-label">Due</span>
                <input
                  type="date"
                  className="tk-input mt-1.5"
                  value={(value('due_date') as string) ?? ''}
                  onChange={(e) => set('due_date', e.target.value || null)}
                />
              </label>
            </div>

            <div>
              <span className="tk-label">
                Progress · {progress}%
                {progress === 100 && !mayFinish && (
                  <span className="tk-column-note ml-2 normal-case tracking-normal">
                    100% sends this to Quality Check
                  </span>
                )}
              </span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={progress}
                onChange={(e) => set('progress', Number(e.target.value))}
                className="tk-range mt-1.5"
                aria-label="Progress"
              />
            </div>

            {!isNew && (
              <div>
                <span className="tk-label">Waiting on</span>
                <div className="mt-1.5 space-y-1.5">
                  {blockedBy.length === 0 && (
                    <p className="tk-hint" style={{ marginTop: 0 }}>
                      Nothing — this can start.
                    </p>
                  )}
                  {blockedBy.map((id) => (
                    <div key={id} className="group flex items-center gap-2">
                      <span className="tk-chip tk-chip-blocked min-w-0 flex-1">
                        <Lock className="h-2.5 w-2.5 shrink-0" />
                        <span className="tk-chip-text">{titleOf(id)}</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => unlink(id)}
                        aria-label="Unlink"
                        className="opacity-0 group-hover:opacity-100"
                      >
                        <Unlink className="h-3 w-3 text-muted-foreground hover:text-danger-400" />
                      </button>
                    </div>
                  ))}
                  {linkable.length > 0 && (
                    <select
                      className="tk-input"
                      value={dependencyPick}
                      onChange={(e) => {
                        const v = e.target.value;
                        setDependencyPick('');
                        if (v) link(Number(v));
                      }}
                    >
                      <option value="">Wait on another task…</option>
                      {linkable.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.title}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            )}

            {/* The REVERSE edge — the half you can't see from here. "What falls
                over if I move this" is asked before rescheduling or deleting,
                and the answer is usually on another board. */}
            {!isNew && blocks.length > 0 && (
              <div>
                <span className="tk-label">Holding up</span>
                <div className="mt-1.5 space-y-1.5">
                  {blocks.map((id) => (
                    <span key={id} className="tk-chip flex">
                      <Link2 className="h-2.5 w-2.5 shrink-0" />
                      <span className="tk-chip-text">{titleOf(id)}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </aside>
        </div>

        {/* ── Foot ────────────────────────────────────────────────────────── */}
        <footer className="tk-drawer-foot">
          {!isNew &&
            (confirmDelete ? (
              <>
                <button type="button" className="tk-btn tk-btn-danger" onClick={doDelete}>
                  Delete for good
                </button>
                <button type="button" className="tk-btn" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="tk-btn tk-btn-danger"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            ))}

          <span className="tk-comment-meta ml-auto">
            {task.completed_at
              ? `Completed ${relTime(task.completed_at)}`
              : task.created_at
                ? `Created ${relTime(task.created_at)}`
                : ''}
          </span>

          <button type="button" className="tk-btn" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="tk-btn tk-btn-primary"
            onClick={save}
            disabled={!dirty || saving}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {saving ? 'Saving…' : isNew ? 'Create task' : 'Save'}
          </button>
        </footer>
      </div>
    </div>
  );
};

/** File sizes as a person reads them. */
const formatBytes = (bytes: number | null): string => {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * One trail entry as a sentence.
 *
 * The server already writes LABELS rather than keys ("In Progress", not
 * "in_progress"; a name, not a user id), so this only supplies the grammar. An
 * unrecognised `field` renders verbatim, which is the point of the column being
 * text: a newly-tracked field appears here with no frontend deploy.
 */
const sentenceFor = (e: TaskEvent): string => {
  if (e.action === 'created') return 'created this task';
  if (e.action === 'linked') {
    return e.field === 'blocks' ? `linked ${e.to} to wait on this` : `set this to wait on ${e.to}`;
  }
  if (e.action === 'unlinked') {
    return e.field === 'blocks' ? `unlinked ${e.to} from this` : `stopped this waiting on ${e.to}`;
  }
  const field = (e.field ?? '').replace(/_/g, ' ');
  if (e.field === 'description') return 'edited the notes';
  if (e.field === 'attachment') return e.to ? `attached ${e.to}` : `removed the file ${e.from}`;
  if (e.from === null && e.to !== null) return `set the ${field} to ${e.to}`;
  if (e.to === null) return `cleared the ${field}`;
  return `changed the ${field} from ${e.from} to ${e.to}`;
};

export default TaskDrawer;
