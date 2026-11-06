import { describe, expect, it } from 'vitest'
import {
  normalizeStructure,
  compareStructures,
  requireStructureClient,
} from './structure.server'

const dump = (body: string, version = '16.14', key = 'random') => `--
-- PostgreSQL database dump
--

\\restrict ${key}

-- Dumped from database version ${version}
-- Dumped by pg_dump version ${version}

SET statement_timeout = 0;
SET lock_timeout = 0;

--
-- Name: probe; Type: TABLE; Schema: public; Owner: -
--

${body}

--
-- PostgreSQL database dump complete
--

\\unrestrict ${key}
`
const TABLE = 'CREATE TABLE public.probe (id integer NOT NULL);'

describe('canonical database structure', () => {
  it('ignores only dump envelope versions and random restriction keys', () => {
    expect(normalizeStructure(dump(TABLE))).toBe(
      normalizeStructure(dump(TABLE, '16.15', 'other')),
    )
  })

  it('retains function bodies, including lines that resemble dump metadata', () => {
    const body = `CREATE FUNCTION public.probe() RETURNS text LANGUAGE sql AS $$
-- Dumped by pg_dump version 16.14
SELECT 'two  spaces';
$$;`
    expect(normalizeStructure(dump(body))).toContain(body)
    expect(
      compareStructures(dump(body), dump(body.replace('two  spaces', 'two spaces'))),
    ).not.toEqual([])
    expect(
      compareStructures(dump(body), dump(body.replace('version 16.14', 'version 16.15'))),
    ).not.toEqual([])
  })

  it.each(['', 'CREATE TABLE probe (id int);', '-- PostgreSQL database dump\n'])(
    '%j is not a completed schema dump',
    (sql) => {
      expect(() => normalizeStructure(sql)).toThrow('complete PostgreSQL schema dump')
    },
  )

  it('reports both added and removed SQL', () => {
    expect(compareStructures(dump(TABLE), dump(TABLE))).toEqual([])
    expect(
      compareStructures(
        dump(TABLE),
        dump(`${TABLE}\nCREATE TABLE public.extra (id int);`),
      ),
    ).not.toEqual([])
    expect(
      compareStructures(
        dump(`${TABLE}\nCREATE TABLE public.extra (id int);`),
        dump(TABLE),
      ),
    ).not.toEqual([])
  })

  it('rejects SQL outside the dump envelope', () => {
    expect(() =>
      compareStructures(dump(TABLE), `${dump(TABLE)}CREATE TABLE public.extra (id int);`),
    ).toThrow('complete PostgreSQL schema dump')
    expect(() =>
      normalizeStructure(
        dump(TABLE).replace(
          'SET statement_timeout',
          'CREATE TABLE public.extra (id int);\nSET statement_timeout',
        ),
      ),
    ).toThrow('complete PostgreSQL schema dump')
    expect(() =>
      normalizeStructure(
        dump(TABLE).replace('\\unrestrict random', '\\unrestrict other'),
      ),
    ).toThrow('complete PostgreSQL schema dump')
  })

  it('preserves line endings and session-looking text inside function literals', () => {
    const body = `CREATE FUNCTION public.probe() RETURNS text LANGUAGE sql AS $$
SELECT 'line1\r\nline2';
SET transaction_timeout = 0;
$$;`
    expect(normalizeStructure(dump(body))).toContain(body)
    expect(compareStructures(dump(body), dump(body.replace('\r\n', '\n')))).not.toEqual(
      [],
    )
    expect(
      compareStructures(
        dump(body),
        dump(body.replace('SET transaction_timeout = 0;', '')),
      ),
    ).not.toEqual([])
  })

  it.each([
    ['integer', 'bigint'],
    ['NOT NULL', 'DEFAULT 1'],
    ['CREATE TABLE', 'CREATE UNLOGGED TABLE'],
  ])('detects a change from %s to %s', (from, to) => {
    expect(compareStructures(dump(TABLE), dump(TABLE.replace(from, to)))).not.toEqual([])
  })
})

describe('canonical dump client', () => {
  it('accepts PostgreSQL 16 clients', () => {
    expect(() =>
      requireStructureClient('pg_dump (PostgreSQL) 16.14 (Ubuntu)\n'),
    ).not.toThrow()
  })

  it.each(['pg_dump (PostgreSQL) 17.5', 'pg_dump (PostgreSQL) 15.14', '', '16.14'])(
    'rejects incompatible or unidentified client %j',
    (version) => {
      expect(() => requireStructureClient(version)).toThrow('PostgreSQL 16 pg_dump')
    },
  )
})
