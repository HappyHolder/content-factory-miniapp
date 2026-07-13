# Security Audit — Publium Moderator v1.2

Дата: 13.07.2026
Объект: Moderator, Community API, Telegram webhooks, персональные боты, Terra, санкции, журнал и production-инфраструктура.
Метод: ручной code review, проверка ownership endpoint, анализ trust boundaries, безопасные production HTTP-пробы, поиск секретов, dependency advisories и production builds.

## Результат устранения (13.07.2026)

Все 12 находок закрыты в security patch v1.2.1. Реализация и release gate: [moderator-security-remediation-v1.2.1.md](moderator-security-remediation-v1.2.1.md).

## Итог

- Критических уязвимостей, позволяющих без Telegram-авторизации захватить чужой Moderator или получить bot token, не найдено.
- Основная tenant-изоляция реализована: API валидирует подпись Telegram и связывает ресурс с `channel.userId`; webhook защищены отдельными secrets.
- Найдено 3 high, 6 medium и 3 low hardening findings.
- Статус: допустимо для контролируемой beta; широкий rollout и платный запуск AI Moderator — после закрытия high и основных medium.

## Что уже защищено правильно

- Telegram `initData` проверяется HMAC-SHA256 и constant-time comparison.
- Чтение, изменение и публикация конфигурации требуют владельца канала.
- Подключение канала и группы проверяет реальные роли через Telegram.
- Общий и персональные webhook требуют secret token.
- У каждого персонального бота отдельный webhook secret; token зашифрован AES-256-GCM и исключён из публичной API-модели.
- Runtime принимает update только выбранного executor; `update_id` изолированы bot id.
- CAPTCHA callback привязан к участнику и атомарно claim-ится.
- Anti-spam хранит разрешённые сообщения как короткоживущий SHA-256.
- Rich Message текст HTML-экранируется.
- AI работает fail-open: ошибка модели не приводит к санкции.
- В tracked files не обнаружены bot tokens, API keys или private keys.
- API и PostgreSQL не публикуют внутренние порты наружу.

## High findings

### H-01 — Ручные команды усиливают права любого администратора

**Где:** `server/src/moderator/manualCommands.ts:23-41`.

Проверяется только статус `administrator|creator`, но не конкретные права автора (`can_delete_messages`, `can_restrict_members`). Администратор с минимальной ролью может через права бота выполнить `/delete`, `/mute`, `/kick` или `/ban`.

Проверка цели работает fail-open: при ошибке Telegram `targetRole` становится `null`, после чего наказание продолжается. Во время сбоя можно применить санкцию к администратору.

**Исправление:** матрица command → required actor right; creator разрешён всегда; target-role check для наказаний только fail-closed; аудит отказов.

### H-02 — AI-вмешательство может наказать не того участника

**Где:** `server/src/moderator/interventionEngine.ts:40-58`.

Terra возвращает `participantIds`, но warning выдаётся `input.tgUserId` — автору последнего сообщения, запустившего анализ. Это может быть сторонний участник или человек, пытавшийся остановить конфликт. Ошибка способна дойти до mute/ban; конфликт можно намеренно продолжить перед сообщением жертвы.

**Исправление:** не применять автоматическую санкцию без отдельной per-user проверки; для v1 отправлять такое решение в review либо детерминированно подтверждать цель. Роль цели проверять fail-closed.

### H-03 — Уязвимая production-зависимость Multer

**Где:** `server/package.json:26`, lock содержит `multer@2.1.1`.

`npm audit --omit=dev` обнаружил high DoS advisory `GHSA-72gw-mp4g-v24j` и moderate `GHSA-3p4h-7m6x-2hcm`. Multipart middleware выполняется до route-level auth на upload endpoint, поэтому парсинг можно атаковать без валидного пользователя.

**Исправление:** Multer `>=2.2.0`, новый lockfile, upload regression tests и multipart limits на edge.

## Medium findings

### M-01 — `initData` передаётся в URL и replay-доступно до 24 часов

**Где:** `server/src/lib/telegram.ts:27,91-92`, GET-вызовы Community/Config/Log.

Credential может попасть в access logs, browser history и observability. При утечке он даёт API-доступ от имени пользователя до 24 часов. Timestamp из будущего не отклоняется.

**Исправление:** однократный POST-обмен на короткую серверную сессию/bearer; убрать credential из URL; TTL 5–15 минут; проверять `ageSeconds >= -30`; скрыть query в proxy logs.

