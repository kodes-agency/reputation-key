// The retention exclusion for reply permits is SQL, separate from Review's own
// lists of states that may have dispatched. This fails when they drift apart.

import { describe, expect, it } from 'vitest'
import { UNCERTAIN_ATTEMPT_OUTCOMES } from '../application/ports/reply-writer.port'
import { UNSETTLED_REPLY_PERMIT_EXCLUSION } from '#/shared/jobs/retention-sweep.job'
import { NEVER_DISPATCHED_SETTLEABLE } from './reply-command-store'

const clauses = UNSETTLED_REPLY_PERMIT_EXCLUSION.split('\n')

describe('unsettled reply permit exclusion', () => {
  it.each(NEVER_DISPATCHED_SETTLEABLE)(
    'keeps the permit of a settleable reply state %o',
    (snapshot) => {
      const covered = clauses.some(
        (line) =>
          line.includes(`r.status::text = '${snapshot.status}'`) &&
          line.includes('r.publication_state') &&
          line.includes(`'${snapshot.publicationState}'`) &&
          (snapshot.lastErrorClass === undefined ||
            line.includes(
              `r.publication_last_error_class = '${snapshot.lastErrorClass}'`,
            )),
      )
      expect(covered).toBe(true)
    },
  )

  it.each(UNCERTAIN_ATTEMPT_OUTCOMES)(
    'keeps the permit of an attempt record with outcome %s',
    (outcome) => {
      const line = clauses.find((candidate) => candidate.includes('a.outcome IN'))
      expect(line).toContain(`'${outcome}'`)
    },
  )
})
