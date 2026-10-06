import { useEffect, useEffectEvent, useId, useMemo, useRef, useState } from 'react'
import { useT, type MessageKey } from '../i18n'
import { parseAccentInput, readAccent } from '../model/model'
import { accentTargets, useGraphStore } from '../store/graphStore'
import { readRecentAccents, rememberAccent } from '../store/recentAccents'
import { accentNotices, FLOW_PALETTE, type AccentNotice } from '../ui/flowColour'
import { useIsMobile } from '../ui/media'

// docs/flow-colour-and-compact-nodes.md FC-5 — the Inspector's Colour section.
//
// It applies to every node and edge React Flow marks `selected`, or to the one
// element the Inspector shows when none is marked (`accentTargets`); the
// selection model and the Inspector's anchor are unchanged. One choice is one
// `setAccent` call: one undo entry, never a simulation change (FC-2.4).
//
// The browser's colour input applies on its real `change` only — never on
// opening it, never on the live `input` events while it is open — so opening it
// on Default or on a mixed selection applies nothing.
//
// Each colour is offered once: Recent leaves out the palette's colours, and
// In this document leaves out both, so the current colour's ring shows once.
//
// On the phone the Inspector is a read-only sheet (docs/mobile.md MV-D3): the
// section is one line of read-only text there, a dot and the colour's name and
// hex (its hex alone off the palette; Default with an empty ring; Mixed with no
// dot), instead of the disabled editor.

const NOTICE_KEY = {
  'canvas-light': 'inspector.accent.notice.canvasLight',
  'canvas-dark': 'inspector.accent.notice.canvasDark',
  'node-light': 'inspector.accent.notice.nodeLight',
  'node-dark': 'inspector.accent.notice.nodeDark',
} satisfies Record<string, MessageKey>

const noticeKey = (n: AccentNotice): MessageKey =>
  n.kind === 'state' ? 'inspector.accent.notice.state' : NOTICE_KEY[`${n.place}-${n.theme}`]

/** what the browser colour input shows while there is no single colour */
const PICKER_NEUTRAL = '#808080'
const DOCUMENT_MAX = 12
const PALETTE_HEX: ReadonlySet<string> = new Set(FLOW_PALETTE.map((p) => p.hex))
const paletteEntry = (hex: string) => FLOW_PALETTE.find((p) => p.hex === hex)

