import { useState } from 'react'
import { Calendar } from 'lucide-react'
import { Sheet } from '@/components/ui/Sheet'
import { Button } from '@/components/ui/Button'
import { addHours, format } from 'date-fns'

interface ScheduleSheetProps {
  open: boolean
  onClose: () => void
  onSchedule: (date: Date) => void
}

const presets = [
  { label: 'In 1 hour', hours: 1 },
  { label: 'In 2 hours', hours: 2 },
  { label: 'In 6 hours', hours: 6 },
  { label: 'Tomorrow 9 AM', hours: null },
]

export function ScheduleSheet({ open, onClose, onSchedule }: ScheduleSheetProps) {
  const [selected, setSelected] = useState<number | null>(null)
  const [custom, setCustom] = useState('')

  const handlePreset = (hours: number | null, i: number) => {
    setSelected(i)
    if (hours !== null) {
      const date = addHours(new Date(), hours)
      setCustom(format(date, "yyyy-MM-dd'T'HH:mm"))
    } else {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(9, 0, 0, 0)
      setCustom(format(tomorrow, "yyyy-MM-dd'T'HH:mm"))
    }
  }

  const handleSchedule = () => {
    const date = custom ? new Date(custom) : addHours(new Date(), 1)
    onSchedule(date)
    onClose()
  }

  return (
    <Sheet open={open} onClose={onClose} title="Schedule Post" height="auto">
      <div className="space-y-4 pt-2">
        <div className="grid grid-cols-2 gap-2">
          {presets.map((p, i) => (
            <button
              key={i}
              onClick={() => handlePreset(p.hours, i)}
              className={`px-3 py-2.5 rounded-[14px] text-sm font-medium border transition-all duration-150 ${
                selected === i
                  ? 'bg-[rgba(255,106,0,0.12)] border-[rgba(255,106,0,0.40)] text-[#FF6A00]'
                  : 'bg-white/4 border-white/8 text-[#A1A1AA] hover:bg-white/8'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[#66666E] uppercase tracking-wide">Custom time</label>
          <input
            type="datetime-local"
            value={custom}
            onChange={e => { setCustom(e.target.value); setSelected(null) }}
            className="glass-input w-full px-3 py-2.5 text-sm text-white"
            style={{ colorScheme: 'dark' }}
          />
        </div>

        <div className="flex gap-2 pt-1">
          <Button variant="secondary" onClick={onClose} fullWidth>Cancel</Button>
          <Button variant="primary" onClick={handleSchedule} fullWidth>
            <Calendar size={14} />
            Schedule
          </Button>
        </div>
      </div>
    </Sheet>
  )
}
