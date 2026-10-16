/* global WebSocket -- Node 22 ships a WebSocket client */
// Story watchdog: logs each story's start and end, and when one runs past
// STALL_MS it pauses every page through Chromium's DevTools port and prints the
// JavaScript stack the page is executing. A page stuck in a synchronous loop is
// interrupted by the pause, so its stack names the loop.
//
// Chromium only honours an interrupting Debugger.pause in a session whose
// Debugger domain was enabled while the page was still responsive, so every page
// is attached (and its debugger enabled) as soon as it appears.
// Needs Chromium launched with --remote-debugging-port=$CDP_PORT.
import { appendFileSync } from 'node:fs'

const out = process.env.TRACE_FILE ?? '/dev/stderr'
const STALL_MS = Number(process.env.STALL_MS ?? 45_000)
const PORT = Number(process.env.CDP_PORT ?? 9222)
const t0 = Date.now()
const log = (line) => {
  const text = `${((Date.now() - t0) / 1000).toFixed(2)} ${line}\n`
  appendFileSync(out, text)
  if (out !== '/dev/stderr') process.stderr.write(`[watchdog] ${text}`)
}
const fileOf = (test) => (test.module?.moduleId ?? '').split('/').slice(-2).join('/')

function cdpSession(wsUrl) {
  const ws = new WebSocket(wsUrl)
  let id = 0
  const waiting = new Map()
  const listeners = new Set()
  ws.addEventListener('message', (event) => {
    const msg = JSON.parse(String(event.data))
    if (msg.id !== undefined && waiting.has(msg.id)) {
      waiting.get(msg.id)(msg)
      waiting.delete(msg.id)
    } else for (const listener of listeners) listener(msg)
  })
  const opened = new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
  const closed = new Promise((resolve) =>
    ws.addEventListener('close', resolve, { once: true }),
  )
  return {
    opened,
    closed,
    send: (method, params = {}, timeoutMs = 5000) =>
      new Promise((resolve) => {
        const msgId = ++id
        const timer = setTimeout(() => {
          waiting.delete(msgId)
          resolve({ timedOut: true })
        }, timeoutMs)
        waiting.set(msgId, (msg) => {
          clearTimeout(timer)
          resolve(msg)
        })
        try {
          ws.send(JSON.stringify({ id: msgId, method, params }))
        } catch {
          clearTimeout(timer)
          resolve({ failed: true })
        }
      }),
    on: (listener) => listeners.add(listener),
    off: (listener) => listeners.delete(listener),
    close: () => ws.close(),
  }
}

/** Script URLs by script id, from every attached page's Debugger.scriptParsed. */
const scriptUrls = new Map()
const frameLine = (frame) => {
  const url = frame.url || scriptUrls.get(frame.location?.scriptId) || ''
  const where = url.replace(/^https?:\/\/[^/]+/, '').replace(/\?.*$/, '')
  const line = (frame.location?.lineNumber ?? 0) + 1
  const column = (frame.location?.columnNumber ?? 0) + 1
  return `${frame.functionName || '(anonymous)'} ${where}:${line}:${column}`
}

/** Pages attached so far, by target id. */
const attached = new Map()
let diagnosing = false

async function attach(target) {
  const session = cdpSession(target.webSocketDebuggerUrl)
  const entry = { target, session, paused: null }
  attached.set(target.id, entry)
  try {
    await session.opened
  } catch {
    attached.delete(target.id)
    return
  }
  session.on((msg) => {
    if (msg.method === 'Debugger.scriptParsed') {
      scriptUrls.set(msg.params.scriptId, msg.params.url)
      return
    }
    if (msg.method !== 'Debugger.paused') return
    if (diagnosing) entry.paused?.(msg)
    // A `debugger` statement in some library must not stop the run.
    else void session.send('Debugger.resume')
  })
  void session.closed.then(() => attached.delete(target.id))
  const enabled = await session.send('Debugger.enable', {}, 10_000)
  log(
    `ATTACH ${target.url.slice(0, 100)} debugger ${enabled.timedOut ? 'NOT enabled (page busy)' : 'enabled'}`,
  )
}

async function attachNewPages() {
  try {
    const response = await fetch(`http://127.0.0.1:${PORT}/json/list`)
    const targets = await response.json()
    for (const target of targets) {
      if (target.type === 'page' && !attached.has(target.id)) void attach(target)
    }
  } catch {
    // The browser is not up yet, or already gone.
  }
}

