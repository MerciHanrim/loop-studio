import { t, type MessageKey } from '../i18n'
import { isolateAuto } from '../i18n/bidiIsolate'
import type { ContentProblem } from '../model/revision'
import { useFrameStore } from '../store/frameStore'
import { useGraphStore } from '../store/graphStore'

// #619 follow-up — ONE sentence per cause of content that cannot be read, shared
// by the revision export and the data import (each adds its own outcome). The
// element is named by its own name, isolated, or by its id when the name is
// empty; a known node kind by its translated name. A problem with nothing to
// name (`other`, an internal check, a non-finite number with no element) has
// no sentence: the caller keeps its general text and guesses no cause.

/** the user's name for an element, or its id when the name is empty */
function nameOr(label: unknown, id: string): string {
  return typeof label === 'string' && label.trim() !== '' ? label : id
}

function nodeName(id: string): string {
  const n = useGraphStore.getState().nodes.find((x) => x.id === id)
  return nameOr((n?.data as { label?: unknown } | undefined)?.label, id)
}

function edgeName(id: string): string {
  const e = useGraphStore.getState().edges.find((x) => x.id === id)
  return nameOr((e?.data as { label?: unknown } | undefined)?.label, id)
}

function frameName(id: string): string {
  return nameOr(useFrameStore.getState().frames.find((f) => f.id === id)?.label, id)
}

/** the cause sentence, or null when the problem names nothing */
export function contentProblemSentence(problem: ContentProblem): string | null {
  switch (problem.kind) {
    case 'non-finite': {
      const el = problem.element
      if (!el) return null
      switch (el.type) {
        // one whole sentence per field, not a `select`: the field's word takes the
        // case and the position its language needs around the node's name
        case 'node':
          if (el.field === 'initial') return t('content.problem.nonFiniteNodeInitial', { node: isolateAuto(nodeName(el.id)) })
          if (el.field === 'capacity') return t('content.problem.nonFiniteNodeCapacity', { node: isolateAuto(nodeName(el.id)) })
          return t('content.problem.nonFiniteNodePosition', { node: isolateAuto(nodeName(el.id)) })
        case 'edge':
          if (el.field === 'delay') return t('content.problem.nonFiniteEdgeDelay', { edge: isolateAuto(edgeName(el.id)) })
          return t('content.problem.nonFiniteEdgeWaypoint', { edge: isolateAuto(edgeName(el.id)) })
        case 'frame':
          return t('content.problem.nonFiniteFrame', { frame: isolateAuto(frameName(el.id)) })
        case 'importRow':
          return t('content.problem.nonFiniteRow', { row: isolateAuto(el.id) })
      }
      return null
    }
    case 'unreadable-model-node':
      return t('content.problem.unreadableNode', { node: isolateAuto(nodeName(problem.nodeId)), kind: t(`canvas.nodeKind.${problem.nodeKind}` as MessageKey) })
    case 'model-node-in-v1':
      return t('content.problem.modelNodeInV1', { node: isolateAuto(nodeName(problem.nodeId)), kind: t(`canvas.nodeKind.${problem.nodeKind}` as MessageKey) })
    case 'unknown-kind':
      return t('content.problem.unknownKind', { node: isolateAuto(nodeName(problem.nodeId)), kind: isolateAuto(problem.nodeKind) })
    case 'other':
      return null
  }
}
