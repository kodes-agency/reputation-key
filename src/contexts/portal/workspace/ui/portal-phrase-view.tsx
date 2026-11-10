// Draws a Phrase: strong pieces in bold, and the guests' own wording with the
// language it is in, so a screen reader pronounces ‘Piscina y terraza’ as Spanish.

import { Fragment } from 'react'
import type { Phrase } from './portal-history-phrase'

export function PhraseView({ phrase }: Readonly<{ phrase: Phrase }>) {
  return (
    <>
      {phrase.map((piece, index) => {
        const content =
          piece.lang === undefined ? (
            piece.text
          ) : (
            <span lang={piece.lang}>{piece.text}</span>
          )
        return (
          <Fragment key={`${index}-${piece.text}`}>
            {piece.strong ? (
              <b className="font-medium text-foreground">{content}</b>
            ) : (
              content
            )}
          </Fragment>
        )
      })}
    </>
  )
}
