import { cn } from '@/lib/utils'
import { motion } from 'framer-motion'

interface ButtonProps {
  children: React.ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  onClick?: () => void
  disabled?: boolean
  className?: string
  fullWidth?: boolean
  type?: 'button' | 'submit'
}

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  onClick,
  disabled,
  className,
  fullWidth,
  type = 'button',
}: ButtonProps) {
  const variants = {
    primary: 'bg-[#FF6A00] text-white font-semibold hover:bg-[#ff7a1a] active:bg-[#e55f00]',
    secondary: 'bg-white/[0.05] text-white border border-white/[0.07] hover:bg-white/[0.09]',
    ghost: 'text-[#A1A1AA] hover:text-white hover:bg-white/5',
    danger: 'bg-red-500/12 text-red-400 border border-red-500/16 hover:bg-red-500/20',
  }

  const sizes = {
    sm: 'px-3 py-1 text-[13px] rounded-[10px] min-h-[32px]',
    md: 'px-4 py-2 text-[13px] rounded-[12px] min-h-[38px]',
    lg: 'px-5 py-2.5 text-sm rounded-[14px] min-h-[46px]',
  }

  return (
    <motion.button
      type={type}
      whileTap={{ scale: disabled ? 1 : 0.97 }}
      transition={{ duration: 0.1 }}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 font-medium transition-colors duration-150 select-none',
        variants[variant],
        sizes[size],
        fullWidth && 'w-full',
        disabled && 'opacity-40 cursor-not-allowed',
        className
      )}
    >
      {children}
    </motion.button>
  )
}
