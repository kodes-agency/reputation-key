// A function may be labelled PARALLEL SAFE or PARALLEL RESTRICTED only when it
// does nothing PostgreSQL forbids while a parallel operation is running.
//
// Starting a subtransaction is one of those things, and a PL/pgSQL EXCEPTION
// clause starts one every time its block is entered. A query that calls such a
// function from a parallel plan fails with "cannot start subtransactions during
// a parallel operation" (SQLSTATE 25000), which Review's trend population read
// turned into `policy_unavailable` for every Property whose plan went parallel.
// RESTRICTED is no help: the function then runs in the group leader, which is in
// parallel mode for the whole statement once the plan holds a Gather node.
// Only the default, PARALLEL UNSAFE, keeps the planner from building a parallel
// plan at all. PostgreSQL prints no clause for it, so a function in
// db-constructs.sql that carries no PARALLEL word is unsafe.
//
// These cases read the file with no database. The catalogue half, a real
// parallel plan against the real functions, is
// local-date-functions-parallel.integration.test.ts.

import { describe, expect, it } from 'vitest'
import {
  parseConstructDefinitions,
  readConstructsFileDefinitions,
  type ConstructDefinition,
} from './construct-definitions'

/** The labels that let the planner run a function in a parallel worker or its leader. */
const PARALLEL_LABEL = /\bPARALLEL (?:SAFE|RESTRICTED)\b/u

/**
 * What a body must not do under a parallel label. A deliberate subset of
 * PostgreSQL's list (CREATE FUNCTION, "Parallel Safety"): the subtransaction an
 * EXCEPTION clause starts, writes, sequences, settings and advisory locks.
 */
const PARALLEL_HAZARDS: readonly Readonly<{ hazard: string; pattern: RegExp }>[] = [
  { hazard: 'an EXCEPTION clause', pattern: /^\s*EXCEPTION\b/mu },
  { hazard: 'an INSERT', pattern: /\bINSERT\s+INTO\b/iu },
  { hazard: 'an UPDATE', pattern: /\bUPDATE\s+\S+\s+SET\b/iu },
  { hazard: 'a DELETE', pattern: /\bDELETE\s+FROM\b/iu },
  { hazard: 'a sequence', pattern: /\b(?:nextval|setval)\s*\(/iu },
  { hazard: 'a setting change', pattern: /\bset_config\s*\(/iu },
  { hazard: 'an advisory lock', pattern: /\bpg_(?:try_)?advisory_(?:xact_)?lock/iu },
]

/** What a function under a parallel label does that a parallel worker cannot. */
function parallelHazards(definition: ConstructDefinition): readonly string[] {
  const [header = '', ...body] = definition.definition.split('\n')
  if (definition.kind !== 'function' || !PARALLEL_LABEL.test(header)) return []
  const text = body.join('\n')
  return PARALLEL_HAZARDS.filter(({ pattern }) => pattern.test(text)).map(
    ({ hazard }) => hazard,
  )
}

const LOCAL_DATE_FUNCTIONS = [
  'ai_property_local_date_v1',
  'ai_property_local_midnight_v1',
] as const

describe('the parallel labels of the DB-only functions', () => {
  it('names no function parallel safe or restricted when its body starts a subtransaction or writes', () => {
    const offenders = readConstructsFileDefinitions().flatMap((definition) => {
      const hazards = parallelHazards(definition)
      return hazards.length === 0 ? [] : [`${definition.name}: ${hazards.join(', ')}`]
    })

    expect(offenders).toEqual([])
  })

  it.each(LOCAL_DATE_FUNCTIONS)(
    'states %s as PARALLEL UNSAFE, which PostgreSQL prints as no PARALLEL clause',
    (name) => {
      const stated = readConstructsFileDefinitions().filter(
        (definition) => definition.kind === 'function' && definition.name === name,
      )

      expect(stated).toHaveLength(1)
      const [header = '', ...body] = (stated[0]?.definition ?? '').split('\n')
      expect(header).not.toContain('PARALLEL')
      // The EXCEPTION clause is why: keep this case honest if the body changes.
      expect(body.join('\n')).toMatch(/^\s*EXCEPTION\b/mu)
    },
  )
})

describe('the parallel hazard detector', () => {
  const FUNCTION = (
    attributes: string,
    body: string,
  ) => `CREATE OR REPLACE FUNCTION public.probe(p_value integer)
 RETURNS integer
 LANGUAGE plpgsql
 ${attributes}
AS $function$
${body}
$function$
;`
  const definitionOf = (attributes: string, body: string) => {
    const [definition] = parseConstructDefinitions(
      FUNCTION(attributes, body),
      'probe.sql',
    )
    if (!definition) throw new Error('the probe function did not parse')
    return definition
  }

  it('finds the EXCEPTION clause of a function labelled PARALLEL SAFE', () => {
    const definition = definitionOf(
      'IMMUTABLE PARALLEL SAFE STRICT',
      'BEGIN\n  RETURN p_value;\nEXCEPTION\n  WHEN numeric_value_out_of_range THEN RETURN NULL;\nEND;',
    )

    expect(parallelHazards(definition)).toEqual(['an EXCEPTION clause'])
  })

  it('finds the same clause under PARALLEL RESTRICTED, which the leader would still run in parallel mode', () => {
    const definition = definitionOf(
      'IMMUTABLE PARALLEL RESTRICTED STRICT',
      'BEGIN\n  RETURN p_value;\nEXCEPTION WHEN OTHERS THEN RETURN NULL;\nEND;',
    )

    expect(parallelHazards(definition)).toEqual(['an EXCEPTION clause'])
  })

  it('leaves the same body alone when the function is parallel unsafe', () => {
    const definition = definitionOf(
      'IMMUTABLE STRICT',
      'BEGIN\n  RETURN p_value;\nEXCEPTION\n  WHEN numeric_value_out_of_range THEN RETURN NULL;\nEND;',
    )

    expect(parallelHazards(definition)).toEqual([])
  })

  it('does not mistake RAISE EXCEPTION for an EXCEPTION clause', () => {
    const definition = definitionOf(
      'IMMUTABLE PARALLEL SAFE STRICT',
      "BEGIN\n  IF p_value < 0 THEN\n    RAISE EXCEPTION 'out of range' USING ERRCODE = '22003';\n  END IF;\n  RETURN p_value;\nEND;",
    )

    expect(parallelHazards(definition)).toEqual([])
  })

  it('finds a write and a sequence read under a parallel label', () => {
    const definition = definitionOf(
      'VOLATILE PARALLEL SAFE',
      "BEGIN\n  INSERT INTO ledger (id) VALUES (nextval('ledger_seq'));\n  RETURN 1;\nEND;",
    )

    expect(parallelHazards(definition)).toEqual(['an INSERT', 'a sequence'])
  })
})
