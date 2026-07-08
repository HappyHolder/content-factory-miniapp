# Publium — AI Контент-менеджер (полная автоматизация контента)

> Хендофф-документ для продолжения в новой сессии. Собрано 2026-07-08.
> Память проекта уже обновлена: `MEMORY.md` → `content-automation-plan.md` (+ `publium-engine-map`, `publium-build-status`, `publium-cover-engines-routing`, `publium-prod-server`, `telegram-rich-messages`, `styles-market-design`). Следующая сессия подхватит их автоматически.

---

## 0. Контекст: что такое Publium (кратко)

Telegram Mini App + бот `@Publiumbot`, превращающий идею/ссылку/скриншот в готовый оформленный Telegram-пост (текст + обложка + вёрстка) и публикующий его в канал.

**Стек:** React 18 + Vite + Tailwind (фронт, раздаётся Caddy) · Express + Prisma + Postgres (бэк) · Playwright/Chromium, sharp, Satori (рендер обложек) · Replicate (Flux/gpt-image-2, Claude Sonnet) · DeepSeek (текст/классификаторы) · Serper→Tavily (поиск).
**Прод:** `root@45.146.165.97`, репо `/opt/publium`, деплой `git pull` + `docker compose up -d --build` (миграции применяются на старте api). Тестовый канал `@Testchanalvibe`.

**Ключевые узлы движка (уже есть, переиспользуем):**
- `server/src/lib/draftGenerator.ts` → `createDraftPostForChannel(...)` — оркестратор генерации одного поста (текст → рубрика → обложка → rich-блоки). **Дёргаем N раз.**
- `server/src/lib/scheduler.ts` — poller 60 с, публикует посты `status=SCHEDULED` по `scheduledAt` + purge просроченных. **«Закинуть в отложку» = создать посты с датами.**
- `server/src/lib/webSearch.ts` (Serper→Tavily), `urlContentExtractor.ts` (`fetchArticle`) — research-кирпичи.
- `server/src/routes/chat.ts` — AI-ассистент (DeepSeek tool-loop с `web_search`; HIGH-путь = Claude на Replicate, без tool-calling).
- BrandKit (6 JSON-секций) хранит `visualKit.rubrics` — рубрики канала (обложки по рубрике).
- Модель `GenerationJob`/`JobStatus` в схеме есть, но НЕ переиспользуем (завязана на `SourceInput`).

---

## 1. Что делаем: видение фичи

Пользователь общается с **AI-ассистентом** (обычный чат) и просит собрать **серию постов**: например «сделай мини-курс по трейдингу, план на 2 недели, по 1 посту в день, источники — Binance Academy». Ассистент **задаёт уточняющие вопросы в чате**, затем строит план, показывает **карточку плана + кнопку «Приступить»**. По нажатию фоновый воркер **исследует каждую тему, генерирует посты с обложками по рубрике и раскидывает их в Отложку**. Пользователь просматривает/правит их в Отложке до времени публикации.

Вторая часть: пользователь загружает **материалы проекта** (PDF-презентация, whitepaper/«Белая бумага», roadmap, тех-доки) в **Стиль канала**. Ассистент их видит и может делать серию «на базе whitepaper».

---

## 2. Залоченные решения (это финал, не пересматриваем без причины)

**UX (пользователь был категоричен):**
- **Точка входа — только AI-ассистент (чат).** НЕТ третьего режима в Create. НЕТ отдельного экрана-редактора плана (ручная история не нравится).
- Ассистент задаёт **уточняющие вопросы в чате** (с какого дня ставить отложку — чтобы было время просмотреть; какая рубрика; сколько постов/за сколько дней; источники web/доки).
- **Ревью-гейт = кнопка «Приступить» в карточке чата** (явная), НЕ парсинг «да» и НЕ редактируемый список из 14 элементов.
- **Настоящее ревью = Отложка** после генерации (задержка старт-даты даёт время просмотреть/поправить).

**Форки (зафиксированы):**
- Ревью-гейт: **ДА** (лёгкий — карточка + кнопка).
- Глубина research: **глубокий** (3–5 статей на пост).
- Доки проекта: **входят в MVP**.
- Периодичность: **разовый запуск** (крон-автопилот — позже).

**Сплит моделей (важно):**
- Интерактивный ассистент и уточняющие вопросы — остаются на **DeepSeek** (дёшево, быстро, tool-loop уже работает).
- **Глубокий research + синтез постов** — на **Opus 4.8** (`claude-opus-4-8`, $5/$25 за 1M, контекст 1M).
- Переключение — **по задаче, а не по сообщению**: Opus включается только после «Приступить», в живом чате модель не меняется.
- Два способа подключить Opus:
  - **A) через Replicate** (`replicateText`) — плоский `prompt→text`, БЕЗ веб-инструментов; research (Serper+fetchArticle) на нас, Opus только синтезирует.
  - **B) через Anthropic API напрямую (рекомендуется)** — `@anthropic-ai/sdk` + `ANTHROPIC_API_KEY` разблокирует нативные серверные инструменты Opus `web_search` + `web_fetch` (динамическая фильтрация + цитаты) → Opus сам ищет и читает источники. Глубже, чем текущий Serper+fetchArticle.
