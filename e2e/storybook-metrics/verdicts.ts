// Turns measurements into violation lines. Pure: no page, no Playwright — every
// input is a report `pane-metrics.ts` or `layer-probe.ts` already produced, so
// a red run can be re-judged from its `pane-metrics.json` attachment alone.
//
// Every failed rule is one line naming the story, the width, the stage (the
// play's final frame, a layer the harness opened, or the pane after the harness
// opened its disclosures), the element's accessible name and its measured box
// — so a red run says what to fix without re-running anything by hand.

import type { ExpansionReport, ProbeReport } from './layer-probe'
import {
  COMPOSER_PRIMARY_NAMES,
  DESKTOP_TARGET_MIN_PX,
  PHONE_BELOW_PX,
  PHONE_CONTROL_MIN_PX,
  PHONE_THUMB_MIN_PX,
  type Box,
  type MeasuredLayer,
  type MeasuredTarget,
  type PaneReport,
  type TargetKind,
} from './pane-metrics'

export type Expectations = Readonly<{
  storyId: string
  width: number
  paneSelector: string
  /** The story shows the composer's primary; its absence is a failure. */
  requiresPrimary: boolean
  /**
   * `false` for a harness whose slots are stand-ins: target sizes are not
   * judged there; overflow, clipping, layers and the primary's position are.
   */
  judgesTargets: boolean
}>

function minimumFor(kind: TargetKind, width: number): number {
  if (width >= PHONE_BELOW_PX) return DESKTOP_TARGET_MIN_PX
  return kind === 'control' ? PHONE_CONTROL_MIN_PX : PHONE_THUMB_MIN_PX
}

const px = (n: number): string => n.toFixed(1)
const describeBox = (box: Box): string =>
  `${px(box.width)}x${px(box.height)} at (${px(box.x)}, ${px(box.y)})`

function targetLines(
  targets: ReadonlyArray<MeasuredTarget>,
  width: number,
  where: string,
): string[] {
  return targets.flatMap((target) => {
    const minimum = minimumFor(target.kind, width)
    if (Math.min(target.box.width, target.box.height) >= minimum) return []
    return [
      `${where}"${target.name}" (${target.role}, ${target.kind}) measures ` +
        `${describeBox(target.box)}; its smaller side must be >= ${minimum} px at ${width} px`,
    ]
  })
}

function geometryLines(
  report: Pick<PaneReport, 'overflows' | 'clips'>,
  where: string,
): string[] {
  return [
    ...report.overflows.map(
      (o) =>
        `${where}${o.name} scrolls horizontally: scrollWidth ${o.scrollWidth} > clientWidth ${o.clientWidth}`,
    ),
    ...report.clips.map(
      (c) =>
        `${where}"${c.name}" (${c.role}) at ${describeBox(c.box)} is clipped by ${c.clipper}, ` +
        `whose box runs ${px(c.clipLeft)}..${px(c.clipRight)}`,
    ),
  ]
}

function layerLines(
  layer: MeasuredLayer,
  expectations: Expectations,
  viewport: Readonly<{ width: number; height: number }>,
  where: string,
): string[] {
  const at = `${where}${layer.role} "${layer.name}": `
  return [
    ...(expectations.judgesTargets
      ? targetLines(layer.targets, expectations.width, at)
      : []),
    ...geometryLines(layer, at),
    ...layer.outside.map(
      (o) =>
        `${at}"${o.name}" (${o.role}) at ${describeBox(o.box)} is outside the ` +
        `${viewport.width}x${viewport.height} viewport`,
    ),
  ]
}

/**
 * The pane as measured: targets, overflow and clipping, its own box against
 * the window, the document, the composer's primary, and any layer open over
 * it. `stage` prefixes every line after the story and width.
 */
export function paneViolations(
  expectations: Expectations,
  pane: PaneReport,
  stage = '',
): ReadonlyArray<string> {
  const { storyId, width, paneSelector, requiresPrimary, judgesTargets } = expectations
  const at = `${storyId} @ ${width}px: ${stage}`
  if (pane.paneCount === 0) {
    return [`${at}no visible pane matched ${paneSelector} — nothing was measured`]
  }
  const { viewport } = pane
  const sizes = judgesTargets ? targetLines(pane.targets, width, at) : []
  const paneOffScreen = pane.paneBoxes
    .filter((box) => box.x < -0.5 || box.x + box.width > viewport.width + 0.5)
    .map(
      (box) =>
        `${at}the pane (${paneSelector}) at ${describeBox(box)} runs past the ${viewport.width} px window`,
    )
  const document =
    pane.documentScrollWidth > viewport.width
      ? [
          `${at}the document scrolls horizontally: scrollWidth ${pane.documentScrollWidth} > viewport ${viewport.width}`,
        ]
      : []
  const missingPrimary =
    requiresPrimary && pane.primaries.length === 0
      ? [
          `${at}no composer primary (${COMPOSER_PRIMARY_NAMES.join(' / ')}) is visible in the pane`,
        ]
      : []
  const primaries = pane.primaries.flatMap((p) => [
    ...(p.inViewport
      ? []
      : [
          `${at}primary "${p.name}" at ${describeBox(p.box)} is outside the ${viewport.width}x${viewport.height} viewport`,
        ]),
    ...(p.coveredBy === null
      ? []
      : [
          `${at}primary "${p.name}" at ${describeBox(p.box)} is covered by ${p.coveredBy}`,
        ]),
  ])
  const layers = pane.layers.flatMap((layer) =>
    layerLines(layer, expectations, viewport, `${at}open `),
  )
  return [
    ...sizes,
    ...geometryLines(pane, at),
    ...paneOffScreen,
    ...document,
    ...missingPrimary,
    ...primaries,
    ...layers,
  ]
}

/** Every layer the harness opened, and every trigger it could not open. */
export function probeViolations(
  expectations: Expectations,
  viewport: Readonly<{ width: number; height: number }>,
  probes: ReadonlyArray<ProbeReport>,
  stage = '',
): ReadonlyArray<string> {
  const at = `${expectations.storyId} @ ${expectations.width}px: ${stage}`
  return probes.flatMap((probe) => [
    ...(probe.error === null ? [] : [`${at}trigger "${probe.trigger}" ${probe.error}`]),
    ...probe.layers.flatMap((layer) =>
      layerLines(layer, expectations, viewport, `${at}"${probe.trigger}" opened `),
    ),
  ])
}

/** A disclosure the harness could not open is a line of its own. */
export function expansionViolations(
  expectations: Expectations,
  expansion: ExpansionReport,
): ReadonlyArray<string> {
  const at = `${expectations.storyId} @ ${expectations.width}px: `
  return expansion.errors.map((error) => `${at}${error}`)
}

/**
 * The expanded pane repeats every line the final frame already produced — a
 * 28 px control is still 28 px after a fold opens, only lower down. A line is
 * new when it differs from every earlier one once the stage and the box's
 * position are set aside.
 */
export function onlyNew(
  lines: ReadonlyArray<string>,
  already: ReadonlyArray<string>,
  stage: string,
): ReadonlyArray<string> {
  const key = (line: string): string =>
    line.replace(stage, '').replace(/ at \(-?[\d.]+, -?[\d.]+\)/g, '')
  const seen = new Set(already.map(key))
  return lines.filter((line) => !seen.has(key(line)))
}
