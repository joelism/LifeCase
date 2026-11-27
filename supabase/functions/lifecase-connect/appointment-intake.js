const zone = 'Europe/Zurich';
const swissDay = new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
const germanMonths = ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'];
const englishMonths = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const dayExpression = /\b(?:(?<isoYear>20\d{2})-(?<isoMonth>\d{1,2})-(?<isoDay>\d{1,2})|(?<day>\d{1,2})[./](?<month>\d{1,2})(?:[./](?<year>20\d{2}|\d{2})\b)?\.?|(?<nameDay>\d{1,2})\.?\s+(?<nameMonth>januar|january|jan|februar|february|feb|märz|maerz|march|mrz|mar|april|apr|mai|may|juni|june|jun|juli|july|jul|august|aug|september|sep|oktober|october|okt|oct|november|nov|dezember|december|dez|dec)\.?(?:\s+(?<nameYear>20\d{2}))?)\b/giu;
const words = line => line.toLocaleLowerCase('de-CH').match(/[\p{L}]+/gu) ?? [];
const fixedPattern = /fest(?:gelegt|e[rn]?)|bestätig|vereinbart|findet\b|erinnerung|einladung|terminbestätigung|appointment\b|confirmed|scheduled/i;
const appointmentPattern = /\b(?:termin\w*|sprechstunde|gespräch\w*|arzt\w*|quartal\w*gespräch|sitzung|besprechung|meeting|appointment|interview|consultation|einladung|reservation)\b/i;
const canceledPattern = /abgesagt|absage|annulliert|cancel(?:led|ed|lation)|storniert|verschoben|terminänderung|reschedul|neu vereinbaren|nicht stattfinden/i;
const uncertainPattern = /voraussichtlich|unverbindlich|würde.{0,40}passen|alternativ|terminvorschlag|könnten|falls.{0,40}passt|möchtest du|tentative|proposed|subject to change/i;
const noisePattern = /\b(?:bestellung|rechnung|zahlung|lieferung|abo|newsletter|angebot|nur gültig|öffnungszeit\w*|unsubscribe|shipment|invoice|newsletter|discount|sale)\b/i;

const training = {
  appointment: [
    'Terminbestätigung Ihr Arzttermin in der Praxis findet vereinbart statt',
    'Einladung zum Gespräch Sitzung Treffpunkt Besprechung Traktanden',
    'Erinnerung an Ihren Termin Behandlung Kontrolltermin Klinik Sprechstunde',
    'Wir bestätigen Ihren vereinbarten Termin Standortgespräch Abklärung',
    'Einladung Standortgespräch Protokoll Fragen Austausch Teilnahme',
    'Appointment confirmed consultation clinic office medical treatment',
    'Reminder for your scheduled appointment meeting room consultation',
    'Confirming your appointment next checkup please arrive reception',
    'Termin Uhr Praxis Besprechung Raum Adresse Ankunft',
    'Der Besuch findet statt wir erwarten Sie am Empfang',
  ],
  other: [
    'Bestellung erhalten Rechnung Zahlung Betrag Sendung Lieferdatum',
    'Newsletter Angebot Rabatt Preise Aktion Versand Bestätigung',
    'Öffnungszeiten Feiertage Kasse gültig nur solange Vorrat',
    'Rechnung zahlbar bis Liefertermin voraussichtlich und Versandstatus',
    'Online Angebot neu Anmeldung Vertrag Zahlungsfrist Verlängerung',
    'Your order shipping invoice due date payment received tracking',
    'Newsletter reminder sale billing delivery promotions unsubscribe',
    'Veranstaltungstipp Tag der offenen Tür Programm Werbung Flyer',
    'Bestätigte Zahlung Quittung Termin für Paket Zustellung',
    'E-Mail automatisch erstellt Artikel Rechnung Rücksendung Shop',
  ],
};

