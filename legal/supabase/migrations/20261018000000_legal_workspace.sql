-- legal.kavascapital.com — the partners' workspace, moved off the nightingale
-- trading stack (owner, 2026-10-18): users, the task board, the Account
-- Management ledger and the Documents cabinet.
--
-- The tables are nightingale's alembic revisions, carried over verbatim so the
-- rules stay where nightingale put them — in the schema:
--   658a2967fe5d  users            (now tied to Supabase Auth, see below)
--   f1a2b3c4d5e6  task board       a7b8c9d0e1f2  task_files
--   b8c9d0e1f2a3  account_entries  d9e0f1a2b3c4  transfer/GST + account_files
--   e0f1a2b3c4d5  document cabinet c3d4e5f6a7b9  salary_month
--   f2a3b4c5d6e7  major heads
-- Read those files for the reasoning behind each constraint; it is not
-- repeated here.
--
-- WHO CAN READ THESE TABLES: only the `api` edge function, which connects as
-- the database owner. RLS is enabled on every table with NO policies, so the
-- anon and authenticated roles PostgREST hands the browser see nothing. Every
-- authority rule (partners only, who may sign work off) lives in the function,
-- as it did in nightingale's FastAPI routes.

-- ── Users ────────────────────────────────────────────────────────────────────
-- Supabase Auth owns the password; this row owns the name, role and active
-- flag. `id` stays an integer so every foreign key below, and the rows copied
-- over from nightingale, keep their meaning unchanged. `auth_id` is the link to
-- auth.users; SET NULL rather than CASCADE so deleting a login never takes its
-- tasks' history with it (the row is deactivated instead).
CREATE TABLE IF NOT EXISTS public.users (
    id SERIAL PRIMARY KEY,
    auth_id UUID UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'viewer'
        CHECK (role IN ('viewer', 'trader', 'manager', 'super_admin')),
    is_active BOOLEAN NOT NULL DEFAULT true,
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_email ON public.users (email);

-- ── Task board (f1a2b3c4d5e6) ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.task_boards (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    color VARCHAR(20),
    is_archived BOOLEAN NOT NULL DEFAULT false,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    owner_user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_task_boards_name_lower ON public.task_boards (LOWER(name));
CREATE INDEX IF NOT EXISTS idx_task_boards_archived_sort ON public.task_boards (is_archived, sort_order);

CREATE TABLE IF NOT EXISTS public.tasks (
    id SERIAL PRIMARY KEY,
    board_id INTEGER NOT NULL REFERENCES public.task_boards(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'todo',
    priority VARCHAR(10) NOT NULL DEFAULT 'medium',
    assignee_user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    start_date DATE,
    due_date DATE,
    progress INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT tasks_status_check
        CHECK (status IN ('todo','in_progress','blocked','quality_check','done')),
    CONSTRAINT tasks_priority_check
        CHECK (priority IN ('low','medium','high','urgent')),
    CONSTRAINT tasks_progress_check
        CHECK (progress >= 0 AND progress <= 100),
    CONSTRAINT tasks_dates_ordered_check
        CHECK (start_date IS NULL OR due_date IS NULL OR due_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_tasks_board_status_sort ON public.tasks (board_id, status, sort_order);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON public.tasks (assignee_user_id);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date ON public.tasks (due_date);

CREATE TABLE IF NOT EXISTS public.task_subtasks (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    is_done BOOLEAN NOT NULL DEFAULT false,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_subtasks_task_sort ON public.task_subtasks (task_id, sort_order);

CREATE TABLE IF NOT EXISTS public.task_comments (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    author_user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    body TEXT NOT NULL,
    edited_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_comments_task ON public.task_comments (task_id);

CREATE TABLE IF NOT EXISTS public.task_dependencies (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    depends_on_task_id INTEGER NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT task_dependencies_not_self_check CHECK (task_id <> depends_on_task_id),
    CONSTRAINT task_dependencies_pair_unique UNIQUE (task_id, depends_on_task_id)
);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on ON public.task_dependencies (depends_on_task_id);

CREATE TABLE IF NOT EXISTS public.task_events (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    actor_user_id INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    actor_name VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL,
    field VARCHAR(50),
    from_value TEXT,
    to_value TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_task_events_task_created ON public.task_events (task_id, created_at DESC, id DESC);

-- a7b8c9d0e1f2. `file_key` is the object name in the private `tasks` bucket.
CREATE TABLE IF NOT EXISTS public.task_files (
    id SERIAL PRIMARY KEY,
    task_id INTEGER NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    file_key VARCHAR(80) NOT NULL,
    mime_type VARCHAR(120),
    file_size BIGINT,
    uploaded_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT task_files_key_unique UNIQUE (file_key)
);
CREATE INDEX IF NOT EXISTS idx_task_files_task ON public.task_files (task_id);

-- ── Account Management (b8c9d0e1f2a3, d9e0f1a2b3c4, c3d4e5f6a7b9, f2a3b4c5d6e7)
CREATE TABLE IF NOT EXISTS public.account_entries (
    id SERIAL PRIMARY KEY,
    entry_date DATE NOT NULL,
    category VARCHAR(20) NOT NULL,
    party VARCHAR(200),
    description VARCHAR(500) NOT NULL,
    amount NUMERIC(14, 2) NOT NULL CHECK (amount >= 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'INR',
    payment_method VARCHAR(50),
    -- NULL = joint; otherwise the partner (login email, lower-case) it belongs to.
    owner_email VARCHAR(255),
    notes TEXT,
    created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    paid_from VARCHAR(120),
    reference_no VARCHAR(120),
    payee_account VARCHAR(200),
    bank_narration TEXT,
    gst_applicable BOOLEAN NOT NULL DEFAULT FALSE,
    vendor_gstin VARCHAR(15),
    invoice_no VARCHAR(60),
    invoice_date DATE,
    gst_rate NUMERIC(5, 2),
    taxable_value NUMERIC(14, 2),
    gst_amount NUMERIC(14, 2),
    salary_month DATE,
    CONSTRAINT account_entries_category_check CHECK (category IN (
        'salary', 'office', 'subscription', 'marketing', 'travel',
        'professional', 'purchase', 'tax_bank', 'company', 'personal'
    ))
);
CREATE INDEX IF NOT EXISTS idx_account_entries_date ON public.account_entries (entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_account_entries_category ON public.account_entries (category);
CREATE INDEX IF NOT EXISTS idx_account_entries_owner ON public.account_entries (owner_email);
CREATE INDEX IF NOT EXISTS idx_account_entries_reference ON public.account_entries (reference_no);
CREATE INDEX IF NOT EXISTS idx_account_entries_salary_month
    ON public.account_entries (salary_month) WHERE category = 'salary';

-- `file_key` is the object name in the private `accounts` bucket.
CREATE TABLE IF NOT EXISTS public.account_files (
    id SERIAL PRIMARY KEY,
    entry_id INTEGER NOT NULL REFERENCES public.account_entries(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    file_key VARCHAR(80) NOT NULL,
    mime_type VARCHAR(120),
    file_size BIGINT,
    uploaded_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT account_files_key_unique UNIQUE (file_key)
);
CREATE INDEX IF NOT EXISTS idx_account_files_entry ON public.account_files (entry_id);

-- ── Documents cabinet (e0f1a2b3c4d5) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.document_folders (
    id SERIAL PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    description TEXT,
    parent_id INTEGER REFERENCES public.document_folders(id) ON DELETE CASCADE,
    created_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT document_folders_not_own_parent CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX IF NOT EXISTS idx_document_folders_parent ON public.document_folders (parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_document_folders_sibling_name
    ON public.document_folders (COALESCE(parent_id, 0), LOWER(name));

-- `file_key` is the object name in the private `documents` bucket.
CREATE TABLE IF NOT EXISTS public.documents (
    id SERIAL PRIMARY KEY,
    folder_id INTEGER NOT NULL REFERENCES public.document_folders(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    file_key VARCHAR(80) NOT NULL,
    mime_type VARCHAR(120),
    file_size BIGINT,
    uploaded_by INTEGER REFERENCES public.users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    CONSTRAINT documents_key_unique UNIQUE (file_key)
);
CREATE INDEX IF NOT EXISTS idx_documents_folder ON public.documents (folder_id);

-- ── Locked to the edge function ──────────────────────────────────────────────
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_subtasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.document_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

-- ── File buckets ─────────────────────────────────────────────────────────────
-- Private, with no storage.objects policies: only the service role (the edge
-- function) reads or writes them, and a file leaves only through the API's
-- download routes, which re-check the caller. 10 MB each, as on nightingale.
-- The extension allowlists stay in the function (extension is the control,
-- the declared type only a veto), so no MIME list is set here.
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES
    ('tasks', 'tasks', false, 10485760),
    ('accounts', 'accounts', false, 10485760),
    ('documents', 'documents', false, 10485760)
ON CONFLICT (id) DO NOTHING;
