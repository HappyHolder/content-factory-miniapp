# Publium — Project Handoff Document

> ⚠️ **OUTDATED (most sections below describe the May 2026 prototype).**
> As of June 2026 the project is live, not a mock prototype. The corrections in
> this banner override anything stale further down. See `README.md` →
> "Current state (live)" for the accurate overview.
>
> **What actually changed since this doc was written:**
> - **Self-hosted on a Beget VPS** via Docker Compose (Caddy + API + PostgreSQL),
>   live at `https://publium.ru`. (No longer Render/Neon/Vercel — those were retired.)
> - **Storage:** local filesystem served at `/uploads` by Caddy (was Vercel Blob).
> - **Prisma migrations ARE run** — see `server/prisma/migrations/` (self-hosted Postgres).
> - **Real API routes exist:** auth, channels, brandkits, posts (generate/list/publish/
>   schedule/delete/regenerate/upload), bot webhook, chat, promo, admin, payments.
> - **Auth is real** — Telegram `initData` HMAC validation on every route.
> - **AI is real** — DeepSeek for text + chat assistant; Replicate for cover images.
> - **There IS a FREE tier** (freemium). Paid tiers renamed (DB enum unchanged):
>   **Blogger** 650⭐/5 Gram, **Business** 1800⭐/15 Gram, **Agency** 10000⭐/80 Gram.
>   "Gram" is the UI label for TON. Prices live in `server/src/lib/payments.ts` and
>   `src/lib/payments.ts` (keep in sync).
> - **Per-post regen caps are 3 text / 3 visual** (`subscriptionLimits.ts`), enforced server-side.
> - **Deployment:** push to GitHub (`HappyHolder/publium-miniapp`), then on the VPS
>   `git pull && cd deploy && docker compose up -d --build`. See `deploy/README.md`.

---

## What this project is

**Publium** is a Telegram Mini App for channel owners who want to generate AI-powered posts. Users configure a per-channel **Channel Style** (voice, emoji rules, visuals, links, signature, post structure rules) and then generate 2–3 post variants from any input — a link, idea, text, or forwarded post.

This is a **polished frontend MVP prototype**. All data is mocked. The backend scaffold exists but has zero migrations run and is not connected to the frontend.

---

## Repository

**GitHub:** https://github.com/HappyHolder/publium-miniapp  
**Branch:** `main`  
**Latest commits:**
- `88d87e4` — Polish localization and active channel UX
- `95cbf2a` — Localize channel style settings and polish switches

---

## Deployment

**Frontend (Vercel):** Not confirmed deployed — check Vercel dashboard.  
**Backend:** Not deployed. Express scaffold only, no real API routes beyond `/health`.

---

## Tech stack

### Frontend
| Tool | Version |
|---|---|
| React | 18.3.1 |
| TypeScript | 5.5.3 |
| Vite | 5.4.0 |
| Tailwind CSS | 3.4.10 |
| Framer Motion | 11.3.0 |
| lucide-react | 0.427.0 |
| date-fns | 3.6.0 |

### Backend (scaffold only)
| Tool | Version |
|---|---|
| Node.js / Express | 4.18.2 |
| Prisma | 5.19.0 |
| TypeScript | 5.4.5 |
| tsx | 4.7.1 |

### Database
**Neon (PostgreSQL)** — connection strings in `server/.env` (not committed).  
`server/.env.example` contains the required variable names:
```
DATABASE_URL=""
DIRECT_URL=""
PORT=8787
NODE_ENV=development
```

---

## Backend scaffold status

| Item | Status |
|---|---|
| Express server | Scaffolded — `server/src/index.ts` |
| Health route | `/health` — returns `{ ok: true }` |
| Prisma schema | Written — `server/prisma/schema.prisma` |
| Prisma migrations | **NOT RUN** — no migration files exist |
| Prisma client | Not generated (requires `npx prisma generate`) |
| Real API routes | None — all data is mocked on frontend |
| Auth | None — no JWT, no session, no Telegram SDK auth |
| AI integration | None — `generationService.ts` is a frontend mock with 1.8s delay |