function learn(samples) {
  const counts = new Map();
  for (const sample of samples) for (const token of words(sample)) counts.set(token, (counts.get(token) ?? 0) + 1);
  return { counts, total: [...counts.values()].reduce((a, b) => a + b, 0) };
}
const model = Object.values(training).map(learn);
const vocabulary = new Set(model.flatMap(group => [...group.counts.keys()]));
function appointmentScore(text) {
  let ratio = 0;
  for (const token of new Set(words(text))) {
    if (!vocabulary.has(token)) continue;
    const [positive, negative] = model.map(group => (1 + (group.counts.get(token) ?? 0)) / (group.total + vocabulary.size));
    ratio += Math.log(positive / negative);
  }
  return 1 / (1 + Math.exp(-ratio));
}
const pad = number => String(number).padStart(2, '0');
function calendarDate(year, month, day) {
  if (year < 2000 || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const date = year + '-' + pad(month) + '-' + pad(day);
  return Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date ? date : '';
}
export function readDates(text, reference = new Date()) {
  if (!(reference instanceof Date) || !Number.isFinite(reference.getTime())) reference = new Date();
  const earliest = swissDay.format(reference);
  const currentYear = Number(earliest.slice(0, 4));
  return [...text.matchAll(dayExpression)].flatMap(match => {
    const { isoYear, isoMonth, isoDay, day, month, year, nameDay, nameMonth, nameYear } = match.groups;
    if (day && !year && (/^\s*Uhr\b/i.test(text.slice(match.index + match[0].length)) ||
        /\b(?:um|at)\s*$/i.test(text.slice(0, match.index)))) return [];
    const dayNumber = Number(isoDay || day || nameDay);
    const spell = nameMonth?.toLowerCase().replace('maerz', 'märz');
    const monthNumber = Number(isoMonth || month) || (germanMonths.findIndex((item, index) =>
      item.startsWith(spell ?? '?') || englishMonths[index].startsWith(spell ?? '?') ||
        (index === 2 && spell === 'mrz') || (index === 9 && spell === 'okt')) + 1);
    const writtenYear = Number(isoYear || year || nameYear);
    let inferred = writtenYear < 100 && writtenYear > 0 ? writtenYear + 2000 : writtenYear || currentYear;
    let date = calendarDate(inferred, monthNumber, dayNumber);
    if (!writtenYear && date && Date.parse(earliest) - Date.parse(date) > 45 * 86400000) date = calendarDate(++inferred, monthNumber, dayNumber);
    return date ? [{ date, index: match.index, length: match[0].length, evidence: match[0], explicitYear: Boolean(writtenYear) }] : [];
  });
}
const clock = '(?:[01]?\\d|2[0-3])(?:[:.h][0-5]\\d)?';
const rangePattern = new RegExp('(?:^|[^\\d.])(' + clock + ')\\s*(?:-|–|—|bis|to)\\s*(' + clock + ')(?![\\d.:])(?:\\s*(?:Uhr|h)\\b)?', 'giu');
const timePattern = /(?:\bum\s+|\bat\s+|\b(?=\d{1,2}:))([01]?\d|2[0-3])(?:(?:[:.h])([0-5]\d))?(?![\d./:])(?:\s*(?:Uhr|h)\b)?|(?<![\d.])([01]?\d|2[0-3])(?:(?:[:.h])([0-5]\d))?\s*Uhr\b/giu;
function toTime(input) {
  const [hour, minute] = input.split(/[:.h]/i);
  return pad(Number(hour)) + ':' + (minute || '00');
}
export function readTimeRanges(text) {
  return [...text.matchAll(rangePattern)].flatMap(match => {
    // Without a clock separator, require an explicit range delimiter and a following labelled hour or plain shift-cell format.
    const from = toTime(match[1]);
    const to = toTime(match[2]);
    return from !== to ? [{ time: from, endTime: to, evidence: match[0].trim(), index: match.index + match[0].indexOf(match[1]) }] : [];
  });
}
function appointmentTimes(text) {
  const ranges = readTimeRanges(text);
  if (ranges.length) return ranges;
  return [...text.matchAll(timePattern)].map(match => ({ time: pad(Number(match[1] || match[3])) + ':' + (match[2] || match[4] || '00'), endTime: '', evidence: match[0] }));
}
function withoutDates(line, matches) {
  let copy = line;
  for (const match of [...matches].reverse()) copy = copy.slice(0, match.index) + ' '.repeat(match.length) + copy.slice(match.index + match.length);
  return copy;
}
function clean(value, max = 250) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}
function documentTitle(lines, source) {
  const plausible = lines.find(line => appointmentPattern.test(line) && !readDates(line).length && line.length <= 85);
  return clean(source || plausible || 'Termin aus Dokument', 160);
}
function currentText(body) {
  const lines = String(body ?? '').replace(/\r/g, '').slice(0, 24000).split('\n').slice(0, 180);
  const quote = lines.findIndex(line => /^\s*(?:>{1,}|_{5,}|[- ]{3,}(?:original (?:message|nachricht)|weitergeleitete nachricht)|on .+wrote:|am .+schrieb\b.*:)\s*/i.test(line));
  return lines.slice(0, quote < 0 ? lines.length : quote).map(line => line.trim()).filter(Boolean);
}
const locationPattern = /^(?:ort|adresse|treffpunkt|location|wo)\s*:\s*(.+)$/i;

