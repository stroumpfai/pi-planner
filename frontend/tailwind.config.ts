import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        canvas: 'rgb(var(--color-canvas) / <alpha-value>)',
        band:   'rgb(var(--color-band)   / <alpha-value>)',
      },
      boxShadow: {
        'soft':       'var(--shadow-soft)',
        'soft-sm':    'var(--shadow-soft-sm)',
        'soft-inset': 'var(--shadow-soft-inset)',
        'soft-hover': 'var(--shadow-soft-hover)',
      },
      borderRadius: {
        'xl2': '14px',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
}

export default config
