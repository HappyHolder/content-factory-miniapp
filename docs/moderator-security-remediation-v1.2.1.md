# Publium Moderator v1.2.1 — закрытие security audit

Дата: 13.07.2026
Основание: `docs/moderator-security-audit-v1.2.md`
Статус: закрыты все 12 находок — 3 high, 6 medium, 3 low.

## Что исправлено

### High

- **H-01 — права ручных команд.** Для `/delete` проверяется `can_delete_messages`, для warn/mute/ban/kick/unban — `can_restrict_members`; creator разрешен явно. Проверка роли цели стала fail-closed: при недоступности Telegram команда отменяется, администраторы и владельцы защищены.
- **H-02 — неверная цель AI-санкции.** Terra больше не наказывает автора последнего сообщения автоматически. Санкция возможна только для одного однозначного участника, которого модель назвала и в текущем, и в предыдущем эпизоде; цель должна присутствовать в реальном контексте, а ее роль повторно проверяется через Telegram. Неоднозначность или ошибка дают только вмешательство без санкции.
- **H-03 — Multer.** Production-зависимость обновлена до `2.2.0`; добавлены лимиты file/field/part на каждом upload middleware и общий edge-limit 32 MB. `npm audit --omit=dev` — 0 уязвимостей.

### Medium

- **M-01 — утечка/replay initData.** Moderator получает отдельный bearer через одноразовый POST-обмен свежего Telegram `initData`; TTL bearer — 30 минут, credential удален из URL и тел Moderator mutation. Клиент обновляет истекшую сессию автоматически. Будущие `auth_date` отклоняются.
- **M-02 — rate limiting и AI quota.** Добавлены лимиты на обмен сессии и Moderator API. Резервирование проверки Terra выполняется атомарным conditional update, поэтому параллельные запросы не выходят за месячный лимит.
- **M-03 — права активного executor.** Publish каждый раз получает живые права именно выбранного shared/custom bot и текущую роль владельца через Telegram; публикация блокируется при недостаточных правах.
- **M-04 — ReDoS.** Пользовательские regex выполняются в отдельном worker с жестким timeout и ограничением входного текста; timeout/error не блокирует event loop.
- **M-05 — ключ токенов.** Production стартует только с отдельным `MANAGED_BOT_ENCRYPTION_KEY` не короче 32 байт. Новые ciphertext имеют key version 2 и AES-GCM AAD, привязанный к `communityId`; старые version 1 читаются для бесшовной миграции.
- **M-06 — retention.** Сырые тексты больше не сохраняются в событиях триггеров. AI context удаляется после часа, moderation events — через 30 дней, закрытые warnings — через 90 дней, завершенные scheduled actions — через 30 дней. Удаление канала каскадно удаляет Community и его Moderator-данные.

### Low

- **L-01 — CORS/headers.** Production CORS ограничен публичным origin; добавлены CSP, HSTS, nosniff, Referrer-Policy и Permissions-Policy.
- **L-02 — контейнер.** Backend собирается multi-stage, runtime запускается пользователем `node`; compose задает CPU/RAM/PID limits и `no-new-privileges`.
- **L-03 — привязка персонального бота.** Завершение provisioning сверяет ожидаемый и фактический username, поэтому параллельные заявки одного владельца не могут привязать не того бота.

## Проверки release gate

- Backend TypeScript/Prisma production build.
- Frontend TypeScript/Vite production build.
- `npm audit --omit=dev` для backend и frontend.
- Security smoke: безопасный regex, катастрофический regex/timeout, версия Multer, non-root Docker runtime, CSP и edge body limit.
- После deploy: миграции, health, bearer rejection, CORS, security headers, webhook secret и состояние контейнеров.

## Остаточный риск

Автоматическая модерация по определению не может быть абсолютно безошибочной. Поэтому Terra остается fail-open, не банит после одного сообщения, а неоднозначная цель не получает санкцию. Порог уверенности, режим наблюдения и журнал отмены остаются обязательными страховками при расширении rollout.