// The receptionist's conversation. One state object per call:
//   greeting -> intent -> (answer question | take booking | transfer)
//   booking: name -> service -> time -> confirm -> booked (+ SMS)
import { findSlots, parseWhen, speakSlot } from './calendar.js';

const EMERGENCY = /\b(emergency|urgent|bleeding|severe pain|flood(ing)?|no heat|gas leak|burst pipe|fire)\b/i;
const HUMAN = /\b(human|real person|live person|representative|operator|(speak|talk) (to|with) (a |an |the )?(someone|somebody|person|manager|owner))\b/i;
const BOOK = /\b(book|appointment|schedule|reserve|come in|available|availability|slot|quote|estimate)\b/i;
const YES = /\b(yes|yeah|yep|sure|correct|that works|perfect|sounds good|ok(ay)?|great)\b/i;
const NO = /\b(no|nope|different|another|other|later|earlier)\b/i;

export function newCall(from) {
  return { stage: 'intent', from, name: null, service: null, offered: [], attempts: 0 };
}

function matchService(text, services) {
  const t = text.toLowerCase();
  return services.find((s) => [s.name, ...(s.aliases || [])].some((a) => t.includes(a.toLowerCase())));
}

function answerFaq(text, faqs) {
  const words = new Set(text.toLowerCase().match(/[a-z]+/g) || []);
  let best = null, score = 0;
  for (const f of faqs) {
    const s = f.keywords.filter((k) => words.has(k)).length;
    if (s > score) { best = f; score = s; }
  }
  return best;
}

function extractName(text) {
  const m = text.match(/(?:my name is|this is|i am|i'm|it's|name's)\s+([a-z]+(?:\s+[a-z]+)?)/i);
  const raw = m ? m[1] : text.trim().split(/\s+/).slice(0, 2).join(' ');
  return raw.replace(/[^a-z\s'-]/gi, '').replace(/\b\w/g, (c) => c.toUpperCase()).trim() || null;
}

/**
 * Advance the conversation. Returns { say, end?, transfer?, booking? } and mutates `call`.
 */
export function step(call, speech, ctx) {
  const { business, bookings, now } = ctx;
  const text = (speech || '').trim();

  if (!text) {
    call.attempts++;
    if (call.attempts >= 2) return { say: `Sorry, I'm having trouble hearing you. Someone from ${business.name} will call you back. Goodbye!`, end: true, callback: true };
    return { say: 'Sorry, could you say that again?' };
  }
  call.attempts = 0;

  if (EMERGENCY.test(text)) return { say: "That sounds urgent. I'm connecting you to our on-call team right now.", transfer: business.transferNumber, reason: 'emergency' };
  if (HUMAN.test(text) && call.stage !== 'confirm') return { say: 'No problem, let me put you through.', transfer: business.transferNumber, reason: 'asked_for_human' };

  switch (call.stage) {
    case 'intent': {
      const service = matchService(text, business.services);
      if (BOOK.test(text) || service) {
        call.service = service || null;
        call.stage = 'name';
        return { say: `I can help you book${service ? ` a ${service.name}` : ''}. Can I get your first and last name?` };
      }
      const faq = answerFaq(text, business.faqs);
      if (faq) return { say: `${faq.answer} Is there anything else, or would you like to book an appointment?` };
      return { say: `I can book an appointment or answer questions about ${business.name}. What can I help with?` };
    }
    case 'name': {
      call.name = extractName(text);
      if (call.service) {
        call.stage = 'time';
        return { say: `Thanks ${call.name.split(' ')[0]}. What day and time works best for you?` };
      }
      call.stage = 'service';
      const list = business.services.map((s) => s.name).join(', ');
      return { say: `Thanks ${call.name.split(' ')[0]}. Which service do you need? We offer ${list}.` };
    }
    case 'service': {
      const s = matchService(text, business.services);
      if (!s) return { say: `Sorry, which of these do you need: ${business.services.map((x) => x.name).join(', ')}?` };
      call.service = s;
      call.stage = 'time';
      return { say: `Great, a ${s.name}. What day and time works best for you?` };
    }
    case 'time': {
      const when = parseWhen(text, now);
      const slots = findSlots({ hours: business.hours, slotMinutes: call.service.minutes || 30, bookings, now, when });
      if (!slots.length) {
        const any = findSlots({ hours: business.hours, slotMinutes: call.service.minutes || 30, bookings, now, when: { dayOffset: null, hour: null, part: null } });
        if (!any.length) return { say: "We're fully booked this week. I'll have the team call you back to find a time.", end: true, callback: true };
        call.offered = any;
        call.stage = 'confirm';
        return { say: `That time isn't available. The next opening is ${speakSlot(any[0])}. Does that work?` };
      }
      call.offered = slots;
      call.stage = 'confirm';
      return { say: `I have ${speakSlot(slots[0])}${slots[1] ? `, or ${speakSlot(slots[1])}` : ''}. Which would you like?` };
    }
    case 'confirm': {
      let chosen = null;
      if (call.offered[1] && /\b(second|later one|other one|or the)\b/i.test(text)) chosen = call.offered[1];
      else if (YES.test(text) || /\b(first|that one)\b/i.test(text)) chosen = call.offered[0];
      if (!chosen) {
        const when = parseWhen(text, now);
        if (when.dayOffset !== null || when.hour !== null || NO.test(text)) {
          call.stage = 'time';
          return step(call, text, ctx);
        }
        return { say: `Sorry, should I book ${speakSlot(call.offered[0])}?` };
      }
      const booking = { start: chosen.toISOString(), minutes: call.service.minutes || 30, name: call.name, phone: call.from, service: call.service.name, createdAt: now.toISOString() };
      call.stage = 'done';
      return {
        say: `You're booked for a ${call.service.name} on ${speakSlot(chosen)}. I'll text a confirmation to this number. Thanks for calling ${business.name}!`,
        end: true,
        booking,
      };
    }
    default:
      return { say: `Thanks for calling ${business.name}. Goodbye!`, end: true };
  }
}
