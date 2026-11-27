import { connection } from './connections-api.js';
import { userError } from './backend.js';

const registration = () => navigator.serviceWorker?.getRegistration();
export function pushSupported() {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}
export async function pushEnabled() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  return Boolean(await (await registration())?.pushManager?.getSubscription());
}
function applicationKey(raw) {
  return Uint8Array.from(atob(raw.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - raw.length % 4) % 4)), letter => letter.charCodeAt(0));
}
export async function enablePush() {
  if (!pushSupported()) throw userError('Auf dem iPhone öffnest du LifeCase als Web-App vom Home-Bildschirm. Dort kannst du Push aktivieren.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw userError('Die Benachrichtigungen sind im Browser oder in den Geräteeinstellungen blockiert.');
  const active = await registration();
  if (!active?.active) throw userError('Lade LifeCase neu und aktiviere danach die Benachrichtigungen.');
  const { key } = await connection('push-public-key');
  let subscription = await active.pushManager.getSubscription();
  const newSubscription = !subscription;
  if (!subscription) subscription = await active.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(key) });
  try { await connection('push-subscribe', { subscription: subscription.toJSON() }); }
  catch (error) {
    if (newSubscription) await subscription.unsubscribe().catch(() => {});
    throw error;
  }
}
export async function disablePush() {
  if (!pushSupported()) return;
  const subscription = await (await registration())?.pushManager?.getSubscription();
  if (!subscription) return;
  try { await connection('push-unsubscribe', { endpoint: subscription.endpoint }); }
  finally { await subscription.unsubscribe(); }
}
