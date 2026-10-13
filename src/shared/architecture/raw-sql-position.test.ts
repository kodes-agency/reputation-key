import { describe, expect, it } from 'vitest'
import {
  type SqlInterpolation,
  type SqlSlot,
  insertsOnlyValues,
  leadingClause,
  readSqlSlots,
} from './raw-sql-position'

const HELD_TABLES: ReadonlySet<string> = new Set(['replies', 'reviews'])

/** A statement written with `?` where the template interpolates. */
function slotsOf(
  sql: string,
  interpolations?: readonly SqlInterpolation[],
): readonly SqlSlot[] {
  return readSqlSlots({
    literals: sql.split('?'),
    heldTables: HELD_TABLES,
    ...(interpolations === undefined ? {} : { interpolations }),
  })
}

function comparisons(sql: string): readonly SqlSlot['comparison'][] {
  return slotsOf(sql).map((slot) => slot.comparison)
}

function restricting(
  sql: string,
  interpolations?: readonly SqlInterpolation[],
): readonly boolean[] {
  return slotsOf(sql, interpolations).map((slot) => slot.canRestrict)
}

describe('raw SQL position: what an interpolation is compared with', () => {
  it.each([
    ['WHERE organization_id = ?', ['equality']],
    ['WHERE organization_id = ANY(?::text[])', ['equality']],
    ['WHERE organization_id IN (?, ?)', ['equality', 'equality']],
    ['WHERE (organization_id, id) = (?, ?::uuid)', ['equality', 'equality']],
    ['WHERE organization_id IS NOT DISTINCT FROM ?', ['equality']],
    // The quoted key must not glue `->>` to the `=` that follows it.
    ["WHERE payload->>'organizationId' = ?", ['equality']],
  ] as const)('reads %s as an equality', (sql, expected) => {
    expect(comparisons(sql)).toEqual(expected)
  })

  it.each([
    ['WHERE (organization_id, id) > (?, ?)', ['range', 'range']],
    ['WHERE organization_id <> ?', ['range']],
    ['WHERE organization_id != ?', ['range']],
    ['WHERE organization_id >= ?', ['range']],
  ] as const)('reads %s as a range', (sql, expected) => {
    expect(comparisons(sql)).toEqual(expected)
  })

  it.each([
    'SELECT ? AS organization_id',
    'WHERE organization_id NOT IN (?)',
    'WHERE organization_id IS DISTINCT FROM ?',
    'WHERE organization_id = COALESCE(?, organization_id)',
    // Only an operator written before the interpolation is read.
    'WHERE ? = organization_id',
  ])('reads no comparison in %s', (sql) => {
    expect(comparisons(sql)).toEqual([null])
  })
})