### M-02 — Нет общего rate limiting, AI quota неатомарна

**Где:** `server/src/index.ts:28-29`, `server/src/moderator/interventionEngine.ts:18`.

API не ограничивает auth, config, simulate и bot-management операции. Проверка квоты и increment разделены, поэтому параллельные запросы могут превысить лимит и стоимость Terra.

**Исправление:** edge/application rate limits по IP/user/community; atomic conditional update квоты; idempotency key для дорогих операций.

### M-03 — Publish проверяет не права выбранного executor

**Где:** `server/src/routes/moderatorConfig.ts:76-80`.

Используются сохранённые `moderatorChat.grantedRights` стандартного бота, а не живые права текущего shared/custom executor. Конфигурация может опубликоваться, хотя персональный бот не умеет удалить или ограничить участника.

**Исправление:** перед publish получать `getChatMember` выбранного executor, обновлять granted rights и блокировать/degrade конкретный блок.

### M-04 — Пользовательский regex выполняется без timeout

**Где:** `server/src/moderator/config.ts:28`, `server/src/routes/moderator.ts:127`.

Эвристика отсекает очевидные опасные выражения, но JavaScript RegExp работает в основном event loop без timeout. Сложный шаблон может вызвать CPU DoS.

**Исправление:** RE2/безопасный regex engine либо worker с timeout; adversarial corpus tests.

### M-05 — Encryption key имеет небезопасный fallback

**Где:** `server/src/moderator/managedBotCrypto.ts:8-10`.

Без `MANAGED_BOT_ENCRYPTION_KEY` ключ выводится из Telegram webhook secret. Это смешивает назначения секретов и позволяет production стартовать с неверной конфигурацией. На текущем production отдельный стабильный ключ задан.

**Исправление:** production fail-fast, минимум 32 random bytes, версия/rotation ключа и AAD с bot/community id.

### M-06 — Retention журнала не ограничен политикой

`ModerationEvent` и `ModerationWarning` не очищаются автоматически; scheduler удаляет только 60-минутный AI context. Trigger event сохраняет до 200 символов нормализованного сообщения.

**Исправление:** configurable retention 30/90 дней, удалить `metadata.normalized` или хранить trigger id/hash, добавить удаление данных сообщества.

## Low findings

### L-01 — Широкий CORS и отсутствующие security headers

Production отвечает `Access-Control-Allow-Origin: *`; Caddy не задаёт CSP, HSTS, Referrer-Policy и базовые anti-sniff/frame policies. CORS сам не раскрывает Telegram credential, но усиливает ущерб при утечке.

**Исправление:** allowlist production origin, `Vary: Origin`, edge headers после проверки Telegram WebView.

### L-02 — API-контейнер root и без resource limits

Dockerfile не переключается на непривилегированного пользователя; compose не ограничивает CPU/memory. Это увеличивает blast radius RCE/regex/upload DoS.

**Исправление:** multi-stage runtime, non-root user, read-only filesystem где возможно, `no-new-privileges`, cap drop и limits.

### L-03 — Создание бота коррелируется только по owner + времени

`completeManagedBot` берёт последний REQUESTED объект владельца за 30 минут и не подтверждает ожидаемый username. Чужой пользователь не может захватить бота, но при параллельном создании можно привязать не того.

**Исправление:** request nonce/correlation id или проверка username и явное подтверждение identity.

## Проверки

- `npm audit --omit=dev` client: 0 vulnerabilities.
- `npm audit --omit=dev` server: 1 high package finding (Multer).
- Fake/missing `initData`: API отвечает 400/401 и не раскрывает ресурс.
- Webhook code требует `X-Telegram-Bot-Api-Secret-Token` и constant-time compare.
- Production probe подтвердил wildcard CORS и отсутствие основных security headers.
- Поиск tracked files: секреты и private keys не найдены.
- Client и server builds являются обязательным release gate.

## Рекомендуемый порядок исправлений

1. H-01, H-02: безопасность санкций и защита администраторов.
2. H-03: Multer и multipart regression tests.
3. M-01, M-02: короткая auth-session, отказ от query credential, rate limits и атомарная AI quota.
4. M-03, M-04: live rights check и безопасный regex runtime.
5. M-05, M-06: обязательный encryption key и retention jobs.
6. L-01…L-03: инфраструктурный hardening и provisioning UX.

После пунктов 1–4 нужен повторный targeted audit и adversarial тест в отдельной Telegram-группе до публичного paid rollout.
