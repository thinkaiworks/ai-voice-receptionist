// Tiny TwiML builder (Twilio's XML call instructions).
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));

export function gather(prompt, { action = '/voice/respond', voice = 'Polly.Joanna-Neural', hints = '' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="speech" action="${esc(action)}" method="POST" speechTimeout="auto" language="en-US"${hints ? ` hints="${esc(hints)}"` : ''}>
    <Say voice="${esc(voice)}">${esc(prompt)}</Say>
  </Gather>
  <Say voice="${esc(voice)}">Sorry, I didn't catch that.</Say>
  <Redirect method="POST">${esc(action)}?silence=1</Redirect>
</Response>`;
}

export function sayAndHangup(text, { voice = 'Polly.Joanna-Neural' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${esc(voice)}">${esc(text)}</Say>
  <Hangup/>
</Response>`;
}

export function transfer(text, number, { voice = 'Polly.Joanna-Neural' } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="${esc(voice)}">${esc(text)}</Say>
  <Dial timeout="25">${esc(number)}</Dial>
  <Say voice="${esc(voice)}">Nobody could pick up right now. We'll call you back shortly.</Say>
</Response>`;
}
