import { appointmentCheckIns, checkInQuestion } from './appointment-care.js';
import { namedRows, normalize, recordSeeds, replyRecipient, shoppingFields } from './assistant-actions.js';
import { archive, ensureShoppingList, findRecord, message, records, userError } from './backend.js';
import { connection, healthRows } from './connections-api.js';
import { editRecord, errorAt, openDialog } from './editor.js';
import { measures } from './health-data.js';
import { calendarEntries, dateOf, isActive, nameOf, recordSections, reminderDue, searchRecords, sectionOf, sections, sha256, shiftDate, showDate, today, value } from './model.js';
import { button, esc, options } from './ui.js';

const providerName = { google:'Gmail', microsoft:'Outlook' };
const verbs = {shopping_add:'auf der Liste', shopping_check:'abgehakt', shopping_uncheck:'wieder offen', shopping_remove:'entfernt'};
const summary = row => nameOf(row) + ' · ' + sectionOf(row) + (value(row,'date') ? ' · ' + showDate(value(row,'date')) : '');
const link = (label, action) => ({label,action});
const safe = fn => { try { return fn(); } catch (error) { throw userError(error.message); } };

export function makeWorkspace(ctx, add) {
  let controls = [];
  let results = {};
  function reset() { controls = []; results = {}; }
  function clear() { controls = []; }
  function buttons() {
    return controls.length ? '<div class="assistant-tools"><div class="actions">' +
      controls.map((item,i)=>button(item.label,'workspace-choice',String(i))).join('')+'</div></div>' : '';
  }
  async function choose(index) {
    const action = controls[index]?.action;
    if (action) { clear(); await action(); }
  }
  async function execute(cmd, request, epoch) {
    const guard = () => { if (ctx.epoch() !== epoch) throw userError('Die Sitzung wurde gewechselt.'); };
    const show = (text, actions = [], model = '') => {
      guard(); controls = actions;
      add('assistant', text, '', '', model || 'LifeCase hat das Ergebnis für '+cmd.operation+' angezeigt.');
    };
    const navigate = section => link(section+' öffnen',()=>ctx.go(section));
    const chooseRow = async (type, hits, display, handle, defaultFirst = false) => {
      guard();
      results[type] = hits.slice(0,25);
      const n = cmd.position || (hits.length === 1 || defaultFirst ? 1 : 0);
      if (n && hits[n-1]) return handle(hits[n-1]);
      if (!hits.length || n > hits.length) return show('Dazu habe ich keinen passenden Treffer.');
      const top = hits.slice(0,10);
      show(top.map((r,i)=>(i+1)+'. '+display(r)).join('\n'),
        top.map((r,i)=>link('Nr. '+(i+1),()=>handle(r))),
        'Auswahl für '+type+' mit '+top.length+' nummerierten Treffern. Der Nutzer kann eine Nummer wählen.');
    };
    const go = section => show('Hier kannst du mit «'+section+'» fortfahren.',[navigate(section)]);
    const readAI = async (mode, source) => {
      guard();
      const response = await connection('assistant-reading',{reading:{mode,request,source:source.slice(0,10000)}});
      guard();
      if (response.action !== 'reading' || !response.text) throw userError('Die KI konnte den Text nicht auswerten.');
      return response.text;
    };
    clear();
    if (cmd.operation === 'help') return show('Ich kann deine Einkaufsliste führen, in Outlook und Gmail suchen, E-Mails zusammenfassen und Entwürfe schreiben. Ich finde und bearbeite LifeCase-Einträge, plane Termine und Schlaf, lese importierte Health-Werte und suche Scans in Drive. Sag mir einfach, was du brauchst.');
    if (cmd.operation === 'open') return Object.hasOwn(sections,cmd.section) ? ctx.go(cmd.section) : show('Welchen Bereich möchtest du öffnen?');

    if (cmd.operation === 'scan') return ctx.scan(cmd.query==='plan' ? 'plan' : 'document');
    if (cmd.operation === 'sleep_settings') return ctx.sleepSettings();
    if (cmd.operation.startsWith('shopping_')) {
      const rows = await records(); guard();
      const lists = rows.filter(r=>sectionOf(r)==='Einkaufen' && isActive(r));
      let matches = cmd.operation === 'shopping_create' ? lists.filter(row=>normalize(nameOf(row))===normalize(cmd.query || 'Einkaufsliste')) : namedRows(lists,cmd.query);
      if (!cmd.query && cmd.operation!=='shopping_create' && matches.some(r=>r.id===results.listId)) matches=matches.filter(r=>r.id===results.listId);
      const change = async list => {
        guard();
        const current = await findRecord(list.id); guard();
        if (!isActive(current) || sectionOf(current)!=='Einkaufen') throw userError('Diese Liste ist nicht mehr aktiv.');
        results.listId=current.id;
        if (cmd.operation === 'shopping_show') {
          const items = current.fields.items || [];
          const group = done => items.filter(i=>Boolean(i.done)===done).map(i=>[i.quantity,i.name].filter(Boolean).join(' '));
          return show(nameOf(current)+'\nOffen: '+(group(false).join(', ') || 'nichts')+
            (group(true).length ? '\nGekauft: '+group(true).join(', ') : ''),[navigate('Einkaufen')]);
        }
        if (cmd.operation === 'shopping_create' && !cmd.pairs.length) return show('«'+nameOf(current)+'» ist als Einkaufsliste vorhanden.',[navigate('Einkaufen')]);
        const perform = async () => {
          guard();
          const result = await ctx.changeShopping(current.id,row=>safe(()=>shoppingFields(row.fields,cmd.operation,cmd.pairs)));
          guard();
          if (!result) throw userError('Die Liste wird gerade bearbeitet. Versuche es nochmals.');
          show(nameOf(result)+' · '+cmd.pairs.map(p=>[p.value,p.key].filter(Boolean).join(' ')).join(', ')+
            ' '+(verbs[cmd.operation] || 'auf der Liste')+'.',[navigate('Einkaufen')]);
        };
        if (cmd.operation === 'shopping_remove') return show('Aus «'+nameOf(current)+'» entfernen: '+cmd.pairs.map(p=>p.key).join(', ')+'?',[link('Artikel entfernen',perform)]);
        return perform();
      };
      if (matches.length) return chooseRow('shopping',matches,nameOf,change);
      if (!['shopping_create','shopping_add'].includes(cmd.operation)) return show('Keine passende Einkaufsliste gefunden.',[navigate('Einkaufen')]);
      const title = cmd.query || 'Einkaufsliste';
      if (title.length > 80) throw userError('Gib der Liste einen kürzeren Namen.');
      if (cmd.pairs.length || cmd.operation === 'shopping_add') safe(()=>shoppingFields({items:[]},cmd.operation,cmd.pairs));
      const older = rows.filter(r=>sectionOf(r)==='Einkaufen' && !isActive(r) && normalize(nameOf(r))===normalize(title)).map(r=>r.id).sort();
      const key = await sha256(new Blob([JSON.stringify([ctx.owner(),normalize(title),older])])); guard();
      const id = [key.slice(0,8),key.slice(8,12),'5'+key.slice(13,16),'a'+key.slice(17,20),key.slice(20,32)].join('-');
      const created = await ensureShoppingList(id,title); guard(); ctx.addRecord(created);
      return change(created);
    }

    if (cmd.operation.startsWith('record_') || ['reminders','prepare'].includes(cmd.operation)) {
      const rows = await records(); guard();
      if (cmd.operation === 'reminders') {
        const due = calendarEntries(rows).filter(item=>reminderDue(item,today()));
        const lines=due.map(item=>showDate(item.date)+' · '+nameOf(item.row));
        for (const row of appointmentCheckIns(rows)) lines.push(nameOf(row)+' · '+checkInQuestion(row));
        return show(lines.join('\n') || 'Aktuell sind keine Erinnerungen fällig.',[navigate('Erinnerungen')]);
      }
      const openEditor = (section,row=null) => {
        const patch = safe(()=>recordSeeds(section,cmd.pairs,rows,row));
        editRecord(section,row,ctx,patch);
      };
      if (cmd.operation === 'record_create') return openEditor(cmd.section);
      const lookup = !cmd.query && cmd.position && results.record && !cmd.from && !cmd.through;
      const previous = lookup && results.record[cmd.position-1];
      const selectedRow = previous && rows.find(row=>row.id===previous.id && isActive(row) && (!cmd.section || sectionOf(row)===cmd.section));
      if (lookup && !selectedRow) return show('Dieser Treffer ist nicht mehr verfügbar. Suche den Eintrag erneut.');
      const hits = lookup ? [selectedRow] :
        searchRecords(rows,ctx.files(),cmd.query,{section:cmd.section,from:cmd.from,to:cmd.through});
      if (cmd.operation === 'prepare') {
        if (lookup) return ctx.canPrepare(selectedRow) ? ctx.prepareAssistantRecord(selectedRow) : show('Dieser Eintrag hat keine Terminvorbereitung.');
        return chooseRow('record',hits.filter(ctx.canPrepare),summary,row=>ctx.prepareAssistantRecord(row));
      }
      if (cmd.operation === 'record_answer') {
        if (!hits.length) return show('Keine passenden Einträge gefunden.');
        const sources=hits.slice(0,8).map(row=>summary(row)+'\n'+ (sections[sectionOf(row)]?.fields || []).filter(f=>f.type!=='links' && value(row,f.key)).map(f=>f.label+': '+value(row,f.key)).join('\n')).join('\n\n');
        return show(await readAI('summary',sources)+'\n\nGrundlage: '+Math.min(8,hits.length)+' von '+hits.length+' Treffern.',[navigate('Suche')]);
      }
      const exact = cmd.query && hits.filter(r=>normalize(nameOf(r))===normalize(cmd.query));
      const display = async row => {
        guard();
        const current = await findRecord(row.id); guard();
        if (!isActive(current)) throw userError('Dieser Eintrag ist inzwischen archiviert.');
        const section = sectionOf(current);
        if (section==='Vorbereitung') return ctx.openPreparation(current);
        if (!recordSections.includes(section)) return go(section);
        if (cmd.operation === 'record_edit') return openEditor(section,current);
        if (cmd.operation === 'record_archive') return show('«'+nameOf(current)+'» archivieren?',[
          link('Archivieren',async()=>{ guard(); const saved=await archive(current,true); guard(); ctx.addRecord(saved); show('«'+nameOf(saved)+'» ist archiviert.'); })]);
        const lines = sections[section].fields.map(f=>{
          const v = value(current,f.key);
          return v !== '' && (!Array.isArray(v) || v.length) ? f.label+': '+(Array.isArray(v) ? v.map(id=>rows.find(r=>r.id===id)).filter(Boolean).map(nameOf).join(', ') : v) : '';
        }).filter(Boolean);
        show(lines.join('\n'),[link('Eintrag öffnen',()=>ctx.openAssistantRecord(current.id))]);
      };
      if (cmd.operation === 'record_search') {
        results.record=hits.slice(0,25);
        return show(hits.length ? hits.length+' Treffer\n'+hits.slice(0,10).map((r,i)=>(i+1)+'. '+summary(r)).join('\n') : 'Keine passenden Einträge gefunden.',
          hits.slice(0,10).map((r,i)=>link('Nr. '+(i+1),()=>display(r))), 'Eintragssuche mit '+Math.min(hits.length,10)+' nummerierten Treffern.');
      }
      if (lookup) return display(selectedRow);
      return chooseRow('record',exact?.length ? exact : hits,summary,display);
    }

    if (['health_read','health_summary'].includes(cmd.operation)) {
      const metric = cmd.query;
      if (metric && !Object.hasOwn(measures,metric)) return go('Gesundheitsdaten');
      const end = cmd.through || today(), start=cmd.from || shiftDate(end,-6);
      if (start > end) throw userError('Prüfe den Zeitraum.');
      const rows = await healthRows(start,metric,end); guard();
      if (!rows.length) return show('Für diesen Zeitraum sind keine passenden Health-Werte importiert.',[navigate('Gesundheitsdaten')]);
      const lines = rows.slice(0,60).map(r=>showDate(r.day)+' · '+(measures[r.metric]?.label || r.metric)+' '+r.value+' '+(measures[r.metric]?.unit || '')+' · '+r.source_name);
      if (cmd.operation === 'health_summary') {
        const groups=new Map();
        for (const r of rows) {
          const group=[r.metric,r.source,r.source_name].join('|');
          if (!groups.has(group)) groups.set(group,{metric:r.metric,source:r.source_name,values:[],days:new Set()});
          const item=groups.get(group); item.values.push(Number(r.value)); item.days.add(r.day);
        }
        const facts=[...groups.values()].filter(g=>measures[g.metric]).map(g=>({Messwert:measures[g.metric].label,Einheit:measures[g.metric].unit,
          Quelle:g.source,Tage:g.days.size,Mittelwert:Number((g.values.reduce((a,b)=>a+b,0)/g.values.length).toFixed(2))}));
        return show(await readAI('summary',JSON.stringify({von:start,bis:end,Quellen_getrennt:facts})),[navigate('Gesundheitsdaten')]);
      }
      return show(lines.join('\n')+(rows.length>60?'\nWeitere Messwerte findest du unter Gesundheitsdaten.':''),[navigate('Gesundheitsdaten')]);
    }

    if (cmd.operation.startsWith('drive_')) {
      const response=await connection('drive-list',{provider:'drive',query:cmd.query}); guard();
      const hits=cmd.position && !cmd.query && results.drive ? results.drive : response.rows;
      const select=file=>file.folder ? go('Google Drive') : ctx.importDriveFile(file);
      if (cmd.operation==='drive_import') return chooseRow('drive',hits,file=>file.name,select);
      results.drive=hits.slice(0,25);
      return show(hits.length ? hits.slice(0,10).map((r,i)=>(i+1)+'. '+r.name).join('\n') : 'Keine passenden Dateien gefunden.',
        hits.slice(0,10).map((r,i)=>link('Nr. '+(i+1)+' öffnen',()=>select(r))), 'Drive-Suche mit '+Math.min(10,hits.length)+' Treffern.');
    }

    if (!cmd.operation.startsWith('mail_')) throw userError('Diese Aktion kennt LifeCase noch nicht.');
    const {accounts}=await connection('status'); guard();
    const keys=Object.keys(providerName).filter(key=>accounts[key]?.connected && (!cmd.provider || cmd.provider===key));
    if (cmd.operation==='mail_draft') return mailEditor(keys,accounts,Object.fromEntries(cmd.pairs.map(p=>[p.key,p.value])));
    if (!keys.length) return show('Verbinde für diesen Auftrag zuerst dein '+(providerName[cmd.provider] || 'Gmail- oder Outlook')+'-Konto.',[navigate('Verbindungen')]);
    const cached=!['mail_search','mail_digest'].includes(cmd.operation) && !cmd.query && !cmd.from && !cmd.through && results.mail?.length;
    const referenced = cached && cmd.position ? results.mail[cmd.position-1] : null;
    if (cached && cmd.position && (!referenced || !keys.includes(referenced.provider) || referenced.account!==accounts[referenced.provider]?.accountRef))
      return show('Dieser nummerierte Treffer gehört nicht zum gewählten Postfach oder ist nicht mehr verfügbar. Suche die Mail erneut.');
    let hits = cached ? results.mail.filter(r=>keys.includes(r.provider) && r.account===accounts[r.provider].accountRef) : [];
    let errors=[];
    if (cached && !hits.length) return show('Die vorherigen Treffer gehören zu einem anderen Postfach. Starte eine neue Suche.');
    if (!cached) {
      results.selectedMail=null;
      const responses=await Promise.allSettled(keys.map(provider=>connection('mail',{provider,query:cmd.query,account:accounts[provider].accountRef,from:cmd.from,through:cmd.through}))); guard();
      hits=responses.flatMap((r,i)=>r.status==='fulfilled' ? r.value.rows.map(row=>({...row,provider:keys[i],account:accounts[keys[i]].accountRef})) : []);
      errors=responses.flatMap((r,i)=>r.status==='rejected' ? [providerName[keys[i]]+': '+message(r.reason)] : []);
      if (errors.length===keys.length) throw userError(errors.join('\n'));
      if (responses.some(r=>r.status==='fulfilled' && r.value.partial)) errors.push('Weitere Nachrichten im Zeitraum wurden nicht durchsucht. Grenze die Suche bei Bedarf ein.');
      hits.sort((a,b)=>b.date.localeCompare(a.date));
    }
    if (!cached) results.mail=hits.slice(0,25);
    const label=r=>providerName[r.provider]+' · '+showDate(r.date)+' · '+r.sender+' · '+r.subject;
    if (cmd.operation==='mail_digest') {
      if (!hits.length) return show(['Keine passenden Nachrichten gefunden.',...errors].join('\n'));
      const subset=hits.slice(0,5);
      const details=await Promise.allSettled(subset.map(r=>connection('detail',{provider:r.provider,id:r.id,account:r.account}))); guard();
      const sources=details.flatMap((res,i)=>res.status==='fulfilled' ? [label(subset[i])+'\n'+res.value.text.slice(0,1500)] : []);
      if (!sources.length) throw userError('Die gefundenen Nachrichten konnten nicht gelesen werden.');
      return show(await readAI('summary',sources.join('\n\n'))+'\n\nGelesene Nachrichten: '+sources.length+' von '+subset.length+'.'+(errors.length?'\n'+errors.join('\n'):''));
    }
    const select = async row => {
      guard();
      const provider=row.provider, id=row.id;
      const mail=await connection('detail',{provider,id,account:row.account}); guard();
      results.selectedMail=row;
      const source='Absender: '+mail.sender+'\nBetreff: '+mail.subject+'\n\n'+mail.text;
      const file=()=>ctx.importAssistantMail(mail,item=>connection('file',{provider,id,attachment:item.id,account:row.account},true));
      if (cmd.operation==='mail_file') return file();
      if (cmd.operation==='mail_plan') {
        const plan=await connection('assistant-reading',{reading:{mode:'plan',request,source:('Nachricht vom '+showDate(mail.date)+'\n'+source).slice(0,10000)}}); guard();
        if (plan.action!=='mail_plan' || !plan.fields) throw userError('Der Kalenderentwurf konnte nicht erstellt werden.');
        if (!plan.fields.title) return show('Welchen Termin oder welche Frist aus dieser Mail möchtest du übernehmen?',[], 'Die Ausgangsmail ist ausgewählt. Für eine Rückfrage zu einem Termin daraus erneut mail_plan verwenden.');
        editRecord('Kalender',null,ctx,plan.fields);
        return;
      }
      if (cmd.operation==='mail_summary') return show(await readAI('summary',source),[link('Original ansehen',()=>show(source,[link('Im Dossier ablegen',file)]))]);
      if (cmd.operation==='mail_reply') {
        const body=await readAI('reply',source);
        return mailEditor([provider],accounts,{to:replyRecipient(mail.replyAddress || mail.sender),subject:/^re:/i.test(mail.subject)?mail.subject:'Re: '+mail.subject,body},id);
      }
      return show(source,[link('Im Dossier ablegen',file)],'Eine E-Mail wurde geöffnet. Für Folgefragen ist sie im Posteingang ausgewählt.');
    };
    if (cmd.operation==='mail_search') return show((hits.length ? hits.slice(0,10).map((r,i)=>(i+1)+'. '+label(r)).join('\n') : 'Keine passenden Nachrichten gefunden.')+(errors.length?'\n'+errors.join('\n'):''),
      hits.slice(0,10).map((r,i)=>link('Nr. '+(i+1)+' lesen',()=>select(r))), 'E-Mail-Suche mit '+Math.min(10,hits.length)+' nummerierten Treffern.');
    if (errors.length && !hits.length) return show('Keine Treffer in den erreichbaren Postfächern.\n'+errors.join('\n'));
    if (referenced) return select(referenced);
    const selected=results.selectedMail;
    if (cached && !cmd.position && selected && hits.some(r=>r.id===selected.id && r.provider===selected.provider && r.account===selected.account)) return select(selected);
    return chooseRow('mail',hits,label,select);
  }

  function mailEditor(keys,accounts,fields,replyId='') {
    const epoch=ctx.epoch();
    const form=openDialog('E-Mail-Entwurf','<div class="form-grid"><label class="input-wrap wide">Von<select name="provider">'+
      options(keys.length ? keys.map(k=>[k,providerName[k]+' · '+accounts[k].email]) : [['','Standard-Mailprogramm']],keys[0])+'</select></label>'+
      '<label class="input-wrap wide">An<input type="email" name="to" maxlength="254" required value="'+esc(fields.to)+'"></label>'+
      '<label class="input-wrap wide">Betreff<input name="subject" maxlength="250" required value="'+esc(fields.subject)+'"></label>'+
      '<label class="input-wrap wide">Nachricht<textarea name="body" rows="8" maxlength="10000" required>'+esc(fields.body)+'</textarea></label></div>'+
      '<p class="hint" data-grant></p><p class="form-error" hidden role="alert"></p>',
      button('Schliessen','close')+button('Im Mailprogramm öffnen','compose-external')+'<button class="button primary" type="submit">Im Postfach speichern</button>',true).querySelector('form');
    const save=form.querySelector('[type=submit]');
    let saving=false;
    const refresh=()=>{
      const allowed=accounts[form.elements.provider.value]?.mailDrafts;
      save.disabled=saving || !allowed; save.hidden=!allowed;
      const hint=form.querySelector('[data-grant]');
      hint.textContent=allowed ? 'Du findest den Entwurf anschliessend im gewählten Postfach und kannst ihn dort versenden.' :
        'Für dieses Konto fehlt die Freigabe «E-Mail-Entwürfe erlauben» unter Verbindungen.';
      if (!allowed) {
        const control=document.createElement('button'); control.type='button'; control.className='button'; control.textContent=keys.length ? 'Entwürfe erlauben' : 'Verbindungen öffnen';
        control.onclick=()=>{
          const provider=form.elements.provider.value;
          if (!provider) { ctx.go('Verbindungen'); return; }
          ctx.authorizeMailDrafts(provider,(href,check)=>{
            if (!form.isConnected || ctx.epoch()!==epoch) return;
            const a=document.createElement('a'); a.href=href; a.target='_blank'; a.rel='noopener noreferrer'; a.textContent='Freigabe beim Anbieter öffnen';
            hint.replaceChildren(a, ' '); const verify=document.createElement('button'); verify.type='button'; verify.textContent='Freigabe prüfen'; verify.onclick=check; hint.append(verify);
          },updated=>{
            if (!form.isConnected || ctx.epoch()!==epoch) return;
            if (accounts[provider].accountRef!==updated[provider]?.accountRef) {
              errorAt(form,userError('Das verbundene Postfach hat gewechselt. Öffne einen neuen Entwurf.')); return;
            }
            accounts=updated; refresh();
          });
        };
        hint.append(' ',control);
      }
    };
    form.querySelector('[data-compose-external]').onclick=()=>{
      if (!form.reportValidity()) return;
      const f=new FormData(form);
      location.href='mailto:'+encodeURIComponent(f.get('to').trim())+'?subject='+encodeURIComponent(f.get('subject'))+'&body='+encodeURIComponent(f.get('body'));
    };
    form.elements.provider.onchange=refresh; refresh();
    form.onsubmit=async event=>{
      event.preventDefault(); if (saving || save.disabled || epoch!==ctx.epoch()) return;
      const f=new FormData(form), provider=f.get('provider'); saving=true; save.disabled=true; form.elements.provider.disabled=true;
      try {
        const result=await connection('mail-draft',{provider,account:accounts[provider].accountRef,replyId,to:f.get('to').trim(),subject:f.get('subject').trim(),body:f.get('body').trim()});
        if (!result.saved) throw userError('Der Anbieter hat den Entwurf nicht bestätigt.');
        if (epoch===ctx.epoch()) {
          add('assistant','Der Entwurf ist in '+providerName[provider]+' unter «Entwürfe» gespeichert.');
          if (form.isConnected) ctx.returnToAssistant();
        }
      } catch(error) { if (form.isConnected && epoch===ctx.epoch()) { saving=false; form.elements.provider.disabled=false; errorAt(form,error); refresh(); } }
    };
  }
  return { execute, reset, clear, buttons, choose };
}
