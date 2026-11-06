import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useT, type MessageKey } from '../i18n'
import { isolateAuto } from '../i18n/bidiIsolate'
import { ruleOf, runFindings, runGroupOf, runNotices, groupLines, type RunRule } from '../model/runRule'
import { runWarnings } from '../model/runWarnings'
import type { LoopNode } from '../model/types'
import { fieldUnitText, poolKindName, resolveFieldUnit } from '../model/units'
import { useGraphStore } from '../store/graphStore'
import { useSimStore } from '../store/simStore'
import { fullPercent, poolAmounts, runNoticeText, runOffText, runRefusalText, runStreak, runWarningText } from '../ui/runMessages'
import { draftState, fractionOfPercent, isAboveZero, isPlainNumber, nextDraft, percentOfFraction, type RuleDraft } from '../ui/runRuleForm'
import { useStageTag } from './nodes/StageTag'

// SEMANTICS-M6.md §M6-9 — the Inspector's "Target run" section. It reads first: what the
// stage reads, what it did this step and why, so what a folded tag leaves out is here.
// Then the rule, made field by field. A document only ever holds a rule that reads, so a
// tank waiting for its level and band stays in the form, and says so.

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
    </label>
  )
}

/** a number kept as decimal text, set on Enter or on leaving the field, so clearing
 *  `500` never runs a level of `50` on the way. What does not read is dropped on blur. */
function DecimalField({ label, value, valid, hint, onCommit }: { label: string; value: string; valid: (text: string) => boolean; hint: MessageKey; onCommit: (text: string) => void }) {
  const t = useT()
  const [draft, setDraft] = useState<string | null>(null)
  const bad = draft !== null && draft.trim() !== '' && !valid(draft)
  const confirm = () => {
    if (draft !== null && valid(draft) && draft.trim() !== value) onCommit(draft.trim())
    setDraft(null)
  }
  return (
    <Field label={label}>
      <input
        type="text"
        inputMode="decimal"
        // §L9.3 — a number, never prose
        dir="ltr"
        value={draft ?? value}
        aria-invalid={bad || undefined}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={confirm}
        onKeyDown={(e) => {
          if (e.key === 'Enter') confirm()
        }}
      />
      {bad && <span className="inspector__note inspector__note--warn">{t(hint)}</span>}
    </Field>
  )
}

/** what the stage reads and did: the tag's whole words, the step's two numbers in full,
 *  and why it did not reach its target */
function RunReading({ node, rule }: { node: LoopNode; rule: RunRule | null }) {
  const t = useT()
  const nodes = useGraphStore((s) => s.nodes)
  const kinds = useGraphStore((s) => s.kinds)
  const time = useGraphStore((s) => s.time)
  const series = useSimStore((s) => s.series)
  const report = series[series.length - 1]?.runs?.find((r) => r.members.includes(node.id)) ?? null
  const tag = useStageTag(node.id, node.data)
  const amount = poolAmounts(nodes, kinds, time)
  const labelOf = (id: string) => nodes.find((n) => n.id === id)?.data.label ?? id
  const decider = nodes.find((n) => n.id === report?.decidedBy)
  const lowest = (decider ? ruleOf(decider) : rule)?.lowest
  return (
    <div className="run-reading" data-run-reading>
      {tag && <p className="run-reading__state" dir="auto">{tag.full}</p>}
      {report && (
        <>
          <p className="inspector__note">{t('inspector.run.now', { target: isolateAuto(fullPercent(report.target)), moved: isolateAuto(fullPercent(report.moved)) })}</p>
          {report.state === 'off' && <p className="inspector__note">{runOffText(report, lowest, t)}</p>}
          {report.rules.length > 1 &&
            report.rules.map((r) => (
              <p key={r.stage} className="inspector__note">
                {r.stage === report.decidedBy
                  ? t('inspector.run.ruleDecides', { label: isolateAuto(labelOf(r.stage)), target: isolateAuto(fullPercent(r.target)) })
                  : t('inspector.run.rule', { label: isolateAuto(labelOf(r.stage)), target: isolateAuto(fullPercent(r.target)) })}
              </p>
            ))}
          {runNotices([report], nodes).map((x) => (
            <p key={x.kind} className="inspector__note inspector__note--warn">
              {runNoticeText(x, runStreak(series, report.members[0]!), t, amount)}
            </p>
          ))}
        </>
      )}
    </div>
  )
}

