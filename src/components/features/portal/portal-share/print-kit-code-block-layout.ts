// The code block's styles, from the same plan and measures the PDF draws from
// (`portal-print-kit-code-block.ts`, `portal-print-kit-measures.ts`). A pure
// function of the plan, the colours and a length function, so it can be tested
// without a DOM and the component stays a thin tree of elements.
//
// Inline styles on purpose, as the rest of the print preview's: the first-paint
// stylesheet is built by scanning `src/` for class names, and a measure this
// specific would be added to the stylesheet of every page in production.

/** A length in points, as a CSS length: pixels at 96 to the inch, or a share of a card's width. */
export type PointsToLength = (points: number) => string
