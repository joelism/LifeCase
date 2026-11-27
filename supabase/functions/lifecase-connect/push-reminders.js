import webPush from 'npm:web-push@3.6.7';
import { Failure } from './providers.js';

const hosts = new Set(['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com', 'wns2-ln2p.notify.windows.com']);
const acceptKey = (key, length) => typeof key === 'string' && key.length === length && /^[A-Za-z0-9_-]+$/.test(key);

function endpointOf(input) {
  // Browsers issue these URLs. Restrict outbound delivery to supported push vendors.
  if (typeof input !== 'string' || input.length > 2048 || /[\s\\]/.test(input)) throw new Failure(400, 'Ungültiges Push-Gerät.');
  let url;
  try { url = new URL(input); } catch { throw new Failure(400, 'Ungültiges Push-Gerät.'); }
  if (url.protocol !== 'https:' || !hosts.has(url.hostname) || url.port || url.username || url.password ||
      url.pathname.length < 10 || url.hash || url.search) {
    throw new Failure(400, 'Dieser Browser-Push-Dienst wird derzeit nicht unterstützt.');
  }
  return url.href;
}
function validSubscription(input) {
  const endpoint = endpointOf(input?.endpoint);
  if (!acceptKey(input?.keys?.p256dh, 87) || !acceptKey(input?.keys?.auth, 22)) throw new Failure(400, 'Ungültige Push-Verschlüsselungsschlüssel.');
  return { endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth };
}
function get(result) {
  if (result.error) throw new Failure(503, 'Die Benachrichtigungen sind momentan nicht verfügbar.');
  return result.data;
}
async function keysFor(service, create = false) {
  const keys = get(await service.rpc('lifecase_push_keys'));
  if (keys || !create) return keys;
  return get(await service.rpc('lifecase_push_keys', { p_keys: webPush.generateVAPIDKeys() }));
}
export async function managePush(service, user, action, values) {
  if (action === 'push-public-key') return { key: (await keysFor(service, true)).publicKey };
  if (action === 'push-subscribe') {
    const device = validSubscription(values.subscription);
    // One subscription is tied to one user. A fresh successful opt-in replaces a prior user on that browser.
    const existing = get(await service.from('lifecase_push_devices').select('id,user_id').eq('endpoint', device.endpoint).maybeSingle());
    if (existing && existing.user_id !== user) {
      get(await service.from('lifecase_push_devices').delete().eq('id', existing.id).eq('user_id', existing.user_id));
    }
    get(await service.from('lifecase_push_devices').upsert({ user_id: user, ...device }, { onConflict: 'endpoint' }));
    return { subscribed: true };
  }
  const endpoint = endpointOf(values.endpoint);
  get(await service.from('lifecase_push_devices').delete().eq('user_id', user).eq('endpoint', endpoint));
  return { subscribed: false };
}

export async function deliverReminders(service) {
  const [rows, keys] = await Promise.all([service.rpc('lifecase_due_push').then(get), keysFor(service)]);
  if (!keys || !rows.length) return { delivered: 0, failures: 0 };
  const byDevice = new Map();
  for (const row of rows) {
    if (!byDevice.has(row.device_id)) byDevice.set(row.device_id, []);
    byDevice.get(row.device_id).push(row);
  }
  const groups = [...byDevice.values()].slice(0, 60);
  let delivered = 0;
  let failures = 0;
  for (let offset = 0; offset < groups.length; offset += 8) {
    const batch = await Promise.allSettled(groups.slice(offset, offset + 8).map(async records => {
      const first = records[0];
      const device = validSubscription({ endpoint: first.endpoint, keys: { p256dh: first.p256dh, auth: first.auth } });
      try {
        await webPush.sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
          JSON.stringify({ kind: 'expiry' }), { TTL: 12 * 3600, timeout: 7000, urgency: 'normal',
            vapidDetails: { subject: 'https://joelism.github.io/LifeCase/', ...keys } });
      } catch (error) {
        if ([404, 410].includes(error.statusCode)) {
          get(await service.from('lifecase_push_devices').delete().eq('id', first.device_id));
          return false;
        }
        throw error;
      }
      get(await service.from('lifecase_push_sent').upsert(records.map(record => ({
        device_id: record.device_id, record_id: record.record_id, expiry: record.expiry,
      })), { onConflict: 'device_id,record_id,expiry', ignoreDuplicates: true }));
      return true;
    }));
    delivered += batch.filter(result => result.status === 'fulfilled' && result.value).length;
    failures += batch.filter(result => result.status === 'rejected').length;
  }
  return { delivered, failures };
}
