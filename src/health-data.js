import { readHealthXml } from './health-archive.js';
import { CH_ZONE, shiftDate } from './model.js';

export const measures = {
  steps: { label: 'Schritte', unit: 'Schritte', icon: 'activity', type: 'HKQuantityTypeIdentifierStepCount' },
  sleep: { label: 'Schlaf', unit: 'h', icon: 'moon', type: 'HKCategoryTypeIdentifierSleepAnalysis' },
  weight: { label: 'Gewicht', unit: 'kg', icon: 'heart', type: 'HKQuantityTypeIdentifierBodyMass' },
  exercise: { label: 'Bewegung', unit: 'min', icon: 'tasks', type: 'HKQuantityTypeIdentifierAppleExerciseTime' },
  resting: { label: 'Ruhepuls', unit: 'bpm', icon: 'activity', type: 'HKQuantityTypeIdentifierRestingHeartRate' },
};

const byType = new Map(Object.entries(measures).map(([key, metric]) => [metric.type, key]));
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
const swissDate = new Intl.DateTimeFormat('sv-SE', { timeZone: CH_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
const invalidExport = () => new Error('Wähle einen vollständigen Apple-Health-Export als ZIP oder XML.');

const specialTags = {
  '<!--': '-->',
  '<![CDATA[': ']]>',
  '<?': '?>',
};

function tagEnd(text, from) {
  let quote = '';
  for (let i = from; i < text.length; i++) {
    if (i - from === 65536) throw invalidExport();
    const char = text[i];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '>') {
      return i;
    } else if (char === '<') {
      throw invalidExport();
    }
  }
  return -1;
}

function healthRecords(onRecord) {
  const tags = /<!--|<!\[CDATA\[|<\?|<\/?HealthData(?=[\s>])|<Record(?=\s)/g;
  let pending = '';
  let terminator = '';
  let opened = false;
  let closed = false;
  return {
    push(chunk) {
      const text = pending + chunk;
      pending = '';
      let cursor = 0;
      while (cursor < text.length) {
        if (closed) {
          if (/\S/.test(text.slice(cursor))) throw invalidExport();
          return;
        }
        if (terminator) {
          const end = text.indexOf(terminator, cursor);
          if (end === -1) {
            pending = text.slice(Math.max(cursor, text.length - terminator.length + 1));
            return;
          }
          cursor = end + terminator.length;
          terminator = '';
          continue;
        }
        tags.lastIndex = cursor;
        const match = tags.exec(text);
        if (!match) {
          const tail = text.lastIndexOf('<');
          if (tail >= cursor && text.length - tail <= 12) pending = text.slice(tail);
          return;
        }
        const tag = match[0];
        const from = tags.lastIndex;
        if (specialTags[tag]) {
          terminator = specialTags[tag];
          cursor = from;
          continue;
        }
        const end = tagEnd(text, from);
        if (end === -1) {
          pending = text.slice(match.index);
          return;
        }
        if (tag === '<HealthData') {
          if (opened) throw invalidExport();
          opened = true;
        } else if (tag === '</HealthData') {
          if (!opened) throw invalidExport();
          closed = true;
        } else if (opened) {
          onRecord(text.slice(from, end));
        }
        cursor = end + 1;
      }
    },
    finish() {
      if (!opened || !closed) throw invalidExport();
    },
  };
}

function addSleep(dayEntries, start, finish) {
  const previous = dayEntries.at(-1);
  if (previous && start <= previous[1]) previous[1] = Math.max(previous[1], finish);
  else dayEntries.push([start, finish]);
}

function healthSummary(from, through) {
  const groups = new Map();
  const early = shiftDate(from, -1);
  const late = shiftDate(through, 1);
  const dateCache = new Map();
  const dateFor = ms => {
    const hour = Math.floor(ms / 3600000);
    if (!dateCache.has(hour)) dateCache.set(hour, swissDate.format(ms));
    return dateCache.get(hour);
  };
  function add(record) {
    const type = /(?:^|\s)type\s*=\s*["']([^"']+)["']/.exec(record)?.[1];
    const metric = byType.get(type);
    if (!metric) return;
    const attrs = Object.create(null);
    for (const [, key, , val] of record.matchAll(/([\w]+)\s*=\s*(["'])(.*?)\2/gs)) attrs[key] = val;
    if (!attrs.startDate || !attrs.endDate) return;
    const approximateDay = (metric === 'sleep' ? attrs.endDate : attrs.startDate).slice(0, 10);
    if (approximateDay < early || approximateDay > late) return;
    const start = healthTime(attrs.startDate);
    const finish = healthTime(attrs.endDate);
    if (!Number.isFinite(start) || !Number.isFinite(finish) || finish < start) return;
    const date = dateFor(metric === 'sleep' ? finish : start);
    if (date < from || date > through) return;
    let amount = Number(attrs.value);
    if (metric === 'sleep') {
      if (!asleep.has(attrs.value)) return;
    } else {
      if (attrs.value == null || attrs.value === '' || !Number.isFinite(amount) || amount < 0) return;
      if (metric === 'weight' && attrs.unit === 'lb') amount *= 0.45359237;
      else if (metric === 'weight' && attrs.unit !== 'kg') return;
      if (metric === 'exercise' && attrs.unit === 's') amount /= 60;
      else if (metric === 'exercise' && attrs.unit !== 'min') return;
    }
    const name = xmlText(attrs.sourceName || 'Apple Health').slice(0, 120);
    const id = metric + '\u0000' + name;
    if (!groups.has(id)) groups.set(id, { id, metric, name, days: new Map() });
    const { days } = groups.get(id);
    if (!days.has(date)) days.set(date, []);
    days.get(date).push([start, finish, amount]);
  }
  function finish() {
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
  return { add, finish };
}

export async function importHealthExport(file, from, through, onProgress = () => {}) {
  const summary = healthSummary(from, through);
  const records = healthRecords(summary.add);
  await readHealthXml(file, (chunk, progress) => {
    records.push(chunk);
    onProgress(progress);
  });
  records.finish();
  return summary.finish();
}

export function preferredHealthDays(rows, metric, from, through) {
  const byDay = new Map();
  for (const row of rows) {
    if (row.metric !== metric || row.day < from || row.day > through) continue;
    if (!byDay.has(row.day) || row.source === 'healthkit') byDay.set(row.day, row);
  }
  return [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day));
}