- Planner / классификаторы / slot-fill обложек / вёрстка — остаются DeepSeek.

---

## 3. Архитектура

### 3.1 Модель данных (новая миграция Prisma)

```prisma
enum ContentPlanStatus { DRAFT GENERATING SCHEDULED FAILED CANCELLED }
enum PlanItemStatus    { PENDING RESEARCHING GENERATING DONE FAILED SKIPPED }

model ProjectDoc {                 // база знаний канала
  id String @id @default(cuid())
  channelId String
  name String; mime String; sizeBytes Int
  text String                      // извлечённый текст, cap ~200k символов
  createdAt DateTime @default(now())
  channel Channel @relation(fields:[channelId], references:[id], onDelete: Cascade)
  @@index([channelId])
}

model ContentPlan {
  id String @id @default(cuid())
  channelId String
  topic String; postsPerDay Int; days Int; startDate DateTime
  source String                    // 'web' | 'uploads' | 'both'
  status ContentPlanStatus @default(DRAFT)
  errorMessage String?
  createdAt DateTime @default(now()); updatedAt DateTime @updatedAt
  channel Channel @relation(...); items ContentPlanItem[]
  @@index([channelId])
}

model ContentPlanItem {
  id String @id @default(cuid())
  planId String; orderIndex Int; scheduledAt DateTime
  rubricId String?; rubricName String?
  workingTitle String; angle String; searchQuery String
  status PlanItemStatus @default(PENDING)
  generatedPostId String?          // ссылка на созданный GeneratedPost
  errorMessage String?
  plan ContentPlan @relation(fields:[planId], references:[id], onDelete: Cascade)
  @@index([planId])
}
```

### 3.2 Бэкенд — новые модули (`server/src/lib/`)

- **`researchEngine.ts`** — `research(query, {backend})`: `opus` (Anthropic SDK + `web_search`/`web_fetch`) или `deepseek` (текущий Serper + fetchArticle → синтез). Возвращает собранный материал + источники. Serper/Tavily — fallback, если нет `ANTHROPIC_API_KEY`.
- **`contentPlanner.ts`** — `generateContentPlan(params)`: грузит BrandKit (`channelAbout`, `voiceProfile`, `visualKit.rubrics`) + тексты `ProjectDoc` (если source=uploads/both) → LLM (DeepSeek) отдаёт строгий JSON на `N = postsPerDay×days` элементов `{дата, время, rubricId, workingTitle, angle, searchQuery}`. Рубрики round-robin без повторов подряд. **Авто-создаёт рубрику** (напр. «Learn»/«Обучение») в `visualKit.rubrics`, если её нет.
- **`docExtractor.ts`** — `extractDocText(buffer, mime)`. Новые зависимости: `pdf-parse` (PDF), `mammoth` (DOCX), MD/TXT as-is. Cap по размеру.
- **`contentWorker.ts`** — `runContentPlan(planId)`: строго **последовательно** по элементам (критично для 1.9 ГБ бокса — Chromium/картинки нельзя параллелить; in-flight lock; resume GENERATING-планов на старте). Для каждого элемента:
  1. **Research (глубокий):** `researchEngine.research(item.searchQuery, {backend:'opus'})` (+ куски `ProjectDoc`).
  2. **Синтез поста:** на Opus (качество мини-курса) — материал → пост в голосе канала.
  3. **Генерация:** `createDraftPostForChannel({ channelId, input: пост, sourceType:'plan', forcedRubric })` → обложка по рубрике + rich-блоки.
  4. **Планирование:** пост → `status=SCHEDULED`, `scheduledAt` = слот из плана; `item.status=DONE`, `generatedPostId`.
  - Per-item try/catch: сбой → `SKIPPED`, план продолжается. Прогресс n/14.

**Одна хирургическая правка существующего кода:** в `draftGenerator.ts` добавить опциональный `forcedRubric?: {id,name,mode,templateUrl?,hybridPrompt?}` в `CreateDraftParams` — если передан, пропускаем `classifyPostRubric` и берём готовую рубрику из плана. Всё остальное — оркестрация поверх.

