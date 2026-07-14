# Publium Community Manager v1 — подробный план реализации

Статус: реализовано в Community Manager v1; фактический состав релиза — docs/community-manager-v1-release.md
Дата: 2026-07-14
Родительская дорожная карта: docs/community-manager-roadmap.md

## 1. Цель и граница v1

Community Manager v1 — отдельный AI-исполнитель в Telegram-группе, который:

- знает тематику, стиль, аудиторию и правила сообщества;
- знает продукт по загруженным документам и подтверждённому FAQ;
- отвечает как первая линия поддержки;
- выполняет интернет-ресерч для свежих внешних вопросов;
- общается в устойчивой настраиваемой личности;
- замечает вопросы без ответа;
- запускает ограниченный набор безопасных активностей;
- работает в режимах наблюдения, черновиков и автопилота;
- соблюдает расписание, лимиты и решения Moderator;
- объясняет каждое действие в журнале;
- полностью останавливается одной кнопкой.

v1 создаёт общее ядро для будущих отдельных AI-персонажей. Сами 3–10 аккаунтов-персонажей в этот релиз не входят.

### Входит

- отдельный стандартный бот Community Manager;
- подключение к существующему Community и его Telegram-группе;
- профиль CM: имя, роль, биография, тон, стиль и ограничения;
- draft/published конфигурация и кнопка «Применить»;
- ответы на reply, mention и распознанный вопрос о продукте;
- краткосрочный контекст разговора;
- база знаний на основе ProjectDoc и BrandKit;
- подтверждённый FAQ и журнал неизвестных вопросов;
- быстрый и глубокий web research;
- support routing и эскалация владельцу;
- тема для обсуждения, простой poll и недельный дайджест;
- quiet hours, cooldown, часовые/суточные квоты;
- журнал действий, источников, ошибок, токенов и стоимости;
- симулятор до применения настроек;
- feature flags и безопасное отключение.

### Не входит

- отдельные аккаунты AI-персонажей;
- психологические профили участников;
- конкурсы, розыгрыши, Stars/TON;
- сложные event state machines;
- голосовые комнаты и видеособытия;
- обучение/fine-tuning на переписке;
- автоматическое изменение Moderator;
- действия с оплатой, аккаунтами и персональными данными.

## 2. Архитектурные решения

### Отдельный исполнитель

- @Publiumbot — Mini App и управление;
- @PubliumModerBot/managed Moderator bot — правила и санкции;
- новый @PubliumCommunityBot — публичный CM.

Сначала используется shared CM bot из env. Подключение собственного CM-бота проектируется совместимым с managed Moderator bot и добавляется после стабилизации shared executor.

CM получает только нужные ему права: чтение доступных сообщений, отправка и создание опросов. Он не удаляет, не ограничивает, не банит и не назначает администраторов.

### Moderation gate

Moderator и CM — разные боты, поэтому Telegram доставляет им updates независимо и порядок webhook не гарантирован.

Вводится CommunityInboundMessage:

1. Webhook CM идемпотентно создаёт сообщение со статусом PENDING_MODERATION.
2. Moderator после всех проверок записывает ALLOWED, BLOCKED или IGNORED по ключу communityId + tgChatId + telegramMessageId.
3. Если Moderator выключен, intake CM выставляет ALLOWED после базовых проверок.
4. CM worker забирает только ALLOWED.
5. BLOCKED никогда не попадает в LLM-контекст.
6. Если включённый Moderator не дал решение вовремя, сообщение получает MODERATION_TIMEOUT, и CM его пропускает.

Moderator потребуется дополнить: итог фиксируется не только при нарушении, но и после успешного прохождения всех проверок.

### Durable DB queue

LLM, retrieval и research не выполняются внутри webhook. Webhook проверяет secret, валидирует update, дедуплицирует, сохраняет message/job и быстро возвращает 200.

CommunityManagerWorker забирает задачи из PostgreSQL атомарным claim. Redis для v1 не обязателен. Lease и retry позволяют продолжить после рестарта.

Состояния:

PENDING → CLAIMED → CLASSIFYING → RETRIEVING → RESEARCHING? → GENERATING → POLICY_CHECK → SENDING → COMPLETED.

Альтернативы: SKIPPED, RETRY_WAIT, FAILED, CANCELLED.

### Единый decision pipeline

Reply, support, research и активности используют один контур классификации, разрешений, генерации и проверки. Ни одна ветка не обходит published config, квоты или emergency pause.

## 3. Пользовательский сценарий

### Первое подключение

