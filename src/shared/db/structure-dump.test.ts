import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readStructure } from './structure.server'

const { execFile } = vi.hoisted(() => ({
  execFile:
    vi.fn<
      (
        file: string,
        args: string[],
        options: { env: NodeJS.ProcessEnv },
        callback: (error: Error | null, stdout: string) => void,
      ) => void
    >(),
}))
vi.mock('node:child_process', () => ({ execFile }))

const dump = `--
-- PostgreSQL database dump
--

SET statement_timeout = 0;

--
-- Name: probe; Type: TABLE; Schema: public; Owner: -
--
CREATE TABLE public.probe (id integer);

--
-- PostgreSQL database dump complete
--
`

describe('schema dump connection', () => {
  beforeEach(() => {
    execFile.mockReset()
    execFile.mockImplementation(
      (
        _file: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout: string) => void,
      ) => {
        callback(null, args.includes('--version') ? 'pg_dump (PostgreSQL) 16.14' : dump)
      },
    )
  })

  it.each([
    ['postgresql://reader:p%40ss@localhost:5433/test_structure', 'p@ss'],
    [
      'postgresql://reader@localhost:5433/test_structure?password=query%40secret',
      'query@secret',
    ],
  ])(
    'connects to the supplied target with credentials outside arguments',
    async (url, password) => {
      await readStructure(url)
      const call = execFile.mock.calls.find(([, args]) => args.includes('--schema-only'))!
      const [, args, options] = call
      expect(args).toContain('--dbname')
      const databaseUrl = args[args.indexOf('--dbname') + 1]
      if (databaseUrl === undefined) throw new Error('Expected pg_dump database URL')
      const connection = new URL(databaseUrl)
      expect(connection.hostname).toBe('localhost')
      expect(connection.port).toBe('5433')
      expect(connection.username).toBe('reader')
      expect(connection.pathname).toBe('/test_structure')
      expect(connection.password).toBe('')
      expect(connection.searchParams.has('password')).toBe(false)
      expect(options.env.PGPASSWORD).toBe(password)
      expect(args.join(' ')).not.toContain(password)
    },
  )

  it('keeps the dump read-only when the URL supplies other session options', async () => {
    await readStructure(
      'postgresql://localhost/test_structure?options=-c%20statement_timeout%3D1000%20-c%20default_transaction_read_only%3Doff',
    )
    const [, args] = execFile.mock.calls.find(([, args]) =>
      args.includes('--schema-only'),
    )!
    const databaseUrl = args[args.indexOf('--dbname') + 1]
    if (databaseUrl === undefined) throw new Error('Expected pg_dump database URL')
    const connection = new URL(databaseUrl)
    expect(connection.searchParams.get('options')).toBe(
      '-c statement_timeout=1000 -c default_transaction_read_only=off -c default_transaction_read_only=on',
    )
  })
})
