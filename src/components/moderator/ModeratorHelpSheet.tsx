import { CircleHelp, Lightbulb, Settings2 } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'

export type ModeratorHelpKind = 'welcome' | 'captcha' | 'antispam' | 'filters'

type HelpSection = { title: string; text?: string; items?: string[]; example?: string }

const HELP: Record<ModeratorHelpKind, { title: string; intro: string; sections: HelpSection[] }> = {
  welcome: {
    title: 'Как работает приветствие',
    intro: 'Сообщение встречает нового участника после вступления и, если включена CAPTCHA, только после успешной проверки.',
    sections: [
      { title: 'Что можно настроить', items: ['Текст с форматированием, изображение и до трёх кнопок-ссылок.', 'Переменные {name}, {username}, {group}, {channel} и {rules} подставляются перед отправкой.', 'Автоудаление приветствия и служебного сообщения Telegram, а также поведение при повторном вступлении.'] },
      { title: 'Пример', example: 'Добро пожаловать, {name}! Сначала прочитайте {rules}, затем расскажите пару слов о себе.' },
      { title: 'Рекомендация', text: 'Делайте сообщение коротким: одно действие в тексте и отдельная кнопка «Правила». Автоудаление через 10–30 минут помогает не засорять чат.' },
    ],
  },
  captcha: {
    title: 'Как работает CAPTCHA',
    intro: 'Moderator временно ограничивает новичка и просит нажать кнопку. После подтверждения ограничения снимаются, затем отправляется приветствие.',
    sections: [
      { title: 'Основные настройки', items: ['Текст и подпись кнопки видит новый участник.', 'Таймер задаёт срок проверки: после него участник удаляется или остаётся ограниченным.', 'CAPTCHA может удаляться сразу после успеха.', 'Администраторов, ботов и доверенных участников можно не проверять.'] },
      { title: 'Пример', example: '**{name}**, подтвердите, что вы человек. Нажмите «Я человек» в течение 5 минут.' },
      { title: 'Рекомендация', text: 'Для обычного сообщества начните с 5 минут и удаления из группы по таймауту. Пропуск администраторов, ботов и доверенных лучше оставить включённым.' },
    ],
  },
  antispam: {
    title: 'Как работает антиспам',
    intro: 'Антиспам ловит массовое поведение: слишком частые сообщения, одинаковые повторы и нежелательные ссылки.',
    sections: [
      { title: 'Антифлуд', text: 'Считает сообщения одного участника в скользящем интервале. При лимите 6 за 10 секунд сработает на сообщении, которое превысило разрешённый порог.' },
      { title: 'Повторы', text: 'Сравнивает нормализованный текст: регистр и лишние пробелы не помогают обойти проверку. Настройте число одинаковых сообщений и период.' },
      { title: 'Ссылки', items: ['«Разрешить все» — антиспам не ограничивает ссылки.', '«Запретить все» — удаляется любое сообщение со ссылкой.', '«Разрешённые домены» — проходят только сайты из белого списка, например telegram.org.'] },
      { title: 'Важно: это не чёрный список', text: 'Здесь задаётся общая политика ссылок. Если ссылки в целом разрешены, но нужно запретить несколько опасных сайтов, используйте «Домены» в фильтрах контента.' },
      { title: 'Рекомендация', text: 'Начните с 6 сообщений за 10 секунд и 3 повторов за минуту. Для открытого чата оставьте ссылки разрешёнными и блокируйте только опасные домены в фильтрах.' },
    ],
  },
  filters: {
    title: 'Как работают фильтры',
    intro: 'Фильтры проверяют содержимое отдельного сообщения: слова и фразы, шаблоны текста, конкретные домены, оформление и тип вложения.',
    sections: [
      { title: 'Слова и домены', items: ['Стоп-слова ищутся без учёта регистра; можно указывать фразы.', 'Запрещённые домены — чёрный список: остальные ссылки продолжают работать.', 'Это отличается от белого списка антиспама, который запрещает всё, кроме перечисленного.'] },
      { title: 'Regex-паттерны', text: 'Regex — шаблон для вариантов одного выражения. Например, \\bpromo[-_ ]?code\\b найдёт promo-code, promo_code и promo code. Регистр уже игнорируется автоматически.' },
      { title: 'Поведение и вложения', items: ['Можно ограничить число упоминаний, долю CAPS и количество эмодзи.', 'Отдельно блокируются пересланные и отредактированные сообщения.', 'Для фото, видео, файлов, голосовых, стикеров и других вложений есть отдельные переключатели.'] },
      { title: 'Рекомендация', text: 'Сначала используйте стоп-слова и чёрный список доменов. Regex добавляйте только когда обычного слова недостаточно, и проверяйте шаблон на реальных примерах, чтобы не удалить нормальные сообщения.' },
    ],
  },
}

export function ModeratorInfoButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] text-[#777780] transition-colors hover:bg-white/[0.06] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00]">
      <CircleHelp size={18} />
    </button>
  )
}

export function ModeratorHelpSheet({ kind, open, onClose }: { kind: ModeratorHelpKind; open: boolean; onClose: () => void }) {
  const help = HELP[kind]
  return (
    <Sheet open={open} onClose={onClose} title={help.title} height="80">
      <div className="space-y-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="flex gap-3 rounded-[16px] border border-[rgba(255,106,0,0.18)] bg-[rgba(255,106,0,0.08)] p-3.5">
          <CircleHelp size={18} className="mt-0.5 shrink-0 text-[#FF6A00]" />
          <p className="text-[13px] leading-relaxed text-[#D4D4D8]">{help.intro}</p>
        </div>
        {help.sections.map((section, index) => (
          <section key={section.title} className="rounded-[16px] border border-white/[0.07] bg-white/[0.025] p-4">
            <div className="flex items-center gap-2">
              {index === help.sections.length - 1 ? <Lightbulb size={15} className="text-[#FF6A00]" /> : <Settings2 size={15} className="text-[#777780]" />}
              <h3 className="text-[13px] font-semibold text-white">{section.title}</h3>
            </div>
            {section.text && <p className="mt-2 text-[12px] leading-relaxed text-[#A1A1AA]">{section.text}</p>}
            {section.items && <ul className="mt-2 space-y-2">{section.items.map(item => <li key={item} className="flex gap-2 text-[12px] leading-relaxed text-[#A1A1AA]"><span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[#FF6A00]" />{item}</li>)}</ul>}
            {section.example && <div className="mt-3 rounded-[11px] border border-white/[0.06] bg-black/20 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-[#D4D4D8]">{section.example}</div>}
          </section>
        ))}
      </div>
    </Sheet>
  )
}
