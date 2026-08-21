/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: ['selector', 'body.dark-mode'],
  theme: {
    extend: {
      colors: {
        ink: {
          DEFAULT: '#142033',
          soft: '#3d5168',
          muted: '#5a7488',
        },
        brand: {
          DEFAULT: '#1f7eb8',
          deep: '#165f8c',
          bright: '#2f87c6',
          pale: '#e7f4fc',
          mist: '#cfe8f8',
        },
        surface: {
          DEFAULT: '#ffffff',
          page: '#f4f8fb',
          elevated: '#ffffff',
          tint: '#f7fbfe',
        },
        line: {
          DEFAULT: '#d8e6ef',
          strong: '#bfd7e8',
        },
        status: {
          ok: '#0a7a4a',
          'ok-bg': '#e8f8ef',
          warn: '#a16207',
          'warn-bg': '#fef6e7',
          erro: '#b91c1c',
          'erro-bg': '#fef2f2',
          pendente: '#1f7eb8',
          'pendente-bg': '#e8f4fc',
        },
      },
      fontFamily: {
        display: ['Syne', 'system-ui', 'sans-serif'],
        sans: ['Manrope', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        stage: '2px 28px 2px 28px',
        'stage-sm': '2px 20px 2px 20px',
      },
      boxShadow: {
        soft: '0 12px 32px rgba(20, 32, 51, 0.08)',
        lift: '0 16px 40px rgba(20, 32, 51, 0.12)',
      },
      minHeight: {
        touch: '2.75rem',
      },
      spacing: {
        'nav-bottom': '4.25rem',
        sidebar: '16.5rem',
        'sidebar-collapsed': '4.25rem',
      },
      zIndex: {
        nav: '40',
        sidebar: '30',
        fab: '55',
        drawer: '50',
        modal: '60',
        toast: '70',
      },
    },
  },
  plugins: [],
}
