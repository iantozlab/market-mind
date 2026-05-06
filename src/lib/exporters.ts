import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export function downloadCSV(filename: string, rows: Record<string, unknown>[]) {
  if (rows.length === 0) {
    const blob = new Blob([''], { type: 'text/csv' });
    triggerDownload(blob, filename);
    return;
  }
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [
    headers.join(','),
    ...rows.map(r => headers.map(h => escape(r[h])).join(',')),
  ].join('\n');
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), filename);
}

export function downloadPDF(
  filename: string,
  title: string,
  columns: string[],
  rows: (string | number)[][],
  meta?: Record<string, string | number>,
) {
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(14);
  doc.text(title, 14, 14);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(`Generated ${new Date().toLocaleString()}`, 14, 20);
  let y = 26;
  if (meta) {
    Object.entries(meta).forEach(([k, v]) => {
      doc.text(`${k}: ${v}`, 14, y);
      y += 5;
    });
  }
  autoTable(doc, {
    head: [columns],
    body: rows.map(r => r.map(c => (typeof c === 'number' ? Number(c.toFixed(4)).toString() : c))),
    startY: y + 2,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [30, 30, 40] },
  });
  doc.save(filename);
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
