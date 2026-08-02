import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamingDownloadCSV, streamingDownloadJSON, ExportCancelledError } from './streaming-export';

const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i, name: `row-${i}` }));

let createdUrls = 0;
let clicks = 0;

beforeEach(() => {
  createdUrls = 0;
  clicks = 0;
  URL.createObjectURL = vi.fn(() => { createdUrls++; return 'blob:mock'; });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () { clicks++; });
});

afterEach(() => vi.restoreAllMocks());

describe('streaming export cancellation', () => {
  it('CSV: stops yielding progress and never triggers a download after abort', async () => {
    const ctrl = new AbortController();
    const progress: number[] = [];
    const p = streamingDownloadCSV('t.csv', rows, (done) => {
      progress.push(done);
      if (progress.length === 1) ctrl.abort();
    }, ctrl.signal);

    await expect(p).rejects.toBeInstanceOf(ExportCancelledError);
    await expect(p).rejects.toMatchObject({ name: 'ExportCancelledError', message: 'Export cancelled' });
    expect(progress.length).toBe(1);
    expect(clicks).toBe(0);
    expect(createdUrls).toBe(0);
  });

  it('JSON: stops yielding progress and never triggers a download after abort', async () => {
    const ctrl = new AbortController();
    const progress: number[] = [];
    const p = streamingDownloadJSON('t.json', rows, { filter: 'all' }, (done) => {
      progress.push(done);
      if (progress.length === 1) ctrl.abort();
    }, ctrl.signal);

    await expect(p).rejects.toBeInstanceOf(ExportCancelledError);
    expect(progress.length).toBe(1);
    expect(clicks).toBe(0);
  });

  it('rejects immediately when the signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const onProgress = vi.fn();
    await expect(streamingDownloadCSV('t.csv', rows, onProgress, ctrl.signal)).rejects.toBeInstanceOf(ExportCancelledError);
    await expect(streamingDownloadJSON('t.json', rows, {}, onProgress, ctrl.signal)).rejects.toBeInstanceOf(ExportCancelledError);
    expect(onProgress).not.toHaveBeenCalled();
    expect(clicks).toBe(0);
  });

  it('completes and downloads once when not aborted', async () => {
    const onProgress = vi.fn();
    await streamingDownloadCSV('t.csv', rows, onProgress, new AbortController().signal);
    expect(clicks).toBe(1);
    expect(onProgress).toHaveBeenLastCalledWith(rows.length, rows.length);
  });
});
