# Content Factory — Brandbook & UI System
> Generated from actual source code. Last updated: May 2026.

---

## Product

**Name:** Content Factory  
**Type:** Telegram Mini App  
**Purpose:** AI-powered content creation tool for Telegram channel owners. Users configure a per-channel style kit, then generate ready-to-publish posts from any input (link, idea, text, forwarded post). The AI applies the channel's voice, emoji rules, link kit, and visual style, producing 2–3 variants with a banner and inline buttons.

---

## Telegram Mini App context

- Runs inside Telegram WebView via the Mini App SDK
- Target viewport: 375 / 390 / 430 px width
- No browser chrome — no address bar, no native back button
- Safe-area insets applied for iPhone home indicator
- Interaction model: tap-first, no hover states in production
- Dark mode only — matches Telegram's dark theme

---

## Color palette

All colors are hardcoded — no Tailwind theme extension used. Values are referenced directly in className strings.

### Background hierarchy
| Role | Value |
|---|---|
| App background | `#070708` |
| Strong card bg | `#111114` |
| Glass card bg | `rgba(255,255,255,0.05)` |
| Surface overlay | `rgba(255,255,255,0.03)` |
| Hover overlay | `rgba(255,255,255,0.07–0.09)` |

### Borders
| Role | Value |
|---|---|
| Default card border | `rgba(255,255,255,0.07)` |
| Soft border | `rgba(255,255,255,0.06)` |
| Active channel card border | `rgba(255,106,0,0.22)` |
| Input focus border | `rgba(255,106,0,0.45)` |

### Text
| Role | Value |
|---|---|
| Primary (headings, values) | `#FFFFFF` |
| Secondary (labels, subtitles) | `#A1A1AA` |
| Muted (hints, meta) | `#66666E` |
| Very muted (section headers, separators) | `#55555D`, `#44444C` |

### Orange accent — single accent color throughout
| Role | Value |
|---|---|
| Primary accent | `#FF6A00` |
| Soft background tint | `rgba(255,106,0,0.10–0.14)` |
| Soft border tint | `rgba(255,106,0,0.18–0.22)` |
| Glow shadow | `rgba(255,106,0,0.22)` |
| Button hover | `#ff7a1a` |
| Button active | `#e55f00` |

### Status / semantic
| Role | Value |
|---|---|
| Danger button bg | `red-500/12` |
| Danger text | `red-400` |
| Danger border | `red-500/16` |

---

## Typography

**Font stack:** `-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', system-ui, sans-serif`  
System font — no web font loaded. On iPhone: SF Pro. On Android/desktop: system default.

### Scale in use (from source)
| Use | Size | Weight | Color |
|---|---|---|---|
| Page title (modal) | `text-[15px]` | `font-semibold` | white |
| Channel handle in header | `text-[16px]` | `font-semibold` | white |
| User name in profile | `text-[15px]` | `font-bold` | white |
| Plan name | `text-[20px]` | `font-bold` | white |
| Card title (post) | `text-[13px]` | `font-semibold` | white |
| Stat value / price | varies | `font-bold` | white |
| Body / form label | `text-sm` = `14px` | `font-medium` | white |
| Secondary info | `text-[13px]` | `font-medium` | `#A1A1AA` |
| Hints / descriptions | `text-[12px]` | normal | `#66666E` |
| Small meta | `text-[11px]` | normal | `#55555D` |
| Section header caps | `text-xs` = `12px` | `font-semibold` | `#66666E`, uppercase, tracking-wide |
| Badge / chip | `text-[10px]–text-[11px]` | `font-semibold` | varies |
| Micro label | `text-[9px]–text-[10px]` | `font-semibold` | `#55555D` |

---

## Border radius system

| Component | Radius |
|---|---|
| App-level cards (GlassCard) | `18px` |
| Inner cards, dropdowns | `14px` |
| Buttons sm | `10px` |
| Buttons md | `12px` |
| Buttons lg | `14px` |
| Input fields | `12px` |
| Generate button | `14px` |
| Channel avatars | `rounded-full` |
| Bottom nav | `999px` (full pill) |
| Status chips / badges | `rounded-full` |
| Toggle / Switch track | `rounded-full` |
| Settings row icon bg | `8px` |

---

## Spacing system

Based on Tailwind default scale (4px = 1 unit):

- Section gap: `space-y-2.5` (10px) — main screen content blocks
- Card internal padding: `p-4` (16px) default, `p-3` compact
- Form field gap: `space-y-4` (16px) inside channel style forms
- Page top padding: `pt-3` (12px) — content starts below ChannelSwitcherHeader
- Bottom padding: `pb-2` (8px) at page bottom
- Nav bottom offset: `6px + env(safe-area-inset-bottom, 0px)`
- Page content bottom padding: `calc(96px + env(safe-area-inset-bottom, 0px))` — keeps content above floating nav