### 3.3 Роуты (`server/src/routes/contentPlan.ts` + `projectDocs.ts`)
Все с валидацией initData (HMAC) + проверкой владения (как везде):
- **Агентная способность в `/api/chat`:** ассистенту (DeepSeek tool-loop, у него уже есть `web_search`) добавить инструмент `create_content_plan_draft(...)`. Инструмент строит `ContentPlan(DRAFT)`+items (через `contentPlanner`), а ответ чата несёт структурный `plan`-объект → `ChatScreen` рисует **карточку плана + кнопку «Приступить»**. (HIGH-путь Claude на Replicate tool-calling не умеет — планирование всегда через DeepSeek.)
- `POST /api/content-plan/:id/confirm` → **квота-гейт** (нужно ≥ N свободных `aiPostsLimit`), `status=GENERATING`, запуск воркера в фоне, `200`.
- `GET /api/content-plan/:id` → статус + прогресс по элементам (poll n/14).
- `POST /api/content-plan/:id/cancel` → отмена (останов после текущего элемента; уже созданные SCHEDULED-посты можно снять).
- `POST /api/content-plan/list`.
- `POST /api/project-docs/{upload,list,delete}` (multipart, multer как в brandkits).

**Env (`server/src/env.ts`):** `ANTHROPIC_API_KEY`, `CONTENT_RESEARCH_MODEL` (default `claude-opus-4-8`), флаг backend research (`opus` | `deepseek`). Зависимости сервера: `@anthropic-ai/sdk`, `pdf-parse`, `mammoth`.

**Гейтинг:** фича тяжёлая → предлагаю CREATOR+ (как расписание). Каждый пост серии считается против месячной квоты `aiPostsLimit` (14 постов = 14 из квоты).

### 3.4 Фронтенд
- **НЕТ нового режима в Create.** Точка входа — `ChatScreen`.
- `ChatScreen` рендерит **карточку плана** (тема, N постов, период, рубрика, дата старта, источники) + кнопку **«Приступить»**, когда ответ `/api/chat` несёт `plan`. Кнопка → `/confirm`. Затем **живой прогресс** в карточке (poll `/api/content-plan/:id`, n/14). Готовые посты появляются в **Posts → Отложка**.
- `BrandKitScreen` получает новую секцию **«Материалы проекта»**: загрузка PDF/DOCX/MD → `ProjectDoc`, список, удаление. Ассистент видит доки (в системном промпте — названия + краткие выжимки; планировщик берёт полный текст при «на базе whitepaper»).

---

## 4. Порядок реализации (MVP)