**To run backend locally:**
```bash
cd server
cp .env.example .env  # fill in DATABASE_URL and DIRECT_URL from Neon
npm install
npm run build         # runs prisma generate + tsc
npm run dev
```

**IMPORTANT: Do NOT run `prisma migrate dev` without explicit permission.** The schema is not finalized and migration files don't exist yet.

---

## Frontend status

### What works (all mocked)
- Posts tab: New / Scheduled / Published with actual filtering
- Post detail: variant selector, text editing, banner preview, link buttons, publish/schedule
- Create tab: source type chips, textarea input, AI generation mock (1.8s), result in Posts → New
- Profile tab: account card, plan card, 2 mock channels, channel style forms (all 6 sections)
- Channel Style: Writing style, Emoji, Visual, Links & buttons, Signature, Post rules — fully editable with i18n
- Plans screen: 3 plan tiers, upgrade/downgrade buttons (mocked)
- Language switcher: RU / EN — persisted in localStorage
- Channel switcher: global active channel shared across Posts and Create

### Known mocked behaviors
| Feature | Mock location |
|---|---|
| AI generation | `src/services/generationService.ts` — template + 1.8s delay |
| Post CRUD | `src/services/postService.ts` — in-memory array |
| Brand Kit save | `src/services/brandKitService.ts` — in-memory |
| Channel list | `src/data/mockData.ts` — 2 hardcoded channels |
| User auth | `src/data/mockData.ts` — hardcoded user |
| Publishing | `postService.publish()` — local state only |
| Scheduling | `postService.schedule()` — local state, no real cron |
| Banner images | CSS gradient templates — no real image gen |

---

## Prisma schema summary

Models: `User`, `Channel`, `BrandKit`, `LinkKit`, `EmojiPack`, `SourceInput`, `GenerationJob`, `GeneratedPost`, `PostVariant`, `Subscription`

Enums: `SourceType`, `PostStatus`, `JobStatus`, `PlanTier`

**Migrations: NOT RUN.** No `prisma/migrations/` folder exists.

---

## Pricing rules — DO NOT CHANGE without permission

| Tier | Internal key | RU name | Price | AI posts / mo | Channels | Scheduling |
|---|---|---|---|---|---|---|
| Starter | `starter` | Старт | $5 | 30 | 1 | No |
| Creator | `creator` | Автор | $20 | 150 | 3 | Yes |
| Studio Pro | `studio_pro` | Студия Pro | $70 | 700 | 10 | Yes |

Studio Pro includes: Post promotion (coming soon).  
No free tier. No credits/tokens terminology. No "publications/month" (use "постов с AI / AI posts").

---

## Regeneration limits

Per AI post:
- Text regenerations: **3** (tracked in `textRegensUsed`)
- Visual/banner regenerations: **2** (tracked in `imageRegensUsed`)

These are tracked in state but not yet enforced server-side.

---

## i18n architecture

- `src/i18n/en.ts` — source of truth (`Dict = typeof en`)
- `src/i18n/ru.ts` — must satisfy `Dict` exactly (TypeScript enforced)
- `src/i18n/index.ts` — exports `TranslationKey`, `createTranslator(lang)`, `getInitialLanguage()`
- `t(key: TranslationKey)` — type-safe translation function via `useApp()`
- Language stored in `localStorage`, detected on load

---

## What MUST NOT be touched without explicit permission

| Area | Reason |
|---|---|
| `src/components/layout/AppShell.tsx` | Global scroll architecture |
| `src/App.tsx` | Root routing and screen stack |
| `src/styles/globals.css` scroll rules | `overflow: hidden` on html/body is load-bearing |
| Pricing tiers and prices | Product decision, not a code decision |
| Product name | Always "Publium" |
| `server/prisma/schema.prisma` | Schema not finalized; migrations not run |
| `server/.env` | Contains real secrets |
| Backend API routes | Don't add without backend plan |

---

## Telegram Mini App integration (not yet done)

To wire up real Telegram auth:

```bash
npm install @twa-dev/sdk
```

In `src/main.tsx` or `src/App.tsx`:
```ts
import WebApp from '@twa-dev/sdk'
WebApp.ready()
const user = WebApp.initDataUnsafe.user
```

