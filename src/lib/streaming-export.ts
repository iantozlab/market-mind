// Chunked/streaming exporters that yield to the event loop so large
// datasets don't freeze the UI while building CSV/JSON blobs.

type Row = Record<string, unknown>;

const CHUNK = 500;

function yieldToUI(): Promise<void> {
  return new Promise(resolve => {
    const ric = (globalThis as unknown as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    if (typeof ric === 'function') ric(() => resolve());
    else setTimeout(resolve, 0);
  });
}

function escapeCSV(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export class ExportCancelledError extends Error {
  constructor() { super('Export cancelled'); this.name = 'ExportCancelledError'; }
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new ExportCancelledError();
}

export async function streamingDownloadCSV(
  filename: string,
  rows: Row[],
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  if (rows.length === 0) {
    triggerDownload(new Blob([''], { type: 'text/csv;charset=utf-8;' }), filename);
    onProgress?.(0, 0);
    return;
  }
  const headers = Object.keys(rows[0]);
  let parts: string[] | null = [headers.join(',') + '\n'];
  try {
    for (let i = 0; i < rows.length; i += CHUNK) {
      throwIfAborted(signal);
      const slice = rows.slice(i, i + CHUNK);
      let buf = '';
      for (const r of slice) buf += headers.map(h => escapeCSV(r[h])).join(',') + '\n';
      parts.push(buf);
      onProgress?.(Math.min(i + CHUNK, rows.length), rows.length);
      await yieldToUI();
    }
    throwIfAborted(signal);
    triggerDownload(new Blob(parts, { type: 'text/csv;charset=utf-8;' }), filename);
  } finally {
    // Drop any partially built output so no incomplete file can be offered.
    parts = null;
  }
}


export async function streamingDownloadJSON(
  filename: string,
  rows: Row[],
  meta: Record<string, unknown> = {},
  onProgress?: (done: number, total: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  let parts: string[] | null = [];
  try {
    const header = { ...meta, exportedAt: new Date().toISOString(), count: rows.length };
    parts.push('{');
    for (const [k, v] of Object.entries(header)) parts.push(JSON.stringify(k) + ':' + JSON.stringify(v) + ',');
    parts.push('"events":[');
    for (let i = 0; i < rows.length; i += CHUNK) {
      throwIfAborted(signal);
      const slice = rows.slice(i, i + CHUNK);
      let buf = '';
      for (let j = 0; j < slice.length; j++) {
        const isLast = i + j === rows.length - 1;
        buf += JSON.stringify(slice[j]) + (isLast ? '' : ',');
      }
      parts.push(buf);
      onProgress?.(Math.min(i + CHUNK, rows.length), rows.length);
      await yieldToUI();
    }
    throwIfAborted(signal);
    parts.push(']}');
    triggerDownload(new Blob(parts, { type: 'application/json' }), filename);
  } finally {
    // Drop any partially built output so no incomplete file can be offered.
    parts = null;
  }
}

