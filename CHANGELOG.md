# Changelog

All notable changes to Publium are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/). This file is the basis for the
update posts on the project channel — when you ship something, add it under
**[Unreleased]**, and on release move it into a dated version section.

Categories: **Added / Changed / Fixed / Removed**.

For the full always-current capability list, see [FEATURES.md](FEATURES.md).

---

## [Unreleased] — toward 1.2

Shipped to production since 1.1; not yet tagged.

### Added
- **Moderator: встроенные памятки и навигация Community** — четыре карточки получили контекстные справочные bottom sheets с назначением, примерами и рекомендациями; политика ссылок Anti-spam отделена от чёрного списка доменов Filters, regex объяснён на примере; экран сообщества разделён на вкладки Moderator и Community Manager.
- **Moderator: Content Filters v1** — visual block for stop words/phrases, safe regex patterns, domain blacklist, mention/CAPS/emoji limits, forwarded messages and 11 attachment types; supports edited messages, admin/bot/trusted exceptions, delete or delete+warning, retryable enforcement and audit events.
- **Moderator: Anti-spam v1** — visual block for rate flood, duplicate messages and link policy (allow all, block all, domain allowlist), with admin/bot/trusted exceptions, delete or delete+warning actions, audit events, retryable deletion, hashed short-lived message samples, and automatic retention cleanup.
- **Moderator: CAPTCHA v1** — visual newcomer verification block with a personal callback button, temporary write restriction, configurable 1–30 minute deadline, kick/keep-restricted timeout action, bot/admin/trusted exceptions, foreign-click protection, durable Postgres timeouts, audit events, and Welcome delivery only after successful verification.
- **Moderator: Welcome v1** — visual Rich Message welcome block for discussion groups: formatting, image, URL buttons, variables (`{name}`, `{username}`, `{group}`, `{channel}`, `{rules}`), repeat-join modes, bot/admin exceptions, service-message cleanup, and durable auto-delete up to 48 hours. Settings use draft/publish versions and a collapsible editor.
- **Rich inline formatting everywhere** — the generator (and editor) now use the full marker set: `**bold**`, `__italic__`, `~~strike~~`, `` `mono` ``, `==highlight==`, `||spoiler||`, `[links](url)`. Same vocabulary in generation, the block editor and table cells.
- **Nested lists** — a list item can carry a nested numbered sub-list (Tab-indent in the editor).
- **Heading links** — a heading can be a clickable link.
- **Table cell formatting** — inline markers work inside cells (+ a shared formatting toolbar for the focused cell). Cell background color is NOT possible (Telegram strips it).
- **«Ссылка-рамка» (linkbox)** — a framed, filled CTA box with a centered link, rendered as a bordered single-cell table (`<table border="1"><th>`).
- **Checklists, collapsible «спойлер-секции» (`<details>`), and code blocks** — three manual editor blocks.
- **11 cover styles** — pixel, sci-fi, cyberpunk, vaporwave, isometric, minimal, low-poly, glitch, blueprint, watercolor, oil.
- **Panoramas** — a post-image split into stacked/carousel slides. Upload → slice, OR **generate via `google/nano-banana-2`** (Gemini, the one Replicate model doing true 1:4 / 4:1 / 1:8 / 8:1) → auto-slice + upscale to 1080. Gallery gains a `stack` layout.

### Changed
- **Layout/formatting model → GPT-5.6 Terra** (`openai/gpt-5.6-terra` on Replicate), DeepSeek fallback. Richer output (actually uses highlight, nested lists, expandable quotes, linkbox), ~4s.

### Fixed
- **Publishing is rename-proof** — posts publish by the channel's stable numeric chat id (`tgChatId`), falling back to `@handle`; self-heals from a successful send. Renaming a channel no longer causes "chat not found". Raw Telegram errors → clear Russian messages.

---

## [1.1.0] — 2026-07-11

Everything below is live in production.

### Added
- **AI Content Manager** — the assistant turns one request into a whole SERIES of scheduled posts: chat → plan card → background worker researches each topic (Opus web_search/web_fetch, DeepSeek/Serper fallback), generates each post with a rubric cover, and drops them into Отложка. Asks for and honors the publish time (MSK). Project docs (PDF/DOCX) as a knowledge source in the Brand Kit.
- **Carousel engine** — a post that holds 3–7 parallel points becomes a swipeable slide **carousel** built from the channel pack's slide set (cover → item → outro), with a running bottom strip and a section label read from the post. Peer of the cover engines; degrades to a plain post when the pack has no slides or the post has no parallel points.
- **Publium carousel pack** — carousel slides in the Publium signature style (hand-painted orange dot ornament, glass cards, Onest).
- **Showcase-only style packs** — the internal **Publium** and **Stepan Logos** packs are now visible in the market to everyone, but only an admin can apply them (a shop window); regular users see a disabled CTA + "витрина" badge.
- **Private Stepan Logos cover pack** — dark blueprint rubrics (admin-only).

### Fixed
- **Content manager** — plans are built deterministically (a server-side intent classifier), not via a DeepSeek tool-call that never fired; the real current date is anchored across the whole pipeline (no more stale 2024/2025 facts); scheduling is in Moscow time, not server UTC.
- **Отложка** — the trash button really deletes and "publish now" really sends (were local-only); channel disconnect cascades (posts/brandkit/docs/plans).
- **Carousel** — the bottom ticker reads as one continuous band across slides; the section label is separated from the channel rubric; seed scripts no longer hang on Chromium (browser is closed on exit).

---

## [1.0.0] — 2026-07-03

First fixed public baseline. Everything below is live in production.

### Added
- **Telegram Mini App + bot** (`@Publiumbot`): idea → finished, formatted, on-brand Telegram post.
- **AI post generation** from text, a link (auto-extracted), or a screenshot (vision).
- **Manual "from scratch"** composition mode.
- **AI assistant** with real web research (Serper primary, Tavily fallback) and an "Отправить в Create" handoff.
- **Formatted posts (Telegram Rich Messages)** — auto layout into headings, lists, tables, expandable quotes, and slideshow/collage galleries.
- **Block composer** — heading / paragraph / list / quote / table / image / gallery / video / document / divider; inline formatting toolbar (bold, italic, strike, mono, highlight, spoiler, link) on paragraph, quote **and list**; full table row/column editing; drag-reorder; inline-keyboard button editor; AI illustrations per block.
- **Dual cover engine** — legacy (AI photo + HTML overlay) and modular (rubric/template packs, hybrid, Satori); modes AI / HTML / AI+HTML.
- **Rubrics** — per-channel content types that route the cover recipe.
- **Styles market** — curated cover-style packs (Crypto, CYBR, Publium), buy with Stars / TON, apply to a channel.
- **Publishing** — publish now, schedule + auto-publish, Fast Share (no channel needed).
- **5-hour edit window** — pull a published post back, edit, and re-publish **in place** (same channel message; views/reactions preserved); Archive card "Edit" action; auto-retention purge after the window.
- **Brand Kit** — channel about, voice, post rules, link kit, signature, visual kit + cover settings.
- **Monetization** — subscription tiers with monthly quotas, Telegram Stars + TON payments, promo codes.
- **Admin panel** — promo codes and styles CRUD (upload templates, render previews).

---

_Tag this commit: `v1.0.0`._
