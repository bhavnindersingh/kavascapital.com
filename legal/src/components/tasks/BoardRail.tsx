import React, { useEffect, useRef, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  ChevronDown,
  ChevronUp,
  MoreVertical,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import type { PlatformUser, TaskBoard } from '@/types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { DEFAULT_BOARD_COLOUR } from './taskUtils';

/**
 * How long a destructive press stays armed before it forgets itself. Two taps,
 * not a browser `confirm()`: a centred OS dialog is the one thing on this
 * screen that looks like nothing else on it, it cannot say which board or how
 * many tasks, and it trains people to dismiss it. Arming in place puts the
 * warning where the press was and lets a wrong reach simply time out.
 */
const CONFIRM_MS = 4000;

/**
 * The rail: every board, live first, archived filed at the foot.
 *
 * ARCHIVED BOARDS ARE ALWAYS LISTED, in a collapsed group. Archiving is offered
 * as the safe alternative to deleting, so a board that archived itself out of
 * the app entirely — recoverable only from psql — would be the more destructive
 * of the two options wearing the gentler word.
 *
 * The badge counts OPEN work, not everything. A finished board wearing the same
 * fat number as a board with everything still to do is the opposite of what you
 * want to know at a glance down a rail.
 *
 * Reordering is a nudge (▲▼) rather than a drag. A drag needs a drop target the
 * width of the rail and a ghost row, for a list of six; the arrows are
 * unambiguous, keyboard-reachable, and they renumber the WHOLE live group on
 * every move — boards can share a sort_order (anything made before the endpoint
 * existed), so writing just the swapped pair leaves the rest tied and
 * re-sorted by name on the next load, and the move undoes itself with nothing
 * said.
 */

export interface BoardRailProps {
  /** Inline create, from the rail's + — not a modal. */
  onCreateInline: (name: string) => void;
  /** Inline rename, from the row itself. */
  onRename: (board: TaskBoard, name: string) => void;
  boards: TaskBoard[];
  activeBoardId: number | null;
  onSelect: (id: number) => void;
  onArchive: (board: TaskBoard, archived: boolean) => void;
  onDelete: (board: TaskBoard) => void;
  onReorder: (updates: { id: number; sort_order: number }[]) => void;
  /** Person mode is a view of the rail with nothing selected. */
  personMode: boolean;
  onPersonMode: () => void;
  user: PlatformUser | null;
  busy?: boolean;
}

const BoardRow: React.FC<{
  board: TaskBoard;
  active: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onSelect: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onMove: (delta: -1 | 1) => void;
  armed: 'delete' | 'archive' | null;
  onArm: (what: 'delete' | 'archive' | null) => void;
  renaming: boolean;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onCancelRename: () => void;
}> = ({
  board,
  active,
  canMoveUp,
  canMoveDown,
  onSelect,
  onArchive,
  onDelete,
  onMove,
  armed,
  onArm,
  renaming,
  onStartRename,
  onRename,
  onCancelRename,
}) =>
  // RENAMING HAPPENS IN PLACE. A board's name is one field; sending somebody to
  // a modal to change one field is three interactions where one would do, and
  // it hides the rail they are renaming a row of.
  renaming ? (
    <div className="px-1 py-1">
      <input
        autoFocus
        defaultValue={board.name}
        aria-label={`Rename ${board.name}`}
        className="tk-input"
        onBlur={(e) => onRename(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onRename((e.target as HTMLInputElement).value);
          if (e.key === 'Escape') onCancelRename();
        }}
      />
    </div>
  ) : (
  <div
    className={cn(
      'group relative flex items-center gap-2 rounded-lg pl-2.5 pr-1 py-2 text-body transition-colors',
      active
        ? 'bg-primary/10 border border-primary/25 text-foreground'
        : 'border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
    )}
  >
    {/* The whole row is the control — a stretched button rather than a
        clickable wrapper, so it is reachable by keyboard and announced as a
        button, while the menu trigger beside it stays its own control. A
        <button> cannot contain the menu's <button>, hence the overlay. */}
    <button
      type="button"
      onClick={onSelect}
      aria-current={active ? 'true' : undefined}
      className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="sr-only">{board.name}</span>
    </button>
    <span
      className="pointer-events-none relative h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: board.color || DEFAULT_BOARD_COLOUR }}
    />
    <span className="pointer-events-none relative flex-1 truncate font-medium">{board.name}</span>

    {/* An owner is named: the board reviews its own finished work, and the rail
        says so without needing the board opened. */}
    {board.owner_user_id && (
      <ShieldCheck
        className="pointer-events-none relative h-3.5 w-3.5 shrink-0 text-muted-foreground"
        aria-label="Signed off by an owner"
      />
    )}

    {board.open_count > 0 && (
      <span
        className={cn(
          'pointer-events-none relative shrink-0 rounded px-1.5 py-0.5 text-micro font-bold tabular-nums',
          active ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground'
        )}
      >
        {board.open_count}
      </span>
    )}

    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
        <button
          className="relative shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={`Options for ${board.name}`}
        >
          <MoreVertical className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onSelect={onStartRename}>
          <Pencil className="mr-2 h-3.5 w-3.5" /> Rename
        </DropdownMenuItem>
        {!board.is_archived && (
          <>
            <DropdownMenuItem disabled={!canMoveUp} onSelect={() => onMove(-1)}>
              <ChevronUp className="mr-2 h-3.5 w-3.5" /> Move up
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canMoveDown} onSelect={() => onMove(1)}>
              <ChevronDown className="mr-2 h-3.5 w-3.5" /> Move down
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuSeparator />
        {/* Archive arms like delete does when — and ONLY when — the board
            still has open tasks. Archive is sold as the safe ending, and for a
            finished board it is; but archived boards leave the My-work fetch,
            so archiving a half-done board silently removes live tasks from
            everyone's personal list. That is the one destructive path here
            wearing the gentler word, so it gets the same two taps. A board at
            zero open archives in one. */}
        <DropdownMenuItem
          // The menu must STAY OPEN between the arming tap and the confirming
          // one — closing it would put the second tap on whatever row is
          // underneath.
          onSelect={(e) => {
            if (board.is_archived || !board.open_count || armed === 'archive') {
              onArm(null);
              onArchive();
              return;
            }
            e.preventDefault();
            onArm('archive');
          }}
          className={armed === 'archive' ? 'text-warning-400 focus:text-warning-400' : undefined}
        >
          {board.is_archived ? (
            <>
              <ArchiveRestore className="mr-2 h-3.5 w-3.5" /> Restore
            </>
          ) : armed === 'archive' ? (
            <>
              <Archive className="mr-2 h-3.5 w-3.5" /> Archive {board.open_count} open? Tap again
            </>
          ) : (
            <>
              <Archive className="mr-2 h-3.5 w-3.5" /> Archive
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={(e) => {
            if (armed === 'delete') {
              onArm(null);
              onDelete();
              return;
            }
            e.preventDefault();
            onArm('delete');
          }}
          className="text-danger-400 focus:bg-destructive/10 focus:text-danger-400"
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          {armed === 'delete' ? 'Tap again to delete for good' : 'Delete…'}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    </div>
  );

export const BoardRail: React.FC<BoardRailProps> = ({
  boards,
  activeBoardId,
  onSelect,
  onCreateInline,
  onRename,
  onArchive,
  onDelete,
  onReorder,
  personMode,
  onPersonMode,
  busy,
}) => {
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  // One armed row at a time, and it forgets itself after CONFIRM_MS so a press
  // somebody made minutes ago can never be the one that lands.
  const [armed, setArmed] = useState<{ id: number; what: 'delete' | 'archive' } | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const arm = (id: number, what: 'delete' | 'archive' | null) => {
    if (armTimer.current) clearTimeout(armTimer.current);
    if (!what) return setArmed(null);
    setArmed({ id, what });
    armTimer.current = setTimeout(() => setArmed(null), CONFIRM_MS);
  };
  useEffect(() => () => { if (armTimer.current) clearTimeout(armTimer.current); }, []);

  const live = boards.filter((b) => !b.is_archived);
  const archived = boards.filter((b) => b.is_archived);

  /**
   * Nudge one board and renumber the whole live group from the result. See the
   * note at the head of this file for why the whole list is sent.
   */
  const move = (board: TaskBoard, delta: -1 | 1) => {
    const index = live.findIndex((b) => b.id === board.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= live.length) return;
    const next = [...live];
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next.map((b, i) => ({ id: b.id, sort_order: i })));
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="flex items-center justify-between px-3 py-3">
        <h2 className="text-micro font-semibold uppercase tracking-widest text-muted-foreground">
          Boards
        </h2>
        <button
          type="button"
          className="tk-column-add"
          onClick={() => setCreating(true)}
          disabled={busy}
          aria-label="New board"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 space-y-0.5 overflow-y-auto px-2 pb-3">
        {/* CREATING HAPPENS IN PLACE too, and it asks for one thing: a name.
            Colour, description and owner are all edited on the board itself
            once it exists — a create form that collects everything up front
            asks four questions to answer one. */}
        {creating && (
          <input
            autoFocus
            placeholder="Board name"
            aria-label="New board name"
            className="tk-input mb-2"
            onBlur={(e) => {
              const name = e.target.value.trim();
              setCreating(false);
              if (name) onCreateInline(name);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                (e.target as HTMLInputElement).value = '';
                setCreating(false);
              }
            }}
          />
        )}
        {/* The other axis. It sits with the boards because it is a way of
            reading the same rows, not a different screen. */}
        <button
          type="button"
          onClick={onPersonMode}
          aria-current={personMode ? 'true' : undefined}
          className={cn(
            'mb-2 flex w-full items-center gap-2 rounded-lg border px-2.5 py-2 text-body transition-colors',
            personMode
              ? 'border-primary/25 bg-primary/10 text-foreground'
              : 'border-transparent text-muted-foreground hover:bg-accent hover:text-foreground'
          )}
        >
          <span className="font-medium">My work</span>
          <span className="ml-auto text-micro uppercase tracking-wider text-muted-foreground">
            all boards
          </span>
        </button>

        {live.length === 0 && (
          <p className="px-2.5 py-6 text-center text-meta text-muted-foreground">
            No boards yet. A board is a project — “Broker migration”, “Q4 review”.
          </p>
        )}

        {live.map((board, i) => (
          <BoardRow
            key={board.id}
            board={board}
            active={!personMode && board.id === activeBoardId}
            canMoveUp={i > 0}
            canMoveDown={i < live.length - 1}
            onSelect={() => onSelect(board.id)}
            onArchive={() => onArchive(board, true)}
            onDelete={() => onDelete(board)}
            onMove={(d) => move(board, d)}
            armed={armed?.id === board.id ? armed.what : null}
            onArm={(what) => arm(board.id, what)}
            renaming={renamingId === board.id}
            onStartRename={() => setRenamingId(board.id)}
            onRename={(name) => {
              setRenamingId(null);
              const clean = name.trim();
              if (clean && clean !== board.name) onRename(board, clean);
            }}
            onCancelRename={() => setRenamingId(null)}
          />
        ))}

        {archived.length > 0 && (
          <div className="pt-3">
            <button
              onClick={() => setShowArchived((v) => !v)}
              className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-eyebrow font-semibold uppercase tracking-widest text-muted-foreground hover:text-foreground"
            >
              {showArchived ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronUp className="h-3 w-3 rotate-90" />
              )}
              Archived · {archived.length}
            </button>
            {showArchived &&
              archived.map((board) => (
                <BoardRow
                  key={board.id}
                  board={board}
                  active={!personMode && board.id === activeBoardId}
                  canMoveUp={false}
                  canMoveDown={false}
                  onSelect={() => onSelect(board.id)}
                        onArchive={() => onArchive(board, false)}
                  onDelete={() => onDelete(board)}
                  onMove={() => undefined}
                  armed={armed?.id === board.id ? armed.what : null}
                  onArm={(what) => arm(board.id, what)}
                  renaming={renamingId === board.id}
            onStartRename={() => setRenamingId(board.id)}
            onRename={(name) => {
              setRenamingId(null);
              const clean = name.trim();
              if (clean && clean !== board.name) onRename(board, clean);
            }}
            onCancelRename={() => setRenamingId(null)}
          />
              ))}
          </div>
        )}
      </div>
    </aside>
  );
};

export default BoardRail;
