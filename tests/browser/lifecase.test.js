// Test the actual Pages bundle and UI. All network requests are intercepted;
// the fixture cannot access a real identity, mailbox or LifeCase record.
import { after,before,test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
import { chromium,webkit } from 'playwright';

const app='https://joelism.github.io/LifeCase/';
const account='demo@example.org', userId='10000000-0000-4000-8000-000000000001';
let browser;
before(async()=>{
  const engine=process.env.LIFECASE_TEST_ENGINE || 'chromium';
  if (!['chromium','webkit'].includes(engine)) throw new Error('Unbekannter Testbrowser');
  browser=engine === 'webkit' ? await webkit.launch() : await chromium.launch({
    executablePath:process.env.LIFECASE_TEST_BROWSER || undefined, args:process.env.LIFECASE_TEST_BROWSER ? ['--disable-gpu'] : []});
});
after(async()=>{await browser?.close();});
const json=(route,obj,status=200)=>route.fulfill({status,headers:{'Content-Type':'application/json; charset=utf-8','Access-Control-Allow-Origin':new URL(app).origin,'Access-Control-Allow-Headers':'*','Access-Control-Allow-Methods':'GET, POST, PATCH, OPTIONS'},body:JSON.stringify(obj)});
const baseRecord={id:'20000000-0000-4000-8000-000000000001',section:'Einkaufen',revision:1,fields:{title:'Haushalt',items:[]},
  created_at:'2026-11-28T08:00:00Z',updated_at:'2026-11-28T08:00:00Z',archived_at:null};
async function fixture(t,installed=false) {
  const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'Europe/Zurich',serviceWorkers:'block'});
  t.after(()=>context.close());
  if (installed) await context.addInitScript(()=>{Object.defineProperty(navigator,'standalone',{value:true});});
  let allowed=false,ready=false,logins=0,refreshes=0,patches=0,confirmScope;
  let row=structuredClone(baseRecord);
  const writes=[],errors=[];
  const user={id:userId,email:account,role:'authenticated',aud:'authenticated',user_metadata:{},app_metadata:{}};
  const payload=Buffer.from(JSON.stringify({sub:userId,aal:'aal2',exp:Math.round(Date.now()/1000)+3600})).toString('base64url');
  const session={access_token:'eyJhbGciOiJub25lIn0.'+payload+'.fixture',refresh_token:'fixture-refresh',
    token_type:'bearer',expires_in:3600,user};
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if (req.method()==='OPTIONS') return route.fulfill({status:204,headers:{'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':req.headers()['access-control-request-headers'] || '*','Access-Control-Allow-Methods':'GET, POST, PATCH, OPTIONS'}});
    if (url.origin===new URL(app).origin) {
      const name=url.pathname.replace(/^\/LifeCase\/?/,'') || 'index.html';
      if (!/^(index\.html|app\.js|styles\.css|icon-\d+\.png|manifest\.webmanifest|site-assets\/[\w.-]+)$/.test(name)) return route.abort();
      const contentType={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.webmanifest':'application/manifest+json'}[extname(name)];
      return route.fulfill({body:await readFile(resolve('dist',name)),contentType});
    }
    if (url.hostname==='login.microsoftonline.com' && url.pathname==='/fixture') {
      return route.fulfill({contentType:'text/html; charset=utf-8',body:'<!doctype html><meta charset="utf-8"><a id="grant" href="'+app+'?lcWindow=1&amp;lcConnection=connected">Kontofreigabe bestätigen</a>'});
    }
    if (url.hostname!=='gmulchykvjxkbpcfnspg.supabase.co') return route.abort();
    if (url.pathname==='/auth/v1/token') {
      if (url.searchParams.get('grant_type')==='refresh_token') refreshes++; else logins++;
      return json(route,session);
    }
    if (url.pathname==='/auth/v1/user') return json(route,user);
    if (url.pathname==='/rest/v1/lifecase_records'){
      const single=url.searchParams.has('id');
      if (req.method()==='PATCH') {
        patches++;
        if (patches===1) {
          row={...row,revision:2,fields:{...row.fields,items:[{id:'other',name:'Eier',quantity:'',done:false}]}};
          return json(route,[]);
        }
        assert.equal(url.searchParams.get('revision'),'eq.2');
        row={...row,...req.postDataJSON(),revision:3};return json(route,[row]);
      }
      return json(route,single?row:[row]);
    }
    if (url.pathname.startsWith('/rest/v1/')) return json(route,[]);
    if (url.pathname.endsWith('/lifecase-connect')){
      const p=req.postDataJSON();
      switch(p.action){
        case 'status': return json(route,{accounts:{microsoft:{connected:true,available:true,email:account,accountRef:'account',mailDrafts:allowed}},callback:''});
        case 'calendar': return json(route,{events:[]});
        case 'assistant-status': return json(route,{available:true});
        case 'assistant-briefing': return json(route,{action:'briefing',text:'Dein Überblick.',help:''});
        case 'mail': return json(route,{rows:[],next:''});
        case 'assistant': {
          const shopping=p.messages.at(-1).content.includes('Milch');
          return json(route,{action:'workspace',operation:shopping?'shopping_add':'mail_draft',section:'',query:'',position:0,provider:'',from:'',through:'',
            pairs:shopping?[{key:'Milch',value:'2 Liter'},{key:'Brot',value:''}]:[{key:'to',value:'person@example.org'},{key:'subject',value:'Einladung'},{key:'body',value:'Danke für die Einladung.'}]});
        }
        case 'start-mail-drafts': confirmScope=p;ready=true;return json(route,{url:'https://login.microsoftonline.com/fixture'});
        case 'mail-draft': writes.push(p);return json(route,{saved:allowed});
        default: return json(route,{});
      }
    }
    return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(app);await page.locator('#login-form [name=email]').fill(account);
  await page.locator('#login-form [name=password]').fill('fixture-only-password');
  await page.locator('#login-form [type=submit]').click();
  await page.locator('[data-assistant]').first().waitFor();
  const ask=async text=>{
    await page.locator('[data-assistant]').first().click();
    await page.getByText('OpenAI verarbeitet deine Chatnachricht',{exact:false}).waitFor();
    await page.getByRole('textbox',{name:'Deine Nachricht'}).fill(text);
    await page.getByRole('button',{name:'Nachricht senden'}).click();
  };
  return {page,context,writes,errors,ask,get row(){return row;},get logins(){return logins;},get refreshes(){return refreshes;},get patches(){return patches;},
    grant:()=>{assert.equal(ready,true);assert.equal(confirmScope.separateWindow,true);allowed=true;}};
}
test('shared iPhone-sized browser tab keeps its draft and login through provider consent',async t=>{
  const f=await fixture(t);
  await f.ask('Schreib mir eine E-Mail.');
  const form=f.page.locator('dialog form');
  await form.locator('[name=body]').fill('Mein korrigierter Text bleibt erhalten.');
  const newTab=f.context.waitForEvent('page');
  await f.page.getByRole('button',{name:'Entwürfe erlauben'}).click();
  const provider=await newTab;
  const allow=provider.locator('#grant');
  await allow.waitFor(); f.grant(); await allow.click();
  await f.page.bringToFront();
  const save=f.page.getByRole('button',{name:'Im Postfach speichern'});
  await save.waitFor();await save.click();
  await f.page.getByText('Der Entwurf ist in Outlook',{exact:false}).waitFor();
  assert.equal(f.logins,1);assert.equal(f.writes.length,1);
  assert.equal(f.writes[0].body,'Mein korrigierter Text bleibt erhalten.');assert.equal(f.writes[0].to,'person@example.org');assert.deepEqual(f.errors,[]);
});

test('installed-mode reload renews an expired session and simultaneous shopping changes survive retry',async t=>{
  const f=await fixture(t,true);
  await f.page.evaluate(()=>{
    const key='lifecase-auth-v1';
    const stored=JSON.parse(localStorage.getItem(key));
    stored.expires_at=Math.floor(Date.now()/1000)-300;
    localStorage.setItem(key,JSON.stringify(stored));
  });
  await f.page.reload();await f.page.locator('[data-assistant]').first().waitFor();
  assert.equal(f.logins,1);assert.ok(f.refreshes>=1);
  await f.ask('Setze Milch und Brot auf meine Einkaufsliste.');
  await f.page.getByText('auf der Liste.',{exact:false}).waitFor();
  assert.equal(f.patches,2);assert.deepEqual(f.row.fields.items.map(i=>i.name),['Eier','Milch','Brot']);
  await f.page.locator('dialog [data-close]').first().click();
  await f.page.locator('[data-view="Einkaufen"]').last().click();
  await f.page.getByText('2 Liter',{exact:true}).waitFor();
  assert.deepEqual(f.errors,[]);
});
