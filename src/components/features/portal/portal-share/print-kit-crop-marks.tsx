// The crop marks round the trim, at the same offsets the PDF draws them.

import type { CSSProperties } from 'react'
import { A6_HEIGHT_MM, A6_WIDTH_MM } from '#/shared/domain/portal-print-kit'
import {
  MARK_LENGTH_MM,
  MARK_OFFSET_MM,
  SLUG_MM,
} from '#/shared/domain/portal-print-kit-layout'
import { mmToContainerWidth } from './print-kit-art-layout'

const HAIRLINE_MM = 0.25

/** Eight lines: across and along each corner of the trim, pointing away from the art. */
export function PrintKitCropMarks({ pageWidthMm }: Readonly<{ pageWidthMm: number }>) {
  const u = (millimetres: number) => mmToContainerWidth(millimetres, pageWidthMm)
  const left = SLUG_MM
  const right = SLUG_MM + A6_WIDTH_MM
  const top = SLUG_MM
  const bottom = SLUG_MM + A6_HEIGHT_MM
  const line = (style: CSSProperties) => (
    <span
      aria-hidden
      style={{ position: 'absolute', background: 'var(--foreground)', ...style }}
    />
  )
  const across = (x: number, y: number, direction: 1 | -1) =>
    line({
      left: u(
        direction === -1 ? x - MARK_OFFSET_MM - MARK_LENGTH_MM : x + MARK_OFFSET_MM,
      ),
      top: u(y - HAIRLINE_MM / 2),
      width: u(MARK_LENGTH_MM),
      height: u(HAIRLINE_MM),
    })
  const along = (x: number, y: number, direction: 1 | -1) =>
    line({
      left: u(x - HAIRLINE_MM / 2),
      top: u(direction === -1 ? y - MARK_OFFSET_MM - MARK_LENGTH_MM : y + MARK_OFFSET_MM),
      width: u(HAIRLINE_MM),
      height: u(MARK_LENGTH_MM),
    })
  return (
    <>
      {across(left, top, -1)}
      {across(left, bottom, -1)}
      {across(right, top, 1)}
      {across(right, bottom, 1)}
      {along(left, top, -1)}
      {along(right, top, -1)}
      {along(left, bottom, 1)}
      {along(right, bottom, 1)}
    </>
  )
}
