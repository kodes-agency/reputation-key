// React element -> email HTML document, synchronously.
//
// `@react-email/render`'s own `render()` is ASYNC in v2 (it drives
// `renderToReadableStream` and awaits `stream.allReady`, and optionally
// prettier). The ratified renderer contract in
// `src/contexts/notification/infrastructure/email/render.ts` is synchronous,
// and the job callers treat rendering as a pure formatting step, not I/O.
//
// `renderToStaticMarkup` is the sync path to the same markup: our email trees
// contain no Suspense boundaries, no data fetching and no client components, so
// the streaming machinery buys nothing here. We prepend the identical XHTML 1.0
// Transitional doctype react-email emits, which is what Outlook's Word engine
// expects.

import { renderToStaticMarkup } from 'react-dom/server'
import type { ReactElement } from 'react'

const XHTML_DOCTYPE =
  '<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">'

/** What every email renderer in the repo returns: an HTML part and its twin. */
export type RenderedEmail = Readonly<{
  subject: string
  html: string
  text: string
}>

/** Render an email tree to a complete, doctype-prefixed HTML document. */
export const renderEmailDocument = (element: ReactElement): string =>
  `${XHTML_DOCTYPE}${renderToStaticMarkup(element).replace(/^<!DOCTYPE[^>]*>/i, '')}`
