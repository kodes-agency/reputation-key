// A static file server for a built Storybook (`storybook build -o storybook-static`),
// started by `playwright.storybook.config.ts` when `STORYBOOK_METRICS_STATIC` names
// the build directory.
//
//   tsx e2e/storybook-metrics/static-server.ts <directory> <port>
//
// Why a static build at all: the guest page's LCP and CLS are only worth
// reading from a PRODUCTION bundle. Storybook's dev server transforms every
// module on first request, so a "largest contentful paint" there is the dev
// server's cold start, not the page's. The build is also the cheaper thing to
// run in CI (one build, no watcher) and needs no dev server.
//
// It binds `localhost` only (the harness's own address, never the network), serves nothing outside <directory>, and answers GET
// and HEAD. It is a test fixture, not a general server.

import { createReadStream } from 'node:fs'
import { createServer } from 'node:http'
import { extname, resolve } from 'node:path'
import { resolveStaticFile } from '../helpers/static-file'

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

function serve(directory: string, port: number): void {
  const root = resolve(directory)
  createServer((request, response) => {
    const file = resolveStaticFile(root, request.url ?? '/')
    if (file === null || (request.method !== 'GET' && request.method !== 'HEAD')) {
      response.writeHead(file === null ? 404 : 405).end()
      return
    }
    response.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    })
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    createReadStream(file).pipe(response)
  }).listen(port, 'localhost')
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('static-server.ts')) {
  const [directory, rawPort] = process.argv.slice(2)
  const port = Number(rawPort)
  if (directory === undefined || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('usage: static-server.ts <directory> <port>')
  }
  serve(directory, port)
}
