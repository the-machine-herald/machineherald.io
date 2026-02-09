/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  darkMode: 'class',
  theme: {
    screens: {
      sm: '640px',
      md: '768px',
      nav: '890px',
      lg: '1024px',
      xl: '1280px',
      '2xl': '1536px',
    },
    extend: {
      colors: {
        surface: {
          light: '#FAFAF9',
          dark: '#0A0A0B',
        },
        text: {
          primary: {
            light: '#18181B',
            dark: '#FAFAFA',
          },
          secondary: {
            light: '#52525B',
            dark: '#A1A1AA',
          },
          muted: {
            light: '#71717A',
            dark: '#71717A',
          },
        },
        border: {
          light: '#E4E4E7',
          dark: '#27272A',
        },
        accent: {
          DEFAULT: '#2563EB',
          hover: '#1D4ED8',
        },
      },
      fontFamily: {
        serif: ['"Source Serif 4"', 'Georgia', 'Cambria', 'serif'],
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      maxWidth: {
        reading: '740px',
        container: '1100px',
      },
      typography: ({ theme }) => ({
        DEFAULT: {
          css: {
            '--tw-prose-body': theme('colors.text.primary.light'),
            '--tw-prose-headings': theme('colors.text.primary.light'),
            '--tw-prose-links': theme('colors.accent.DEFAULT'),
            '--tw-prose-bold': theme('colors.text.primary.light'),
            '--tw-prose-counters': theme('colors.text.secondary.light'),
            '--tw-prose-bullets': theme('colors.text.muted.light'),
            '--tw-prose-hr': theme('colors.border.light'),
            '--tw-prose-quotes': theme('colors.text.secondary.light'),
            '--tw-prose-quote-borders': theme('colors.border.light'),
            '--tw-prose-captions': theme('colors.text.muted.light'),
            '--tw-prose-code': theme('colors.text.primary.light'),
            '--tw-prose-pre-code': theme('colors.text.primary.dark'),
            '--tw-prose-pre-bg': theme('colors.surface.dark'),
            '--tw-prose-th-borders': theme('colors.border.light'),
            '--tw-prose-td-borders': theme('colors.border.light'),
            maxWidth: '740px',
            fontFamily: theme('fontFamily.sans').join(', '),
            h1: {
              fontFamily: theme('fontFamily.serif').join(', '),
              fontWeight: '600',
            },
            h2: {
              fontFamily: theme('fontFamily.serif').join(', '),
              fontWeight: '600',
            },
            h3: {
              fontFamily: theme('fontFamily.serif').join(', '),
              fontWeight: '600',
            },
            h4: {
              fontFamily: theme('fontFamily.serif').join(', '),
              fontWeight: '600',
            },
            a: {
              textDecoration: 'none',
              borderBottom: '1px solid transparent',
              transition: 'border-color 0.15s ease',
              '&:hover': {
                borderBottomColor: theme('colors.accent.DEFAULT'),
              },
            },
            code: {
              fontFamily: theme('fontFamily.mono').join(', '),
              fontSize: '0.875em',
            },
          },
        },
        invert: {
          css: {
            '--tw-prose-body': theme('colors.text.primary.dark'),
            '--tw-prose-headings': theme('colors.text.primary.dark'),
            '--tw-prose-links': theme('colors.accent.DEFAULT'),
            '--tw-prose-bold': theme('colors.text.primary.dark'),
            '--tw-prose-counters': theme('colors.text.secondary.dark'),
            '--tw-prose-bullets': theme('colors.text.muted.dark'),
            '--tw-prose-hr': theme('colors.border.dark'),
            '--tw-prose-quotes': theme('colors.text.secondary.dark'),
            '--tw-prose-quote-borders': theme('colors.border.dark'),
            '--tw-prose-captions': theme('colors.text.muted.dark'),
            '--tw-prose-code': theme('colors.text.primary.dark'),
            '--tw-prose-th-borders': theme('colors.border.dark'),
            '--tw-prose-td-borders': theme('colors.border.dark'),
          },
        },
      }),
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
