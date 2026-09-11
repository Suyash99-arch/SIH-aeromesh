/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        aeromesh: {
          bg: "#050811",
          card: "#080e1e",
          cardHover: "#0c152d",
          cardBorder: "#132142",
          cardBorderHover: "#1d356a",
          darkNavy: "#0a1122",
          surface: "#0c162e",
          surfaceLight: "#101e3d",
          accentBlue: "#1a6aff",
          accentCyan: "#00d2ff",
          cyanGlow: "rgba(0, 210, 255, 0.35)",
          electricBlue: "#2563eb",
          mutedText: "#8ea3bf",
          dimText: "#526885",
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      boxShadow: {
        'glow-cyan': '0 0 25px -5px rgba(0, 210, 255, 0.3)',
        'glow-cyan-lg': '0 0 45px -8px rgba(0, 210, 255, 0.45)',
        'glow-blue': '0 0 25px -5px rgba(37, 99, 235, 0.4)',
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.45)',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pulse-fast': 'pulse 1.5s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'float': 'float 4s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        }
      }
    },
  },
  plugins: [],
}
