# Changelog

All notable changes to Publium are recorded here. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/). This file is the basis for the
update posts on the project channel — when you ship something, add it under
**[Unreleased]**, and on release move it into a dated version section.

Categories: **Added / Changed / Fixed / Removed**.

For the full always-current capability list, see [FEATURES.md](FEATURES.md).

---

## [Unreleased]
_Work in progress — next up: AI content manager (weekly content plan → research →
batch-generate → auto-schedule; upload project docs as a knowledge source)._

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
