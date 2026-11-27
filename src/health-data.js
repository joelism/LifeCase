import { unzipSync } from 'fflate';
import { shiftDate, today } from './model.js';

export const measures = {
  steps: { label: 'Schritte', unit: 'Schritte', icon: 'activity', type: 'HKQuantityTypeIdentifierStepCount' },
  sleep: { label: 'Schlaf', unit: 'h', icon: 'moon', type: 'HKCategoryTypeIdentifierSleepAnalysis' },
  weight: { label: 'Gewicht', unit: 'kg', icon: 'heart', type: 'HKQuantityTypeIdentifierBodyMass' },
  exercise: { label: 'Bewegung', unit: 'min', icon: 'tasks', type: 'HKQuantityTypeIdentifierAppleExerciseTime' },
  resting: { label: 'Ruhepuls', unit: 'bpm', icon: 'activity', type: 'HKQuantityTypeIdentifierRestingHeartRate' },
};

const byType = new Map(Object.entries(measures).map(([key, metric]) => [metric.type, key]));
const MAX_ARCHIVE = 150 * 1024 * 1024;
const MAX_XML = 220 * 1024 * 1024;
const asleep = new Set(['HKCategoryValueSleepAnalysisAsleep', 'HKCategoryValueSleepAnalysisAsleepUnspecified',
  'HKCategoryValueSleepAnalysisAsleepCore', 'HKCategoryValueSleepAnalysisAsleepDeep', 'HKCategoryValueSleepAnalysisAsleepREM', '1', '3', '4', '5']);

function xmlText(string) {
  const common = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
  return string.replace(/&(?:amp|lt|gt|quot|apos|#x[0-9a-f]+|#\d+);/gi, entity => {
    const key = entity.slice(1, -1);
    if (key[0] !== '#') return common[key] ?? entity;
    const code = key[1].toLowerCase() === 'x' ? Number.parseInt(key.slice(2), 16) : Number(key.slice(1));
    return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}
const healthTime = value => Date.parse((value ?? '').replace(/^(\d{4}-\d{2}-\d{2}) /, '$1T').replace(/ ([+-]\d{2})(\d{2})$/, '$1:$2'));
const dayFor = ms => today(new Date(ms));

export async function openHealthExport(file) {
  if (file.size > MAX_ARCHIVE) throw new Error('Die Datei ist grösser als 150 MB. Verwende für grosse Exporte die iPhone-Synchronisierung.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let input = bytes;
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    let tooLarge = false;
    let chosen = false;
    const files = unzipSync(bytes, { filter: item => {
      if (chosen || !/(^|\/)export\.xml$/i.test(item.name)) return false;
      chosen = true;
      tooLarge = item.originalSize > MAX_XML;
      return !tooLarge;
    } });
    if (tooLarge) throw new Error('Die XML-Datei im Apple-Health-Export ist zu gross.');
    input = Object.values(files)[0];
    if (!input) throw new Error('Die ZIP-Datei enthält keine export.xml.');
  }
  const xml = new TextDecoder().decode(input);
  if (!/<HealthData(?:\s|>)/.test(xml.slice(0, 500000)) || !/<\/HealthData>\s*$/.test(xml)) {
    throw new Error('Wähle einen vollständigen Apple-Health-Export als ZIP oder XML.');
  }
  return xml;
}

function addSleep(dayEntries, start, finish) {
  const previous = dayEntries.at(-1);
  if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], finish);
  else dayEntries.push([start, finish]);
}

export function summarizeHealthExport(xml, from, through) {
  const groups = new Map();
  const early = shiftDate(from, -1);
  const late = shiftDate(through, 1);
  const dateCache = new Map();
  const dateFor = ms => {
    const hour = Math.floor(ms / 3600000);
    if (!dateCache.has(hour)) dateCache.set(hour, dayFor(ms));
    return dateCache.get(hour);
  };
  for (const [, record] of xml.matchAll(/<Record(?=\s)([^<>]*)>/g)) {
    const attrs = {};
    for (const [, key, val] of record.matchAll(/([\w]+)="([^"]*)"/g)) attrs[key] = val;
    const metric = byType.get(attrs.type);
    if (!metric || !attrs.startDate || !attrs.endDate) continue;
    const approximateDay = (metric === 'sleep' ? attrs.endDate : attrs.startDate).slice(0, 10);
    if (approximateDay < early || approximateDay > late) continue;
    const start = healthTime(attrs.startDate);
    const finish = healthTime(attrs.endDate);
    if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) continue;
    const date = dateFor(metric === 'sleep' ? finish : start);
    if (date < from || date > through) continue;
    let amount = Number(attrs.value);
    if (metric === 'sleep') {
      if (!asleep.has(attrs.value)) continue;
    } else {
      if (attrs.value == null || attrs.value === '' || !Number.isFinite(amount) || amount < 0) continue;
      if (metric === 'weight' && attrs.unit === 'lb') amount *= 0.45359237;
      else if (metric === 'weight' && attrs.unit !== 'kg') continue;
      if (metric === 'exercise' && attrs.unit === 's') amount /= 60;
      else if (metric === 'exercise' && attrs.unit !== 'min') continue;
    }
    const name = xmlText(attrs.sourceName || 'Apple Health').slice(0, 120);
    const id = metric + '\u0000' + name;
    if (!groups.has(id)) groups.set(id, { id, metric, name, days: new Map() });
    const { days } = groups.get(id);
    if (!days.has(date)) days.set(date, []);
    days.get(date).push([start, finish, amount]);
  }
  return [...groups.values()].map(({ days, ...group }) => ({
    ...group,
    values: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, entries]) => {
      entries.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let value;
      if (group.metric === 'sleep') {
        const intervals = [];
        for (const [start, finish] of entries) addSleep(intervals, start, finish);
        value = intervals.reduce((sum, [start, finish]) => sum + (finish - start) / 3600000, 0);
      } else if (group.metric === 'weight') {
        value = entries.at(-1)[2];
      } else {
        const points = new Set();
        value = 0;
        for (const [start, finish, amount] of entries) {
          const key = [start, finish, amount].join('/');
          if (points.has(key)) continue;
          points.add(key);
          value += amount;
        }
        if (group.metric === 'resting') value /= points.size;
      }
      return { day: date, metric: group.metric, value: Math.round(value * 100) / 100, source: 'export', source_name: group.name };
    }).filter(item => item.value <= ({ steps: 250000, sleep: 24, weight: 1000, exercise: 1440, resting: 400 })[group.metric]),
  })).filter(group => group.values.length).sort((a, b) => b.values.length - a.values.length || a.name.localeCompare(b.name, 'de-CH'));
}

export function preferredHealthDays(rows, metric, from, through) {
  const byDay = new Map();
  for (const row of rows) {
    if (row.metric !== metric || row.day < from || row.day > through) continue;
    if (!byDay.has(row.day) || row.source === 'healthkit') byDay.set(row.day, row);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}