Replace `mockInitialState.user` with the real Telegram user.

---

## Backend next steps (priority order)

1. **Run Prisma migration** — only after schema is reviewed and approved
2. **Prisma generate** — `cd server && npm run build`
3. **Auth endpoint** — validate `initData` from Telegram, return JWT
4. **Generate endpoint** — `POST /api/generate` → call Claude API with BrandKit as system prompt
5. **Post CRUD** — `GET/POST/PATCH /api/posts`
6. **BrandKit CRUD** — `GET/PUT /api/brand-kit/:channelId`
7. **Scheduling** — BullMQ job queue + Telegram Bot API send at scheduled time
8. **Banner generation** — html-to-image on server or external design API

---

## Recommended workflow for future Claude / AI prompts

When starting a new session, provide:
1. This handoff document
2. The brandbook document (`docs/content-factory-brandbook-current.md`)
3. The specific file(s) you want to change

**Always state at the start of a prompt:**
- What NOT to touch (backend, nav, AppShell, pricing, product name)
- Whether to commit/push
- Whether a build check is required

**Prompt discipline that works well:**
- Scope changes to specific files
- Separate UI tasks from logic tasks
- Separate frontend from backend tasks
- Ask for preview screenshots before committing
- Build (`npm run build`) must pass before every commit

---

## File structure reference

```
content-factory-miniapp/
├── src/
│   ├── App.tsx                          # Root, screen stack, nav
│   ├── main.tsx                         # React entry point
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppShell.tsx             # Scroll container — DO NOT TOUCH
│   │   │   ├── BottomNav.tsx            # 3-tab floating nav
│   │   │   ├── ChannelSwitcherHeader.tsx # Shared channel selector (Posts + Create)
│   │   │   └── PageHeader.tsx           # Header with optional back button
│   │   ├── ui/
│   │   │   ├── Button.tsx               # 4 variants, 3 sizes
│   │   │   ├── GlassCard.tsx            # Default + strong card
│   │   │   ├── SegmentedTabs.tsx        # Pill tab group
│   │   │   ├── Sheet.tsx                # Bottom drawer
│   │   │   ├── StatusChip.tsx           # Post status badge
│   │   │   ├── Switch.tsx               # iOS-style toggle (36×20px)
│   │   │   └── Toast.tsx                # Toast notification
│   │   ├── posts/                       # Post card, banner, editor, etc.
│   │   ├── create/                      # InputTypeChips
│   │   └── profile/                     # Channel Style forms (6 sections)
│   ├── screens/
│   │   ├── PostsScreen.tsx              # Posts tab (New/Scheduled/Published)
│   │   ├── PostDetailsScreen.tsx        # Post detail / editor
│   │   ├── CreateScreen.tsx             # AI generate (uses ChannelSwitcherHeader)
│   │   ├── ProfileScreen.tsx            # Profile, channels, settings
│   │   ├── PlansScreen.tsx              # Pricing / plan management
│   │   └── BrandKitScreen.tsx           # Channel Style accordion (6 sections)
│   ├── context/
│   │   └── AppContext.tsx               # Global state: posts, channels, BrandKit, lang
│   ├── i18n/
│   │   ├── en.ts                        # Source of truth for all copy
│   │   └── ru.ts                        # Russian translation (Dict-typed)
│   ├── services/                        # Mock service layer (integration boundary)
│   ├── data/
│   │   └── mockData.ts                  # Hardcoded mock state
│   ├── types/
│   │   └── index.ts                     # All TypeScript types
│   └── styles/
│       └── globals.css                  # Global CSS, bottom nav, scroll rules
├── server/
│   ├── src/
│   │   ├── index.ts                     # Express server entry
│   │   ├── db.ts                        # Prisma client singleton
│   │   └── routes/health.ts             # GET /health
│   ├── prisma/
│   │   └── schema.prisma                # DB schema (migrations NOT run)
│   ├── .env.example                     # Required env vars (no secrets)
│   └── package.json
├── docs/
│   ├── content-factory-brandbook-current.md
│   └── content-factory-handoff-current.md
├── screenshots/                         # App screenshots (PNG)
└── scripts/                             # make-archive, make-montage, take-screenshots
```