export function detectAppointments({ subject = '', body = '', reference = new Date(), mode = 'mail' }) {
  const lines = currentText(body);
  if (subject) lines.unshift(clean(subject, 250));
  const referenceDay = swissDay.format(reference);
  const complete = lines.slice(0, 24).join(' ');
  const headline = lines.slice(0, 6).join(' ');
  const eventSignal = appointmentPattern.test(headline);
  const ambiguous = uncertainPattern.test(complete) || canceledPattern.test(complete);
  if (mode === 'mail' && !eventSignal) return [];
  if (mode === 'mail' && noisePattern.test(headline) && !fixedPattern.test(headline)) return [];
  const title = documentTitle(lines, subject);
  const place = lines.map(line => locationPattern.exec(line)?.[1]).find(Boolean) || '';
  const candidates = new Map();
  for (const [index, line] of lines.entries()) {
    const dates = readDates(line, reference);
    if (!dates.length) continue;
    const base = withoutDates(line, dates);
    const immediate = appointmentTimes(base);
    const neighbor = !immediate.length && dates.length === 1 ? [lines[index + 1], lines[index - 1]].find(text => text && !readDates(text, reference).length && appointmentTimes(text).length) : '';
    const times = immediate.length ? immediate : neighbor ? appointmentTimes(neighbor) : [];
    const localLine = [lines[index - 1], line, lines[index + 1]].filter(Boolean).join(' ');
    const cleanSignal = eventSignal && (fixedPattern.test(headline) || appointmentScore(headline + ' ' + localLine) >= 0.73);
    for (const [position, date] of dates.entries()) {
      if (mode === 'mail' && (date.date < referenceDay || Date.parse(date.date) - Date.parse(referenceDay) > 370 * 86400000)) continue;
      const when = times.length === dates.length ? times[position] : times.length === 1 && dates.length === 1 ? times[0] : null;
      const key = [date.date, when?.time || ''].join('|');
      if (!candidates.has(key)) candidates.set(key, {
        title, date: date.date, time: when?.time || '', endTime: when?.endTime > when?.time ? when.endTime : '',
        location: clean(place), evidence: clean(line + (neighbor ? ' · ' + neighbor : ''), 400),
        automatic: Boolean(when && cleanSignal && !ambiguous && dates.length === 1 && times.length === 1 &&
          (date.explicitYear || Date.parse(date.date) - Date.parse(referenceDay) <= 90 * 86400000)),
        reviewReason: canceledPattern.test(complete) ? 'Absage oder Verschiebung' : ambiguous ? 'Termin möglicherweise unverbindlich' : '',
      });
    }
  }
  const result = [...candidates.values()].slice(0, 20);
  const timedDays = new Set(result.filter(row => row.time).map(row => row.date));
  const distinct = result.filter(row => row.time || !timedDays.has(row.date));
  return distinct.map(row => ({ ...row, automatic: distinct.length === 1 && row.automatic }));
}

export function detectShifts(text, reference = new Date()) {
  const rows = [];
  let activeDate = '';
  for (const line of currentText(text)) {
    const rawShifts = readTimeRanges(line);
    const dates = readDates(line, reference).filter(date => !rawShifts.some(shift => shift.index === date.index &&
      (activeDate || readDates(line.slice(0, shift.index), reference).length)));
    if (dates.length === 1) activeDate = dates[0].date;
    if (dates.length > 1) activeDate = '';
    const ranges = readTimeRanges(withoutDates(line, dates));
    if (dates.length <= 1 && activeDate && ranges.length === 1) rows.push({ date: activeDate, ...ranges[0], evidence: clean(line, 400) });
    if (dates.length > 1 && dates.length === ranges.length) {
      dates.forEach(({ date }, index) => rows.push({ date, ...ranges[index], evidence: clean(line, 400) }));
    }
  }
  return [...new Map(rows.map(row => [row.date + '|' + row.time + '|' + row.endTime, row])).values()].slice(0, 31);
}
