import { motion } from 'framer-motion'
import { FileText, Sparkles, User } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tab = 'posts' | 'create' | 'profile'

interface NavItem {
  id: Tab
  label: string
  icon: React.ElementType
}

const navItems: NavItem[] = [
  { id: 'posts', label: 'Posts', icon: FileText },
  { id: 'create', label: 'Create', icon: Sparkles },
  { id: 'profile', label: 'Profile', icon: User },
]

interface BottomNavProps {
  active: Tab
  onChange: (tab: Tab) => void
}

export function BottomNav({ active, onChange }: BottomNavProps) {
  return (
    <nav className="bottom-nav flex items-center px-2">
      {navItems.map(item => {
        const isActive = item.id === active
        const Icon = item.icon
        return (
          <motion.button
            key={item.id}
            onClick={() => onChange(item.id)}
            whileTap={{ scale: 0.92 }}
            transition={{ duration: 0.1 }}
            className={cn(
              'relative flex-1 flex flex-col items-center justify-center gap-0.5 h-[46px] rounded-[40px] transition-colors duration-200',
              isActive ? 'text-[#FF6A00]' : 'text-[#66666E] hover:text-[#A1A1AA]'
            )}
          >
            {isActive && (
              <motion.div
                layoutId="nav-active-bg"
                className="absolute inset-0 rounded-[40px] bg-[rgba(255,106,0,0.09)]"
                transition={{ type: 'spring', bounce: 0.2, duration: 0.35 }}
              />
            )}
            <Icon size={18} strokeWidth={isActive ? 2.1 : 1.7} className="relative z-10" />
            <span className={cn(
              'relative z-10 text-[10px] font-semibold tracking-wide',
              isActive ? 'text-[#FF6A00]' : 'text-[#66666E]'
            )}>
              {item.label}
            </span>
          </motion.button>
        )
      })}
    </nav>
  )
}
