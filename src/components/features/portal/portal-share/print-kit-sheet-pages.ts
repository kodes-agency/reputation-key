// The pages a choice prints on, for the preview: the same `printKitSheetPages` the
// PDF draws, asked with the faces the preview has. A choice the kit does not make
// has none (the Share tab never offers one), so the preview draws nothing for it.

import type { PrintFace } from '#/shared/domain/portal-print-kit'
import {
  printKitFormatProblem,
  printKitSheetPages,
  type PrintKitFormatChoice,
} from '#/shared/domain/portal-print-kit-formats'
import type { PrintKitPaper } from '#/shared/domain/portal-print-kit'
import type { PrintKitPage } from '#/shared/domain/portal-print-kit-sheets'

export function previewSheetPages(
  format: Omit<PrintKitFormatChoice, 'languageCount'> &
    Readonly<{ paper: PrintKitPaper }>,
  faces: readonly PrintFace[],
  tilePt: number,
): readonly PrintKitPage[] | null {
  const languageCount = faces[0]?.blocks.length ?? 1
  if (printKitFormatProblem({ ...format, languageCount }) !== null) return null
  return printKitSheetPages({
    ...format,
    languageCount,
    faceCount: faces.length,
    tilePt,
  })
}
