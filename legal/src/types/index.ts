export interface ApiResponse<T = any> {
  status: string;
  message?: string;
  data?: T;
  error?: string;
}

export interface PlatformUser {
  id: number;
  email: string;
  full_name: string;
  role: 'super_admin' | 'trader' | 'manager' | 'viewer';
  is_active: boolean;
  last_login?: string | null;
}

// Account Management ledger (super_admin only)
export type AccountCategory =
  | 'salary' | 'office' | 'subscription' | 'marketing' | 'travel'
  | 'professional' | 'purchase' | 'tax_bank' | 'company' | 'personal';
export type AccountCurrency = 'INR' | 'USD';

export interface AccountEntry {
  id: number;
  entry_date: string;
  category: AccountCategory;
  party: string | null;
  description: string;
  amount: string; // NUMERIC as a string — never a float
  currency: AccountCurrency;
  payment_method: string | null;
  owner_email: string | null; // null = joint
  notes: string | null;
  // Transfer details — what the bank statement shows, for matching.
  paid_from: string | null;
  reference_no: string | null;
  payee_account: string | null;
  bank_narration: string | null;
  // GST invoice
  gst_applicable: boolean;
  vendor_gstin: string | null;
  invoice_no: string | null;
  invoice_date: string | null;
  gst_rate: string | null;
  taxable_value: string | null;
  gst_amount: string | null;
  salary_month: string | null; // salaries: first day of the month it is for
  files: AccountFile[];
  created_by: number | null;
  created_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountFile {
  id: number;
  entry_id: number;
  name: string;
  mime_type: string | null;
  file_size: number | null;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  created_at: string;
}

export interface AccountEntryInput {
  entry_date: string;
  category: AccountCategory;
  party?: string | null;
  description: string;
  amount: string;
  currency: AccountCurrency;
  payment_method?: string | null;
  owner_email: string | null; // null = joint
  notes?: string | null;
  paid_from?: string | null;
  reference_no?: string | null;
  payee_account?: string | null;
  bank_narration?: string | null;
  gst_applicable: boolean;
  vendor_gstin?: string | null;
  invoice_no?: string | null;
  invoice_date?: string | null;
  gst_rate?: string | null;
  taxable_value?: string | null;
  gst_amount?: string | null;
  salary_month?: string | null; // 'YYYY-MM-DD'; the server stores the 1st
}

export interface AccountTotal {
  category: AccountCategory;
  currency: AccountCurrency;
  owner_email: string | null;
  total: string;
  count: number;
}

export interface AccountPerson {
  email: string;
  name: string;
}

export interface AccountAccess {
  allowed: boolean;
  people: AccountPerson[];
}

// Documents cabinet — nested folders, partners only (same gate as accounts).
export interface DocumentFolder {
  id: number;
  name: string;
  description: string | null;
  parent_id: number | null; // null = top level
  document_count: number; // filed directly in this folder, not its subfolders
  created_at: string;
}

export interface CabinetDocument {
  id: number;
  folder_id: number;
  name: string; // display name, no extension
  description: string | null;
  ext: string;
  mime_type: string | null;
  file_size: number | null;
  uploaded_by: number | null;
  uploaded_by_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountMonthTotal {
  month: string; // YYYY-MM
  category: AccountCategory;
  currency: AccountCurrency;
  total: string;
}

export interface AccountListResponse {
  entries: AccountEntry[];
  totals: AccountTotal[];
}


// ============================================================================
// Task board
// ============================================================================
// Mirrors the backend contract in `backend/app/api/tasks.py`. Dates are plain
// day strings ('YYYY-MM-DD') with no time and no zone — a due date has no time
// of day, and anything zone-aware would render as the previous day for a
// browser behind ET. Timestamps (`created_at`, `completed_at`) are real ISO
// instants and are the only fields here a Date is built from.

export const TASK_STATUSES = ['todo', 'in_progress', 'blocked', 'quality_check', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface TaskSubtask {
  id: number;
  title: string;
  is_done: boolean;
  sort_order: number;
}

/** The board a task belongs to, sent only on the person axis. */
export interface TaskBoardStub {
  id: number;
  name: string;
  color: string | null;
  /** Who signs this board's work off. Null = the board has no reviewer. */
  owner_user_id: number | null;
}

export interface Task {
  id: number;
  board_id: number;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee_user_id: number | null;
  assignee_name: string | null;
  start_date: string | null;
  due_date: string | null;
  progress: number;
  sort_order: number;
  completed_at: string | null;
  created_at: string | null;
  /** Ids this task waits on. */
  blocked_by: number[];
  /** Ids waiting on THIS one — the reverse edge, sent rather than derived. */
  blocks: number[];
  subtasks: TaskSubtask[];
  /** Present on the person axis only: a task read across boards needs context. */
  board?: TaskBoardStub;
}

/** A task a fetch NAMES but does not contain — enough for a chip and a link. */
export interface TaskStub {
  id: number;
  title: string;
  status: TaskStatus;
  board_id: number;
}

export interface TaskBoard {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  is_archived: boolean;
  sort_order: number;
  open_count: number;
  owner_user_id: number | null;
  owner_name: string | null;
  created_at?: string | null;
}

export interface TaskComment {
  id: number;
  task_id: number;
  body: string;
  author_user_id: number | null;
  author_name: string;
  created_at: string;
  edited_at: string | null;
}

export interface TaskEvent {
  id: number;
  /** Frozen at write time — it survives the login it names. */
  actor_name: string;
  actor_user_id: number | null;
  action: 'created' | 'updated' | 'linked' | 'unlinked' | string;
  field: string | null;
  from: string | null;
  to: string | null;
  created_at: string;
}

export interface TaskListResponse {
  tasks: Task[];
  foreign_tasks: TaskStub[];
}

/** Every field is optional: the API applies only the keys actually sent. */
export interface TaskInput {
  board_id?: number;
  title?: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  assignee_user_id?: number | null;
  start_date?: string | null;
  due_date?: string | null;
  progress?: number;
  sort_order?: number;
}

export interface TaskReorderUpdate {
  id: number;
  status?: TaskStatus;
  sort_order: number;
}

/**
 * One attachment's metadata. The on-disk key is deliberately NOT here — it is
 * the server's business, and the only route to the bytes is the download
 * endpoint, which re-checks the caller.
 */
export interface TaskFile {
  id: number;
  task_id: number;
  name: string;
  mime_type: string | null;
  file_size: number | null;
  uploaded_by: number | null;
  uploader_name: string;
  created_at: string;
}
