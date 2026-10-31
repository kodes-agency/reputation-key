import { describe, expect, it } from 'vitest'
import { getTableName } from 'drizzle-orm'
import { getTableConfig } from 'drizzle-orm/pg-core'
import {
  aiDraftMeasurements,
  aiDraftMeasurementLinks,
} from './ai-draft-measurements.schema'

describe('draft measurement storage shape', () => {
  it('has no content, payload, digest or fingerprint column and shares operation retention', () => {
    const measurement = getTableConfig(aiDraftMeasurements)
    expect(
      measurement.columns
        .map((column) => column.name)
        .filter((name) => /text|body|payload|digest|fingerprint|avoid|output/.test(name)),
    ).toEqual([])
    const operation = measurement.foreignKeys.find(
      (key) => getTableName(key.reference().foreignTable) === 'ai_operations',
    )
    expect(operation?.onDelete).toBe('cascade')
    expect(operation?.reference().columns.map((column) => column.name)).toEqual([
      'operation_id',
    ])
    expect(aiDraftMeasurements.id.default).toBeDefined()
    const links = getTableConfig(aiDraftMeasurementLinks)
    expect(links.columns.map((column) => column.name)).toEqual([
      'reply_id',
      'reply_revision',
      'generation_id',
    ])
    expect(links.foreignKeys.every((key) => key.onDelete === 'cascade')).toBe(true)
  })
})
