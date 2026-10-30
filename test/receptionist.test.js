import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { parseWhen, findSlots, BookingStore } from '../lib/calendar.js';
import { newCall, step } from '../lib/dialog.js';
import { validSignature } from '../lib/twilio.js';
import { createApp } from '../server.js';
import business from '../config/business.json' with { type: 'json' };

process.env.TZ = 'UTC';
const NOW = new Date('2026-10-28T14:00:00Z'); // Wednesday 2pm

test('parses spoken times', () => {
  assert.deepEqual(parseWhen('tomorrow at 3', NOW), { dayOffset: 1, hour: 15, minute: 0, part: null });
  assert.equal(parseWhen('friday morning', NOW).dayOffset, 2);
  assert.equal(parseWhen('monday', NOW).dayOffset, 5);
  assert.deepEqual(parseWhen('10:30 am today', NOW), { dayOffset: 0, hour: 10, minute: 30, part: null });
});

test('finds free slots inside business hours, skipping booked ones', () => {
  const when = parseWhen('tomorrow at 3', NOW);
  const booked = [{ start: '2026-10-29T15:00:00.000Z' }];
  const slots = findSlots({ hours: business.hours, slotMinutes: 60, bookings: booked, now: NOW, when });
  assert.equal(slots[0].toISOString(), '2026-10-29T15:30:00.000Z');
  const sunday = findSlots({ hours: business.hours, bookings: [], now: NOW, when: parseWhen('sunday', NOW) });
  assert.equal(sunday.length, 0);
});

test('full booking conversation', () => {
  const call = newCall('+15551234567');
  const ctx = { business, bookings: [], now: NOW };
  assert.match(step(call, 'Hi, my kitchen sink is clogged, can I book someone?', ctx).say, /drain cleaning/);
  assert.match(step(call, 'my name is jane doe', ctx).say, /Thanks Jane/);
  assert.match(step(call, 'tomorrow morning', ctx).say, /Thursday, October 29 at 8 AM/);
  const done = step(call, 'yes the first one', ctx);
  assert.equal(done.end, true);
  assert.deepEqual(done.booking, { start: '2026-10-29T08:00:00.000Z', minutes: 60, name: 'Jane Doe', phone: '+15551234567', service: 'drain cleaning', createdAt: NOW.toISOString() });
});

test('answers FAQs, transfers emergencies and requests for a human', () => {
  const ctx = { business, bookings: [], now: NOW };
  assert.match(step(newCall('x'), 'how much do you charge', ctx).say, /89 dollars/);
  assert.equal(step(newCall('x'), 'I have a burst pipe flooding the basement', ctx).reason, 'emergency');
  assert.equal(step(newCall('x'), 'can I talk to a real person', ctx).reason, 'asked_for_human');
});

test('gives up gracefully after two silences', () => {
  const call = newCall('x');
  const ctx = { business, bookings: [], now: NOW };
  assert.equal(step(call, '', ctx).end, undefined);
  const r = step(call, '', ctx);
  assert.equal(r.end, true);
  assert.equal(r.callback, true);
});

test('twilio signature validation', () => {
  const params = { CallSid: 'CA1', From: '+1555' };
  const url = 'https://example.com/voice/incoming';
  const sig = createHmac('sha1', 'tok').update(url + 'CallSidCA1From+1555').digest('base64');
  assert.equal(validSignature('tok', sig, url, params), true);
  assert.equal(validSignature('tok', 'bad', url, params), false);
});

test('webhook flow: incoming → respond → booking stored, SMS + owner notified', async () => {
  const sent = [];
  const fakeFetch = async (u, o) => { sent.push({ u, body: String(o.body) }); return { ok: true, status: 201 }; };
  const store = new BookingStore(null);
  const env = { OWNER_WEBHOOK_URL: 'https://hooks.example.com/owner', TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 'tok', TWILIO_NUMBER: '+1999', VALIDATE_SIGNATURE: '0' };
  const server = createApp({ env, business, store, fetchImpl: fakeFetch, clock: () => NOW }).listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, p) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ CallSid: 'CA9', From: '+15550001111', ...p }) }).then((r) => r.text());
  try {
    assert.match(await post('/voice/incoming', {}), /<Gather input="speech"/);
    await post('/voice/respond', { SpeechResult: 'my water heater is broken' });
    await post('/voice/respond', { SpeechResult: "it's Sam Lee" });
    assert.match(await post('/voice/respond', { SpeechResult: 'friday at 10' }), /Friday, October 30 at 10 AM/);
    const end = await post('/voice/respond', { SpeechResult: 'yes' });
    assert.match(end, /<Hangup\/>/);
    assert.equal(store.all()[0].service, 'water heater repair');
    await new Promise((r) => setTimeout(r, 20));
    assert.ok(sent.some((s) => s.u.includes('api.twilio.com') && s.body.includes('water+heater+repair')));
    assert.ok(sent.some((s) => s.u === env.OWNER_WEBHOOK_URL && JSON.parse(s.body).event === 'booking'));
  } finally {
    server.close();
  }
});
