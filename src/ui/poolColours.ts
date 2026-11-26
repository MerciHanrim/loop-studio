import { readAccent } from '../model/model'
import type { TimelineSeries } from '../model/serialize'
import { resolveTimelineSeries } from '../model/timelineSeries'
import { SERIES_PALETTE, seriesColours } from './seriesDash'

// The colour a series is drawn in, one rule for every chart (issue #614 item 2). The Live chart
// set it and the Distribution chart did not: Distribution coloured a Pool by its place in the
// Monte Carlo result and never by its own colour, so one Pool read two colours once a colour
// was set or only some Pools were tracked.

type SeriesNode = { id: string; data: { kind: string; label: string; accent?: unknown } }
export type OwnSeries = { id: string; label: string; color: string }

/** the chart palette by index (`--series-1` … `-6`, repeating) */
export const paletteColour = (i: number): string => SERIES_PALETTE[i % SERIES_PALETTE.length]!.css

/** docs/flow-colour-and-compact-nodes.md FC-6 — a Pool or Register with a flow colour draws its
 *  series in it; every other series keeps its colour by index, so colouring one node never
 *  recolours another series. No flow colour under forced colours (FC-3.4). Edge colours never
 *  reach the timeline. */
export const ownSeriesColour = (accent: unknown, i: number, forced: boolean): string => (!forced && readAccent(accent)) || paletteColour(i)

/** every Pool, in document order, with its own colour: its flow colour, else the palette by its
 *  index among the document's Pools */
export function ownPoolSeries(nodes: readonly SeriesNode[], forced: boolean): OwnSeries[] {
  return nodes.filter((n) => n.data.kind === 'pool').map((n, i) => ({ id: n.id, label: n.data.label, color: ownSeriesColour(n.data.accent, i, forced) }))
}

/** every Register, after the Pools in the palette's order */
export function ownRegisterSeries(nodes: readonly SeriesNode[], poolCount: number, forced: boolean): OwnSeries[] {
  return nodes.filter((n) => n.data.kind === 'register').map((n, i) => ({ id: n.id, label: n.data.label, color: ownSeriesColour(n.data.accent, poolCount + i, forced) }))
}

/** each Pool's chart colour once the Live chart has told shared colours apart among the drawn
 *  lines (`seriesColours`); under forced colours, its own (the palette by index already) */
export function chartPoolColours(pools: readonly OwnSeries[], drawn: ReadonlySet<string>, forced: boolean): Map<string, string> {
  if (forced) return new Map(pools.map((p) => [p.id, p.color]))
  const colours = seriesColours(pools, drawn)
  return new Map(pools.map((p) => [p.id, colours.get(p.id) ?? p.color]))
}

/** each Pool's colour in the Live chart, from the document and the stored Timeline series
 *  choice: what the Distribution chart draws a Pool in, so one Pool reads one colour */
export function livePoolColours(nodes: readonly SeriesNode[], timelineSeries: TimelineSeries, forced: boolean): Map<string, string> {
  const pools = ownPoolSeries(nodes, forced)
  const registers = ownRegisterSeries(nodes, pools.length, forced)
  const drawn = new Set(resolveTimelineSeries(timelineSeries, [...pools.map((p) => p.id), ...registers.map((r) => r.id)]))
  return chartPoolColours(pools, drawn, forced)
}