1. ✅ **СДЕЛАНО** Миграция + модели (`ProjectDoc`, `ContentPlan`, `ContentPlanItem`). Enums `ContentPlanStatus`/`PlanItemStatus`, back-relations в `Channel`. Миграция `20260708120000_add_content_manager`. (`ContentPlan.source` default `'web'`; добавлен `@@index([status])` под resume-запрос воркера.)
2. ✅ **СДЕЛАНО** `docExtractor.ts` (⚠️ pdf-parse **v2** — классовый API `new PDFParse({data}).getText()`, не v1-функция; свои типы, `@types/pdf-parse` НЕ нужен) + роуты `server/src/routes/projectDocs.ts` (`/upload` `/list` `/delete`, POST, initData+ownership, multer 15 МБ, cap 20 доков/канал) зарегистрированы в `index.ts` как `/api/project-docs` + UI-секция «Материалы проекта» (`ProjectDocsForm.tsx` + пункт `projectDocs` в `BrandKitScreen`, i18n ru/en). Рантайм-тест извлечения (md/txt/pdf/reject) пройден.
3. ✅ **СДЕЛАНО** `server/src/lib/researchEngine.ts` — `research(query, {backend, extraContext})`. Backend `opus`: Anthropic SDK (`@anthropic-ai/sdk`), модель `claude-opus-4-8`, adaptive thinking + `output_config.effort='medium'`, нативные серверные тулзы `web_search_20260209`/`web_fetch_20260209`, обработка `stop_reason='pause_turn'` (resume-луп, guard 8). Backend `deepseek`: `webSearch` (Serper/Tavily) → `fetchArticle` top-4 → DeepSeek-синтез. Fallback opus→deepseek если нет `ANTHROPIC_API_KEY` или Opus упал. Env: `ANTHROPIC_API_KEY`, `CONTENT_RESEARCH_MODEL` (default `claude-opus-4-8`), `CONTENT_RESEARCH_BACKEND` (auto: opus при ключе, иначе deepseek) — в `env.ts` + `.env.example`. Рантайм-смоук: резолв backend, graceful-degradation без ключей, CJS-импорт SDK — ок.
4. ✅ **СДЕЛАНО** `server/src/lib/contentPlanner.ts` — `generateContentPlan(params)`: грузит BrandKit + (при source uploads/both) `ProjectDoc`, DeepSeek генерит N items (workingTitle/angle/searchQuery), рубрики в коде (round-robin по существующим; `rubricHint` → одна рубрика, авто-создание при отсутствии; персист в `visualKit.rubrics`), слоты по дню (09–21), clamp (≤5/день, ≤14 дн, ≤30 всего), создаёт `ContentPlan(DRAFT)`+items, возвращает DTO. Инструмент `create_content_plan_draft` в `chat.ts` (гейт `canUseContentManager`=CREATOR+ в `subscriptionLimits.ts`) + гайд в системном промпте (уточняющие вопросы → вызов тула → короткое подтверждение); обработка в tool-loop, `plan` в ответе `/api/chat`. Фронт: типы `ContentPlan`/`ContentPlanItem` + `plan?` в `ChatMessage`, компонент `PlanCard` (тема, N/период/старт/источник/рубрики, превью 4 заголовков, кнопка «Приступить») в `ChatScreen`; `App.tsx` прокидывает `plan`, `handleConfirmPlan` (POST `/confirm`), `confirmingPlanId`. tsc (сервер+фронт) + vite build чисто. ⚠️ Кнопка «Приступить» бьёт в `/api/content-plan/:id/confirm` — роут появится в шаге 5 (сейчас 404 → сообщение об ошибке).
5. ✅ **СДЕЛАНО** `draftGenerator.ts`: `forcedRubric?: {id,name}` в `CreateDraftParams` — ветка минует `classifyPostRubric`, резолвит mode/template из `visualKit.rubrics` по id (fallback plain 'ai'). `contentWorker.ts` — single-flight очередь (`enqueueContentPlan`/`pump`, один план за раз), `runContentPlan`: по элементам последовательно RESEARCHING→(`research`)→GENERATING→(`createDraftPostForChannel({forcedRubric, modelTier})`)→пост `SCHEDULED` на слот→item DONE (+`aiPostsUsed++`); сбой→SKIPPED, план продолжается; cancel-чек перед каждым элементом; `resumeGeneratingPlans()` при старте (вызван в `index.ts`). Роуты `routes/contentPlan.ts` (`/api/content-plan`): `POST /:id/confirm` (гейт CREATOR+ + квота-гейт ≥N свободных `aiPostsLimit`, status=GENERATING, enqueue), `GET /:id` (poll: status + processed/total + counts), `POST /:id/cancel` (CANCELLED + снять SCHEDULED-посты в ARCHIVED), `POST /list`. Фронт: `PlanCard` статусы GENERATING/SCHEDULED/FAILED/CANCELLED + «Генерирую n/N», `App.tsx` `pollPlan` (setTimeout 4s, cap ~13мин, cleanup на unmount). Публикация: движок `scheduler.ts` уже сам публикует `SCHEDULED` по `scheduledAt` — воркер только ставит статус+дату. tsc (сервер+фронт) + import-смоук + vite build чисто. Реальный e2e — в шаге 6 (нет БД/ключей/Telegram в сессии).
6. Квота-гейт (✅ в confirm) — остаётся cancel-кнопка в UI (роут готов), тест на `@Testchanalvibe`, деплой.

---

## 5. Риски и как закрыты
- **Автопост без глаза** → посты лежат SCHEDULED, юзер видит календарь и может отменить/поправить до времени.
- **Стоимость** (Opus: ~$0.2–0.5/пост → ~$3–7 за недельный план) → гейт на CREATOR+, квота, backend research конфигом (лёгкий DeepSeek vs глубокий Opus по тарифу).
- **Память бокса (1.9 ГБ)** → строго последовательный воркер + один план на инстанс за раз; на всплесках апнуть RAM до 4 ГБ.
- **Модерация обложки (E005 у gpt-image-2)** → мягкий fallback уже в движке.
- **Качество из доков** → на старте truncate+chunk в промпт, без эмбеддингов.

---

## 6. Как продолжить в новой сессии
1. Память подхватится сама (`MEMORY.md`). Прочитать `content-automation-plan.md` — там сжато то же самое.
2. Открыть этот файл (`docs/content-manager-plan.md`) — полный план.
3. Начать с шага 1 порядка реализации. Перед кодом стоит войти в plan mode и сверить конкретные правки.
4. Точки касания в существующем коде: `draftGenerator.ts` (forcedRubric), `chat.ts` (новый инструмент), `scheduler.ts` (публикует SCHEDULED — не трогаем), `env.ts` (ключи), `ChatScreen.tsx` + `BrandKitScreen.tsx` (UI).

_Актуальная модель Claude: Opus 4.8 = `claude-opus-4-8`. Adaptive thinking, без `temperature`/`budget_tokens`. Нативные серверные инструменты `web_search_20260209` / `web_fetch_20260209` (динамическая фильтрация + цитаты) поддерживаются._
