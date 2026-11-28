import { isActive, nameOf, recordSections, sectionOf, sections, shiftDate, value } from './model.js';

export const normalize = text => String(text || '').normalize('NFKD').replace(/\p{Diacritic}/gu,'').toLocaleLowerCase('de-CH').replace(/ß/g,'ss').replace(/\s+/g,' ').trim();
export function namedRows(rows, query) {
  if (!query) return rows;
  const key = normalize(query);
  const exact = rows.filter(row=>normalize(nameOf(row)) === key);
  return exact.length ? exact : rows.filter(row=>normalize(nameOf(row)).includes(key));
}
export function shoppingFields(fields, op, pairs, makeId = () => crypto.randomUUID()) {
  const items = Array.isArray(fields.items) ? fields.items.map(item=>({...item})) : [];
  if (!pairs.length) throw new Error('Welche Artikel meinst du?');
  for (const pair of pairs) {
    const name = pair.key.trim(), quantity = pair.value.trim();
    if (!name || name.length > 120 || quantity.length > 40) throw new Error('Prüfe Artikelname und Menge.');
    const matches = items.filter(item=>normalize(item.name)===normalize(name));
    const pending = matches.filter(item=>!item.done);
    const candidates = op === 'shopping_check' ? pending : op === 'shopping_uncheck' ? matches.filter(i=>i.done) :
      op === 'shopping_add' && pending.length ? pending : matches;
    if (candidates.length > 1) throw new Error('«'+name+'» kommt mehrfach vor. Wähle den Artikel unter Einkaufen.');
    const item = candidates[0];
    if (op === 'shopping_add' || op === 'shopping_create') {
      if (item) { item.done = false; if (quantity) item.quantity = quantity; }
      else items.push({id:makeId(),name,quantity,done:false});
    } else {
      if (!matches.length) throw new Error('«'+name+'» finde ich auf dieser Liste nicht.');
      if (!item) continue;
      if (op === 'shopping_remove') items.splice(items.indexOf(item),1);
      else if (['shopping_check','shopping_uncheck'].includes(op)) item.done = op === 'shopping_check';
      else throw new Error('Unbekannte Einkaufsaktion.');
    }
  }
  if (items.length > 300) throw new Error('Diese Liste ist auf 300 Artikel begrenzt.');
  return {...fields, items};
}

export function recordSeeds(section, pairs, rows, row) {
  if (!recordSections.includes(section)) throw new Error('Wähle bitte einen bearbeitbaren Bereich.');
  const fields = sections[section].fields;
  const patch = {};
  for (const {key,value} of pairs) {
    const f = fields.find(item=>item.key===key);
    if (!f) throw new Error('Dieses Feld gehört nicht zum Bereich '+section+'.');
    if (f.choices && !f.choices.includes(value)) throw new Error('Für «'+f.label+'» gibt es diese Auswahl: '+f.choices.filter(Boolean).join(', ')+'.');
    if (f.type === 'links') {
      const matches = namedRows(rows.filter(item=>isActive(item) && item.id !== row?.id && f.sections.includes(sectionOf(item))),value);
      if (!value || matches.length !== 1) throw new Error('Die Verknüpfung «'+value+'» ist nicht eindeutig.');
      patch[key] = [...new Set([...(patch[key] ?? row?.fields[key] ?? []),matches[0].id])];
    } else patch[key] = value;
  }
  // A move preserves the recorded duration unless the user supplied a new end.
  if (row && section==='Kalender' && (patch.time || patch.date) && patch.endTime===undefined && patch.endDate===undefined) {
    const date=value(row,'date'), time=value(row,'time'), endDate=value(row,'endDate') || date, endTime=value(row,'endTime');
    if (time && endTime) {
      const stamp=(day,t)=>Date.parse(day+'T'+t+':00Z');
      const duration=stamp(endDate,endTime)-stamp(date,time);
      const day=patch.date || date, end=stamp(day,patch.time || time)+duration;
      if (duration>0 && Number.isFinite(end)) {
        const iso=new Date(end).toISOString();
        patch.endTime=iso.slice(11,16);
        patch.endDate=iso.slice(0,10)===day ? '' : iso.slice(0,10);
      }
    } else if (patch.date && value(row,'endDate')) {
      const days=(Date.parse(endDate)-Date.parse(date))/86400000;
      if (Number.isInteger(days) && days>=0 && Number.isFinite(Date.parse(patch.date))) patch.endDate=shiftDate(patch.date,days);
    }
  }
  return patch;
}

export function replyRecipient(text) {
  const value = String(text || '').trim();
  if (!value || /[\r\n]/.test(value)) return '';
  const matches = value.match(/[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
  return matches.length === 1 ? matches[0] : '';
}
