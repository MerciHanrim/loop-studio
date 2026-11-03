import type { NodeIconId } from '../../model/model'

// SEMANTICS-R12.md — the drawings of the node icon registry (`NODE_ICON_IDS`):
// the approved set of the first list, one filled silhouette per id in
// `currentColor` (the node's symbol stroke token; `CanvasText` under forced
// colours). Every cut-out is a real hole (evenodd or mask), never a paint in the
// node's fill: the mark sits in the label on the canvas, so a painted cut-out
// would show as a patch.
//
// `big` is the 24-unit drawing, used from 20 px rendered up; `small` is the
// separately tuned drawing for below that and is only listed where it differs.
// A mask id is written `{uid}-arch`; `NodeIcon` makes it unique per mark.

export type IconDrawing = {
  /** the drawing's viewBox */
  vb: string
  big: string
  small?: string
}

export const NODE_ICON_DRAWINGS: Record<NodeIconId, IconDrawing> = {
  cloud: {
    vb: '0 0 48 48',
    big: `<path d="M10 34h25c6 0 9-4 9-9s-4-9-9-9h-1A12 12 0 0 0 11 19a8 8 0 0 0-1 15Z"/>`,
  },
  // the cloud above, scaled and raised, with three slanted rain strokes; the 16 px
  // drawing shortens and thickens the rain (follow-up 1 of #478)
  'rain-cloud': {
    vb: '0 0 48 48',
    big: `<g transform="translate(6.2 -1.5) scale(0.78)"><path d="M10 34h25c6 0 9-4 9-9s-4-9-9-9h-1A12 12 0 0 0 11 19a8 8 0 0 0-1 15Z"/></g><g fill="none" stroke="currentColor" stroke-width="4.6" stroke-linecap="round"><path d="M16.75 30L13.25 40.5"/><path d="M25.75 30L22.25 40.5"/><path d="M34.75 30L31.25 40.5"/></g>`,
    small: `<g transform="translate(5.6 -2.6) scale(0.8)"><path d="M10 34h25c6 0 9-4 9-9s-4-9-9-9h-1A12 12 0 0 0 11 19a8 8 0 0 0-1 15Z"/></g><g fill="none" stroke="currentColor" stroke-width="5.6" stroke-linecap="round"><path d="M16.75 30.5L13.25 40"/><path d="M25.75 30.5L22.25 40"/><path d="M34.75 30.5L31.25 40"/></g>`,
  },
  // a sun at the upper left behind the cloud, a clear gap between them cut by a mask;
  // the 16 px drawing keeps five rays on the free side and a larger cloud (follow-up 3 of #478)
  'partly-cloudy': {
    vb: '0 0 48 48',
    big: `<mask id="p{uid}"><rect width="48" height="48" fill="#fff"/><g transform="translate(15.5 16) scale(0.62)"><path d="M10 34h25c6 0 9-4 9-9s-4-9-9-9h-1A12 12 0 0 0 11 19a8 8 0 0 0-1 15Z" fill="#000" stroke="#000" stroke-width="4.52" stroke-linejoin="round"/></g></mask><g mask="url(#p{uid})"><path d="M10.5 17a7.5 7.5 0 1 0 15 0a7.5 7.5 0 1 0 -15 0Z"/><path d="M28.5 17L32.5 17M25.42 24.42L28.25 27.25M18 27.5L18 31.5M10.58 24.42L7.75 27.25M7.5 17L3.5 17M10.58 9.58L7.75 6.75M18 6.5L18 2.5M25.42 9.58L28.25 6.75" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></g><g transform="translate(15.5 16) scale(0.62)"><path d="M10 34h25c6 0 9-4 9-9s-4-9-9-9h-1A12 12 0 0 0 11 19a8 8 0 0 0-1 15Z"/></g>`,
    small: `<mask id="p{uid}"><rect width="48" height="48" fill="#fff"/><g transform="translate(11.5 12.5) scale(0.74)"><path d="M10 34h25c6 0 9-4 9-9s-4-9-9-9h-1A12 12 0 0 0 11 19a8 8 0 0 0-1 15Z" fill="#000" stroke="#000" stroke-width="5.68" stroke-linejoin="round"/></g></mask><g mask="url(#p{uid})"><path d="M7.5 15a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0Z"/><path d="M4 15L-1 15M7.51 6.51L3.98 2.98M16 3L16 -2M24.49 6.51L28.02 2.98M28 15L33 15" fill="none" stroke="currentColor" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/></g><g transform="translate(11.5 12.5) scale(0.74)"><path d="M10 34h25c6 0 9-4 9-9s-4-9-9-9h-1A12 12 0 0 0 11 19a8 8 0 0 0-1 15Z"/></g>`,
  },
  // a snowflake: six arms, a pair of branches each; standalone, so it is never the cloud
  // or the rain cloud; the 16 px drawing is the same, heavier (follow-up 3 of #478)
  snow: {
    vb: '0 0 48 48',
    big: `<path d="M24 24L24 4M24 11.5L19.09 8.06M24 11.5L28.91 8.06M24 24L41.32 14M34.83 17.75L35.35 11.77M34.83 17.75L40.26 20.29M24 24L41.32 34M34.83 30.25L40.26 27.71M34.83 30.25L35.35 36.23M24 24L24 44M24 36.5L28.91 39.94M24 36.5L19.09 39.94M24 24L6.68 34M13.17 30.25L12.65 36.23M13.17 30.25L7.74 27.71M24 24L6.68 14M13.17 17.75L7.74 20.29M13.17 17.75L12.65 11.77" fill="none" stroke="currentColor" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>`,
    small: `<path d="M24 24L24 3M24 10.5L18.88 6.5M24 10.5L29.12 6.5M24 24L42.19 13.5M35.69 17.25L36.6 10.81M35.69 17.25L41.72 19.68M24 24L42.19 34.5M35.69 30.75L41.72 28.32M35.69 30.75L36.6 37.19M24 24L24 45M24 37.5L29.12 41.5M24 37.5L18.88 41.5M24 24L5.81 34.5M12.31 30.75L11.4 37.19M12.31 30.75L6.28 28.32M24 24L5.81 13.5M12.31 17.25L6.28 19.68M12.31 17.25L11.4 10.81" fill="none" stroke="currentColor" stroke-width="5.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  // the cloud with one bolt under it — the rain cloud's sibling; electricity is a bolt
  // alone; the 16 px drawing has a larger bolt (follow-up 3 of #478)
  'lightning-risk': {
    vb: '0 0 48 48',
    big: `<g transform="translate(6.2 -3) scale(0.78)"><path d="M10 34h25c6 0 9-4 9-9s-4-9-9-9h-1A12 12 0 0 0 11 19a8 8 0 0 0-1 15Z"/></g><path fill-rule="evenodd" d="M27 24L17 37.5L23 37.5L19.5 47L31.5 33.5L25.5 33.5L29.5 24Z"/>`,
    small: `<g transform="translate(5.6 -4.5) scale(0.8)"><path d="M10 34h25c6 0 9-4 9-9s-4-9-9-9h-1A12 12 0 0 0 11 19a8 8 0 0 0-1 15Z"/></g><path fill-rule="evenodd" d="M29 22L15.5 38.5L23.5 38.5L19 48L33.5 33L26 33L31 22Z"/>`,
  },
  wind: {
    vb: '0 0 48 48',
    big: `<g transform="translate(2.4 1.2)"><path d="M4 13c0-1.1.7-1.9 1.7-2L29 8.6v5.6L5.7 15.1C4.7 15 4 14.2 4 13Z"/><path d="M29 11.4a4.8 4.8 0 1 0-4.8-4.8" fill="none" stroke="currentColor" stroke-width="5.6" stroke-linecap="round"/><path d="M4 25c0-1.2.8-2.1 1.9-2.2L36 20.9v6.2L5.9 27.2C4.8 27.1 4 26.2 4 25Z"/><path d="M36 24a5.4 5.4 0 1 1-5.4 5.4" fill="none" stroke="currentColor" stroke-width="6.2" stroke-linecap="round"/><path d="M4 38.5c0-1 .7-1.8 1.6-1.9L21 35.3a3.2 3.2 0 0 1 0 6.4L5.6 40.4C4.7 40.3 4 39.5 4 38.5Z"/></g>`,
    small: `<g transform="translate(24 24) scale(1.14) translate(-20.2 -20.8)"><path d="M3 16c0-1.4 1-2.4 2.3-2.6L31 11.2v7.6L5.3 18.6C4 18.4 3 17.4 3 16Z"/><path d="M31 15a6.6 6.6 0 1 0-6.6-6.6" fill="none" stroke="currentColor" stroke-width="7.6" stroke-linecap="round"/><path d="M7 33c0-1.4 1-2.4 2.3-2.6L33 28.2a4.4 4.4 0 0 1 0 8.8L9.3 35.6C8 35.4 7 34.4 7 33Z"/></g>`,
  },
  // a tree bent by the wind: the canopy pushed to leeward, one curved trunk, short gust
  // lines on the windward side (three at 24 px, two at 16 px); the lean and the gusts tell
  // it from the tree, the tree shape from the wind (follow-up 3 of #478, round 2)
  'strong-wind': {
    vb: '0 0 48 48',
    big: `<path d="M18.5 13.5a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0 -17 0Z M29 18a7 7 0 1 0 14 0a7 7 0 1 0 -14 0Z M13.5 19a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0Z M22.5 22a7.5 7.5 0 1 0 15 0a7.5 7.5 0 1 0 -15 0Z M35 25.5a5 5 0 1 0 10 0a5 5 0 1 0 -10 0Z M18.5 25a5.5 5.5 0 1 0 11 0a5.5 5.5 0 1 0 -11 0Z"/><path d="M15 46C17 38 21 31 30 25" fill="none" stroke="currentColor" stroke-width="4.4" stroke-linecap="round" stroke-linejoin="round"/><path d="M2 10L9 10M1 18.5L8 18.5M3 27L10 27" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`,
    small: `<path d="M19.5 14a10.5 10.5 0 1 0 21 0a10.5 10.5 0 1 0 -21 0Z M32.5 20.5a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0Z M15.5 20a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0Z M23 23.5a8 8 0 1 0 16 0a8 8 0 1 0 -16 0Z"/><path d="M13 46C15 38 20 31 29 26" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M1.5 11L9.5 11M1.5 22L9.5 22" fill="none" stroke="currentColor" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  // the cyclone sign: a ring with two tails that leave it tangentially and sweep
  // outwards, never closing into a second ring (follow-up 3 of #478)
  typhoon: {
    vb: '0 0 48 48',
    big: `<path fill-rule="evenodd" d="M16 24a8 8 0 1 0 16 0a8 8 0 1 0 -16 0Z M20.6 24a3.4 3.4 0 1 0 6.8 0a3.4 3.4 0 1 0 -6.8 0Z"/><path d="M24 14.5L25.15 14.17L26.37 13.99L27.66 13.96L28.97 14.1L30.31 14.41L31.63 14.9L32.93 15.58L34.16 16.44L35.31 17.47L36.36 18.67L37.27 20.03L38.03 21.53L38.62 23.15L39.02 24.87L39.2 26.68L39.17 28.54L38.9 30.43L38.4 32.31L37.65 34.16L36.67 35.95L35.45 37.65L34.01 39.21L32.35 40.63L30.5 41.85M24 33.5L22.85 33.83L21.63 34.01L20.34 34.04L19.03 33.9L17.69 33.59L16.37 33.1L15.07 32.42L13.84 31.56L12.69 30.53L11.64 29.33L10.73 27.97L9.97 26.47L9.38 24.85L8.98 23.13L8.8 21.32L8.83 19.46L9.1 17.57L9.6 15.69L10.35 13.84L11.33 12.05L12.55 10.35L13.99 8.79L15.65 7.37L17.5 6.15" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`,
    small: `<path fill-rule="evenodd" d="M15 24a9 9 0 1 0 18 0a9 9 0 1 0 -18 0Z M20.4 24a3.6 3.6 0 1 0 7.2 0a3.6 3.6 0 1 0 -7.2 0Z"/><path d="M24 13.5L25.18 13.19L26.43 13.02L27.74 12.99L29.07 13.12L30.42 13.42L31.76 13.88L33.08 14.52L34.34 15.32L35.54 16.29L36.64 17.42L37.63 18.7L38.49 20.12L39.2 21.66L39.74 23.31L40.09 25.05L40.25 26.87L40.2 28.72L39.94 30.6L39.45 32.48L38.74 34.32L37.82 36.12L36.67 37.82L35.31 39.42L33.75 40.89M24 34.5L22.82 34.81L21.57 34.98L20.26 35.01L18.93 34.88L17.58 34.58L16.24 34.12L14.92 33.48L13.66 32.68L12.46 31.71L11.36 30.58L10.37 29.3L9.51 27.88L8.8 26.34L8.26 24.69L7.91 22.95L7.75 21.13L7.8 19.28L8.06 17.4L8.55 15.52L9.26 13.68L10.18 11.88L11.33 10.18L12.69 8.58L14.25 7.11" fill="none" stroke="currentColor" stroke-width="6.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  // a thermometer: tube and bulb, the empty top of the tube a hole cut by a mask, scale
  // ticks beside it; the 16 px drawing has a wider bulb and two ticks (follow-up 3 of #478)
  temperature: {
    vb: '0 0 48 48',
    big: `<mask id="t{uid}"><rect width="48" height="48" fill="#fff"/><path d="M21 7.5H21A2.5 2.5 0 0 1 23.5 10V18.5A2.5 2.5 0 0 1 21 21H21A2.5 2.5 0 0 1 18.5 18.5V10A2.5 2.5 0 0 1 21 7.5Z" fill="#000"/></mask><path d="M21 4H21A6 6 0 0 1 27 10V29A6 6 0 0 1 21 35H21A6 6 0 0 1 15 29V10A6 6 0 0 1 21 4Z M11.5 35a9.5 9.5 0 1 0 19 0a9.5 9.5 0 1 0 -19 0Z" mask="url(#t{uid})"/><path d="M30 11L35.2 11M30 17L35.2 17M30 23L35.2 23" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    small: `<mask id="t{uid}"><rect width="48" height="48" fill="#fff"/><path d="M20 6.5H20A2.3 2.3 0 0 1 22.3 8.8V15.2A2.3 2.3 0 0 1 20 17.5H20A2.3 2.3 0 0 1 17.7 15.2V8.8A2.3 2.3 0 0 1 20 6.5Z" fill="#000"/></mask><path d="M20 3H20A6 6 0 0 1 26 9V28.5A6 6 0 0 1 20 34.5H20A6 6 0 0 1 14 28.5V9A6 6 0 0 1 20 3Z M8.5 34.5a11.5 11.5 0 1 0 23 0a11.5 11.5 0 1 0 -23 0Z" mask="url(#t{uid})"/><path d="M29 11L35.8 11M29 20L35.8 20" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  sun: {
    vb: '0 0 48 48',
    big: `<circle cx="24" cy="24" r="9"/><g fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"><path d="M24 3v6M24 39v6M3 24h6M39 24h6M9.2 9.2l4.2 4.2M34.6 34.6l4.2 4.2M9.2 38.8l4.2-4.2M34.6 13.4l4.2-4.2"/></g>`,
  },
  remote: {
    vb: '0 0 48 48',
    big: `<path fill-rule="evenodd" d="M17 3h14a4 4 0 0 1 4 4v36a3 3 0 0 1-3 3H16a3 3 0 0 1-3-3V7a4 4 0 0 1 4-4Z M18 14a6 6 0 1 0 12 0a6 6 0 1 0-12 0Z M18 24H21A1 1 0 0 1 22 25V27A1 1 0 0 1 21 28H18A1 1 0 0 1 17 27V25A1 1 0 0 1 18 24Z M27 24H30A1 1 0 0 1 31 25V27A1 1 0 0 1 30 28H27A1 1 0 0 1 26 27V25A1 1 0 0 1 27 24Z M18 31H21A1 1 0 0 1 22 32V34A1 1 0 0 1 21 35H18A1 1 0 0 1 17 34V32A1 1 0 0 1 18 31Z M27 31H30A1 1 0 0 1 31 32V34A1 1 0 0 1 30 35H27A1 1 0 0 1 26 34V32A1 1 0 0 1 27 31Z"/><circle cx="24" cy="14" r="2.4"/>`,
    small: `<path fill-rule="evenodd" d="M20 17H28A4 4 0 0 1 32 21V42A4 4 0 0 1 28 46H20A4 4 0 0 1 16 42V21A4 4 0 0 1 20 17Z M19.2 25.5a4.8 4.8 0 1 0 9.6 0a4.8 4.8 0 1 0-9.6 0Z M19.5 33.5H28.5V37.7H19.5Z"/><circle cx="24" cy="25.5" r="1.9"/><g fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"><path d="M19.8 12.8a6 6 0 0 1 8.4 0"/><path d="M16.2 9.2a11 11 0 0 1 15.6 0"/></g>`,
  },
  tree: {
    vb: '0 0 48 48',
    big: `<circle cx="13" cy="19" r="8"/><circle cx="22" cy="12" r="9.5"/><circle cx="32" cy="15" r="8.5"/><circle cx="38" cy="23" r="6"/><circle cx="9" cy="25" r="5.5"/><circle cx="24" cy="21" r="9"/><circle cx="31" cy="25" r="6"/><path d="M19 46c0-1.5.9-2.4 2.2-2.8V36.4l-8.6-8.8 2-2 6.6 6.6V27h5.6v5.2l6.6-6.6 2 2-8.6 8.8v6.8c1.3.4 2.2 1.3 2.2 2.8Z"/>`,
    small: `<circle cx="24" cy="14" r="11"/><circle cx="13" cy="21" r="8.5"/><circle cx="35" cy="21" r="8.5"/><circle cx="24" cy="22" r="7.5"/><path d="M20.5 46v-7.5L12 30l2.8-2.8 5.7 5.7v-6.4h7v6.4l5.7-5.7L36 30l-8.5 8.5V46Z"/>`,
  },
  electricity: {
    vb: '0 0 48 48',
    big: `<path d="M28 2 7 27h13l-4 19 21-27H25z"/>`,
  },
  water: {
    vb: '0 0 44 44',
    big: `<path d="M22 2C17 10 7 22 7 29a15 15 0 0 0 30 0C37 22 27 10 22 2Zm-2 33a7 7 0 0 1-6-7h5a3 3 0 0 0 2 3Z" fill-rule="evenodd"/>`,
  },
  wave: {
    vb: '0 0 48 48',
    big: `<g fill="none" stroke="currentColor" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"><path d="M18.2 18.3A11 11 0 1 1 37.4 29.1"/><path d="M18.2 18.3C15 25 11 33 4 36"/></g><path d="M3 44v-7h42v7Z"/>`,
    small: `<g fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21A11 11 0 1 1 32.5 30.5"/><path d="M16 21C14.5 26.5 10.5 32 6 35"/></g><rect x="2" y="36" width="44" height="8" rx="2"/>`,
  },
  airplane: {
    vb: '0 0 44 44',
    big: `<g transform="rotate(42 22 22)"><path d="M22 2c3 0 5 4 5 8v10l13 9v4l-13-4v8l5 4v3l-10-3-10 3v-3l5-4v-8L4 33v-4l13-9V10c0-4 2-8 5-8Z"/></g>`,
  },
  car: {
    vb: '0 0 48 48',
    big: `<defs><mask id="{uid}-arch"><rect width="48" height="48" fill="#fff"/><circle cx="13" cy="34" r="7.4" fill="#000"/><circle cx="35" cy="34" r="7.4" fill="#000"/></mask></defs><g mask="url(#{uid}-arch)"><path fill-rule="evenodd" d="M3 34V24.5C3 21.5 5 19 8 19H13L17.4 11.4C18.5 9.4 20.5 8 22.8 8H31C33.4 8 35.4 9.4 36.5 11.4L41 19C43.6 19.5 45 22 45 25V34Z M16 18L19.5 12.2C19.9 11.5 20.6 10.8 21.6 10.8H23.8V18Z M26.4 10.8H30.6C31.6 10.8 32.4 11.4 32.9 12.2L36.4 18H26.4Z"/></g><path fill-rule="evenodd" d="M7.8 34a5.2 5.2 0 1 0 10.4 0a5.2 5.2 0 1 0-10.4 0Z M11.2 34a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0Z M29.8 34a5.2 5.2 0 1 0 10.4 0a5.2 5.2 0 1 0-10.4 0Z M33.2 34a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0Z"/>`,
    small: `<defs><mask id="{uid}-arch"><rect width="48" height="48" fill="#fff"/><circle cx="13" cy="34" r="8.4" fill="#000"/><circle cx="35" cy="34" r="8.4" fill="#000"/></mask></defs><g mask="url(#{uid}-arch)"><path fill-rule="evenodd" d="M2.5 34V24.5C2.5 21.5 4.5 19 7.5 19H13L17.4 11.4C18.5 9.4 20.5 8 22.8 8H31C33.4 8 35.4 9.4 36.5 11.4L41 19C43.8 19.5 45.5 22 45.5 25V34Z M15.6 18.4L19.2 12.3C19.6 11.6 20.4 11 21.4 11H22.8V18.4Z M26.8 11H30.8C31.8 11 32.6 11.5 33.1 12.3L36.6 18.4H26.8Z"/></g><circle cx="13" cy="34" r="6"/><circle cx="35" cy="34" r="6"/>`,
  },
  // a hull with a bow and a stern, a container stack with slits, a bridge; the 16 px
  // drawing keeps one stack and no window (follow-up 3 of #478)
  'cargo-ship': {
    vb: '0 0 48 48',
    big: `<mask id="s{uid}"><rect width="48" height="48" fill="#fff"/><path d="M17.1 21L17.1 30L18.9 30L18.9 21Z M26.1 21L26.1 30L27.9 30L27.9 21Z M17.1 12L17.1 21L18.9 21L18.9 12Z M39 17H43V20H39Z" fill="#000"/></mask><path d="M1 30L47 30L46 38L40 44L8 44L2 38Z M9 21H36V30H9Z M9 12H27V21H9Z M37 14H45V30H37Z" mask="url(#s{uid})"/>`,
    small: `<mask id="s{uid}"><rect width="48" height="48" fill="#fff"/><path d="M19.2 18L19.2 30L21.8 30L21.8 18Z" fill="#000"/></mask><path d="M0.5 30L47.5 30L46 39L40 45L8 45L2 39Z M7 18H34V30H7Z M35 12H45V30H35Z" mask="url(#s{uid})"/>`,
  },
  'nuclear-plant': {
    vb: '0 0 48 48',
    big: `<path d="M7.3 8a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0-6.4 0Z"/><circle cx="16" cy="6.6" r="4"/><circle cx="21.4" cy="8.6" r="3"/><path d="M3.5 41C6.5 35 8 31 8 27C8 22 7 18 7 14H23C23 18 22 22 22 27C22 31 23.5 35 26.5 41Z"/><path fill-rule="evenodd" d="M28.5 41V31A8.75 8.75 0 0 1 46 31V41Z M35 31.5a2.25 2.25 0 1 0 4.5 0a2.25 2.25 0 1 0-4.5 0Z"/><path d="M2 41h44v3.5H2Z"/>`,
    small: `<circle cx="11" cy="7" r="4"/><circle cx="18.5" cy="6" r="4.6"/><path d="M2.5 42C6 37 8.5 32 8.5 27.5C8.5 22 6.5 18 6.5 14H23.5C23.5 18 21.5 22 21.5 27.5C21.5 32 24 37 27.5 42Z"/><path d="M30 42V32A8 8 0 0 1 46 32V42Z"/><path d="M1 42h46v4H1Z"/>`,
  },
  // a drum: the lid an ellipse with its rim, two hoop bands as holes cut by a mask; the
  // 16 px drawing keeps the bands only (follow-up 3 of #478)
  oil: {
    vb: '0 0 48 48',
    big: `<mask id="d{uid}"><rect width="48" height="48" fill="#fff"/><path d="M13.6 10a10.4 2.44 0 1 0 20.8 0a10.4 2.44 0 1 0 -20.8 0Z M13.4 19.7H34.6V22.3H13.4Z M13.4 30.7H34.6V33.3H13.4Z" fill="#000"/></mask><path d="M13.5 10H34.5A2.5 2.5 0 0 1 37 12.5V41.5A2.5 2.5 0 0 1 34.5 44H13.5A2.5 2.5 0 0 1 11 41.5V12.5A2.5 2.5 0 0 1 13.5 10Z M11 10a13 4 0 1 0 26 0a13 4 0 1 0 -26 0Z" mask="url(#d{uid})"/>`,
    small: `<mask id="d{uid}"><rect width="48" height="48" fill="#fff"/><path d=" M12 20.3H36V23.7H12Z M12 31.3H36V34.7H12Z" fill="#000"/></mask><path d="M12 10H36A3 3 0 0 1 39 13V42A3 3 0 0 1 36 45H12A3 3 0 0 1 9 42V13A3 3 0 0 1 12 10Z M9 10a15 4.5 0 1 0 30 0a15 4.5 0 1 0 -30 0Z" mask="url(#d{uid})"/>`,
  },
  // a mine cart heaped with lumps, two wheels — a faceted lump read as a pie chart and a
  // pile as a mountain, so the cart stays (follow-up 3 of #478)
  coal: {
    vb: '0 0 48 48',
    big: `<path fill-rule="evenodd" d="M4 20L44 20L38 38L10 38Z M10 43a4 4 0 1 0 8 0a4 4 0 1 0 -8 0Z M30 43a4 4 0 1 0 8 0a4 4 0 1 0 -8 0Z"/><path fill-rule="evenodd" d="M8 20L12 12L19 9L24 14L20 20Z M20 20L24 14L31 10L38 15L40 20Z"/>`,
    small: `<path fill-rule="evenodd" d="M3 20L45 20L39 38L9 38Z M9.5 43.5a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0Z M29.5 43.5a4.5 4.5 0 1 0 9 0a4.5 4.5 0 1 0 -9 0Z"/><path fill-rule="evenodd" d="M7 20L12 10L20 7L25 13L21 20Z M21 20L25 13L32 8L39 14L41 20Z"/>`,
  },
  warehouse: {
    vb: '0 0 48 48',
    big: `<path fill-rule="evenodd" d="M3 19L24 7L45 19V41H3Z M9 41V24H39V41Z M21.8 15.5a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0Z"/><path d="M12 27.5H36V30.5H12Z M12 32.5H36V35.5H12Z M12 37.5H36V40.5H12Z"/>`,
    small: `<path fill-rule="evenodd" d="M2 20L24 6L46 20V42H2Z M9 42V25H39V42Z"/><path d="M9 28H39V32H9Z M9 35H39V39H9Z"/>`,
  },
  // a steep roof with eaves, a chimney, the door a hole cut by a mask; the warehouse has a
  // low gable and a wide shutter (follow-up 3 of #478)
  house: {
    vb: '0 0 48 48',
    big: `<mask id="h{uid}"><rect width="48" height="48" fill="#fff"/><path d="M20.5 30H27.5V44.1H20.5Z" fill="#000"/></mask><g mask="url(#h{uid})"><path d="M24 5L4 24L10 24L10 44L38 44L38 24L44 24Z"/><path d="M32 9H37V19H32Z"/></g>`,
    small: `<mask id="h{uid}"><rect width="48" height="48" fill="#fff"/><path d="M19.5 30H28.5V45.1H19.5Z" fill="#000"/></mask><g mask="url(#h{uid})"><path d="M24 4L2 25L9 25L9 45L39 45L39 25L46 25Z"/><path d="M32 8H38V19H32Z"/></g>`,
  },
  // a fork and a knife; the 16 px drawing has two tines (follow-up 3 of #478)
  food: {
    vb: '0 0 48 48',
    big: `<path fill-rule="evenodd" d="M15 4H15A4.5 4.5 0 0 1 19.5 8.5V15.5A4.5 4.5 0 0 1 15 20H15A4.5 4.5 0 0 1 10.5 15.5V8.5A4.5 4.5 0 0 1 15 4Z M11.75 3H13.45V13H11.75Z M14.15 3H15.85V13H14.15Z M16.55 3H18.25V13H16.55Z"/><path d="M15 19L15 44M32 25L32 44" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path fill-rule="evenodd" d="M28 4L36 4L36 23L32 26L28 23Z"/>`,
    small: `<path fill-rule="evenodd" d="M14 3H14A5.5 5.5 0 0 1 19.5 8.5V14.5A5.5 5.5 0 0 1 14 20H14A5.5 5.5 0 0 1 8.5 14.5V8.5A5.5 5.5 0 0 1 14 3Z M10 2H12.6V13H10Z M15.4 2H18V13H15.4Z"/><path d="M14 19L14 45M33 26L33 45" fill="none" stroke="currentColor" stroke-width="5.4" stroke-linecap="round" stroke-linejoin="round"/><path fill-rule="evenodd" d="M28 3L38 3L38 23L33 27L28 23Z"/>`,
  },
  // a tumbler with a straw, the liquid line a band; the 16 px drawing is the same,
  // heavier (follow-up 3 of #478)
  drink: {
    vb: '0 0 48 48',
    big: `<path fill-rule="evenodd" d="M13 14L35 14L31.5 44L16.5 44Z M16.77 24H31.23V26.6H16.77Z"/><path d="M28 15L37.5 4" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>`,
    small: `<path fill-rule="evenodd" d="M11 13L37 13L33 45L15 45Z M15.58 24H32.42V27.4H15.58Z"/><path d="M29 14L39.5 3" fill="none" stroke="currentColor" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  },
  medicine: {
    vb: '0 0 48 48',
    big: `<g transform="rotate(-45 24 24)"><path d="M10 14H22.6V34H10A10 10 0 0 1 10 14Z"/><path fill-rule="evenodd" d="M25.4 14H38A10 10 0 0 1 38 34H25.4Z M29.4 18H38A6 6 0 0 1 38 30H29.4Z"/></g>`,
    small: `<g transform="rotate(-45 24 24)"><path d="M10 14H22.3V34H10A10 10 0 0 1 10 14Z"/><path fill-rule="evenodd" d="M25.7 14H38A10 10 0 0 1 38 34H25.7Z M30.3 18.6H38A5.4 5.4 0 0 1 38 29.4H30.3Z"/></g>`,
  },
  'game-currency': {
    vb: '0 0 44 44',
    big: `<path fill-rule="evenodd" d="M4 22a18 18 0 1 0 36 0a18 18 0 1 0-36 0Z m18-12 3.8 7.7 8.5 1.2-6.2 6 1.5 8.4-7.6-4-7.6 4 1.5-8.4-6.2-6 8.5-1.2Z"/>`,
  },
  // a banknote: a landscape note with a printed border (rim, band, panel) and
  // an oval medallion — the double outline is what tells it from a camera at
  // 16 px; the 24 px drawing adds a disc in the medallion (follow-up 2 of #478).
  // Real holes, even-odd, one path: note → band → panel → medallion → disc.
  cash: {
    vb: '0 0 48 48',
    big: `<path fill-rule="evenodd" d="M6 10H42A3 3 0 0 1 45 13V35A3 3 0 0 1 42 38H6A3 3 0 0 1 3 35V13A3 3 0 0 1 6 10Z M6 12.4H42A0.6 0.6 0 0 1 42.6 13V35A0.6 0.6 0 0 1 42 35.6H6A0.6 0.6 0 0 1 5.4 35V13A0.6 0.6 0 0 1 6 12.4Z M7.8 14.8H40.2V33.2H7.8Z M16.5 24a7.5 5.8 0 1 0 15 0a7.5 5.8 0 1 0 -15 0Z M21 24a3 3 0 1 0 6 0a3 3 0 1 0 -6 0Z"/>`,
    small: `<path fill-rule="evenodd" d="M4 9H44A3 3 0 0 1 47 12V36A3 3 0 0 1 44 39H4A3 3 0 0 1 1 36V12A3 3 0 0 1 4 9Z M4.2 12.2H43.8V35.8H4.2Z M7.4 15.4H40.6V32.6H7.4Z M17 24a7 5 0 1 0 14 0a7 5 0 1 0 -14 0Z"/>`,
  },
  // three bent arrows chasing round an upright triangle: a bar along one side
  // that folds at the corner and heads up the next; the 16 px drawing has a
  // larger triangle, shorter bars and bigger heads (follow-up 1 of #478)
  recycling: {
    vb: '0 0 48 48',
    big: `<g><polyline points="19.51,34.75 40.02,34.75 39.06,33.09" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="miter" stroke-miterlimit="4"/><polygon points="35.54,26.98 45.99,29.09 32.13,37.09"/></g><g transform="rotate(120 24 25.5)"><polyline points="19.51,34.75 40.02,34.75 39.06,33.09" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="miter" stroke-miterlimit="4"/><polygon points="35.54,26.98 45.99,29.09 32.13,37.09"/></g><g transform="rotate(240 24 25.5)"><polyline points="19.51,34.75 40.02,34.75 39.06,33.09" fill="none" stroke="currentColor" stroke-width="6" stroke-linejoin="miter" stroke-miterlimit="4"/><polygon points="35.54,26.98 45.99,29.09 32.13,37.09"/></g>`,
    small: `<g><polyline points="22.51,36.75 42.62,36.75 42.25,36.1" fill="none" stroke="currentColor" stroke-width="8.4" stroke-linejoin="miter" stroke-miterlimit="4"/><polygon points="36.66,26.43 49.87,31.71 34.63,40.5"/></g><g transform="rotate(120 24 26)"><polyline points="22.51,36.75 42.62,36.75 42.25,36.1" fill="none" stroke="currentColor" stroke-width="8.4" stroke-linejoin="miter" stroke-miterlimit="4"/><polygon points="36.66,26.43 49.87,31.71 34.63,40.5"/></g><g transform="rotate(240 24 26)"><polyline points="22.51,36.75 42.62,36.75 42.25,36.1" fill="none" stroke="currentColor" stroke-width="8.4" stroke-linejoin="miter" stroke-miterlimit="4"/><polygon points="36.66,26.43 49.87,31.71 34.63,40.5"/></g>`,
  },
}
