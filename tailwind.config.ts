import type { Config } from 'tailwindcss'

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bg: '#070708',
        surface: 'rgba(255,255,255,0.04)',
        card: 'rgba(255,255,255,0.06)',
        'card-strong': '#141417',
        border: 'rgba(255,255,255,0.10)',
        'text-primary': '#FFFFFF',
        'text-secondary': '#A1A1AA',
        'text-muted': '#66666E',
        orange: {
          DEFAULT: '#FF6A00',
          soft: 'rgba(255,106,0,0.16)',
          border: 'rgba(255,106,0,0.38)',
          glow: 'rgba(255,106,0,0.28)',
        },
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        '2xl': '16px',
        '3xl': '22px',
        '4xl': '28px',
      },
      backdropBlur: {
        xs: '4px',
      },
    },
  },
  plugins: [],
} satisfies Config
