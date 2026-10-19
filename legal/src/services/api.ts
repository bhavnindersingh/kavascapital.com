import axios, { AxiosInstance, AxiosResponse } from 'axios';
import { supabase, SUPABASE_URL, SUPABASE_ANON_KEY } from '@/lib/supabase';
import {
  ApiResponse,
  PlatformUser,
  AccountAccess,
  DocumentFolder,
  CabinetDocument,
  AccountEntry,
  AccountEntryInput,
  AccountFile,
  AccountListResponse,
  AccountMonthTotal,
  Task,
  TaskBoard,
  TaskComment,
  TaskEvent,
  TaskInput,
  TaskListResponse,
  TaskReorderUpdate,
  TaskFile,
  TaskSubtask,
} from '@/types';

// The `api` edge function serves nightingale's `/platform/...` routes
// unchanged, so every call below keeps its nightingale path.
const api: AxiosInstance = axios.create({
  baseURL: `${SUPABASE_URL}/functions/v1/api`,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
});

// The bearer is the Supabase session's access token; supabase-js refreshes it
// before it expires, so it is read fresh on every request.
api.interceptors.request.use(async (config) => {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  config.headers.apikey = SUPABASE_ANON_KEY;
  return config;
});

api.interceptors.response.use(
  (response: AxiosResponse) => {
    return response.data;
  },
  async (error) => {
    if (error.response?.status === 401) {
      // An expired or revoked session: drop it and go back to login. Guarded
      // on a session existing so a failed sign-in can't loop.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        await supabase.auth.signOut();
        if (!window.location.pathname.startsWith('/login')) {
          window.location.href = '/login';
        }
      }
    }
    return Promise.reject(error);
  }
);

/** A Supabase Auth error as the `{ response: { data: { detail } } }` shape the pages read. */
const authError = (message: string) =>
  Object.assign(new Error(message), { response: { data: { detail: message } } });

// Auth API — Supabase Auth holds the password; the API holds the profile.
export const authApi = {
  login: async (email: string, password: string): Promise<{ user: PlatformUser }> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      throw authError(error.message === 'Invalid login credentials' ? 'Incorrect email or password' : error.message);
    }
    try {
      const user: PlatformUser = await api.get('/platform/auth/me');
      return { user };
    } catch (err) {
      // Signed in to Supabase but no active profile here: don't leave a half session.
      await supabase.auth.signOut();
      throw err;
    }
  },

  getMe: async (): Promise<PlatformUser> => {
    return api.get('/platform/auth/me');
  },

  logout: async (): Promise<void> => {
    await supabase.auth.signOut();
  },

  /**
   * Asks the API to email a reset link (through Resend). Always answers the
   * same sentence, whether or not the email has a login.
   */
  forgotPassword: async (email: string): Promise<{ detail: string }> => {
    return api.post('/auth/forgot', { email });
  },

  /**
   * Sets a new password from an emailed link. The token is spent only here, on
   * the button press — never by a mail scanner opening the link. Without a
   * token (an older Supabase-style link), the session the link opened is used.
   */
  updatePassword: async (password: string, tokenHash?: string | null): Promise<void> => {
    if (tokenHash) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'recovery' });
      if (error) throw authError('This link has expired or was already used. Ask for a new one from the sign-in page.');
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) throw authError(error.message);
    // Tell the owner of the login, by email. Best effort.
    await api.post('/platform/auth/password-changed').catch(() => undefined);
  },
};

// User Management API (Admin Only)
export const usersApi = {
  listUsers: async (): Promise<PlatformUser[]> => {
    return api.get('/platform/users');
  },

  /** No password = the welcome email lets them set their own. */
  createUser: async (userData: {
    email: string;
    password?: string;
    full_name: string;
    role: string;
  }): Promise<PlatformUser & { emailed: boolean }> => {
    return api.post('/platform/users', userData);
  },

  updateUser: async (
    userId: number,
    data: Partial<{ full_name: string; role: string; is_active: boolean }>
  ): Promise<PlatformUser> => {
    return api.patch(`/platform/users/${userId}`, data);
  },

  deactivateUser: async (userId: number): Promise<ApiResponse> => {
    return api.delete(`/platform/users/${userId}`);
  },

  /** Emails a reset link. `link` comes back only when the email couldn't be sent. */
  sendPasswordReset: async (userId: number): Promise<{ status: string; emailed: boolean; email: string; link?: string }> => {
    return api.post(`/platform/users/${userId}/password-reset`);
  },
};