export function AccentField() {
  const t = useT()
  const ids = useId()
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId)
  const selectedEdgeId = useGraphStore((s) => s.selectedEdgeId)
  const setAccent = useGraphStore((s) => s.setAccent)
  const isMobile = useIsMobile()

  const targets = useMemo(
    () => accentTargets({ nodes, edges, selectedNodeId, selectedEdgeId }),
    [nodes, edges, selectedNodeId, selectedEdgeId],
  )
  const count = targets.nodeIds.length + targets.edgeIds.length

  // the selection's colour: one value (a hex, or `null` for Default) or mixed
  const current = useMemo(() => {
    const nodeSet = new Set(targets.nodeIds)
    const edgeSet = new Set(targets.edgeIds)
    const values = new Set<string | null>()
    for (const n of nodes) if (nodeSet.has(n.id)) values.add(readAccent((n.data as { accent?: unknown }).accent) ?? null)
    for (const e of edges) if (edgeSet.has(e.id)) values.add(readAccent((e.data as { accent?: unknown } | undefined)?.accent) ?? null)
    return values.size === 1 ? { mixed: false as const, value: [...values][0] ?? null } : { mixed: true as const, value: null }
  }, [nodes, edges, targets])

  const [recent, setRecent] = useState<string[]>(() => readRecentAccents())
  // Recent without the palette's colours
  const recentShown = useMemo(() => recent.filter((a) => !PALETTE_HEX.has(a)), [recent])

  // FC-2.7 — "In this document": distinct colours by first use, derived, without
  // the colours the palette or Recent already offer
  const documentColours = useMemo(() => {
    const shown = new Set<string>([...PALETTE_HEX, ...recentShown])
    const out: string[] = []
    for (const el of [...nodes, ...edges]) {
      const a = readAccent((el.data as { accent?: unknown } | undefined)?.accent)
      if (a !== undefined && !shown.has(a) && !out.includes(a)) out.push(a)
      if (out.length === DOCUMENT_MAX) break
    }
    return out
  }, [nodes, edges, recentShown])
  const [hexDraft, setHexDraft] = useState<string | null>(null)
  const [hexError, setHexError] = useState<'alpha' | 'format' | null>(null)

  const apply = (value: string | null) => {
    if (count === 0) return
    setAccent(targets.nodeIds, targets.edgeIds, value)
    if (value !== null) setRecent(rememberAccent(value))
  }

  // the browser input: its real `change` only (React's onChange is `input`)
  const pickerRef = useRef<HTMLInputElement>(null)
  const onPickerChange = useEffectEvent((value: string) => {
    const parsed = parseAccentInput(value)
    if (parsed.ok) apply(parsed.value)
  })
  const hasTargets = count > 0
  useEffect(() => {
    const el = pickerRef.current
    if (!el) return
    const onChange = () => onPickerChange(el.value)
    el.addEventListener('change', onChange)
    return () => el.removeEventListener('change', onChange)
  }, [hasTargets])
  // show the selection's colour; setting `.value` fires no `change`
  const pickerValue = current.value?.toLowerCase() ?? PICKER_NEUTRAL
  useEffect(() => {
    if (pickerRef.current) pickerRef.current.value = pickerValue
  }, [pickerValue, hasTargets])

  const commitHex = () => {
    if (hexDraft === null) return
    const parsed = parseAccentInput(hexDraft)
    if (parsed.ok) {
      apply(parsed.value)
      setHexDraft(null)
      setHexError(null)
    } else if (parsed.reason === 'empty') {
      setHexDraft(null)
      setHexError(null)
    } else {
      setHexError(parsed.reason)
    }
  }

  if (count === 0) return null

  if (isMobile) {
    const entry = current.value ? paletteEntry(current.value) : undefined
    return (
      <section className="accent-field accent-field--summary" aria-labelledby={`${ids}-title`}>
        <h3 className="field__label accent-field__title" id={`${ids}-title`}>
          {t('inspector.accent.title')}
        </h3>
        <p className="accent-field__summary">
          {/* Mixed has no dot: a dot would read as one particular colour */}
          {current.mixed ? null : (
            <span
              className={`accent-field__dot${current.value ? '' : ' accent-field__dot--none'}`}
              style={current.value ? { ['--swatch' as string]: current.value } : undefined}
              aria-hidden="true"
            />
          )}
          {current.mixed ? (
            <span>{t('inspector.accent.mixed')}</span>
          ) : current.value === null ? (
            <span>{t('inspector.accent.default')}</span>
          ) : (
            <>
              {/* a real space, so the text reads "Rose #B47599", not one word */}
              {entry ? <span>{t(`canvas.frame.color.${entry.id}` as MessageKey)}</span> : null}
              {entry ? ' ' : null}
              <span className="accent-field__hexvalue" dir="ltr">
                {current.value}
              </span>
            </>
          )}
        </p>
      </section>
    )
  }

  const notices = current.value ? accentNotices(current.value, { nodes: targets.nodeIds.length > 0, edges: targets.edgeIds.length > 0 }) : []
  const pressed = (v: string | null) => !current.mixed && current.value === v

  const swatch = (value: string, label: string, key: string) => (
    <button
      key={key}
      type="button"
      className="accent-swatch"
      style={{ ['--swatch' as string]: value }}
      aria-label={label}
      aria-pressed={pressed(value)}
      title={label}
      onClick={() => apply(value)}
    />
  )

  return (
    <section className="accent-field" aria-labelledby={`${ids}-title`}>
      <h3 className="field__label accent-field__title" id={`${ids}-title`}>
        {t('inspector.accent.title')}
      </h3>
      {count > 1 ? <p className="inspector__note accent-field__count">{t('inspector.accent.appliesTo', { n: count })}</p> : null}
      {current.mixed ? <p className="inspector__note accent-field__mixed">{t('inspector.accent.mixed')}</p> : null}

      <div className="accent-field__row" role="group" aria-label={t('inspector.accent.palette')}>
        <button
          type="button"
          className="accent-swatch accent-swatch--default"
          aria-pressed={pressed(null)}
          onClick={() => apply(null)}
        >
          {t('inspector.accent.default')}
        </button>
        {FLOW_PALETTE.map((p) => swatch(p.hex, t(`canvas.frame.color.${p.id}` as MessageKey), `p-${p.id}`))}
      </div>

      {recentShown.length > 0 ? (
        <div className="accent-field__row" role="group" aria-label={t('inspector.accent.recent')}>
          <span className="accent-field__rowlabel" aria-hidden="true">{t('inspector.accent.recent')}</span>
          {recentShown.map((a) => swatch(a, a, `r-${a}`))}
        </div>
      ) : null}

      {documentColours.length > 0 ? (
        <div className="accent-field__row" role="group" aria-label={t('inspector.accent.document')}>
          <span className="accent-field__rowlabel" aria-hidden="true">{t('inspector.accent.document')}</span>
          {documentColours.map((a) => swatch(a, a, `d-${a}`))}
        </div>
      ) : null}

      <div className="accent-field__custom">
        <label className="accent-field__hex">
          <span className="field__label">{t('inspector.accent.hex')}</span>
          <input
            type="text"
            dir="ltr"
            spellCheck={false}
            autoComplete="off"
            maxLength={16}
            value={hexDraft ?? current.value ?? ''}
            placeholder={current.mixed ? t('inspector.accent.mixed') : '#336699'}
            aria-invalid={hexError ? true : undefined}
            aria-describedby={hexError ? `${ids}-hexerr` : undefined}
            onChange={(e) => {
              setHexDraft(e.target.value)
              setHexError(null)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                commitHex()
              } else if (e.key === 'Escape') {
                setHexDraft(null)
                setHexError(null)
              }
            }}
            onBlur={commitHex}
          />
        </label>
        <label className="accent-field__picker">
          <span className="field__label">{t('inspector.accent.picker')}</span>
          <input ref={pickerRef} type="color" defaultValue={PICKER_NEUTRAL} />
        </label>
      </div>
      {hexError ? (
        <p className="inspector__note inspector__note--warn" id={`${ids}-hexerr`}>
          {t(hexError === 'alpha' ? 'inspector.accent.error.alpha' : 'inspector.accent.error.format')}
        </p>
      ) : null}

      <div className="accent-field__notices" aria-live="polite">
        {notices.map((n) => (
          <p key={noticeKey(n)} className="inspector__note inspector__note--warn">
            {t(noticeKey(n))}
          </p>
        ))}
      </div>
    </section>
  )
}