describe('raw SQL position: where an interpolation can restrict the statement', () => {
  it.each([
    ['a WHERE clause', 'SELECT id FROM replies WHERE organization_id = ?', [true]],
    [
      'a join condition',
      'SELECT r.id FROM replies r JOIN reviews v ON v.organization_id = ? AND v.id = r.review_id',
      [true],
    ],
    [
      'a HAVING clause',
      'SELECT id FROM replies GROUP BY id HAVING max(organization_id) = ?',
      [true],
    ],
    [
      'a predicate with no statement around it',
      'r.organization_id = ? AND r.id = ?',
      [true, true],
    ],
    [
      'a row value',
      'SELECT id FROM replies WHERE (organization_id, id) = (?, ?)',
      [true, true],
    ],
    [
      'the filter of an update, not its assignment',
      'UPDATE replies SET organization_id = ? WHERE organization_id = ?',
      [false, true],
    ],
    [
      'the filter of a conflict update',
      'INSERT INTO replies (id) VALUES (?) ON CONFLICT (id) DO UPDATE SET body = ? WHERE replies.organization_id = ?',
      [false, false, true],
    ],
  ] as const)('accepts %s', (_place, sql, expected) => {
    expect(restricting(sql)).toEqual(expected)
  })

  it.each([
    ['a projection', 'SELECT id, ? AS organization_id FROM replies'],
    ['a VALUES row', 'INSERT INTO replies (organization_id) VALUES (?)'],
    ['a RETURNING list', 'DELETE FROM replies RETURNING organization_id = ?'],
    ['an ORDER BY', 'SELECT id FROM replies ORDER BY organization_id = ?'],
    [
      'a CASE branch',
      'SELECT id FROM replies WHERE CASE WHEN organization_id = ? THEN true ELSE true END',
    ],
    ['one side of an OR', 'SELECT id FROM replies WHERE organization_id = ? OR public'],
    [
      'one side of an OR in parentheses',
      'SELECT id FROM replies WHERE public AND (id IS NULL OR organization_id = ?)',
    ],
    [
      'a parenthesised predicate that an OR joins',
      'SELECT id FROM replies WHERE public OR (organization_id = ?)',
    ],
    ['a negated predicate', 'SELECT id FROM replies WHERE NOT (organization_id = ?)'],
  ])('refuses %s', (_place, sql) => {
    expect(restricting(sql)).toEqual([false])
  })

  it('keeps a predicate that an OR elsewhere does not weaken', () => {
    expect(
      restricting(
        `SELECT id FROM replies
         WHERE organization_id = ? AND (id = ? OR review_id = ?)
         -- either order or none, 'this or that'
         /* keep or drop */
         ORDER BY id`,
      ),
    ).toEqual([true, false, false])
  })

  it('counts a subquery for the statement only where the statement filters by it', () => {
    const scoped = '(SELECT id FROM reviews WHERE organization_id = ?)'

    expect(restricting(`SELECT id FROM replies WHERE review_id IN ${scoped}`)).toEqual([
      true,
    ])
    expect(restricting(`SELECT id FROM replies WHERE EXISTS ${scoped}`)).toEqual([true])
    expect(restricting(`SELECT id, ${scoped} AS n FROM replies`)).toEqual([false])
    expect(restricting(`UPDATE replies SET review_id = ${scoped}`)).toEqual([false])
    expect(
      restricting(`SELECT id FROM replies WHERE id = ? OR EXISTS ${scoped}`),
    ).toEqual([false, false])
    expect(restricting(`SELECT id FROM replies WHERE NOT EXISTS ${scoped}`)).toEqual([
      false,
    ])
    expect(
      restricting(`SELECT id FROM replies WHERE review_id NOT IN ${scoped}`),
    ).toEqual([false])
  })

  it('lets a subquery stand for a statement that reads no held rows itself', () => {
    const scoped = '(SELECT count(*) FROM reviews WHERE organization_id = ?)'

    expect(restricting(`SELECT ${scoped} + ${scoped} AS total`)).toEqual([true, true])
    expect(
      restricting(
        `SELECT c.version FROM platform_controls c WHERE c.off OR EXISTS ${scoped}`,
      ),
    ).toEqual([true])
    expect(
      restricting(
        `INSERT INTO replies (organization_id) SELECT ? WHERE NOT EXISTS ${scoped}`,
      ),
    ).toEqual([false, true])
    expect(
      restricting(
        `WITH scoped AS ${scoped} SELECT id FROM scoped WHERE id = ? OR id IS NULL`,
      ),
    ).toEqual([true, false])
  })

  it('reads an interpolated table as held or not', () => {
    const sql = 'SELECT (SELECT count(*) FROM ? WHERE organization_id = ?) FROM ?'
    const subquery: readonly SqlInterpolation[] = [{ table: 'held' }, {}]

    expect(restricting(sql, [...subquery, { table: 'held' }])[1]).toBe(false)
    expect(restricting(sql, [...subquery, { table: 'other' }])[1]).toBe(true)
    // A table the scanner cannot name may be a held one.
    expect(restricting(sql, [...subquery, {}])[1]).toBe(false)
  })

  it('places a fragment by the clause it begins by itself', () => {
    const sql = 'SELECT r.id ? AND r.id = ?'

    // Read as written, both stand in the projection.
    expect(restricting(sql)).toEqual([false, false])
    expect(restricting(sql, [{ lead: 'FROM' }, {}])).toEqual([true, true])
  })
})

describe('raw SQL position: what a fragment and a statement are', () => {
  it.each([
    ['FROM replies r WHERE r.organization_id = ', 'FROM'],
    ['\n    LEFT JOIN reviews v ON v.id = r.review_id', 'JOIN'],
    ['-- scoped\n  where organization_id = ', 'WHERE'],
    ['AND organization_id = ', ''],
    ['organization_id = ', ''],
  ])('reads the clause %j begins with', (fragment, expected) => {
    expect(leadingClause(fragment)).toBe(expected)
  })

  it('knows a statement that only inserts the row it is handed', () => {
    expect(
      insertsOnlyValues(['INSERT INTO replies (organization_id) VALUES (', ')']),
    ).toBe(true)
    expect(
      insertsOnlyValues([
        'insert into replies (organization_id) values (',
        ') ON CONFLICT (organization_id) DO UPDATE SET body = EXCLUDED.body',
      ]),
    ).toBe(true)
    expect(
      insertsOnlyValues([
        'INSERT INTO replies (organization_id) SELECT ',
        ' FROM reviews WHERE id = ',
        '',
      ]),
    ).toBe(false)
    expect(insertsOnlyValues(['UPDATE replies SET body = ', ''])).toBe(false)
    expect(
      insertsOnlyValues(['INSERT INTO replies (id) VALUES ((SELECT id FROM reviews))']),
    ).toBe(false)
  })
})