---

## Glass card system

Two card variants via `GlassCard` component:

### Default (glass)
```css
background: rgba(255,255,255,0.05);
backdrop-filter: blur(16px) saturate(120%);
border: 1px solid rgba(255,255,255,0.07);
border-radius: 18px;
```

### Strong (dark solid)
```css
background: #111114;
border: 1px solid rgba(255,255,255,0.07);
border-radius: 18px;
```

Active channel card gets `border-[rgba(255,106,0,0.22)]` highlight override.

---

## Bottom nav

Floating pill, fixed position, centered horizontally:
```css
position: fixed;
left: 50%;
transform: translateX(-50%);
width: calc(100% - 32px);
max-width: 398px;
bottom: calc(6px + env(safe-area-inset-bottom, 0px));
height: 58px;
border-radius: 999px;
background: rgba(13,13,15,0.88);
backdrop-filter: blur(28px) saturate(140%);
border: 1px solid rgba(255,255,255,0.08);
box-shadow: 0 16px 48px rgba(0,0,0,0.50), inset 0 1px 0 rgba(255,255,255,0.06);
z-index: 100;
```

3 tabs: Posts / Create / Profile  
Active tab: `text-[#FF6A00]` + orange pill background (`rgba(255,106,0,0.09)`)  
Inactive tab: `text-[#66666E]`  
Active bg: animated with Framer Motion `layoutId="nav-active-bg"` spring transition

---

## Channel selector (ChannelSwitcherHeader)

Shared across Posts and Create screens. Top-left of working screens.

```
[M avatar] @my_channel ▼
```

- Avatar: 28px circle, `rgba(255,106,0,0.14)` bg, orange letter
- Handle: `text-[16px] font-semibold text-white`
- Chevron: `text-[#55555D]` 13px
- Tap opens bottom sheet (channel switcher)

Sheet: slides up from bottom, backdrop blur overlay, spring animation.  
Each channel row: avatar + handle + subscribers + connected dot + radio circle.  
Active channel: orange avatar border + orange filled checkmark circle.  
Add channel row: muted plus icon + muted text.

**Rule:** This is the ONLY channel selector in the app. The Create screen does NOT have an internal channel dropdown.

---

## Cards

### Post card (PostCard)
- GlassCard default (glass)
- Banner thumbnail (48×48, rounded-[10px]) on left
- Title: `text-[13px] font-semibold text-white`
- Source chip + variant count + Visual badge
- Channel handle + relative time, muted
- Status chip (New / Scheduled / Published) top-right
- Tap opens full post detail sheet

### Channel card (in Profile)
- GlassCard, active channel gets orange border
- Avatar (36px) + handle + subscriber count + connected status inline
- Active channel: `Активный / Active` badge top-right (orange)
- Inactive channel: `Сделать активным / Make active` ghost button
- Both: `Стиль канала → / Channel style →` secondary button (full width)

---

## Buttons

4 variants (`Button` component):

| Variant | Style |
|---|---|
| `primary` | `bg-[#FF6A00]` solid, white text, hover `#ff7a1a` |
| `secondary` | `bg-white/[0.05]` glass, white text, subtle border |
| `ghost` | transparent, `text-[#A1A1AA]`, hover white + bg tint |
| `danger` | `red-500/12` bg, `red-400` text, red border |

3 sizes: `sm` (32px min-h), `md` (38px min-h), `lg` (46px min-h)  
All use `motion.button` with `whileTap: scale(0.97)`  
Disabled: `opacity-40 cursor-not-allowed`

---

## Status chips

`StatusChip` component:

| Status | Style |
|---|---|
| New | Orange bg tint, orange text, orange border |
| Scheduled | Orange text (clock variant) |
| Published | Muted green or neutral |

Small badges (plan tier, active channel):
```
px-1.5 py-px rounded-full text-[10px] font-semibold
bg-[rgba(255,106,0,0.10)] text-[#FF6A00] border border-[rgba(255,106,0,0.22)]
```

---

## Switch / toggle

`Switch` component (`src/components/ui/Switch.tsx`):

- Track: `36×20px`, `rounded-full`
- Active: `bg-[#FF6A00]` (solid orange, no glow)
- Inactive: `bg-[#3A3A3F]` (dark neutral)
- Thumb: `16×16px`, `bg-white`, `shadow-sm`, `absolute left-0.5 top-0.5`
- Active thumb: `translate-x-4` (right position)
- Inactive thumb: `translate-x-0` (left position)
- **Critical:** button must have `min-h-0` to override global `button { min-height: 36px }` rule — without it the track renders as 36×36px square

Used in: EmojiPackForm (Strict mode, Fallback), VisualKitForm (Watermark), PostRulesForm (5 toggles)

---

## Form elements

