// Availability + booking against business hours. Bookings live in a JSON file;
// swap `BookingStore` for Google Calendar / Cal.com / GHL calendars in production.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export class BookingStore {
  constructor(file) {
    this.file = file;
    if (file) {
      mkdirSync(dirname(file), { recursive: true });
      if (!existsSync(file)) writeFileSync(file, '[]');
    }
    this.mem = [];
  }
  all() { return this.file ? JSON.parse(readFileSync(this.file, 'utf8')) : this.mem; }
  add(b) {
    const rows = this.all();
    rows.push(b);
    if (this.file) writeFileSync(this.file, JSON.stringify(rows, null, 2)); else this.mem = rows;
    return b;
  }
}

/** Parse "tomorrow afternoon", "friday at 3", "next monday morning", "3:30 pm" relative to `now` (local time). */
export function parseWhen(text, now) {
  const t = text.toLowerCase();
  let day = null;
  if (/\btoday\b/.test(t)) day = 0;
  else if (/\btomorrow\b/.test(t)) day = 1;
  else {
    const idx = DAYS.findIndex((d) => t.includes(d));
    if (idx >= 0) {
      day = (idx - now.getDay() + 7) % 7 || 7;
    }
  }
  let hour = null, minute = 0;
  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\b/);
  if (m && (m[3] || /\bat\b/.test(t) || m[2])) {
    hour = Number(m[1]);
    minute = Number(m[2] || 0);
    const ap = m[3]?.replace(/\./g, '');
    if (ap === 'pm' && hour < 12) hour += 12;
    if (ap === 'am' && hour === 12) hour = 0;
    if (!ap && hour >= 1 && hour <= 6) hour += 12; // "at 3" on a business call means 3pm
  }
  const part = /\bmorning\b/.test(t) ? 'morning' : /\bafternoon\b/.test(t) ? 'afternoon' : /\bevening\b/.test(t) ? 'evening' : null;
  return { dayOffset: day, hour, minute, part };
}

const GRID = 30; // appointments start on the hour or half hour

function overlaps(start, minutes, bookings) {
  const s = start.getTime(), e = s + minutes * 60_000;
  return bookings.some((b) => {
    const bs = new Date(b.start).getTime(), be = bs + (b.minutes || GRID) * 60_000;
    return bs < e && be > s;
  });
}

export function findSlots({ hours, slotMinutes = 30, bookings, now, when, limit = 2 }) {
  const out = [];
  const startDay = when.dayOffset ?? 0;
  const endDay = when.dayOffset ?? 7;
  for (let d = startDay; d <= endDay && out.length < limit; d++) {
    const date = new Date(now);
    date.setDate(now.getDate() + d);
    const window = hours[DAYS[date.getDay()]];
    if (!window) continue;
    const [open, close] = window.map((h) => h.split(':').map(Number));
    for (let mins = open[0] * 60 + open[1]; mins + slotMinutes <= close[0] * 60 + close[1] && out.length < limit; mins += GRID) {
      const h = Math.floor(mins / 60), m = mins % 60;
      if (when.hour !== null && (h < when.hour || (h === when.hour && m < when.minute))) continue;
      if (when.part === 'morning' && h >= 12) continue;
      if (when.part === 'afternoon' && (h < 12 || h >= 17)) continue;
      if (when.part === 'evening' && h < 17) continue;
      const slot = new Date(date);
      slot.setHours(h, m, 0, 0);
      if (slot <= now) continue;
      if (!overlaps(slot, slotMinutes, bookings)) out.push(slot);
    }
  }
  return out;
}

export function speakSlot(d) {
  const day = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(':00', '');
  return `${day} at ${time}`;
}
