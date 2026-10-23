// The code block of a print, drawn as the PDF draws it (spec 2.3): the tile with
// the code on it, and under it the bar in the accent with a camera and the cue,
// in the lead language first, each line in its own `lang`. Both styles, both
// regions: only the outline differs, drawn on Paper alone.
//
// The plan (where the camera goes, how tall the bar is) and every measure come
// from the files the PDF reads. A face passes its own `pt` to size it in its
// container's units; alone, it is at its real size, 2 in or 192 px wide.

import {
  CAMERA_ICON,
  codeBlockColours,
  estimatedCueWidthPt,
  planCodeBlock,
  type CueLine,
} from '#/shared/domain/portal-print-kit-code-block'
import type { PrintKitPalette } from '#/shared/domain/portal-print-kit-palette'
import {
  codeBlockStyles,
  pointsToPixels,
  type PointsToLength,
} from './print-kit-code-block-layout'

type Props = Readonly<{
  palette: PrintKitPalette
  /** The lead language first; a second language sits below it. */
  cues: readonly CueLine[]
  /** The code as a picture with its quiet zone drawn in; null while it is made. */
  codeUrl: string | null
  /** Points on the print, as a length. Default: CSS pixels at 96 to the inch. */
  pt?: PointsToLength
}>

export function PrintKitCodeBlock({
  palette,
  cues,
  codeUrl,
  pt = pointsToPixels,
}: Props) {
  const plan = planCodeBlock(cues, estimatedCueWidthPt)
  const styles = codeBlockStyles(plan, codeBlockColours(palette), pt)
  return (
    <div aria-hidden data-print-code style={styles.root}>
      {/* While the code is made, the tile is as it will be: cream, with no code. */}
      {codeUrl !== null && <img src={codeUrl} alt="" style={styles.code} />}
      {codeUrl === null && <div style={styles.code} />}
      <div style={styles.bar}>
        <svg
          viewBox={`0 0 ${CAMERA_ICON.grid} ${CAMERA_ICON.grid}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={CAMERA_ICON.strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={styles.icon}
        >
          <path d={CAMERA_ICON.body} />
          <circle {...CAMERA_ICON.lens} />
        </svg>
        <div style={styles.cues}>
          {cues.map((cue) => (
            <span key={cue.locale} lang={cue.locale} style={styles.cue}>
              {cue.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
