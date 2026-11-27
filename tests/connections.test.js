import test from 'node:test';
import assert from 'node:assert/strict';
import { strToU8, Zip, ZipDeflate, zipSync } from 'fflate';
import { displayedAgenda, expandEvents } from '../src/connected-model.js';
import { importHealthExport, preferredHealthDays } from '../src/health-data.js';
import { readMailFile } from '../src/mail-file.js';
import { connectionsView, healthView, mailboxView } from '../src/connected-views.js';
import { calendarPage, dashboard } from '../src/views.js';
import { authorizationUrl, listCalendar, listMail, messageDetail } from '../supabase/functions/lifecase-connect/providers.js';

const stepType = 'HKQuantityTypeIdentifierStepCount';
const sleepType = 'HKCategoryTypeIdentifierSleepAnalysis';
const sample = (type, source, value, start, end = start, unit = 'count') =>
  '<Record type="' + type + '" sourceName="' + source + '" value="' + value + '" unit="' + unit + '" startDate="' + start + '" endDate="' + end + '"/>';
const day = '2026-11-27';

test('Apple Health supports ZIP and preserves source separation and the Swiss reporting day', async () => {
  const step = sample(stepType, 'Joel &amp; Watch', 450, '2026-11-26 23:15:00 +0000');
  const core = sample(sleepType, 'Watch', 'HKCategoryValueSleepAnalysisAsleepCore', '2026-11-27 01:00:00 +0100', '2026-11-27 05:00:00 +0100');
  const unspecified = sample(sleepType, 'Watch', 'HKCategoryValueSleepAnalysisAsleep', '2026-11-27 00:30:00 +0100', '2026-11-27 06:30:00 +0100');
  const xmldata = '<HealthData>' + step.repeat(2) + core + unspecified +
    sample(stepType, 'iPhone', 900, '2026-11-27 06:15:00 +0100') + '</HealthData>';
  const zip = zipSync({ 'apple_health_export/export.xml': strToU8(xmldata), 'apple_health_export/export_cda.xml': strToU8('Ignored') });
  const grouped = await importHealthExport(new Blob([zip]), day, day);
  assert.deepEqual(grouped.map(row => [row.name, row.values[0].value]), [['iPhone', 900], ['Joel & Watch', 450], ['Watch', 6]]);
  const exported = grouped[1].values[0];
  const native = { ...exported, source: 'healthkit', value: 500 };
  assert.deepEqual(preferredHealthDays([native, exported], 'steps', day, day), [native]);
});

test('Apple Health imports a full archive over the old XML limit and filters by the selected day', async () => {
  const chunks = [];
  const zip = new Zip((error, chunk) => {
    if (error) throw error;
    chunks.push(chunk);
  });
  const xml = new ZipDeflate('apple_health_export/export.xml', { level: 1 });
  zip.add(xml);
  xml.push(strToU8('<HealthData><!--'));
  const padding = new Uint8Array(1024 * 1024).fill(32);
  for (let mb = 0; mb < 234; mb++) xml.push(padding);
  xml.push(strToU8('-->' + sample(stepType, 'Old Watch', 200, '2025-01-01 01:00:00 +0100') +
    sample(stepType, 'Test Watch', 800, '2026-11-27 16:00:00 +0100') + '</HealthData>'), true);
  zip.end();
  const archive = new Blob(chunks);
  archive.arrayBuffer = () => assert.fail('The importer must read slices of the archive');
  const groups = await importHealthExport(archive, day, day);
  assert.deepEqual(groups.map(group => [group.name, group.values[0].value]), [['Test Watch', 800]]);
});

test('Apple Health reads split XML tags and UTF-8, ignores commented records and rejects a partial export', async () => {
  const pad = 512 * 1024;
  const header = '<HealthData>';
  const split = new Blob([header, ' '.repeat(pad - header.length - 4), '<Rec',
    sample(stepType, 'Montre Ä', 900, '2026-11-27 06:15:00 +0100').slice(4),
    '<!--', sample(stepType, 'Fake', 20, '2026-11-27 06:15:00 +0100'), '--></HealthData>']);
  const groups = await importHealthExport(split, day, day);
  assert.deepEqual(groups.map(group => [group.name, group.values[0].value]), [['Montre Ä', 900]]);
  const truncated = new Blob(['<HealthData>' + sample(stepType, 'Watch', 10, '2026-11-27 06:15:00 +0100')]);
  await assert.rejects(importHealthExport(truncated, day, day), /vollständigen Apple-Health-Export/);
  const damaged = zipSync({ 'export.xml': strToU8('<HealthData></HealthData>') }, { level: 0 });
  damaged[30 + 'export.xml'.length + '<HealthData>'.length] = 32;
  await assert.rejects(importHealthExport(new Blob([damaged]), day, day), /beschädigt oder unvollständig/);
  const noXml = new Blob([zipSync({ 'export_cda.xml': strToU8('Ignored') })]);
  await assert.rejects(importHealthExport(noXml, day, day), /keine export.xml/);
});