1. Канал → «Сообщество» → Community Manager.
2. Если группа не связана с Community, используется существующий сценарий.
3. Владелец добавляет @PubliumCommunityBot.
4. Publium получает my_chat_member, проверяет группу, владельца и права.
5. CM отображается подключённым, но остаётся на паузе.
6. Владелец задаёт личность, правила ответа, знания, research и режим.
7. Проверяет поведение в симуляторе.
8. Нажимает «Применить».
9. Первый запуск по умолчанию — «Черновики».

### Ежедневное управление

- Пауза не удаляет настройки;
- черновик не влияет на runtime до «Применить»;
- журнал объясняет ответ, молчание и эскалацию;
- неизвестный вопрос можно превратить в FAQ;
- activity draft можно применить или отклонить;
- health отдельно показывает executor, webhook, worker, AI, research, knowledge и квоты.

## 4. UI вкладки Community Manager

Заглушка в src/screens/CommunityScreen.tsx заменяется рабочим содержимым. Новая нижняя вкладка не создаётся.

### Карточки

1. Состояние и исполнитель
   - статус, группа, username, автономность, последняя обработка;
   - добавить бота, проверить права, пауза/запустить;
   - health и причина degraded/error.

2. Личность CM
   - имя, роль, биография и миссия;
   - тон, ты/вы, юмор, энергия и инициативность;
   - фирменные выражения;
   - запрещённые темы и обещания;
   - предпросмотр типовых ответов.

3. Знания и поддержка
   - BrandKit;
   - документы и статусы обработки;
   - FAQ;
   - неизвестные вопросы;
   - правило, текст и контакт эскалации.

4. Интернет-ресерч
   - выключен / при необходимости / глубокий;
   - показывать ссылки;
   - разрешённые/запрещённые домены;
   - дневной бюджет и TTL кеша.

5. Когда отвечать
   - reply, mention, вопрос о продукте, вопрос без ответа N минут;
   - приветствие выключено по умолчанию, чтобы не дублировать Moderator;
   - участие в обычной беседе выключено по умолчанию.

6. Активности
   - discussion, poll, weekly digest;
   - частота, расписание и согласование каждого типа;
   - история результата.

7. Расписание и лимиты
   - timezone, quiet hours;
   - ответы и инициативы в час/сутки/неделю;
   - cooldown пользователя и темы;
   - максимальная глубина ветки;
   - месячные бюджеты AI/research.

8. Симулятор
   - диалог и сценарий;
   - ответ/молчание/эскалация;
   - знания и источники;
   - причина и приблизительная стоимость.

9. Журнал
   - trigger, решение, intent/confidence;
   - model/prompt version;
   - источники, latency, tokens/cost;
   - статус Telegram-доставки;
   - фильтры.

### UI-требования

- текущий тёмный стиль и оранжевый акцент сохраняются;
- карточки сворачиваются, редактируется один крупный блок;
- touch-зона не меньше 44×44 px;
- постоянные labels, placeholder не заменяет label;
- error/loading/disabled состояния видимы и не сдвигают layout;
- цвет не является единственным признаком статуса;
- обязательны focus-visible и клавиатурная навигация;
- проверка на 375, 768, 1024 и 1440 px;
- иконки только Lucide.

## 5. Конфигурация блоков

CommunityManagerConfig.blocks содержит:

- IdentityBlock;
- KnowledgeSupportBlock;
- ResearchBlock;
- ReplyPolicyBlock;
- ActivityBlock;
- ScheduleLimitsBlock.

Identity: displayName, role, bio, mission, tone, addressForm, humorLevel, energyLevel, initiativeLevel, signaturePhrases, forbiddenClaims, forbiddenTopics.

Knowledge & Support: useBrandKit, useProjectDocs, useFaq, answerProductQuestions, escalateWhenUnknown, escalationText, supportContactUrl, minimumGroundingScore.

Research: mode off/when_needed/deep, showSources, allowedDomains, blockedDomains, maxSearchesPerAnswer, dailyResearchLimit, cacheTtlHours.

Reply Policy: direct reply, mention, product question, unanswered question, unansweredAfterMinutes, join welcome, ambient conversation, maxThreadDepth, userCooldownSeconds.

Activities: discussion/poll/digest enabled, approvalByType, scheduleByType, topics.

Schedule & Limits: timezone, quietHours, maxRepliesPerHour/Day, maxInitiativesPerDay/Week, topicCooldownHours, monthlyTokenBudget, monthlyResearchBudget.

parseCommunityManagerBlocks запрещает неизвестные типы, ограничивает размеры, нормализует timezone и применяет безопасные defaults.

