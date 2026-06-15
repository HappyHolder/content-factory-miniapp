# Publium — Telegram Mini App

A Telegram Mini App that generates ready-to-publish posts for channel owners, in their channel's own style. Live in production at [publium.ru](https://publium.ru) — see *Current state* below.

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

Publium is a Telegram Mini App where channel owners configure their **Channel Style** and generate ready-to-publish posts from any input — a link, idea, text snippet, or forwarded post.

The AI applies the user's Channel Style (voice, tone, emoji rules, link kit, visual style) and produces 2–3 post variants with a banner preview and Telegram inline buttons — ready to publish or schedule.

---

## Scope

**3 screens via bottom nav:**

- **Posts** — New / Scheduled / Published tabs. Open any post to edit variants, preview banner, manage link buttons, publish or schedule.
- **Create** — AI input surface. Paste a link, idea, or text. Select channel. Hit Generate. Result lands in Posts → New.
- **Profile** — Account, credits, connected channels, and Channel Style per channel.

**Channel Style (inside Profile → channel → Channel Style):**

- Voice Profile — language, address style, tone, post length, emoji density, word lists
- Emoji Pack — custom Telegram emoji pack link, strict mode, allowed emoji whitelist
- Visual Kit — brand color, logo, background/card style, banner template, watermark
- Link Kit — product, social, and custom links with usage modes (button / inline / signature)
- Signature — sign-off text, CTA, usage rule
- Post Rules — content structure, quality toggles

---

## Current state (live)

This is no longer a frontend-only prototype. The backend is built and deployed; the
app runs end to end against a real database, Telegram bot, AI, and payments.

| Area | Status |
|---|---|
| Backend | Express + Prisma, self-hosted on a **VPS** via Docker Compose (see `deploy/`) |
| Database | Self-hosted **PostgreSQL** (Docker), Prisma migrations applied (`server/prisma/migrations/`) |
| Storage | Local filesystem served at `/uploads` by Caddy (`server/src/lib/storage.ts`) |
| Auth | Real — Telegram `initData` HMAC validation on every request (`server/src/lib/telegram.ts`) |
| AI text | DeepSeek (`AI_PROVIDER=deepseek`) with a deterministic placeholder fallback |
| AI images | Replicate → stored locally |
| Telegram bot | Live `@Publiumbot` — `/start`, auto-draft from messages, payment webhooks |
| Publishing | Real Telegram Bot API send (`POST /api/posts/publish`) |
| Scheduling | In-process 60s poller auto-publishes due posts (`server/src/lib/scheduler.ts`) |
| Payments | Telegram Stars (XTR) + TON via TonConnect (shown as “Gram” in the UI); promo codes; tiers Blogger / Business / Agency |

In a plain browser (no Telegram `initData`) the app still runs in **mock mode** with
`src/data/mockData.ts`, so the UI is developable without Telegram.

### Frontend ↔ backend boundary

The frontend talks to the backend directly via `fetch` (see `src/lib/api.ts` →
`VITE_API_BASE_URL`). The `src/services/*` layer holds the in-memory mock-mode state;
in Telegram mode `AppContext` hydrates from `/api/auth/telegram` and `/api/posts/list`.

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