test('external calendar expands all-day events and sorts together with a local deadline', () => {
  const events = expandEvents([{ id: 'x', provider: 'microsoft', date: '2026-11-26', endDate: '2026-11-29', time: '20:00' }], day, '2026-11-28');
  assert.deepEqual(events.map(event => [event.date, event.time]), [[day, ''], ['2026-11-28', '']]);
  const local = [{ id: 'l', section: 'Kalender', fields: { title: 'Frist', kind: 'Frist', date: day, time: '08:00' } }];
  assert.deepEqual(displayedAgenda(local, events).map(row => row.external?.id ?? row.row.id), ['x', 'l', 'x']);
});

test('file import reads a local email and its binary attachment', async () => {
  const raw = ['Subject: Termin in Aarau', 'From: Test <sender@example.invalid>', 'Date: Fri, 27 Nov 2026 09:00:00 +0100',
    'MIME-Version: 1.0', 'Content-Type: multipart/mixed; boundary=life', '', '--life', 'Content-Type: text/plain; charset=utf-8', '',
    'Der Termin findet in Aarau statt.', '--life', 'Content-Type: text/plain; name="Beilage.txt"', 'Content-Disposition: attachment; filename="Beilage.txt"',
    'Content-Transfer-Encoding: base64', '', 'Tk9USVo=', '--life--', ''].join('\r\n');
  const parsed = await readMailFile(new File([raw], 'Termin.eml'));
  assert.equal(parsed.mail.subject, 'Termin in Aarau');
  assert.equal(parsed.mail.day, day);
  assert.match(parsed.mail.text, /Aarau/);
  assert.equal(parsed.mail.attachments[0].name, 'Beilage.txt');
  assert.equal(await parsed.files.get('0').text(), 'NOTIZ');
  assert.equal(await parsed.files.get('').text(), raw);
  await assert.rejects(readMailFile(new File(['no headers'], 'bad.eml')));
});

test('provider URLs bind PKCE and ask for read permissions', () => {
  for (const provider of ['google', 'microsoft']) {
    const result = new URL(authorizationUrl(provider, { client_id: 'test' }, 'https://example.invalid/callback', 'state', 'challenge'));
    assert.equal(result.searchParams.get('state'), 'state');
    assert.equal(result.searchParams.get('code_challenge_method'), 'S256');
    assert.match(result.searchParams.get('scope'), /read/i);
    assert.doesNotMatch(result.searchParams.get('scope'), /Mail.Send|ReadWrite/);
  }
});

test('Google redirects calendar and mail through the correct data endpoints', async t => {
  const testFetch = t.mock.method(global, 'fetch', async input => {
    const url = new URL(input);
    if (url.pathname.endsWith('calendarList')) return Response.json({ items: [{ id: 'example', primary: true }] });
    if (url.pathname.endsWith('/events')) return Response.json({ items: [
      { id: 'allday', summary: 'Arzt', start: { date: day }, end: { date: '2026-11-28' } },
      { id: 'timed', summary: 'Besuch', start: { dateTime: '2026-11-27T23:10:00Z' }, end: { dateTime: '2026-11-27T23:40:00Z' } },
    ] });
    if (url.pathname.endsWith('/messages')) return Response.json({ messages: [{ id: 'gmail1' }], nextPageToken: 'next' });
    return Response.json({ id: 'gmail1', internalDate: '1795780000000', payload: { mimeType: 'text/html',
      headers: [{ name: 'Subject', value: 'Zeugnis' }], body: { data: Buffer.from('<p>Hallo</p><script>ignored</script>').toString('base64url') } } });
  });
  const events = await listCalendar('google', 'sample-token', day, '2026-11-29');
  assert.deepEqual(events.map(row => [row.date, row.time, row.endDate]), [[day, '', day], ['2026-11-28', '00:10', '2026-11-28']]);
  const mail = await listMail('google', 'sample-token', 'from:example', '');
  assert.equal(mail.next, 'next');
  assert.equal(mail.rows[0].subject, 'Zeugnis');
  assert.equal((await messageDetail('google', 'sample-token', 'gmail1')).text, 'Hallo');
  assert.ok(testFetch.mock.calls.some(({ arguments: [url] }) => new URL(url).searchParams.get('q') === 'from:example'));
});

test('new views retain navigation and render remote text without markup', () => {
  const state = { accounts: { microsoft: { available: true, connected: true, email: 'test@example.invalid' } }, events: [], calendarErrors: [],
    mail: { provider: 'microsoft', query: '', rows: [{ id: 'id', subject: '<script>bad</script>' }] },
    metric: 'sleep', healthRange: '30', health: [] };
  const dateState = { month: '2026-11', selected: '', kind: '', source: '' };
  assert.match(dashboard([], false, state), /Posteingang/);
  assert.match(calendarPage([], dateState, state), /Outlook-Kalender/);
  assert.match(connectionsView(state), /test@example\.invalid/);
  assert.match(healthView(state), /Apple-Health-Export/);
  assert.match(mailboxView(state), /&lt;script&gt;bad/);
  assert.doesNotMatch(mailboxView(state), /<script>/);
});

test('the personalised overview escapes names and exposes its quick actions', () => {
  const ui = dashboard([], false, { events: [], calendarErrors: [] }, { name: 'A <b>', suggestions: 2 });
  assert.match(ui, /Hey, A &lt;b&gt;/);
  assert.match(ui, /data-assistant/);
  assert.match(ui, /data-scan-start="document"/);
  assert.match(ui, /Terminvorschläge/);
});
