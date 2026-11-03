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
  wind: {
    vb: '0 0 48 48',
    big: `<g transform="translate(2.4 1.2)"><path d="M4 13c0-1.1.7-1.9 1.7-2L29 8.6v5.6L5.7 15.1C4.7 15 4 14.2 4 13Z"/><path d="M29 11.4a4.8 4.8 0 1 0-4.8-4.8" fill="none" stroke="currentColor" stroke-width="5.6" stroke-linecap="round"/><path d="M4 25c0-1.2.8-2.1 1.9-2.2L36 20.9v6.2L5.9 27.2C4.8 27.1 4 26.2 4 25Z"/><path d="M36 24a5.4 5.4 0 1 1-5.4 5.4" fill="none" stroke="currentColor" stroke-width="6.2" stroke-linecap="round"/><path d="M4 38.5c0-1 .7-1.8 1.6-1.9L21 35.3a3.2 3.2 0 0 1 0 6.4L5.6 40.4C4.7 40.3 4 39.5 4 38.5Z"/></g>`,
    small: `<g transform="translate(24 24) scale(1.14) translate(-20.2 -20.8)"><path d="M3 16c0-1.4 1-2.4 2.3-2.6L31 11.2v7.6L5.3 18.6C4 18.4 3 17.4 3 16Z"/><path d="M31 15a6.6 6.6 0 1 0-6.6-6.6" fill="none" stroke="currentColor" stroke-width="7.6" stroke-linecap="round"/><path d="M7 33c0-1.4 1-2.4 2.3-2.6L33 28.2a4.4 4.4 0 0 1 0 8.8L9.3 35.6C8 35.4 7 34.4 7 33Z"/></g>`,
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
  'nuclear-plant': {
    vb: '0 0 48 48',
    big: `<path d="M7.3 8a3.2 3.2 0 1 0 6.4 0a3.2 3.2 0 1 0-6.4 0Z"/><circle cx="16" cy="6.6" r="4"/><circle cx="21.4" cy="8.6" r="3"/><path d="M3.5 41C6.5 35 8 31 8 27C8 22 7 18 7 14H23C23 18 22 22 22 27C22 31 23.5 35 26.5 41Z"/><path fill-rule="evenodd" d="M28.5 41V31A8.75 8.75 0 0 1 46 31V41Z M35 31.5a2.25 2.25 0 1 0 4.5 0a2.25 2.25 0 1 0-4.5 0Z"/><path d="M2 41h44v3.5H2Z"/>`,
    small: `<circle cx="11" cy="7" r="4"/><circle cx="18.5" cy="6" r="4.6"/><path d="M2.5 42C6 37 8.5 32 8.5 27.5C8.5 22 6.5 18 6.5 14H23.5C23.5 18 21.5 22 21.5 27.5C21.5 32 24 37 27.5 42Z"/><path d="M30 42V32A8 8 0 0 1 46 32V42Z"/><path d="M1 42h46v4H1Z"/>`,
  },
  warehouse: {
    vb: '0 0 48 48',
    big: `<path fill-rule="evenodd" d="M3 19L24 7L45 19V41H3Z M9 41V24H39V41Z M21.8 15.5a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0Z"/><path d="M12 27.5H36V30.5H12Z M12 32.5H36V35.5H12Z M12 37.5H36V40.5H12Z"/>`,
    small: `<path fill-rule="evenodd" d="M2 20L24 6L46 20V42H2Z M9 42V25H39V42Z"/><path d="M9 28H39V32H9Z M9 35H39V39H9Z"/>`,
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
