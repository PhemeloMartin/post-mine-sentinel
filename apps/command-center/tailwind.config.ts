import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        void: '#03060d',
        deck: '#070d1a',
        panel: 'rgba(9, 18, 34, 0.78)',
        edge: 'rgba(56, 189, 248, 0.22)',
        cyan: { glow: '#22d3ee' },
        signal: {
          operating: '#22d3ee',
          restarted: '#38bdf8',
          care: '#f59e0b',
          closed: '#fb923c',
          derelict: '#ef4444',
          rehab: '#34d399',
        },
      },
      fontFamily: {
        display: ['Orbitron', 'Rajdhani', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      boxShadow: {
        hud: '0 0 0 1px rgba(56,189,248,0.18), 0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.04)',
        glow: '0 0 18px rgba(34,211,238,0.35)',
      },
      keyframes: {
        pulseRing: { '0%': { transform: 'scale(0.9)', opacity: '0.9' }, '100%': { transform: 'scale(1.6)', opacity: '0' } },
        scan: { '0%': { backgroundPosition: '0 0' }, '100%': { backgroundPosition: '0 100%' } },
      },
      animation: {
        pulseRing: 'pulseRing 1.6s ease-out infinite',
        scan: 'scan 8s linear infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
