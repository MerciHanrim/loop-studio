/**
 * The document's model-semantics version and the capability checks code asks
 * of it (SEMANTICS-M2.md §M2-1; #471, the version boundary of the kinds
 * contract).
 *
 * A version is a point on one axis: `loop-studio/graph` is 1, `/graph/2` is 2,
 * and a later meaning is a later number. What a version ENABLES is kept by
 * every version after it, so code never asks `modelVersion === 2` — that reads
 * a newer document as v1 — it asks for the capability, and the capability is a
 * `>=`. The readable set is what `modelVersionForSchema()` in `serialize.ts`
 * accepts; a version this module can name but that function does not return is
 * one no document can declare yet (fail-closed on open, §M2-1).
 */

/** The model-semantics versions this build can name. Reading a version is
 *  decided in `serialize.ts` (`modelVersionForSchema`), not here. */
export type ModelSemanticsVersion = 1 | 2 | 3 | 4

/** loop-model/2 and later — the model layer (SEMANTICS-M2.md): a `resource`
 *  flow may be an `@id` Parameter reference, an activator may compare against a
 *  Parameter term, a Parameter's `value` is engine input (#409), a Gate's
 *  chance may come from a Parameter, and the projection carries the §M2-8
 *  discriminator. Absent reads as 1 (a plain `loop-studio/graph` file). */
export function hasModelLayer(modelVersion: ModelSemanticsVersion | number | undefined): boolean {
  return (modelVersion ?? 1) >= 2
}

/** loop-model/3 and later — the kinds table (SEMANTICS-M3.md): a document may
 *  declare resource kinds, opt a kind into per-kind conservation and name its
 *  base unit; the engine reads every connection's kind and refuses a run where
 *  a conserved kind is involved and a recipe is broken or cannot be computed.
 *  A `kinds` key on a document of an earlier version is not read (§M3-1). */
export function hasKindsTable(modelVersion: ModelSemanticsVersion | number | undefined): boolean {
  return (modelVersion ?? 1) >= 3
}

/** loop-model/4 and later — units and the step length (SEMANTICS-M4.md): a
 *  kind may declare amount units and rate units, a document its step length,
 *  and a number field of a declared kind keeps its authored unit; the engine
 *  reads the derived value. `units`, `rateUnits`, `time` and a field's `unit`
 *  on a document of an earlier version are not read (§M4-1). */
export function hasUnits(modelVersion: ModelSemanticsVersion | number | undefined): boolean {
  return (modelVersion ?? 1) >= 4
}

/** The §M2-8 discriminator a model-layer document's canonical projection and
 *  digest carry (`"loop-model/2"` for version 2, `"loop-model/N"` for N), and
 *  `undefined` for a version-1 document, whose bytes stay untouched (M2-INV-9). */
export function modelSemanticsLabel(modelVersion: ModelSemanticsVersion | number | undefined): ModelSemanticsLabel | undefined {
  return hasModelLayer(modelVersion) ? `loop-model/${modelVersion as number}` : undefined
}

export type ModelSemanticsLabel = `loop-model/${number}`

/** `true` for a string shaped like the §M2-8 discriminator of any model-layer version. */
export function isModelSemanticsLabel(v: unknown): v is ModelSemanticsLabel {
  return typeof v === 'string' && /^loop-model\/[1-9]\d*$/.test(v) && v !== 'loop-model/1'
}