export function RunRuleSection({ node }: { node: LoopNode }) {
  const t = useT()
  const id = node.id
  const nodes = useGraphStore((s) => s.nodes)
  const edges = useGraphStore((s) => s.edges)
  const kinds = useGraphStore((s) => s.kinds)
  const time = useGraphStore((s) => s.time)
  const timetables = useGraphStore((s) => s.timetables)
  const modelVersion = useGraphStore((s) => s.modelVersion)
  const setRunRule = useGraphStore((s) => s.setRunRule)
  const stored = ruleOf(node)
  const storedKey = JSON.stringify(stored)
  const [draft, setDraft] = useState<RuleDraft | null>(null)
  // "By a run rule" with nothing chosen yet holds no rule, and still shows the fields
  const [asked, setAsked] = useState(false)
  useEffect(() => setDraft(null), [storedKey]) // an undo, or a rule set elsewhere, ends the draft

  const form = draft ?? stored ?? {}
  const ruled = stored !== null || draft !== null || asked
  const group = useMemo(() => runGroupOf(nodes, edges, id), [nodes, edges, id])
  const otherRules = group.members.filter((m) => m !== id && ruleOf(nodes.find((n) => n.id === m)!) !== null)
  const findings = useMemo(() => runFindings(nodes, edges, timetables, kinds, time, modelVersion).filter((f) => f.stage === id), [nodes, edges, timetables, kinds, time, modelVersion, id])
  const warnings = useMemo(() => runWarnings(nodes, edges, timetables, kinds, time, id), [nodes, edges, timetables, kinds, time, id])
  const amount = poolAmounts(nodes, kinds, time)

  const change = (patch: Partial<RuleDraft>) => {
    const next = nextDraft(form, patch)
    const state = draftState(next)
    if (state.kind === 'empty') {
      setRunRule(id, null)
      setDraft(null)
      setAsked(true)
    } else if (state.kind === 'rule') {
      setRunRule(id, state.rule)
      setDraft(null)
    } else {
      setDraft(next)
    }
  }
  const setMode = (mode: string) => {
    setAsked(mode === 'rule')
    if (mode === 'full') {
      setDraft(null)
      setRunRule(id, null)
    }
  }

  const pools = nodes.filter((n) => n.data.kind === 'pool')
  const tank = pools.find((n) => n.id === form.tank)
  const tankData = tank?.data as { resourceType?: unknown; unit?: unknown } | undefined
  const unit = tank ? fieldUnitText(resolveFieldUnit(form.unit ?? tankData?.unit, kinds.find((k) => k.name === poolKindName(tankData)), time, 'stock')) || kinds.find((k) => k.name === poolKindName(tankData))?.baseUnit : undefined
  const labelOf = (x: string) => nodes.find((n) => n.id === x)?.data.label ?? x
  const lines = groupLines(edges, group.members)
  const missing = (x: string) => t('inspector.run.missing', { id: isolateAuto(x) })
  const lineText = (e: (typeof lines)[number]) => {
    const d = e.data as { flow?: unknown; unit?: unknown }
    const ends = t('inspector.ends.summary', { from: isolateAuto(labelOf(e.source)), to: isolateAuto(labelOf(e.target)) })
    return `${ends} · ${isolateAuto(`${String(d.flow ?? '')} ${String(d.unit ?? '')}`.trim())}`
  }

  return (
    <section className="wb-panel__sec" aria-label={t('inspector.run.title')} data-run-rule={id}>
      <h3 className="wb-panel__h">{t('inspector.run.title')}</h3>
      {stored && <RunReading node={node} rule={stored} />}
      {!stored && otherRules.length > 0 && (
        <>
          <p className="inspector__note">{t('inspector.run.group', { label: isolateAuto(otherRules.map(labelOf).join(', ')) })}</p>
          <RunReading node={node} rule={null} />
        </>
      )}
      <Field label={t('inspector.run.mode')}>
        <select value={ruled ? 'rule' : 'full'} disabled={!group.ok && !ruled} onChange={(e) => setMode(e.target.value)}>
          <option value="full">{t('inspector.run.mode.full')}</option>
          <option value="rule">{t('inspector.run.mode.rule')}</option>
        </select>
      </Field>
      {!group.ok && <p className="inspector__note">{t('inspector.run.shape')}</p>}
      {ruled && (
        <>
          <Field label={t('inspector.run.tank')}>
            <select value={form.tank ?? ''} onChange={(e) => change({ tank: e.target.value === '' ? undefined : e.target.value })}>
              <option value="">{t('inspector.run.none')}</option>
              {form.tank !== undefined && !tank && <option value={form.tank}>{missing(form.tank)}</option>}
              {pools.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.data.label || p.id}
                </option>
              ))}
            </select>
          </Field>
          {form.tank !== undefined && (
            <>
              <DecimalField label={t('inspector.run.level')} value={form.level ?? ''} valid={isPlainNumber} hint="inspector.run.bad.number" onCommit={(level) => change({ level })} />
              <DecimalField label={t('inspector.run.band')} value={form.band ?? ''} valid={isAboveZero} hint="inspector.run.bad.band" onCommit={(band) => change({ band })} />
              {unit && <p className="inspector__note">{t('inspector.run.unit', { unit: isolateAuto(unit) })}</p>}
              <Field label={t('inspector.run.side')}>
                <select value={form.side ?? 'fill'} onChange={(e) => change({ side: e.target.value as 'fill' | 'empty' })}>
                  <option value="fill">{t('inspector.run.side.fill')}</option>
                  <option value="empty">{t('inspector.run.side.empty')}</option>
                </select>
              </Field>
            </>
          )}
          {(timetables.length > 0 || form.table !== undefined) && (
            <Field label={t('inspector.run.table')}>
              <select value={form.table ?? ''} onChange={(e) => change({ table: e.target.value === '' ? undefined : e.target.value })}>
                <option value="">{t('inspector.run.none')}</option>
                {form.table !== undefined && !timetables.some((x) => x.id === form.table) && <option value={form.table}>{missing(form.table)}</option>}
                {timetables.map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.label}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {form.table !== undefined && (
            <Field label={t('inspector.run.rated')}>
              <select value={form.rated ?? ''} onChange={(e) => change({ rated: e.target.value === '' ? undefined : e.target.value })}>
                <option value="">{t('inspector.run.rated.choose')}</option>
                {form.rated !== undefined && !lines.some((e) => e.id === form.rated) && <option value={form.rated}>{missing(form.rated)}</option>}
                {lines.map((e) => (
                  <option key={e.id} value={e.id}>
                    {lineText(e)}
                  </option>
                ))}
              </select>
            </Field>
          )}
          {(form.tank !== undefined || form.table !== undefined) && (
            <DecimalField
              label={t('inspector.run.lowest')}
              value={percentOfFraction(form.lowest)}
              valid={(text) => text.trim() === '' || fractionOfPercent(text) !== null}
              hint="inspector.run.bad.lowest"
              onCommit={(text) => change({ lowest: text === '' ? undefined : fractionOfPercent(text)! })}
            />
          )}
          {form.tank === undefined && form.table === undefined && <p className="inspector__note">{t('inspector.run.choose')}</p>}
          {draft !== null && <p className="inspector__note inspector__note--warn">{t('inspector.run.incomplete')}</p>}
        </>
      )}
      {stored && findings.map((f) => <p key={f.code} className="inspector__note inspector__note--warn">{runRefusalText(f, nodes, t)}</p>)}
      {stored && warnings.map((w) => <p key={`${w.code}:${w.tank}`} className="inspector__note inspector__note--warn">{runWarningText(w, nodes, t, amount)}</p>)}
    </section>
  )
}
