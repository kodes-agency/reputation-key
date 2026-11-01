import { describe, it, expect } from 'vitest'
import { parseStaffPaste } from './staff-paste'
import { pasteStaffRows, newStaffRow } from './staff-batch'
describe('staff paste', () => {
  it('finds emails in either column, preserving all remaining name words', () => {
    expect(
      parseStaffPaste(
        'Ana Jones\tana@example.com\r\nbob@example.com, Bob, Smith\n\n"Li May" <li@example.com>',
      ),
    ).toEqual([
      { displayName: 'Ana Jones', email: 'ana@example.com' },
      { displayName: 'Bob Smith', email: 'bob@example.com' },
      { displayName: 'Li May', email: 'li@example.com' },
    ])
  })
  it('keeps missing emails and names editable instead of discarding them', () => {
    expect(parseStaffPaste('Name only\na@example.com')).toEqual([
      { displayName: 'Name only', email: '' },
      { displayName: '', email: 'a@example.com' },
    ])
  })
  it('fills from the chosen row, keeps operation ids and reports the overflow', () => {
    let id = 0
    const rows = [newStaffRow('before'), newStaffRow('kept')]
    const pasted = pasteStaffRows(
      rows,
      1,
      Array.from({ length: 22 }, (_, i) => `Person ${i},p${i}@example.com`).join('\n'),
      () => `new-${++id}`,
    )
    expect(pasted.rows).toHaveLength(20)
    expect(pasted.omitted).toBe(3)
    expect(pasted.rows[0]).toEqual(rows[0])
    expect(pasted.rows[1]?.operationId).toBe('kept')
    expect(pasted.rows[19]?.email).toBe('p18@example.com')
  })
})