async function sampleStacks(entry) {
  const { session, target } = entry
  log(`  page ${target.url.slice(0, 120)}`)
  for (let sample = 1; sample <= 8; sample++) {
    const paused = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), 6000)
      entry.paused = (msg) => {
        clearTimeout(timer)
        resolve(msg)
      }
    })
    await session.send('Debugger.pause', {}, 4000)
    const event = await paused
    entry.paused = null
    if (event === null) {
      log(`  sample ${sample}: no JavaScript running (the pause never landed)`)
    } else {
      const frames = event.params.callFrames
      log(`  sample ${sample}: paused, ${frames.length} frames:`)
      for (const frame of frames.slice(0, 45)) log(`      at ${frameLine(frame)}`)
      await session.send('Debugger.resume', {}, 4000)
    }
    await new Promise((resolve) => setTimeout(resolve, 700))
  }
}

/** What each test iframe shows, when the page still answers. */
const SNAPSHOT = `(() => {
  const lines = ['top: ' + location.href.replace(/^https?:\\/\\/[^/]+/, '')]
  for (const frame of document.querySelectorAll('iframe')) {
    let info
    try {
      const win = frame.contentWindow
      const doc = frame.contentDocument
      const root = doc?.getElementById('storybook-root') ?? doc?.body
      const keys = win ? Object.keys(win).filter((k) => k.startsWith('__vitest')).join(',') : '-'
      info = '\\n    src: ' + frame.getAttribute('src') +
        '\\n    location: ' + (win?.location?.href ?? '-') +
        '\\n    readyState: ' + (doc?.readyState ?? '-') + ' title: ' + (doc?.title ?? '-') +
        '\\n    vitest globals: ' + keys +
        '\\n    active: ' + (doc?.activeElement?.outerHTML?.slice(0, 200) ?? '-') +
        '\\n    text: ' + (root?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 1500)
    } catch (error) {
      info = ' (cross-origin or gone: ' + error + ')'
    }
    lines.push('iframe' + info)
  }
  try {
    const trail = JSON.parse(localStorage.getItem('__diag') ?? '[]')
    lines.push('diag trail (last 150):\\n      ' + trail.slice(-150).join('\\n      '))
  } catch (error) {
    lines.push('diag trail unreadable: ' + error)
  }
  return lines.join('\\n')
})()`

async function pageSnapshot(entry) {
  const result = await entry.session.send(
    'Runtime.evaluate',
    { expression: SNAPSHOT, returnByValue: true },
    4000,
  )
  if (result.timedOut) log('  snapshot: the page does not answer (main thread busy)')
  else
    log(
      `  snapshot:\n  ${result.result?.result?.value ?? JSON.stringify(result).slice(0, 300)}`,
    )
}

async function diagnose(reason) {
  log(`WATCHDOG ${reason}`)
  diagnosing = true
  try {
    for (const entry of attached.values()) {
      await sampleStacks(entry)
      await pageSnapshot(entry)
    }
  } finally {
    diagnosing = false
  }
}

export default class WatchdogReporter {
  inFlight = new Map()
  diagnosed = new Set()
  timers = []

  onInit() {
    const watch = setInterval(() => {
      const now = Date.now()
      for (const [id, entry] of this.inFlight) {
        if (now - entry.start < STALL_MS || this.diagnosed.has(id)) continue
        this.diagnosed.add(id)
        void diagnose(
          `story still running after ${Math.round((now - entry.start) / 1000)}s: ${entry.file} :: ${entry.name}`,
        )
      }
    }, 2000)
    const attachEvery = setInterval(() => void attachNewPages(), 1000)
    watch.unref?.()
    attachEvery.unref?.()
    this.timers = [watch, attachEvery]
  }
  onTestModuleStart(mod) {
    log(`FILE  ${(mod.moduleId ?? '').split('/').pop()}`)
  }
  onTestModuleEnd(mod) {
    log(`FEND  ${(mod.moduleId ?? '').split('/').pop()} ${mod.state()}`)
  }
  onTestCaseReady(test) {
    this.inFlight.set(test.id, { name: test.name, file: fileOf(test), start: Date.now() })
    log(`START ${fileOf(test)} :: ${test.name}`)
  }
  onTestCaseResult(test) {
    this.inFlight.delete(test.id)
    const r = test.result()
    const d = test.diagnostic()
    log(
      `END   ${fileOf(test)} :: ${test.name} ${r.state} ${d?.duration?.toFixed?.(0) ?? '?'}ms${
        r.errors?.length
          ? ' ' +
            r.errors
              .map((e) => e.message)
              .join(' | ')
              .slice(0, 300)
          : ''
      }`,
    )
  }
  onTestRunEnd(modules, errors, reason) {
    void modules
    for (const timer of this.timers) clearInterval(timer)
    for (const entry of attached.values()) entry.session.close()
    log(`RUN END ${reason} errors=${errors.length}`)
  }
}