// Account Management API (the two partners' logins only)
export const accountsApi = {
  // Never 403s — tells the sidebar/route whether to show the page.
  access: async (): Promise<AccountAccess> => {
    return api.get('/platform/accounts/access');
  },
  list: async (params: {
    category?: string;
    owner?: string; // 'joint' or a partner's email
    gst_only?: boolean;
    date_from?: string;
    date_to?: string;
    search?: string;
  } = {}): Promise<AccountListResponse> => {
    return api.get('/platform/accounts', { params });
  },
  monthly: async (params: {
    date_from: string;
    date_to: string;
    owner?: string;
  }): Promise<{ months: AccountMonthTotal[] }> => {
    return api.get('/platform/accounts/monthly', { params });
  },
  create: async (data: AccountEntryInput): Promise<AccountEntry> => {
    return api.post('/platform/accounts', data);
  },
  update: async (id: number, data: Partial<AccountEntryInput>): Promise<AccountEntry> => {
    return api.patch(`/platform/accounts/${id}`, data);
  },
  remove: async (id: number): Promise<{ deleted: number }> => {
    return api.delete(`/platform/accounts/${id}`);
  },
  // Attachments. Content-Type must be UNSET so the browser adds the multipart boundary.
  uploadFile: async (entryId: number, file: File): Promise<{ file: AccountFile }> => {
    const form = new FormData();
    form.append('file', file);
    return api.post(`/platform/accounts/${entryId}/files`, form, {
      headers: { 'Content-Type': undefined as any },
      timeout: 120000,
    });
  },
  deleteFile: async (entryId: number, fileId: number): Promise<{ deleted: number }> =>
    api.delete(`/platform/accounts/${entryId}/files/${fileId}`),
  // The bytes, fetched with the bearer token (a plain <a href> would carry none).
  // The server always sends octet-stream; the caller re-types the blob to preview it.
  fetchFile: async (entryId: number, fileId: number): Promise<Blob> =>
    api.get(`/platform/accounts/${entryId}/files/${fileId}/download`, { responseType: 'blob' }),
};

export const documentsApi = {
  folders: async (): Promise<{ folders: DocumentFolder[] }> => api.get('/platform/documents/folders'),
  createFolder: async (data: { name: string; parent_id?: number | null }): Promise<{ folder: DocumentFolder }> =>
    api.post('/platform/documents/folders', data),
  // parent_id: null moves to the top level; leave it out to keep the folder where it is.
  updateFolder: async (id: number, data: { name?: string; parent_id?: number | null }): Promise<{ folder: DocumentFolder }> =>
    api.patch(`/platform/documents/folders/${id}`, data),
  removeFolder: async (id: number): Promise<{ deleted: number }> => api.delete(`/platform/documents/folders/${id}`),
  list: async (params: { folder_id?: number; search?: string }): Promise<{ documents: CabinetDocument[] }> =>
    api.get('/platform/documents', { params }),
  // Content-Type must be UNSET so the browser adds the multipart boundary.
  upload: async (folderId: number, file: File): Promise<{ document: CabinetDocument }> => {
    const form = new FormData();
    form.append('folder_id', String(folderId));
    form.append('file', file);
    return api.post('/platform/documents', form, {
      headers: { 'Content-Type': undefined as any },
      timeout: 120000,
    });
  },
  update: async (id: number, data: { name?: string; folder_id?: number }): Promise<{ document: CabinetDocument }> =>
    api.patch(`/platform/documents/${id}`, data),
  remove: async (id: number): Promise<{ deleted: number }> => api.delete(`/platform/documents/${id}`),
  fetchFile: async (id: number): Promise<Blob> =>
    api.get(`/platform/documents/${id}/download`, { responseType: 'blob' }),
};


