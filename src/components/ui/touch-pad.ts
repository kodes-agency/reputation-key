// A 44 px tap area drawn around a control that is smaller, or set in a line of
// text, below `md`: an invisible `::after` centred on the control, so the layout
// is unchanged and a thumb still lands on it. Use it where a control cannot grow
// (a glyph, a word in a sentence); a control that can grow takes the touch token.
// Every class is written out in full for Tailwind.

/** The pad: `relative` so the `::after` centres on the control, not on an ancestor. */
export const PHONE_TOUCH_PAD =
  "max-md:relative max-md:after:absolute max-md:after:top-1/2 max-md:after:left-1/2 max-md:after:size-11 max-md:after:-translate-1/2 max-md:after:content-['']"

/** The pad for a control that is already positioned by its library (a Radix thumb, a toast's close button). */
export const PHONE_TOUCH_PAD_POSITIONED =
  "max-md:after:absolute max-md:after:top-1/2 max-md:after:left-1/2 max-md:after:size-11 max-md:after:-translate-1/2 max-md:after:content-['']"
