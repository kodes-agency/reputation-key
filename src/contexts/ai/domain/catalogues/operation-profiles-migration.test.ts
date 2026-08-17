import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AI_RUNTIME_CAPABILITIES_V1 } from '#/shared/ai-runtime-capability-contract'
import {
  AI_OPERATION_PROFILES,
  AI_PROVIDER_DEPLOYMENT_PROFILE,
  AI_ROUTING_POLICY,
} from '../../../../shared/ai-operation-profiles'

const ROOT = process.cwd()
const migration = (name: string): string =>
  readFileSync(resolve(ROOT, 'drizzle', name), 'utf8')

function insertBlock(sql: string, table: string, nextTable: string): string {
  const start = sql.indexOf(`INSERT INTO "${table}"`)
  const end = sql.indexOf(`INSERT INTO "${nextTable}"`, start + 1)
  if (start < 0 || end < 0) throw new Error(`Missing ${table} seed block`)
  return sql.slice(start, end)
}

function tupleCount(block: string): number {
  return [...block.matchAll(/^\(/gmu)].length
}

describe('PR5 migration catalogue finalization', () => {
  it('creates every catalogue in 0046 before its one exact seed block', () => {
    const sql = migration('0046_ai-control-plane-and-operations.sql')
    const tables = [
      'ai_provider_deployment_profiles',
      'ai_routing_policies',
      'ai_operation_profiles',
      'ai_runtime_capability_profiles',
      'ai_provider_deployment_capabilities',
    ] as const
    for (const table of tables) {
      expect(sql.match(new RegExp(`CREATE TABLE "${table}"`, 'g'))).toHaveLength(1)
      expect(sql.match(new RegExp(`INSERT INTO "${table}"`, 'g'))).toHaveLength(1)
      expect(sql.indexOf(`CREATE TABLE "${table}"`)).toBeLessThan(
        sql.indexOf(`INSERT INTO "${table}"`),
      )
    }

    expect(tupleCount(insertBlock(sql, tables[0], tables[1]))).toBe(1)
    expect(tupleCount(insertBlock(sql, tables[1], tables[2]))).toBe(1)
    expect(tupleCount(insertBlock(sql, tables[2], tables[3]))).toBe(4)
    expect(tupleCount(insertBlock(sql, tables[3], tables[4]))).toBe(3)
    expect(tupleCount(insertBlock(sql, tables[4], 'ai_control_history'))).toBe(3)
  })

  it('seeds the source catalogues in canonical order with an internal-only canary', () => {
    const sql = migration('0046_ai-control-plane-and-operations.sql')
    const profileBlock = insertBlock(
      sql,
      'ai_operation_profiles',
      'ai_runtime_capability_profiles',
    )
    let previous = -1
    for (const profile of AI_OPERATION_PROFILES) {
      const index = profileBlock.indexOf(`('${profile.profileVersion}'`)
      expect(index).toBeGreaterThan(previous)
      expect(profileBlock).toContain(`'${profile.profileDigest}'`)
      expect(profileBlock).toContain(`'${profile.staticTokenBearingDigest}'`)
      previous = index
    }
    expect(profileBlock).toContain("'synthetic-canary','internal:synthetic-canary'")
    expect(profileBlock).not.toContain("'synthetic-canary','/v1/synthetic-canary'")
    expect(sql).toContain(`'${AI_PROVIDER_DEPLOYMENT_PROFILE.profileDigest}'`)
    expect(sql).toContain(`'${AI_ROUTING_POLICY.policyDigest}'`)

    const runtimeBlock = insertBlock(
      sql,
      'ai_runtime_capability_profiles',
      'ai_provider_deployment_capabilities',
    )
    expect(AI_RUNTIME_CAPABILITIES_V1.map((row) => row.runtimeProfileVersion)).toEqual([
      'review-analysis-runtime-v1',
      'reply-drafting-runtime-v1',
      'property-trends-runtime-v1',
    ])
    for (const runtime of AI_RUNTIME_CAPABILITIES_V1) {
      expect(runtimeBlock).toContain(`('${runtime.runtimeProfileVersion}'`)
    }
  })

  it('gives admission one exact fail-closed catalogue readiness authority', () => {
    const sql0046 = migration('0046_ai-control-plane-and-operations.sql')
    const provisioner = migration('../scripts/local-stack/provision-ai-admission-role.ts')
    expect(sql0046).toContain(
      'CREATE OR REPLACE FUNCTION "assert_ai_runtime_catalogue_ready_v1"',
    )
    expect(sql0046).toContain(
      `p_provider_deployment_profile_digest = '${AI_PROVIDER_DEPLOYMENT_PROFILE.profileDigest}'`,
    )
    expect(sql0046).toContain(
      "jsonb_agg(to_jsonb(row_value) - 'created_at' ORDER BY profile_version)",
    )
    expect(provisioner).toContain(
      'GRANT EXECUTE ON FUNCTION assert_ai_runtime_catalogue_ready_v1(text, text, text)',
    )
  })

  it('does not recreate or compat-seed the catalogues after 0046', () => {
    for (const name of [
      '0047_ai-derivatives-and-property-calendar.sql',
      '0048_ai-lifecycle-authority.sql',
      '0049_ai-execution-admission.sql',
    ]) {
      const sql = migration(name)
      expect(sql).not.toMatch(
        /CREATE TABLE "ai_(?:provider_deployment_profiles|routing_policies|operation_profiles|runtime_capability_profiles|provider_deployment_capabilities)"/u,
      )
      expect(sql).not.toMatch(
        /INSERT INTO "ai_(?:provider_deployment_profiles|routing_policies|operation_profiles|runtime_capability_profiles|provider_deployment_capabilities)"/u,
      )
      expect(sql).not.toMatch(/sentinel|placeholder|compat(?:ibility)?_profile/iu)
    }
  })

  it('pins readiness to the observed Postgres image and rejects source mutations', () => {
    const imageDigest = '33f923b05f64ca54ac4401c01126a6b92afe839a0aa0a52bc5aeb5cc958e5f20'
    const sql0047 = migration('0047_ai-derivatives-and-property-calendar.sql')
    const sql0048 = migration('0048_ai-lifecycle-authority.sql')
    expect(sql0047).toContain(`"image_digest" = '${imageDigest}'`)
    expect(sql0047).toContain('"tested_postgres_major_versions" = ARRAY[16]::integer[]')
    expect(sql0048).toContain(`v_authority.image_digest <> '${imageDigest}'`)
    expect(sql0048).toContain(
      'v_authority.tested_postgres_major_versions <> ARRAY[16]::integer[]',
    )
    expect(sql0048).toContain('v_postgres_major <> 16')
    expect(
      sql0048.replace(
        `v_authority.image_digest <> '${imageDigest}'`,
        `v_authority.image_digest <> '${'0'.repeat(64)}'`,
      ),
    ).not.toContain(`v_authority.image_digest <> '${imageDigest}'`)
  })
})