## 6. Модель данных

- CommunityManager: communityId unique, status, enabled, autonomyMode, executorType, draft/published version, health/error.
- CommunityManagerConfig: manager, version, DRAFT/PUBLISHED/ARCHIVED, blocks, author, publishedAt.
- CommunityManagerBot: identity/status; для custom executor — encrypted token и отдельный webhook secret.
- CommunityInboundMessage: community/chat/message/user/reply IDs, короткоживущий text, type, moderation/intake status, received/expires; unique community + chat + message.
- CommunityManagerJob: manager, message/activity, type, status, priority, attempts, runAfter, leaseUntil, workerId, error.
- CommunityConversationState: summary, activeTopics, last human/CM timestamps, syntheticStreak, optimistic version.
- CommunityKnowledgeChunk: doc/channel/order/heading/text/tokenCount/search representation/contentHash.
- CommunityFaqEntry: community, question, answer, keywords, status, priority, author.
- CommunityManagerAction: trigger, decision, intent/confidence, references, model/prompt, knowledge/research sources, usage/cost/latency, delivery/error.
- CommunityResearchCache: queryHash, summary, sources, freshness, expiry, provider/model/cost.
- CommunityActivity: DISCUSSION/POLL/DIGEST, config snapshot, status, schedule, approval, Telegram reference, metrics.

ProjectDoc расширяется status/version/contentHash и chunks. Первая retrieval-версия использует PostgreSQL full-text/trigram. Embeddings добавляются только если evaluation показывает недостаточное качество.

Все relations от Community/Channel удаляются каскадно. Токены и webhook secrets Moderator и CM не объединяются.

## 7. API

Все UI routes используют короткую server-side session и ownership Community → Channel → User.

State/executor:

- GET /api/community-manager/channels/:channelId
- POST /api/community-manager/channels/:channelId/create
- POST /api/community-manager/:managerId/pause
- GET /api/community-manager/:managerId/health
- POST /api/community-manager/:managerId/check-rights

Config:

- GET /api/community-manager-config/:managerId/draft
- PATCH /api/community-manager-config/:managerId/draft
- POST /api/community-manager-config/:managerId/apply
- POST /api/community-manager/:managerId/simulate

Knowledge/FAQ:

- GET /api/community-manager/:managerId/knowledge
- существующие POST /api/project-docs/upload и /delete
- POST /api/community-manager/:managerId/knowledge/reindex
- GET/POST /api/community-manager/:managerId/faq
- PATCH/DELETE /api/community-manager/:managerId/faq/:faqId
- GET /api/community-manager/:managerId/unknown-questions
- POST /api/community-manager/:managerId/unknown-questions/:id/create-faq

Actions/drafts/activities:

- GET /api/community-manager/:managerId/actions
- GET /api/community-manager/:managerId/drafts
- POST /api/community-manager/:managerId/drafts/:id/send|reject
- GET/POST /api/community-manager/:managerId/activities
- POST /api/community-manager/:managerId/activities/:id/approve|cancel

Telegram:

- POST /api/community-manager/webhook
- POST /api/community-manager/webhook/:botId для будущего managed bot.

PATCH merge-ит блоки по type. Apply проверяет группу, executor, права, required blocks и бюджеты, затем транзакционно архивирует published version и создаёт следующий draft.

## 8. AI pipeline

### Pre-filter без LLM

Отбрасываются сообщения самого CM, запрещённых ботов, service/empty/unsupported messages, BLOCKED Moderator, дубли, сообщения вне published config, превышенные квоты и неразрешённые triggers.

### Intent classifier

Строгий JSON:

- intent: product_support, external_fresh, conversation, feedback, request_human, unsafe, no_response;
- shouldRespond;
- needsKnowledge;
- needsResearch;
- needsEscalation;
- confidence;
- reasonCode;
- searchQuery без персональных данных.

Classifier не пишет публичный ответ. При невалидном JSON fallback отвечает только на прямой reply/mention, иначе молчит.

### Retrieval

Приоритет:

1. Published FAQ.
2. Актуальные chunks документов.
3. BrandKit и описание канала.
4. Недавняя ветка.
5. Web research, если разрешён и нужен.

Retriever возвращает fragment, source, relevance, date и trust level. Низкий score не подаётся генератору как достоверный факт.

### Research

Поверх существующего researchEngine добавляется policy layer: permission, privacy query filter, cache, allow/block domains, budget reservation, fast/deep backend, sources, timeout и fallback.

Web не используется для внутренних цен, сроков и обещаний проекта, отсутствующих в утверждённых материалах.