export const tasksApi = {
  /**
   * Who a task may be given to. Its own route rather than `usersApi.listUsers`,
   * which is admin-only — every desk that works the board needs the roster to
   * assign anything.
   */
  getPeople: async (): Promise<{ people: PlatformUser[] }> => api.get('/platform/tasks/people'),

  // ── Boards ──────────────────────────────────────────────────────────────
  getBoards: async (): Promise<{ boards: TaskBoard[] }> => api.get('/platform/tasks/boards'),

  createBoard: async (body: {
    name: string;
    description?: string | null;
    color?: string | null;
    owner_user_id?: number | null;
  }): Promise<{ board: TaskBoard }> => api.post('/platform/tasks/boards', body),

  updateBoard: async (
    id: number,
    // ABSENT means "leave alone" and NULL means "clear" — the board bar sends
    // only what was touched, so renaming must not blank the owner, and picking
    // "No owner" has to be able to actually remove one. Never spread a whole
    // board object in here.
    body: Partial<{
      name: string;
      description: string | null;
      color: string | null;
      is_archived: boolean;
      owner_user_id: number | null;
    }>
  ): Promise<{ board: TaskBoard }> => api.post(`/platform/tasks/boards/${id}`, body),

  deleteBoard: async (id: number): Promise<{ deleted: boolean; tasks_deleted: number }> =>
    api.delete(`/platform/tasks/boards/${id}`),

  /** The whole live rail, renumbered — see the endpoint for why not just the pair. */
  reorderBoards: async (updates: { id: number; sort_order: number }[]): Promise<{ updated: number }> =>
    api.post('/platform/tasks/boards/reorder', { updates }),

  // ── Tasks ───────────────────────────────────────────────────────────────
  getTasks: async (boardId: number): Promise<TaskListResponse> =>
    api.get('/platform/tasks', { params: { board_id: boardId } }),

  /** One person across every live board. `'none'` is the work nobody owns yet. */
  getTasksForPerson: async (assignee: number | 'none'): Promise<TaskListResponse> =>
    api.get('/platform/tasks', { params: { assignee_user_id: assignee } }),

  createTask: async (body: TaskInput & { board_id: number; title: string }): Promise<{ task: Task }> =>
    api.post('/platform/tasks', body),

  updateTask: async (id: number, body: TaskInput): Promise<{ task: Task }> =>
    api.post(`/platform/tasks/${id}`, body),

  deleteTask: async (id: number): Promise<{ deleted: boolean }> =>
    api.delete(`/platform/tasks/${id}`),

  /**
   * A whole column after a drag. Answers with how many rows it WROTE, and 409s
   * when that is fewer than were sent — a bulk write that silently skipped a
   * deleted row would report success on a move that never happened.
   */
  reorderTasks: async (updates: TaskReorderUpdate[]): Promise<{ updated: number }> =>
    api.post('/platform/tasks/reorder', { updates }),

  // ── Checklist ───────────────────────────────────────────────────────────
  addSubtask: async (taskId: number, title: string): Promise<{ subtask: TaskSubtask }> =>
    api.post(`/platform/tasks/${taskId}/subtasks`, { title }),

  updateSubtask: async (
    taskId: number,
    subtaskId: number,
    body: Partial<{ title: string; is_done: boolean; sort_order: number }>
  ): Promise<{ subtask: TaskSubtask }> =>
    api.post(`/platform/tasks/${taskId}/subtasks/${subtaskId}`, body),

  deleteSubtask: async (taskId: number, subtaskId: number): Promise<{ deleted: boolean }> =>
    api.delete(`/platform/tasks/${taskId}/subtasks/${subtaskId}`),

  // ── Dependencies ────────────────────────────────────────────────────────
  linkDependency: async (taskId: number, dependsOnTaskId: number): Promise<{ linked: boolean }> =>
    api.post(`/platform/tasks/${taskId}/dependencies`, { depends_on_task_id: dependsOnTaskId }),

  // DELETE carries a body here, matching the endpoint. axios needs it under
  // `data:` — passing it as the second argument silently sends nothing.
  unlinkDependency: async (taskId: number, dependsOnTaskId: number): Promise<{ unlinked: boolean }> =>
    api.delete(`/platform/tasks/${taskId}/dependencies`, {
      data: { depends_on_task_id: dependsOnTaskId },
    }),

  // ── Discussion ──────────────────────────────────────────────────────────
  getComments: async (taskId: number): Promise<{ comments: TaskComment[] }> =>
    api.get(`/platform/tasks/${taskId}/comments`),

  addComment: async (taskId: number, body: string): Promise<{ comment: TaskComment }> =>
    api.post(`/platform/tasks/${taskId}/comments`, { body }),

  editComment: async (taskId: number, commentId: number, body: string): Promise<{ comment: TaskComment }> =>
    api.post(`/platform/tasks/${taskId}/comments/${commentId}`, { body }),

  deleteComment: async (taskId: number, commentId: number): Promise<{ deleted: boolean }> =>
    api.delete(`/platform/tasks/${taskId}/comments/${commentId}`),

  // ── Attachments ─────────────────────────────────────────────────────────
  getFiles: async (taskId: number): Promise<{ files: TaskFile[] }> =>
    api.get(`/platform/tasks/${taskId}/files`),

  uploadFile: async (taskId: number, file: File): Promise<{ file: TaskFile }> => {
    const form = new FormData();
    form.append('file', file);
    // The Content-Type header must be UNSET, not set to multipart: the browser
    // has to add its own boundary, and the axios default of application/json
    // would leave the body unparseable server-side.
    return api.post(`/platform/tasks/${taskId}/files`, form, {
      headers: { 'Content-Type': undefined as any },
    });
  },

  deleteFile: async (taskId: number, fileId: number): Promise<{ deleted: boolean }> =>
    api.delete(`/platform/tasks/${taskId}/files/${fileId}`),

  /**
   * Fetch the bytes and hand them to the browser as a download.
   *
   * NOT a plain <a href> — the route needs the bearer token, and a link carries
   * no Authorization header, so it would 401. Putting the token in the query
   * string instead would write it into history and any access log it passes.
   */
  downloadFile: async (taskId: number, fileId: number, name: string): Promise<void> => {
    const blob: Blob = await api.get(`/platform/tasks/${taskId}/files/${fileId}/download`, {
      responseType: 'blob',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoked on the next tick: revoking synchronously can beat the click in
    // Safari and the download arrives empty.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  },

  // ── Activity trail ──────────────────────────────────────────────────────
  getEvents: async (taskId: number): Promise<{ events: TaskEvent[] }> =>
    api.get(`/platform/tasks/${taskId}/events`),
};

/**
 * The sentence to show for a failed task call.
 *
 * The board's refusals are WRITTEN TO BE READ — "Work on this board is signed
 * off by Priya. Move it to Quality Check and it will reach them." — so throwing
 * away `detail` in favour of "Request failed" would discard the whole point of
 * them. Three shapes arrive:
 *
 *   · `{ detail: "a sentence" }`            — the handlers' own refusals
 *   · `{ detail: { message, updated } }`    — a partial reorder
 *   · `{ detail: [{ msg, loc }, …] }`       — a 422 from schema validation
 */
export const taskError = (err: any, fallback = 'That did not save.'): string => {
  const detail = err?.response?.data?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const first = detail[0];
    // Pydantic prefixes its own message with "Value error, "; the half after it
    // is the sentence we wrote.
    const msg = String(first?.msg ?? '').replace(/^Value error,\s*/, '');
    return msg || fallback;
  }
  if (detail && typeof detail === 'object' && typeof detail.message === 'string') {
    return detail.message;
  }
  return fallback;
};
