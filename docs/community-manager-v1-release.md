# Publium Community Manager v1 — реализация

Дата: 2026-07-14
Статус: реализовано, production rollout

## Что вошло

- отдельный shared Telegram executor для Community Manager;
- переменные token, username и отдельный webhook secret;
- установка webhook отдельной npm-командой;
- связь с существующим Community и группой Moderator;
- конфигурация с draft/apply версиями;
- режимы Observe, Drafts и Autopilot;
- настраиваемая личность, тон, обращение и запреты;
- ответы на reply, mention и вопросы о продукте;
- краткосрочный контекст ветки;
- grounded support по BrandKit, ProjectDoc и подтверждённому FAQ;
- web research через существующий researchEngine;
- источники в публичном ответе и журнале;
- quiet hours, per-user cooldown, часовые/суточные лимиты и research budget;
- durable PostgreSQL queue с lease/retry/recovery;
- задержка и проверка Moderator events перед AI-ответом;
- повторная проверка pause непосредственно перед отправкой;
- симулятор решения;
- журнал ответов, молчания, drafts, activity, ошибок, latency и токенов;
- ручные discussion, Telegram poll и digest;
- 24-часовой retention сырого текста;
- каскадное удаление CM-данных вместе с Community;
- mobile UI внутри существующей вкладки Community Manager.

## Безопасные значения по умолчанию

- первый режим: Drafts;
- ambient conversation: off;
- research: when needed;
- proactive automation: off;
- quiet hours: 23:00–09:00 Europe/Moscow;
- максимум 20 ответов/час и 100/сутки;
- CM не имеет функций mute/delete/ban;
- при сбое AI или недостатке контекста отправка не выполняется;
- отключённый формат highlight не генерируется.

## Production env

- COMMUNITY_MANAGER_BOT_TOKEN
- COMMUNITY_MANAGER_BOT_USERNAME
- COMMUNITY_MANAGER_WEBHOOK_SECRET

Secret генерируется во время rollout и не передаётся пользователю. Compose передаёт все три значения только API-контейнеру.

## Операции

Установить webhook:

    docker compose exec api npm run set-community-manager-webhook

Проверить API:

    docker compose ps
    docker compose logs --tail=100 api

Webhook endpoint:

    https://publium.ru/api/community-manager/webhook

## Ограничение v1

Отдельные пользовательские аккаунты-персонажи реализуются следующим этапом поверх этого runtime. В v1 публично пишет один CM bot. Discussion, poll и digest запускаются владельцем из интерфейса; автоматический календарь событий входит в следующий этап.