### Response generator

Prompt строго разделяет неизменяемые ограничения Publium, published Identity, BrandKit, trusted knowledge, untrusted web и thread context.

Ответ не выдумывает продуктовые факты, не обещает действия команды, отделяет внешнюю информацию, уточняет неоднозначный вопрос, эскалирует account/payment/personal-data случаи, пишет естественно и не использует отключённую подсветку ==...==.

### Policy check перед send

- manager всё ещё enabled;
- config version актуальна;
- moderationStatus всё ещё ALLOWED;
- quota атомарно зарезервирована;
- нет forbidden claims, unsafe links или утечки prompt/документов;
- Telegram-разметка и длина корректны;
- режим разрешает SEND, иначе DRAFT, ESCALATE или SKIP.

## 9. Модели и стоимость

Provider-neutral интерфейс:

- classifyCommunityIntent;
- generateCommunityReply;
- researchCommunityQuestion.

Routing:

- deterministic code — triggers, политики и квоты;
- DeepSeek — быстрый classifier и дешёвые простые ответы;
- основной качественный text model — сложный support и публичные ответы;
- существующий researchEngine — web research;
- fallback-модель при сбое основной;
- при полном сбое CM молчит и логирует ошибку, но не отправляет выдуманный шаблон.

Конкретные env defaults выбираются после benchmark latency/cost на фиксированном наборе диалогов.

## 10. Контекст, память и retention

v1 хранит краткосрочную reply chain и ограниченное резюме активной темы. Долговременной персональной памяти нет; допустимы cooldown, текущая эскалация и участие в активном сценарии.

Предложение до security review:

- raw text — 24 часа;
- активный контекст — 60 минут;
- обезличенное резюме — 30 дней;
- research cache — 1 час–7 дней;
- action metadata без полного текста — 90 дней;
- failed jobs — 30 дней;
- документы/FAQ — до удаления владельцем или канала.

## 11. Активности v1

Discussion: тема из канала, документов, контента или research; anti-repeat cooldown; сначала draft при согласовании; после отправки считаются человеческие ответы.

Poll: 2–10 нейтральных вариантов. Одновременно не более одной инициативы.

Weekly digest: темы, полезные решения, открытые вопросы и будущие активности без удалённых Moderator сообщений и лишних персональных данных.

Scheduler durable. После рестарта активность выполняется только в допустимом окне, иначе получает MISSED и не отправляется ночью задним числом.

## 12. Безопасность

До production проводится отдельный security audit и remediation:

- webhook secret, bot identity, replay/duplicate protection;
- ownership и tenant isolation;
- короткая подписанная UI-session;
- encrypted custom bot tokens;
- atomic quotas;
- SSRF-защита research/fetch и блок private/local addresses;
- лимиты MIME/размера/числа документов и extracted text;
- защита от prompt injection из чата, документа и web;
- разделение trusted/untrusted context;
- запрет утечки документов/system prompt;
- sanitization Telegram formatting/links;
- отсутствие секретов и сырого prompt в логах;
- retention/purge jobs;
- fail-closed перед отправкой;
- emergency pause manager/executor/global.

## 13. Наблюдаемость

Метрики: webhook accepted/duplicate/rejected; queue depth/age; completed/retried/failed/skipped jobs; latency стадий; model fallback; Telegram errors; moderation timeout; knowledge hit; research/cache hit; tokens/cost; decisions; AI/human ratio.

Health отдельно показывает executor, webhook, права, published config, worker, AI provider, research provider, knowledge index и quotas.

## 14. Структура кода

server/src/communityManager:

- config.ts, types.ts, defaults.ts, auth.ts;
- executor.ts, intake.ts, moderationGate.ts, worker.ts;
- classifier.ts, retriever.ts, researchPolicy.ts;
- prompt.ts, generator.ts, policy.ts;
- activities.ts, metrics.ts, retention.ts.

Routes:

- server/src/routes/communityManager.ts;
- communityManagerConfig.ts;
- communityManagerKnowledge.ts.

Frontend:

- CommunityManagerOverview;
- IdentityEditor;
- KnowledgeEditor;
- ResearchEditor;
- ReplyPolicyEditor;
- ActivityEditor;
- LimitsEditor;
- Simulator;
- CommunityManagerLog;
- src/lib/communityManagerApi.ts.

CommunityScreen остаётся контейнером вкладок, CM-state выносится, чтобы не создавать монолит.

## 15. Milestones

### A. Foundation и UI skeleton

