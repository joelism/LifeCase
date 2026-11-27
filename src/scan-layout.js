import { detectShifts, readDates, readTimeRanges } from '../supabase/functions/lifecase-connect/appointment-intake.js';

const letters = value => value.toLocaleLowerCase('de-CH').normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^\p{L}]+/gu, ' ').trim();
const matchesName = (line, name) => {
  const person = letters(line).split(' ');
  const wanted = letters(name).split(' ').filter(Boolean);
  return wanted.length > 0 && wanted.every(word => person.includes(word));
};

export function linesFromWords(blocks) {
  const words = (blocks ?? []).flatMap(block => block.paragraphs ?? []).flatMap(paragraph => paragraph.lines ?? [])
    .flatMap(line => line.words ?? []).filter(word => word.text?.trim() && word.bbox);
  const medianHeight = words.map(word => word.bbox.y1 - word.bbox.y0).sort((a, b) => a - b)[Math.floor(words.length / 2)] || 20;
  const rows = [];
  for (const word of [...words].sort((a, b) => a.bbox.y1 - b.bbox.y1 || a.bbox.x0 - b.bbox.x0)) {
    const middle = (word.bbox.y0 + word.bbox.y1) / 2;
    const row = rows.find(line => Math.abs(line.y - middle) <= medianHeight * 0.65);
    if (row) row.words.push(word);
    else rows.push({ y: middle, words: [word] });
  }
  return rows.map(row => {
    let text = '';
    const offsets = row.words.sort((a, b) => a.bbox.x0 - b.bbox.x0).map(word => {
      const part = { index: text.length, x: word.bbox.x0 };
      text += word.text.trim() + ' ';
      return part;
    });
    return { text: text.trim(), offsets };
  });
}

export function planCandidates(result, reference, { team = false, employee = '' } = {}) {
  const lines = result.lines ?? [];
  if (team && !letters(employee)) return [];
  const matchedRows = lines.filter(line => !team || matchesName(line.text, employee));
  const headings = lines.map((line, index) => ({ index, line, dates: readDates(line.text, reference) }))
    .filter(item => item.dates.length >= 2);
  const output = [];
  for (const line of matchedRows) {
    const index = lines.indexOf(line);
    const header = headings.filter(item => item.index < index).at(-1);
    if (!header) continue;
    const shifts = readTimeRanges(line.text);
    if (!shifts.length) continue;
    const at = (row, index) => [...row.offsets].reverse().find(token => token.index <= index)?.x ?? 0;
    const columns = header.dates.map(date => ({ date: date.date, x: at(header.line, date.index) }));
    if (new Set(columns.map(col => col.x)).size !== columns.length) continue;
    shifts.forEach(shift => {
      const start = at(line, shift.index);
      const closest = columns.reduce((best, col) => Math.abs(col.x - start) < Math.abs(best.x - start) ? col : best);
      const spacing = Math.min(...columns.slice(1).map((col, i) => Math.abs(col.x - columns[i].x)));
      if (Math.abs(closest.x - start) <= spacing * 0.6) output.push({ ...shift, date: closest.date, evidence: line.text.slice(0, 400) });
    });
  }
  if (team && !output.length) {
    // A team roster is only inferred from an identified row under a date header.
    // Values from another employee's row must not be assigned by document order.
    return [];
  }
  if (!team) output.push(...detectShifts(result.text, reference));
  return [...new Map(output.map(row => [row.date + '|' + row.time + '|' + row.endTime, row])).values()].slice(0, 31);
}
