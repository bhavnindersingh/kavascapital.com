/**
 * Where attachments and documents live: three private Storage buckets.
 *
 * Port of nightingale's `core/task_storage.py`, `account_storage.py` and
 * `document_storage.py`, with the instance's disk swapped for Supabase Storage.
 * What does not change is the security model:
 *
 * - THE BYTES ARE NEVER REACHABLE BY URL. The buckets are private with no
 *   storage policies; a file leaves only through an API download route, which
 *   re-checks the caller and always answers with an octet-stream attachment.
 * - THE KEY IS ISSUED HERE, NEVER TAKEN FROM THE USER: a UUID hex basename
 *   plus a normalised extension. The uploader's filename is display text only.
 * - THE EXTENSION IS THE AUTHORITY and the declared MIME type only a veto. No
 *   SVG/HTML (script containers) and no archives. See task_storage.py for the
 *   full reasoning.
 */
import { admin } from "./auth.ts";
import { HttpError } from "./http.ts";

export type Bucket = "tasks" | "accounts" | "documents";

// 32 hex characters, optionally an extension. Anything else is not one of ours.
export const KEY_RE = /^[0-9a-f]{32}(\.[A-Za-z0-9]{1,12})?$/;
const EXT_RE = /^[A-Za-z0-9]{1,12}$/;

export const MAX_BYTES = 10 * 1024 * 1024;

const DANGEROUS_MIME = new Set([
  "text/html",
  "application/xhtml+xml",
  "image/svg+xml",
  "text/javascript",
  "application/javascript",
  "application/x-javascript",
  "application/xml",
  "text/xml",
]);

const ALLOWED_EXT: Record<Bucket, Set<string>> = {
  tasks: new Set([
    "png", "jpg", "jpeg", "gif", "webp", "pdf",
    "txt", "csv", "xls", "xlsx", "doc", "docx",
  ]),
  // Invoices and screenshots. HEIC/HEIF: an iPhone photo of a bill.
  accounts: new Set(["png", "jpg", "jpeg", "webp", "heic", "heif", "gif", "pdf"]),
  documents: new Set([
    "pdf", "doc", "docx", "odt", "rtf", "txt",
    "xls", "xlsx", "ods", "csv",
    "ppt", "pptx", "odp",
    "png", "jpg", "jpeg", "webp", "heic", "heif", "gif",
  ]),
};

// The sentence for an extension a bucket does not take, as nightingale had it.
const WRONG_EXT: Record<Bucket, (ext: string) => string> = {
  tasks: (ext) =>
    `.${ext} files can't be attached. Images, PDFs, spreadsheets, documents and plain text can.`,
  accounts: (ext) =>
    `.${ext} files can't be attached. Attach an image (JPG, PNG, WEBP, HEIC) or a PDF.`,
  documents: (ext) =>
    `.${ext} files can't be added. Add a PDF, Word, Excel, PowerPoint, text file or an image.`,
};

const BAD_TYPE: Record<Bucket, string> = {
  tasks: "That file's type isn't allowed as an attachment.",
  accounts: "That file's type isn't allowed as an attachment.",
  documents: "That file's type isn't allowed.",
};

/** The normalised extension of an uploaded name, or '' when there isn't one. */
export function extensionOf(filename: string): string {
  const i = (filename ?? "").lastIndexOf(".");
  if (i < 0) return "";
  const ext = filename.slice(i + 1).trim().toLowerCase();
  return ext && EXT_RE.test(ext) ? ext : "";
}

/** Why this file cannot be stored in `bucket`, or null when it can. */
export function refusalFor(bucket: Bucket, filename: string, mimeType: string | null): string | null {
  const ext = extensionOf(filename);
  if (!ext) return "That file has no extension, so there is no way to tell what it is.";
  if (!ALLOWED_EXT[bucket].has(ext)) return WRONG_EXT[bucket](ext);
  const declared = (mimeType ?? "").split(";")[0].trim().toLowerCase();
  if (DANGEROUS_MIME.has(declared)) return BAD_TYPE[bucket];
  return null;
}

/** An opaque key for a new upload. The caller's name is not used. */
export function newKey(filename: string): string {
  const hex = crypto.randomUUID().replaceAll("-", "");
  const ext = extensionOf(filename);
  return ext ? `${hex}.${ext}` : hex;
}

function checkKey(fileKey: string): void {
  if (!KEY_RE.test(fileKey ?? "")) throw new Error(`not a file key: ${JSON.stringify(fileKey)}`);
}

/**
 * Validate and store one uploaded file. Returns its new key and size, or throws
 * the 400 with the sentence the page shows. The size is checked on the bytes
 * received, never on a header the client sent.
 */
export async function store(
  bucket: Bucket,
  file: File,
  maxBytes = MAX_BYTES,
): Promise<{ key: string; size: number; mime: string | null }> {
  const refusal = refusalFor(bucket, file.name, file.type || null);
  if (refusal) throw new HttpError(400, refusal);
  if (file.size === 0) throw new HttpError(400, "That file is empty.");
  if (file.size > maxBytes) {
    throw new HttpError(400, `That file is bigger than the ${Math.round(maxBytes / (1024 * 1024))} MB limit.`);
  }
  const key = newKey(file.name);
  const mime = file.type || null;
  const { error } = await admin.storage.from(bucket).upload(key, file, {
    contentType: "application/octet-stream",
    upsert: false,
  });
  if (error) throw new Error(`storage upload failed: ${error.message}`);
  return { key, size: file.size, mime };
}

/** The stored bytes, or null when the object is missing. */
export async function read(bucket: Bucket, fileKey: string): Promise<Blob | null> {
  checkKey(fileKey);
  const { data, error } = await admin.storage.from(bucket).download(fileKey);
  if (error || !data) return null;
  return data;
}

/**
 * Remove files, best effort. The row goes first; a failure here leaves an
 * orphaned object rather than a row naming something that will not open.
 */
export async function removeMany(bucket: Bucket, fileKeys: Iterable<string | null | undefined>): Promise<void> {
  const keys = [...fileKeys].filter((k): k is string => !!k && KEY_RE.test(k));
  if (!keys.length) return;
  const { error } = await admin.storage.from(bucket).remove(keys);
  if (error) console.warn(`${bucket}_file_remove_failed`, error.message);
}

export const remove = (bucket: Bucket, fileKey: string) => removeMany(bucket, [fileKey]);

/**
 * The only way out for the bytes: always an attachment, never rendered inline,
 * never cached. The page re-types the blob itself to preview it.
 */
export function attachment(blob: Blob, filename: string): Response {
  const safe = (filename || "file").replace(/[\r\n"]/g, "").slice(0, 200);
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
  return new Response(blob, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** The single `file` field of a multipart upload, or a 422. */
export async function uploadedFile(form: Record<string, unknown>, field = "file"): Promise<File> {
  const f = form[field];
  if (!(f instanceof File)) throw new HttpError(422, `${field} is required`);
  return f;
}
