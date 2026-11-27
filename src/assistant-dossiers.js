import { dateOf, isActive, linksOf, nameOf, sectionOf, value } from './model.js';

const words = text => String(text ?? '').normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('de-CH')
  .replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
const stopwords = new Set(['bei', 'der', 'dem', 'im', 'ins', 'das', 'die', 'dossier', 'fall', 'bitte', 'zu', 'zur', 'zum']);
const titleWords = text => words(text).filter(word => !stopwords.has(word));
const isCase = row => sectionOf(row) === 'Fälle' && isActive(row);

export function findAssistantDossier(rows, query) {
  const asked = titleWords(query);
  const pool = rows.filter(isCase);
  if (!asked.length) return { match: null, choices: pool, mayCreate: false };
  const key = asked.join(' ');
  const exact = pool.filter(row => titleWords(nameOf(row)).join(' ') === key);
  const matches = exact.length ? exact : pool.filter(row => {
    const title = new Set(titleWords(nameOf(row)));
    return asked.every(word => title.has(word));
  });
  return matches.length === 1 ? { match: matches[0], choices: [], mayCreate: false } :
    { match: null, choices: matches.length ? matches : pool, mayCreate: !matches.length };
}

export function reviewChronicleDossier(rows, query, lastCaseId) {
  const { match, choices, mayCreate } = findAssistantDossier(rows, query);
  const available = rows.filter(isCase);
  const preferred = match ?? (!query && available.find(row => row.id === lastCaseId));
  const candidates = new Map([...(preferred ? [preferred] : []), ...choices, ...available].map(row => [row.id, row]));
  return { choices: [...candidates.values()], preferred: preferred?.id, mayCreate };
}

export function dossierEntries(rows, caseId) {
  const dossier = rows.find(row => row.id === caseId && isCase(row));
  const fromDossier = new Set(dossier ? linksOf(dossier) : []);
  return rows.filter(row => isActive(row) && row.id !== caseId &&
      (fromDossier.has(row.id) || (Array.isArray(value(row, 'caseIds')) && value(row, 'caseIds').includes(caseId))))
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || (b.created_at || '').localeCompare(a.created_at || ''));
}

export function assistantChronicleFields(intent, caseId, key) {
  const { title, date, time, location, notes, knowledge, original } = intent;
  const reported = knowledge === 'reported' || /\b(?:gehört|mitgeteilt|berichtet|erzählt|vom hören[s ]agen)\b/i.test(original);
  return {
    title, date, time, location,
    notes: reported ? 'Mir wurde Folgendes berichtet:\n' + notes : notes,
    source: reported ? 'Gehörte Information · unbestätigt' : knowledge === 'observed' ? 'Eigene Wahrnehmung' : 'Eigene Notiz',
    caseIds: [caseId], intakeKey: 'chronicle-chat:' + key, intakeSource: 'LifeCase-Assistent', chatOriginal: original,
  };
}
