const topic = 'lifecase-provider-return';

// The provider runs in a second tab. The original LifeCase tab keeps its session
// and any unsaved form. Only the authenticated status endpoint can confirm a grant.
export function makeProviderGrant(connect, epochOf, notify) {
  let stop = () => {};
  async function begin(provider, grant, fallback, ready) {
    stop();
    const epoch = epochOf();
    const tab = window.open('about:blank','_blank');
    if (tab) tab.opener = null;
    const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel(topic) : null;
    let active = true, checking = false;
    const valid = () => active && epochOf() === epoch;
    const timer = setTimeout(()=>stopThis(), 11*60000);
    const check = async () => {
      if (!valid() || checking || document.hidden) return;
      checking = true;
      try {
        const {accounts} = await connect('status');
        const current = accounts[provider];
        if (valid() && current?.connected && (!grant || current[grant==='drafts'?'mailDrafts':'calendarWrite'])) {
          stopThis(); await ready(accounts);
        }
      } catch { /* The original form stays open. Returning to the tab retries. */ }
      finally { checking = false; }
    };
    const onVisible = () => { if (!document.hidden) check(); };
    function stopThis() {
      active = false; clearTimeout(timer); channel?.close();
      window.removeEventListener('focus',check);
      document.removeEventListener('visibilitychange',onVisible);
    }
    stop = stopThis;
    try {
      const action = grant==='drafts' ? 'start-mail-drafts' : grant==='calendar' ? 'start-calendar-write' : 'start';
      const result = await connect(action,{provider,separateWindow:true});
      if (!valid()) { tab?.close(); return; }
      const url = new URL(result.url);
      if (url.protocol!=='https:' || !['login.microsoftonline.com','accounts.google.com'].includes(url.hostname)) throw new Error('Ungültige Anbieteradresse.');
      window.addEventListener('focus',check);
      document.addEventListener('visibilitychange',onVisible);
      if (channel) channel.onmessage = () => check();
      if (tab && !tab.closed) tab.location.replace(url.href);
      else fallback(url.href,check);
    } catch (error) {
      tab?.close();
      if (valid()) notify(error.userMessage || 'Die Freigabe konnte nicht gestartet werden. Versuche es nochmals.');
      stopThis();
    }
  }
  return {begin, reset:()=>stop()};
}

export function providerReturnPage(url, root) {
  if (url.searchParams.get('lcWindow') !== '1' || !url.searchParams.has('lcConnection')) return false;
  const state = url.searchParams.get('lcConnection');
  const ok = ['connected','drive-connected'].includes(state);
  const title = document.createElement('h1');
  title.textContent = ok ? 'Konto freigegeben' : 'Freigabe offen';
  const info = document.createElement('p');
  info.textContent = ok ? 'Dein ursprüngliches LifeCase-Fenster ist weiterhin geöffnet. Dort kannst du fortfahren.' :
    state==='wrong-account' ? 'Wähle bei der Freigabe das bereits verbundene Konto. Dein bisheriges Konto bleibt verbunden.' :
    'Der Anbieter hat die Freigabe nicht abgeschlossen. Kehre zu LifeCase zurück und versuche es erneut.';
  const back = document.createElement('button'); back.className='button primary'; back.textContent='Fenster schliessen';
  back.onclick=()=>window.close();
  const card=document.createElement('main'); card.className='panel panel-body'; card.append(title,info,back); root.replaceChildren(card);
  if (typeof BroadcastChannel==='function') { const channel=new BroadcastChannel(topic); channel.postMessage('changed'); channel.close(); }
  if (ok) window.close();
  return true;
}
