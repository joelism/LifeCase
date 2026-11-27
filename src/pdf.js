import { jsPDF } from 'jspdf';
import { filesFor, nameOf, sectionOf, sections, showDate, showTimestamp, value, today } from './model.js';

const blue = [30, 75, 128];
const ink = [27, 40, 57];
const muted = [82, 101, 124];
const fontSafe = input => String(input ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

export function makePDF(title, selectedRows, allRows, files, dates, includeFiles) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title, creator: 'LifeCase' });
  const margin = 19;
  const width = 172;
  let y;
  function frame() {
    doc.setFillColor(...blue);
    doc.rect(0, 0, 210, 3, 'F');
    doc.setFontSize(9).setFont('helvetica', 'bold').setTextColor(...blue);
    doc.text('LifeCase', margin, 16);
    doc.setFont('helvetica', 'normal').setTextColor(...muted);
    doc.text('VERTRAULICH', margin + width, 16, { align: 'right' });
    y = 27;
  }
  function ensure(height) {
    if (y + height <= 275) return;
    doc.addPage();
    frame();
  }
  function write(text, size = 10.5, color = ink, weight = 'normal') {
    doc.setFontSize(size).setFont('helvetica', weight);
    const lines = doc.splitTextToSize(fontSafe(text), width);
    const step = size * 0.43 + 0.6;
    for (const line of lines) {
      ensure(step);
      doc.setFontSize(size).setFont('helvetica', weight).setTextColor(...color);
      doc.text(line, margin, y);
      y += step;
    }
  }
  frame();
  write(title, 26, ink, 'bold');
  write('Erstellt am ' + showDate(today()) + ' · ' + selectedRows.length + (selectedRows.length === 1 ? ' Eintrag' : ' Einträge'), 10, muted);
  if (dates.from || dates.to) write('Zeitraum ' + (dates.from ? showDate(dates.from) : 'offen') + ' – ' + (dates.to ? showDate(dates.to) : 'offen'), 10, muted);
  y += 9;
  const rowNames = new Map(allRows.map(row => [row.id, nameOf(row)]));
  for (const row of selectedRows) {
    ensure(27);
    doc.setDrawColor(216, 224, 234);
    doc.line(margin, y - 4, margin + width, y - 4);
    write(sectionOf(row).toUpperCase(), 8.5, blue, 'bold');
    write(nameOf(row), 16, ink, 'bold');
    y += 1.5;
    for (const field of sections[sectionOf(row)]?.fields ?? []) {
      if (field.key === 'title') continue;
      let item = value(row, field.key);
      if (field.type === 'links') item = Array.isArray(item) ? item.map(id => rowNames.get(id)).filter(Boolean).join(', ') : '';
      if (field.type === 'date' && item) item = showDate(item);
      if (field.labels && item !== '') item = field.labels[item] ?? item;
      if (item === '') continue;
      ensure(12);
      write(field.label, 8.5, muted, 'bold');
      write(item);
      y += 1;
    }
    for (const label of ['Fall / Bereich', 'Beteiligte Personen']) {
      if (row.fields[label]) write(label + ' · ' + row.fields[label], 10, muted);
    }
    if (includeFiles) {
      for (const file of filesFor(row, files).filter(item => item.uploaded_at)) {
        ensure(17);
        write('Originaldatei · ' + file.original_name, 9, blue, 'bold');
        write(showTimestamp(file.uploaded_at), 9, muted);
        if (file.sha256) write('SHA-256  ' + file.sha256, 8.5, muted);
      }
    }
    y += 8;
  }
  for (let i = 1; i <= doc.getNumberOfPages(); i++) {
    doc.setPage(i).setFont('helvetica', 'normal').setFontSize(9).setTextColor(...muted);
    doc.text(i + ' / ' + doc.getNumberOfPages(), margin + width, 287, { align: 'right' });
  }
  return doc.output('blob');
}
