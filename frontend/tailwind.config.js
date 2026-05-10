/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx,html}",
    "./src/**/*.js",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Poppins', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          950: 'color-mix(in srgb, var(--color-primary), black 50%)',
          900: 'var(--color-primary)',
          800: 'color-mix(in srgb, var(--color-primary), white 15%)',
          700: 'color-mix(in srgb, var(--color-primary), white 30%)',
          600: 'color-mix(in srgb, var(--color-primary), white 45%)',
          500: 'color-mix(in srgb, var(--color-primary), white 60%)',
          400: 'color-mix(in srgb, var(--color-primary), white 75%)',
          300: 'color-mix(in srgb, var(--color-primary), white 85%)',
          200: 'color-mix(in srgb, var(--color-primary), white 90%)',
          100: 'color-mix(in srgb, var(--color-primary), white 95%)',
        },
        neon: {
          500: 'var(--color-secondary)',
          400: 'color-mix(in srgb, var(--color-secondary), white 30%)',
          300: 'color-mix(in srgb, var(--color-secondary), white 60%)',
        },
        glass: {
          white: 'rgba(255,255,255,0.08)',
          border: 'rgba(255,255,255,0.12)',
        },
      },
      backdropBlur: {
        xs: '2px',
        glass: '16px',
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'fade-in': 'fadeIn 0.4s ease-out',
        'slide-up': 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        'ping-slow': 'ping 2s cubic-bezier(0, 0, 0.2, 1) infinite',
        'bounce-soft': 'bounceSoft 1s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(24px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        bounceSoft: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-6px)' },
        },
      },
    },
  },
  plugins: [],
}
