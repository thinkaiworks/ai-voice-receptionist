// Twilio voice webhooks. Point your Twilio number's "A call comes in" webhook at POST {PUBLIC_URL}/voice/incoming
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gather, sayAndHangup, transfer } from './lib/twiml.js';
import { newCall, step } from './lib/dialog.js';
import { BookingStore, speakSlot } from './lib/calendar.js';
import { validSignature, sendSms } from './lib/twilio.js';

const ROOT = dirname(fileURLToPath(import.meta.url));

export function createApp({ env = process.env, business, store, fetchImpl = fetch, clock = () => new Date() } = {}) {
  business ??= JSON.parse(readFileSync(env.BUSINESS_FILE || join(ROOT, 'config', 'business.json'), 'utf8'));
  store ??= new BookingStore(env.BOOKINGS_FILE || join(ROOT, 'data', 'bookings.json'));
  const calls = new Map(); // CallSid -> conversation state
  const voice = env.TTS_VOICE || 'Polly.Joanna-Neural';
  const hints = business.services.flatMap((s) => [s.name, ...(s.aliases || [])]).join(',');

  const notifyOwner = async (event, data) => {
    if (!env.OWNER_WEBHOOK_URL) return;
    try {
      await fetchImpl(env.OWNER_WEBHOOK_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ event, business: business.name, ...data }) });
    } catch { /* never break the call over a notification */ }
  };

  return createServer((req, res) => {
    const xml = (body) => { res.writeHead(200, { 'content-type': 'text/xml' }); res.end(body); };
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', activeCalls: calls.size, bookings: store.all().length }));
    }
    if (req.method !== 'POST' || !url.pathname.startsWith('/voice/')) { res.writeHead(404); return res.end(); }

    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', async () => {
      const params = Object.fromEntries(new URLSearchParams(raw));
      if (env.TWILIO_AUTH_TOKEN && env.VALIDATE_SIGNATURE !== '0') {
        const fullUrl = (env.PUBLIC_URL || '') + req.url;
        if (!validSignature(env.TWILIO_AUTH_TOKEN, req.headers['x-twilio-signature'], fullUrl, params)) {
          res.writeHead(403); return res.end('invalid signature');
        }
      }
      const sid = params.CallSid;

      if (url.pathname === '/voice/incoming') {
        calls.set(sid, newCall(params.From));
        return xml(gather(business.greeting, { voice, hints }));
      }

      if (url.pathname === '/voice/respond') {
        const call = calls.get(sid) || newCall(params.From);
        calls.set(sid, call);
        const out = step(call, params.SpeechResult || '', { business, bookings: store.all(), now: clock() });

        if (out.transfer) {
          notifyOwner('transfer', { from: params.From, reason: out.reason });
          calls.delete(sid);
          return xml(transfer(out.say, out.transfer, { voice }));
        }
        if (out.booking) {
          store.add(out.booking);
          const when = speakSlot(new Date(out.booking.start));
          sendSms({ accountSid: env.TWILIO_ACCOUNT_SID, authToken: env.TWILIO_AUTH_TOKEN, from: env.TWILIO_NUMBER, to: params.From,
            body: `${business.name}: you're booked for ${out.booking.service} on ${when}. Reply C to cancel.`, fetchImpl });
          notifyOwner('booking', out.booking);
        }
        if (out.callback) notifyOwner('callback_needed', { from: params.From, name: call.name, stage: call.stage });
        if (out.end) { calls.delete(sid); return xml(sayAndHangup(out.say, { voice })); }
        return xml(gather(out.say, { voice, hints }));
      }

      if (url.pathname === '/voice/status') {
        const call = calls.get(sid);
        if (call && call.stage !== 'done' && params.CallStatus === 'completed') {
          notifyOwner('hung_up_before_booking', { from: params.From, name: call.name, service: call.service?.name, stage: call.stage });
        }
        calls.delete(sid);
        res.writeHead(204); return res.end();
      }
      res.writeHead(404); res.end();
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3002);
  createApp().listen(port, () => console.log(`Voice receptionist listening on http://localhost:${port}/voice/incoming`));
}
