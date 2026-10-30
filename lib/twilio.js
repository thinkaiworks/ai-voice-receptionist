// Twilio helpers: webhook signature check and SMS send (REST, no SDK).
import { createHmac, timingSafeEqual } from 'node:crypto';

/** https://www.twilio.com/docs/usage/security#validating-requests */
export function validSignature(authToken, signature, url, params) {
  if (!authToken || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = createHmac('sha1', authToken).update(data).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function sendSms({ accountSid, authToken, from, to, body, fetchImpl = fetch }) {
  if (!accountSid || !authToken || !from) return { sent: false, reason: 'twilio not configured' };
  const res = await fetchImpl(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: { authorization: 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ From: from, To: to, Body: body }),
  });
  return { sent: res.ok, status: res.status };
}
