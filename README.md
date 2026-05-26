# Content Factory — Telegram Mini App

A polished frontend MVP prototype for a Telegram-native AI content tool built for channel owners.

---

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

## Commands

| Command | Description |
|---|---|
| `npm run dev` | Start dev server |
| `npm run build` | TypeScript check + production build |
| `npm run preview` | Preview production build locally |

---

## What is this

Content Factory is a Telegram Mini App where channel owners configure their **Brand Kit** and generate ready-to-publish posts from any input — a link, idea, text snippet, or forwarded post.

The AI applies the user's Brand Kit (voice, tone, emoji rules, link kit, visual style) and produces 2–3 post variants with a banner preview and Telegram inline buttons — ready to publish or schedule.

---

## MVP scope

**3 screens via bottom nav:**

- **Posts** — New / Scheduled / Published tabs. Open any post to edit variants, preview banner, manage link buttons, publish or schedule.
- **Create** — AI input surface. Paste a link, idea, or text. Select channel. Hit Generate. Result lands in Posts → New.
- **Profile** — Account, credits, connected channels, and Brand Kit per channel.

**Brand Kit (inside Profile → channel → Brand Kit):**

- Voice Profile — language, address style, tone, post length, emoji density, word lists
- Emoji Pack — custom Telegram emoji pack link, strict mode, allowed emoji whitelist
- Visual Kit — brand color, logo, background/card style, banner template, watermark
- Link Kit — product, social, and custom links with usage modes (button / inline / signature)
- Signature — sign-off text, CTA, usage rule
- Post Rules — content structure, quality toggles

---

## What is mocked

Everything. This is a frontend-only prototype with zero real backends.

| Mocked | Notes |
|---|---|
| AI generation | `generationService.ts` — 1.8s delay, templates using Brand Kit data |
| Telegram bot | No real bot — "From bot" source type uses mock data |
| Publishing | `postService.ts` — local state only, no real Telegram API |
| Scheduling | Local state — no cron, no queue |
| Banner images | CSS/gradient templates — no real image generation |
| User auth | Hardcoded mock user (`mockData.ts`) |
| Channel data | 2 mock channels with mock subscriber counts |

---

## Future backend integration

The service layer (`src/services/`) is the integration boundary. To wire up real backends:

| Service | Replace with |
|---|---|
| `generationService.ts` | `POST /api/generate` → Claude / OpenAI with Brand Kit as system prompt |
| `postService.ts` | REST or WebSocket API for post CRUD and status |
| `brandKitService.ts` | User settings API, persisted per channel |
| `channelService.ts` | Telegram Bot API — channel list from bot subscriptions |

**Telegram Mini App SDK:** wrap `App.tsx` with `@twa-dev/sdk` init call, read `window.Telegram.WebApp.initDataUnsafe` for real user identity.

**Scheduling:** replace local `scheduledAt` state with a queue (e.g. BullMQ) backed by a Telegram Bot `sendMessage` call at the target time.

**Banner generation:** replace CSS templates in `BannerPreview.tsx` with a real image generation service (e.g. html-to-image on a server, or a design API).

---

## Tech stack

- **React 18** + **TypeScript**
- **Vite 5**
- **Tailwind CSS 3**
- **Framer Motion 11** — page transitions, accordion, tab indicators, nav active state
- **lucide-react** — icons
- **date-fns** — date formatting

## Visual design

- Background: `#070708`
- Frosted glass cards with `backdrop-filter: blur`
- **Orange-only accent:** `#FF6A00`
- Floating glass capsule bottom nav with safe-area inset support
- Mobile-first, tested at 375 / 390 / 430px widths
