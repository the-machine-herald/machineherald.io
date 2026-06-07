import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';

/**
 * Build-time Open Graph image generation.
 *
 * Renders a branded 1200x630 "newspaper card" per article with Satori
 * (HTML/flexbox -> SVG) and rasterises it to PNG with resvg. Runs only during
 * `astro build` (Node), so reading font binaries from node_modules is safe.
 * Fonts are loaded from the committed @fontsource devDependencies (.woff is
 * supported by Satori; .woff2 is not).
 */

const WIDTH = 1200;
const HEIGHT = 630;

// Brand palette (mirrors src/styles/global.css dark surface)
const COLORS = {
  bg: '#0A0A0B',
  bgAccent: '#101013',
  title: '#FAFAFA',
  summary: '#A1A1AA',
  muted: '#71717A',
  border: '#27272A',
  accent: '#3B82F6',
};

const FONT_FILES = {
  serif700:
    '@fontsource/source-serif-4/files/source-serif-4-latin-700-normal.woff',
  sans400: '@fontsource/inter/files/inter-latin-400-normal.woff',
  sans600: '@fontsource/inter/files/inter-latin-600-normal.woff',
  mono500:
    '@fontsource/jetbrains-mono/files/jetbrains-mono-latin-500-normal.woff',
} as const;

function loadFont(rel: string): Buffer {
  return readFileSync(join(process.cwd(), 'node_modules', rel));
}

type LoadedFont = {
  name: string;
  data: Buffer;
  weight: 400 | 500 | 600 | 700;
  style: 'normal';
};

// Loaded once per build process and reused across every image.
let fontCache: LoadedFont[] | null = null;

function getFonts(): LoadedFont[] {
  if (!fontCache) {
    fontCache = [
      {
        name: 'Source Serif 4',
        data: loadFont(FONT_FILES.serif700),
        weight: 700,
        style: 'normal',
      },
      {
        name: 'Inter',
        data: loadFont(FONT_FILES.sans400),
        weight: 400,
        style: 'normal',
      },
      {
        name: 'Inter',
        data: loadFont(FONT_FILES.sans600),
        weight: 600,
        style: 'normal',
      },
      {
        name: 'JetBrains Mono',
        data: loadFont(FONT_FILES.mono500),
        weight: 500,
        style: 'normal',
      },
    ];
  }
  return fontCache;
}

const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
];

function formatOgDate(date: Date): string {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + '…';
}

// Minimal hyperscript so we don't need JSX in a .ts module.
type Node = { type: string; props: Record<string, unknown> };
function h(
  type: string,
  style: Record<string, unknown>,
  children?: unknown
): Node {
  return {
    type,
    props: { style, ...(children !== undefined ? { children } : {}) },
  };
}

export interface OgCardInput {
  title: string;
  summary: string;
  category?: string;
  date?: Date;
  model?: string;
  /** 'article' renders the per-article card; 'default' the brand card. */
  kind?: 'article' | 'default';
}

function buildTree(input: OgCardInput): Node {
  const {
    title: rawTitle,
    summary: rawSummary,
    category,
    date,
    model,
    kind = 'article',
  } = input;

  const title = clamp(rawTitle, 150);
  const summary = clamp(rawSummary, 200);

  const kicker =
    kind === 'article' && (category || date)
      ? [category?.toUpperCase(), date ? formatOgDate(date) : null]
          .filter(Boolean)
          .join('  ·  ')
      : 'AUTONOMOUS NEWSROOM · VERIFIABLE PROVENANCE';

  const titleSize = title.length > 110 ? 54 : title.length > 70 ? 62 : 70;

  return h(
    'div',
    {
      width: WIDTH,
      height: HEIGHT,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'space-between',
      padding: '64px 72px',
      backgroundColor: COLORS.bg,
      backgroundImage: `radial-gradient(circle at 88% 8%, ${COLORS.bgAccent} 0%, ${COLORS.bg} 55%)`,
      fontFamily: 'Inter',
    },
    [
      // ── Masthead row ──────────────────────────────────────
      h(
        'div',
        {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        },
        [
          h(
            'div',
            {
              display: 'flex',
              fontFamily: 'JetBrains Mono',
              fontSize: 26,
              fontWeight: 500,
              letterSpacing: '0.18em',
              color: COLORS.title,
            },
            'THE MACHINE HERALD'
          ),
          h('div', { display: 'flex', alignItems: 'center' }, [
            h('div', {
              display: 'flex',
              width: 14,
              height: 14,
              borderRadius: 3,
              backgroundColor: COLORS.accent,
              marginRight: 12,
              transform: 'rotate(45deg)',
            }),
            h(
              'div',
              {
                display: 'flex',
                fontFamily: 'JetBrains Mono',
                fontSize: 20,
                fontWeight: 500,
                letterSpacing: '0.08em',
                color: COLORS.accent,
              },
              'VERIFIED'
            ),
          ]),
        ]
      ),

      // ── Body ──────────────────────────────────────────────
      h('div', { display: 'flex', flexDirection: 'column' }, [
        h(
          'div',
          {
            display: 'flex',
            fontFamily: 'JetBrains Mono',
            fontSize: 22,
            fontWeight: 500,
            letterSpacing: '0.1em',
            color: COLORS.accent,
            marginBottom: 24,
          },
          kicker
        ),
        h(
          'div',
          {
            display: 'flex',
            fontFamily: 'Source Serif 4',
            fontWeight: 700,
            fontSize: titleSize,
            lineHeight: 1.08,
            letterSpacing: '-0.02em',
            color: COLORS.title,
            maxWidth: WIDTH - 144,
          },
          title
        ),
        summary
          ? h(
              'div',
              {
                display: 'flex',
                fontFamily: 'Inter',
                fontWeight: 400,
                fontSize: 28,
                lineHeight: 1.4,
                color: COLORS.summary,
                marginTop: 28,
                maxWidth: WIDTH - 144,
              },
              summary
            )
          : h('div', { display: 'flex' }, ''),
      ]),

      // ── Footer row ────────────────────────────────────────
      h('div', { display: 'flex', flexDirection: 'column' }, [
        h('div', {
          display: 'flex',
          height: 1,
          backgroundColor: COLORS.border,
          marginBottom: 22,
        }),
        h(
          'div',
          {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          },
          [
            h(
              'div',
              {
                display: 'flex',
                fontFamily: 'JetBrains Mono',
                fontSize: 22,
                fontWeight: 500,
                color: COLORS.title,
              },
              'machineherald.io'
            ),
            model
              ? h(
                  'div',
                  {
                    display: 'flex',
                    fontFamily: 'JetBrains Mono',
                    fontSize: 20,
                    fontWeight: 500,
                    color: COLORS.muted,
                  },
                  model
                )
              : h('div', { display: 'flex' }, ''),
          ]
        ),
      ]),
    ]
  );
}

export async function renderOgPng(input: OgCardInput): Promise<Uint8Array> {
  // satori expects a React-element-like tree; our plain {type, props} matches
  // the runtime shape it consumes, so we cast to its first-argument type.
  const tree = buildTree(input) as unknown as Parameters<typeof satori>[0];
  const svg = await satori(tree, {
    width: WIDTH,
    height: HEIGHT,
    fonts: getFonts(),
  });

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: WIDTH },
    font: { loadSystemFonts: false },
  });
  return resvg.render().asPng();
}
