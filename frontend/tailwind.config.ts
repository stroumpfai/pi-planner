import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
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
        canvas: '#f0f4f8',
      },
      boxShadow: {
        'soft': '4px 4px 10px rgba(163,177,198,0.6), -4px -4px 10px rgba(255,255,255,0.8)',
        'soft-sm': '2px 2px 6px rgba(163,177,198,0.5), -2px -2px 6px rgba(255,255,255,0.7)',
        'soft-inset': 'inset 3px 3px 8px rgba(163,177,198,0.5), inset -3px -3px 8px rgba(255,255,255,0.7)',
        'soft-hover': '6px 6px 14px rgba(163,177,198,0.7), -6px -6px 14px rgba(255,255,255,0.95)',
      },
      borderRadius: {
        'xl2': '14px',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
}

export default config
