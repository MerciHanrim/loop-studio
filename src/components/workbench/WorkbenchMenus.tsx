import { useMemo } from 'react'
import { useT, type MessageKey } from '../../i18n'
import type { NodeKind } from '../../model/types'
import { WORTH_IT_FLOOR } from '../frames/autoFrames'
import { autoFramesStale, hasAutoFrames, useAutoFrameStore } from '../../store/autoFrameStore'
import { hasFrames, useFrameStore } from '../../store/frameStore'
import { useGraphStore } from '../../store/graphStore'
import { useMcStore } from '../../store/mcStore'
import { useSimStore } from '../../store/simStore'
import { useUiStore } from '../../store/uiStore'
import { chooseTool } from './canvasTools'
import { MenubarMenu, type MenuEntry } from './MenubarMenu'

// The workbench (2026-10, step 5) — the menu bar's Edit, Insert and Run. Each
// entry is an existing action, found where the canvas's control rail, the
// palette or the run bar offered it (share workbench-mapping.md); nothing here
// is a new behaviour. Under the edit lock the editing entries are disabled,
// as their rail buttons were (#334 / #338).

const KINDS: readonly NodeKind[] = ['pool', 'source', 'drain', 'gate', 'converter', 'end', 'parameter', 'register']

export function EditMenu() {
  const t = useT()
  const locked = useUiStore((s) => s.canvasLocked)
  const toggleLock = useUiStore((s) => s.toggleCanvasLocked)
  const canUndo = useGraphStore((s) => s.past.length > 0)
  const canRedo = useGraphStore((s) => s.future.length > 0)
  const undo = useGraphStore((s) => s.undo)
  const redo = useGraphStore((s) => s.redo)
  const tidy = useGraphStore((s) => s.tidyToGrid)
  const framesExist = useFrameStore(hasFrames)
  const clearFrames = useFrameStore((s) => s.clearFrames)
  const autoExist = useAutoFrameStore(hasAutoFrames)
  const clearAuto = useAutoFrameStore((s) => s.clearAuto)
  const entries: MenuEntry[] = [
    { kind: 'item', key: 'undo', label: t('workbench.edit.undo'), hint: t('toolbar.undo.title'), onSelect: undo, disabled: !canUndo || locked },
    { kind: 'item', key: 'redo', label: t('workbench.edit.redo'), hint: t('toolbar.redo.title'), onSelect: redo, disabled: !canRedo || locked },
    { kind: 'sep', key: 's1' },
    { kind: 'item', key: 'tidy', label: t('workbench.edit.tidy'), hint: t('canvas.tidy'), onSelect: () => void tidy(), disabled: locked },
    { kind: 'item', key: 'clear-frames', label: t('canvas.frame.clearAll'), onSelect: () => (clearFrames(), clearAuto()), disabled: locked || !(framesExist || autoExist) },
    { kind: 'item', key: 'clear-suggested', label: t('canvas.frame.clearSuggested'), onSelect: clearAuto, disabled: !autoExist },
    { kind: 'sep', key: 's2' },
    { kind: 'check', key: 'lock', label: t('canvas.lock.name'), checked: locked, onToggle: toggleLock },
  ]
  return <MenubarMenu id="edit" label={t('workbench.menu.edit')} entries={entries} />
}

export function InsertMenu({ addCentered }: { addCentered: (kind: NodeKind) => void }) {
  const t = useT()
  const locked = useUiStore((s) => s.canvasLocked)
  const nodes = useGraphStore((s) => s.nodes)
  const suggest = useAutoFrameStore((s) => s.suggest)
  const autoExist = useAutoFrameStore(hasAutoFrames)
  const signature = useAutoFrameStore((s) => s.lastSignature)
  // §AF2.2 — Suggest frames helps only on a graph big enough for it, and is
  // offered while suggested frames exist (to recompute them), as the canvas
  // rail's button was
  const eligible = useMemo(() => nodes.filter((n) => n.type !== 'parameter' && n.type !== 'register').length >= WORTH_IT_FLOOR, [nodes])
  // §AF4.3 — the structure or a node moved since the last Suggest: said on the
  // row, still no automatic recompute (the rail's `is-stale`)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stale = useMemo(() => autoFramesStale(signature), [signature, nodes])
  const entries: MenuEntry[] = [
    ...KINDS.map((k): MenuEntry => ({ kind: 'item', key: k, label: t(`palette.${k}.name` as MessageKey), hint: t(`palette.${k}.description` as MessageKey), onSelect: () => addCentered(k), disabled: locked })),
    { kind: 'sep', key: 's1' },
    { kind: 'item', key: 'frame', label: t('workbench.insert.frame'), hint: t('canvas.frame.draw'), onSelect: () => chooseTool('frame'), disabled: locked },
    {
      kind: 'item',
      key: 'suggest',
      label: t('workbench.insert.suggest'),
      hint: stale ? t('canvas.frame.suggestStale') : t('canvas.frame.suggest'),
      note: stale ? t('canvas.frame.suggestStale') : undefined,
      onSelect: () => suggest(),
      disabled: !(eligible || autoExist),
    },
  ]
  return <MenubarMenu id="insert" label={t('workbench.menu.insert')} entries={entries} />
}

export function RunMenu() {
  const t = useT()
  const status = useSimStore((s) => s.status)
  const initError = useSimStore((s) => s.initError)
  const play = useSimStore((s) => s.play)
  const pause = useSimStore((s) => s.pause)
  const step = useSimStore((s) => s.stepOnce)
  const reset = useSimStore((s) => s.reset)
  const openMc = useMcStore((s) => s.openDialog)
  const running = status === 'running'
  const ended = status === 'ended'
  // the run bar's primary button (PlayBar `onPrimary`): an ended run is
  // replayed from step 0, never played on past its end
  const primary = () => {
    if (ended) {
      reset()
      play()
    } else if (running) pause()
    else play()
  }
  const entries: MenuEntry[] = [
    { kind: 'item', key: 'play', label: ended ? t('playbar.replay') : running ? t('playbar.pause') : t('playbar.play'), onSelect: primary, disabled: initError != null },
    { kind: 'item', key: 'step', label: t('workbench.run.step'), hint: t('playbar.step.title'), onSelect: step, disabled: running || initError != null },
    { kind: 'item', key: 'reset', label: t('workbench.run.reset'), onSelect: reset },
    { kind: 'sep', key: 's1' },
    { kind: 'item', key: 'mc', label: t('workbench.run.mc'), onSelect: openMc },
  ]
  return <MenubarMenu id="run" label={t('workbench.menu.run')} entries={entries} />
}
