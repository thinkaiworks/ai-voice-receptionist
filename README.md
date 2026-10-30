# AI Voice Receptionist

**Stop losing jobs to voicemail.** Most callers who hit voicemail call the next business on the list. This receptionist answers every call on your Twilio number, 24/7: it answers common questions, books the appointment straight into open slots, texts the caller a confirmation, and puts emergencies through to your on-call phone immediately.

Built by [ThinkAIWorks](https://thinkaiworks.com).

## A real call

```
Ava:    Thanks for calling Summit Plumbing, this is Ava, the virtual receptionist.
        Are you looking to book a visit, or do you have a question?
Caller: My kitchen sink is clogged, can I book someone?
Ava:    I can help you book a drain cleaning. Can I get your first and last name?
Caller: Jane Doe.
Ava:    Thanks Jane. What day and time works best for you?
Caller: Tomorrow morning.
Ava:    I have Thursday, October 29 at 8 AM, or Thursday, October 29 at 8:30 AM. Which would you like?
Caller: The first one.
Ava:    You're booked for a drain cleaning on Thursday, October 29 at 8 AM.
        I'll text a confirmation to this number. Thanks for calling Summit Plumbing!

📱 SMS → "Summit Plumbing: you're booked for drain cleaning on Thursday, October 29 at 8 AM."
🔔 Owner webhook → {"event": "booking", "name": "Jane Doe", "service": "drain cleaning", ...}
```

## What it handles

| Caller says | Receptionist does |
|---|---|
| "Can I book…", "my drain is clogged" | Collects name, service and time, checks availability, books |
| "Friday at 10", "tomorrow afternoon", "next Monday" | Understands natural times; offers the nearest two open slots |
| "How much do you charge?" | Answers from your FAQ, then offers to book |
| "Burst pipe!", "flooding", "gas leak" | **Transfers to your on-call number immediately** |
| "Let me talk to a real person" | Transfers |
| Hangs up halfway | Sends a `hung_up_before_booking` alert so you can call back |
| Silence twice | Ends politely and flags a callback |

## Setup (15 minutes)

1. Edit `config/business.json`: name, hours, services (with the words customers use), FAQs, transfer number.
2. `cp .env.example .env` and add your Twilio SID, auth token and number.
3. Deploy (Render, Railway, Fly, a VPS…) and set `PUBLIC_URL`.
4. In Twilio: Phone Number → Voice → *A call comes in* → `POST {PUBLIC_URL}/voice/incoming`, and *Call status changes* → `POST {PUBLIC_URL}/voice/status`.
5. Set `TZ` to your business time zone (e.g. `TZ=America/New_York npm start`).

```bash
npm start
npm test
```

## Integrations

- **Owner alerts** (`OWNER_WEBHOOK_URL`): bookings, transfers and missed callers go to n8n, Make or a GoHighLevel inbound webhook → Slack, SMS, CRM.
- **Calendar**: bookings are stored in `data/bookings.json`. Swap `BookingStore` in `lib/calendar.js` for Google Calendar, Cal.com or GHL calendars.
- **Security**: every Twilio webhook is checked against the `X-Twilio-Signature` header.

## Stack

Node.js 22 (no dependencies) · Twilio Programmable Voice (speech recognition + neural TTS) · Twilio SMS · Webhooks
