// CSV needs no library. Excel uses SheetJS (window.XLSX), PDF uses jsPDF
// (window.jspdf.jsPDF) — both loaded as plain <script> tags in admin/index.html,
// no bundler involved.
import { toast } from './utils.js';

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export function exportCSV(rows, columns, filename) {
  const header = columns.map(c => `"${c.label.replace(/"/g, '""')}"`).join(',');
  const body = rows.map(row => columns.map(c => `"${String(row[c.key] ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  download(new Blob([header + '\n' + body], { type: 'text/csv;charset=utf-8;' }), `${filename}.csv`);
}

export function exportExcel(rows, columns, filename) {
  if (!window.XLSX) return toastMissing('Excel');
  const data = rows.map(row => Object.fromEntries(columns.map(c => [c.label, row[c.key]])));
  const sheet = window.XLSX.utils.json_to_sheet(data);
  const book = window.XLSX.utils.book_new();
  window.XLSX.utils.book_append_sheet(book, sheet, 'Report');
  window.XLSX.writeFile(book, `${filename}.xlsx`);
}

export function exportPDF(title, rows, columns, filename) {
  if (!window.jspdf) return toastMissing('PDF');
  const doc = new window.jspdf.jsPDF();
  doc.setFontSize(14); doc.text(title, 14, 16);
  doc.setFontSize(9);
  let y = 26;
  doc.text(columns.map(c => c.label).join('   |   '), 14, y);
  y += 6;
  rows.forEach(row => {
    if (y > 280) { doc.addPage(); y = 16; }
    doc.text(columns.map(c => String(row[c.key] ?? '')).join('   |   '), 14, y);
    y += 6;
  });
  doc.save(`${filename}.pdf`);
}

function toastMissing(kind) {
  toast(`${kind} export library did not load — check your connection and try again.`, 'error');
}