1. Prisma manager/config/bot/inbound/job/action и relations.
2. Env shared bot + secret, routes и rate limits.
3. Auth/ownership helpers.
4. Create/state/pause/health.
5. my_chat_member, права, удаление/возврат бота.
6. Overview и skeleton карточек.

### B. Config, intake и moderation gate

1. Blocks/defaults/parser.
2. Draft/apply API и первые редакторы.
3. Webhook с secret/idempotency.
4. Inbound + durable job.
5. Moderator disposition каждого сообщения.
6. Gate/timeout.
7. Atomic worker claim/retry/recovery.

### C. Reactive conversation

1. Pre-filter и intent classifier.
2. Thread context.
3. Identity prompt и generator.
4. Policy check и Telegram sender.
5. Observe/Drafts/Autopilot.
6. Simulator и Action log.

### D. Knowledge & Support

1. ProjectDoc status/version/hash.
2. Асинхронный chunking/indexing.
3. Retriever/source ranking.
4. FAQ CRUD/publish.
5. Support router, unknown questions, эскалация.
6. UI Knowledge & Support.

### E. Web Research

1. Research policy/cache/privacy/budgets.
2. Fast/deep, sources, timeout/fallback.
3. UI Research и источники в журнале.

### F. Proactive activities

1. Activity model/scheduler.
2. Discussion, poll, weekly digest.
3. Approval/history/results.
4. Anti-repeat и human-response gate.

### G. Hardening и beta

1. Unit/integration/E2E.
2. Prompt-injection red team.
3. Security audit/remediation.
4. Cost/latency benchmark и retention worker.
5. Production metrics/alerts.
6. Observe-only → drafts → reply/mention autopilot → support → research → одна activity.
7. Неделя в одной группе, затем 3–5 beta-сообществ.

## 16. Тест-план

Unit: config, intent JSON/fallback, moderation gate, timezone, cooldown, quotas, retrieval, research privacy, prompt boundaries, sanitizer, scheduler.

Integration: ownership/isolation, apply transaction, webhook idempotency, atomic claim, lease recovery, оба порядка Moderator/CM webhook, cascade delete, retention, indexing lifecycle.

Telegram: secret, my_chat_member, message/reply/mention, poll, send retry, bot remove/re-add, insufficient rights, duplicates.

AI evaluation — минимум 100 сценариев:

- 30 вопросов по документам;
- 15 неизвестных внутренних;
- 15 свежих внешних;
- 10 chat injections;
- 10 document/web injections;
- 10 разговоров, где CM молчит;
- 10 конфликтных/неоднозначных.

E2E: подключение → настройка → симуляция → применение; support по PDF; research; BLOCKED Moderator message; draft approval; scheduled poll; pause с queued job; restart API.

## 17. Rollout и rollback

Feature flags:

- COMMUNITY_MANAGER_ENABLED;
- COMMUNITY_MANAGER_AUTOPILOT_ENABLED;
- COMMUNITY_MANAGER_RESEARCH_ENABLED;
- COMMUNITY_MANAGER_ACTIVITIES_ENABLED.

Rollout: local/staging → production observe-only → drafts → autopilot reply/mention → knowledge support → research → одна activity → расширение beta.

Rollback: глобальный flag прекращает claim; pause повторно проверяется перед send; queued jobs отменяются; webhook снимается без удаления данных; beta migrations additive; предыдущая published config сохраняется.

## 18. Definition of Done

- отдельный CM bot стабильно подключается и проверяет права;
- config имеет draft/apply и simulator;
- pause предотвращает отправку даже queued jobs;
- BLOCKED Moderator content не достигает AI pipeline;
- webhook быстрый, долгие операции durable;
- продуктовые ответы grounded либо эскалируются;
- research содержит источники и соблюдает лимиты;
- CM не вмешивается без разрешённого trigger;
- quiet hours/cooldown/quotas проходят race tests;
- restart не создаёт дублей;
- журнал объясняет решение, источники, latency и стоимость;
- tenant knowledge изолирован;
- security audit завершён, high/medium исправлены;
- недельная beta не показывает циклов, спама и критических ложных ответов;
- frontend/backend builds и все проверки проходят.

## 19. Первые задачи

1. Утвердить scope v1.
2. Зафиксировать имя и username shared CM bot.
3. Зафиксировать defaults: DRAFTS, research WHEN_NEEDED, ambient OFF, activities require approval.
4. Детализировать Prisma и sequence moderation gate/worker.
5. Выполнить Milestone A.
6. Затем Milestone B; не начинать LLM-ответы до готовности durable queue и moderation gate.
