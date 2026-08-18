import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, RefreshCw, ShieldCheck, Users } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { API_BASE } from '@/lib/api'
import { moderatorFetch } from '@/lib/telegram'
import type { Channel } from '@/types'

interface AvailableChat {
  id: string
  title: string
  username: string | null
  botStatus: string
}

export function ConnectChatSheet({ open, onClose, onConnected }: { open: boolean; onClose: () => void; onConnected: (chat: Channel) => void }) {
  const [chats, setChats] = useState<AvailableChat[]>([])
  const [botUsername, setBotUsername] = useState('publium_moder_bot')
  const [loading, setLoading] = useState(false)
  const [connectingId, setConnectingId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await moderatorFetch(`${API_BASE}/api/moderator/available-chats`)
      const data = await response.json() as { chats?: AvailableChat[]; botUsername?: string; error?: string }
      if (!response.ok) throw new Error(data.error ?? 'Не удалось получить список групп')
      setChats(data.chats ?? [])
      if (data.botUsername) setBotUsername(data.botUsername)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось получить список групп')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (open) void load() }, [open, load])

  const addBot = () => {
    window.open(`https://t.me/${botUsername}?startgroup=publium&admin=delete_messages+restrict_members`, '_blank', 'noopener,noreferrer')
  }

  const connect = async (chat: AvailableChat) => {
    if (connectingId) return
    setConnectingId(chat.id)
    setError('')
    try {
      const response = await moderatorFetch(`${API_BASE}/api/moderator/chats/${chat.id}/connect`, { method: 'POST' })
      const data = await response.json() as { channel?: Channel; error?: string }
      if (!response.ok || !data.channel) throw new Error(data.error ?? 'Не удалось подключить чат')
      onConnected(data.channel)
      onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось подключить чат')
    } finally {
      setConnectingId(null)
    }
  }

  return <Sheet open={open} onClose={onClose} title="Подключить чат" height="auto">
    <div className="space-y-4 pt-1">
      <div className="space-y-2.5">
        <Step number={1} text={`Добавьте @${botUsername} администратором нужной группы`} />
        <Step number={2} text="Разрешите удалять сообщения и ограничивать участников" />
        <Step number={3} text="Вернитесь сюда, обновите список и выберите группу" />
      </div>

      <Button variant="primary" size="lg" fullWidth onClick={addBot}><ShieldCheck size={16}/> Добавить бота в группу</Button>

      <div className="flex items-center justify-between border-t border-white/[0.07] pt-3">
        <p className="text-[12px] font-semibold text-white">Доступные группы</p>
        <button type="button" onClick={()=>void load()} disabled={loading} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[11px] px-3 text-[11px] font-medium text-[#8A8A93] transition-colors hover:bg-white/[0.05] hover:text-white disabled:cursor-wait"><RefreshCw size={14} className={loading?'animate-spin':''}/> Обновить</button>
      </div>

      {loading&&chats.length===0?<div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-[#FF6A00]"/></div>:chats.length===0?<div className="rounded-[14px] border border-white/[0.07] bg-white/[0.025] px-4 py-5 text-center"><Users size={20} className="mx-auto text-[#55555D]"/><p className="mt-2 text-[12px] font-medium text-white">Группы пока не найдены</p><p className="mt-1 text-[11px] leading-relaxed text-[#777780]">После добавления бота вернитесь в Publium и нажмите «Обновить».</p></div>:<div className="space-y-2">{chats.map(chat=><button key={chat.id} type="button" onClick={()=>void connect(chat)} disabled={connectingId!==null} className="flex min-h-16 w-full cursor-pointer items-center gap-3 rounded-[14px] border border-white/[0.08] bg-white/[0.025] px-3.5 py-3 text-left transition-colors hover:border-[rgba(255,106,0,0.28)] hover:bg-white/[0.045] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF6A00] disabled:cursor-wait disabled:opacity-60"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-[rgba(255,106,0,0.11)] text-[#FF6A00]"><Users size={16}/></span><span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-medium text-white">{chat.title}</span><span className="mt-0.5 block text-[11px] text-[#66666E]">{chat.username?`@${chat.username}`:'Приватная группа'}</span></span>{connectingId===chat.id?<Loader2 size={16} className="animate-spin text-[#FF6A00]"/>:<Check size={16} className="text-[#55555D]"/>}</button>)}</div>}

      {error&&<p role="alert" className="rounded-[12px] border border-red-400/15 bg-red-400/[0.07] px-3 py-2.5 text-[12px] leading-relaxed text-red-300">{error}</p>}
    </div>
  </Sheet>
}

function Step({ number, text }: { number: number; text: string }) {
  return <div className="flex items-start gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.05] text-[10px] font-bold text-[#777780]">{number}</span><p className="pt-0.5 text-[13px] leading-snug text-[#A1A1AA]">{text}</p></div>
}
