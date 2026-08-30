// loop-model/1 (SEMANTICS-M.md) — pure model-layer foundation.
//
// `parameter` / `register` node wire types + defensive read, advisory
// `resourceType` normalisation + mismatch findings, and the pure Register DAG
// evaluation pass. No engine wiring, no serialize/projection changes, no UI —
// those land in later slices.

export {
  PARAM_UNIT_MAX_BYTES,
  type ParamNotice,
  type ParamReadResult,
  type ParameterData,
  readParameterData,
} from './parameter'
export {
  type RegisterData,
  type RegisterFormat,
  type RegisterNotice,
  type RegReadResult,
  readRegisterData,
} from './register'
export {
  BUILTIN_RESOURCE_TYPES,
  type BuiltinResourceType,
  isBuiltinResourceType,
  type MismatchGraphView,
  normalizeResourceType,
  RESOURCE_TYPE_MAX_BYTES,
  type ResourceMismatchFinding,
  type ResourceTypeNorm,
  resourceTypeMismatches,
  sameResourceType,
} from './resourceType'
export {
  evaluateRegisters,
  type MRegCode,
  type RefKind,
  type RegisterOutcome,
  type RegisterSnapshotView,
} from './registers'
export { trimUnicodeWhitespace, truncateUtf8, utf8Len } from './text'
export {
  formatRegisterValue,
  initialPoolValues,
  registerSeriesRuns,
  registersOfSnapshot,
} from './observe'