### Glass input
```css
background: rgba(255,255,255,0.04);
border: 1px solid rgba(255,255,255,0.07);
border-radius: 12px;
color: #FFFFFF;
```
Focus: `border-color: rgba(255,106,0,0.45)`  
Placeholder: `#66666E`

### Option pills (SegmentedTabs / OptionPills)
Inactive: `bg-white/5 text-[#A1A1AA] border-white/[0.06]`  
Active: `bg-[rgba(255,106,0,0.14)] text-[#FF6A00] border-[rgba(255,106,0,0.38)]`  
Size: `px-3 py-1 text-[12px] rounded-full`

### Tag input chips (word lists in VoiceProfileForm)
`text × ` format — click to remove

### Section header labels
`text-xs font-medium text-[#66666E] uppercase tracking-wide` — above form groups

---

## Localization

Two languages: **RU** (default if stored) and **EN**.

`src/i18n/en.ts` is the source of truth. `Dict = typeof en`.  
`ru.ts` must satisfy `Dict` exactly — TypeScript enforces this.  
`t(key: TranslationKey)` — type-safe, derived from `PathsOf<Dict>` recursive type.  
Language stored in `localStorage`, auto-detected on first load.

### Product terms — canonical names

| Internal code key | EN display | RU display |
|---|---|---|
| `voiceProfile` | Writing style | Стиль текста |
| `emojiPack` | Emoji | Эмодзи |
| `visualKit` | Visual | Визуал |
| `linkKit` | Links & buttons | Ссылки и кнопки |
| `signature` | Signature | Подпись |
| `postRules` | Post rules | Правила постов |
| BrandKit overall | Channel style | Стиль канала |

### Forbidden visible terms (must never appear in UI)
- Brand Kit
- Link Kit
- Visual Kit
- Voice Profile
- Emoji Pack
- Banner (as a user-facing term)
- credits / tokens
- Free (plan tier)
- publications/month (use "постов с AI / AI posts")
- Default / По умолчанию (for channel selector)
- Set default / Выбрать (for channel selector)

### RU tab labels (Posts screen)
- Новые / Отложка / Опублик.  
  (shortened to fit on mobile — "Запланированные" and "Опубликованные" overflow)

---

## Pricing — canonical copy

Plans are fixed. Do not change tiers, prices, or features without explicit permission.

| Plan | RU name | Price | AI posts | Channels | Features |
|---|---|---|---|---|---|
| starter | Старт | $5 / мес | 30 постов с AI | 1 | — |
| creator | Автор | $20 / мес | 150 постов с AI | 3 | Отложенные посты |
| studio_pro | Студия Pro | $70 / мес | 700 постов с AI | 10 | Отложенные посты, Продвижение постов (soon) |

Scheduling (`scheduledPosts`) available on **creator** and **studio_pro** only.  
`canSchedulePosts = planTier !== 'starter'`

---

## Active channel UX rules

- One globally active channel per session (`state.activeChannelId`)
- Posts tab: shows posts filtered for active channel
- Create tab: generates for active channel (set via `ChannelSwitcherHeader`, not internal dropdown)
- Profile: shows `Активный / Active` badge on active channel card; other channels show `Сделать активным / Make active` button
- `setActiveChannel(id)` in AppContext updates global state
- **No duplicate channel selector inside the Create form**

---

## Regeneration limits (tracked in state, not yet enforced server-side)

- Text regenerations per AI post: **3**
- Visual/banner regenerations per AI post: **2**
- Fields: `textRegensUsed`, `imageRegensUsed` on `GeneratedPost`

---

## Scroll & layout rules

- `html, body, #root { overflow: hidden }` — browser-level scroll disabled
- Each scrollable screen area uses `overflow-y-auto` with `no-scrollbar` class
- Scrollbars are always hidden (CSS for all engines)
- Bottom nav is always floating — never in document flow
- Content area has `padding-bottom: calc(96px + env(safe-area-inset-bottom, 0px))` to stay above nav
- Page-level titles are removed from main tab screens (Posts has channel switcher header; Create has channel switcher header; Profile starts directly with account card)
- Modal/detail screens (Plans, Channel Style, Post Detail) keep `PageHeader` with back button

---

## Current TODO / next design areas

- Wire `@twa-dev/sdk` for real Telegram WebApp auth (`window.Telegram.WebApp.initDataUnsafe`)
- Replace mock generation delay with real `POST /api/generate` → Claude API
- Replace mock publishing with Telegram Bot `sendMessage`
- Real banner image generation (html-to-image server or design API)
- Real scheduling queue (BullMQ or similar)
- BrandKit persistence to Neon/Postgres via backend API
- Channel list from real Telegram bot subscriptions
- Post promotion feature (Studio Pro — marked "soon")
- Possibly: dark/light theme toggle (currently always dark)
