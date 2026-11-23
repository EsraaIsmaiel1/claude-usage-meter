import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, SessionRateLimit } from 'claude-code'

import type { Reading, Window } from '../types'

const REFRESH_MS = 3 * 60 * 1000
const WARN_AT = 80
// Not a documented API: the same figures Claude Code's /usage shows. If it
// fails, the meter falls back to the figures that came with Claude's last reply.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const DEBUG_FILE = ''

const reading = atom({ plugin: 'usage-meter', key: 'reading' } as const, null)
const warned = atom({ plugin: 'usage-meter', key: 'warned' } as const, [] as string[])

const pick = (limits: SessionRateLimit[], kind: string): Window | null => {
  const w = limits.find(l => l.kind === kind)
  return w ? { percent: w.percentUsed, resetsAt: w.resetsAt } : null
}

const liveWindow = (raw: unknown): Window | null => {
  if (!raw || typeof raw !== 'object') return null
  const { utilization, resets_at } = raw as { utilization?: unknown; resets_at?: unknown }
  if (typeof utilization !== 'number' || !Number.isFinite(utilization)) return null
  return {
    percent: Math.round(utilization * 10) / 10,
    resetsAt: typeof resets_at === 'string' ? resets_at : undefined,
  }
}

async function debug($: EngineInterface, line: string) {
  if (DEBUG_FILE) await $.fs.write(DEBUG_FILE, line).catch(() => {})
}

async function fetchLive($: EngineInterface): Promise<Pick<Reading, 'five' | 'week'> | null> {
  try {
    const auth = await $.session.authorize()
    if (!auth) return (await debug($, 'no first-party credential'), null)
    const res = await $.http.fetch(USAGE_URL, {
      auth: auth.handle,
      headers: { 'anthropic-beta': 'oauth-2025-04-20', accept: 'application/json' },
    })
    await debug($, `status ${res.status}\n${res.text.slice(0, 2000)}`)
    if (!res.ok) return null
    const body = JSON.parse(res.text) as { five_hour?: unknown; seven_day?: unknown }
    const five = liveWindow(body.five_hour)
    const week = liveWindow(body.seven_day)
    return five || week ? { five, week } : null
  } catch (err) {
    await debug($, `error ${String(err)}`)
    return null
  }
}


const untilText = (resetsAt: string | undefined, now: number) => {
  if (!resetsAt) return ''
  const ms = Date.parse(resetsAt) - now
  if (!Number.isFinite(ms)) return ''
  if (ms <= 0) return 'resetting'
  const mins = Math.round(ms / 60000)
  const d = Math.floor(mins / 1440)
  const h = Math.floor((mins % 1440) / 60)
  const m = mins % 60
  if (d > 0) return `resets in ${d}d ${h}h`
  if (h > 0) return `resets in ${h}h ${m}m`
  return `resets in ${m}m`
}

const clockText = (resetsAt: string | undefined, now: number) => {
  if (!resetsAt) return ''
  const at = new Date(resetsAt)
  if (!Number.isFinite(at.getTime())) return ''
  const time = at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  const isToday = at.toDateString() === new Date(now).toDateString()
  return isToday ? time : `${at.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`
}

const resetText = (resetsAt: string | undefined, now: number) => {
  const until = untilText(resetsAt, now)
  const clock = clockText(resetsAt, now)
  return clock && until !== 'resetting' ? `${until} · ${clock}` : until
}

const dot = (p: number) => (p > WARN_AT ? '🔴' : p >= 50 ? '🟡' : '🟢')

const statusText = (r: Reading) => {
  const part = (label: string, w: Window | null) => {
    if (!w) return `${label} –`
    const clock = clockText(w.resetsAt, r.at)
    return `${dot(w.percent)} ${label} ${w.percent}%${clock ? ` (resets ${clock})` : ''}`
  }
  const note = r.isLive ? '' : '  (updates after replies)'
  return `${part('5h', r.five)}   ${part('Week', r.week)}${note}`
}

async function store($: EngineInterface, next: Reading) {
  await update($, reading, () => next)
  $.ui.status(next.five || next.week ? statusText(next) : undefined)

  const already = await read($, warned)
  const fresh: string[] = []
  for (const [label, w] of [['5-hour session', next.five], ['Weekly', next.week]] as const) {
    if (!w || w.percent <= WARN_AT) continue
    const key = `${label}|${w.resetsAt?.slice(0, 16) ?? ''}`
    if (already.includes(key)) continue
    fresh.push(key)
    $.ui.toast(`⚠ ${label} usage is at ${w.percent}% (${resetText(w.resetsAt, next.at)})`, { timeoutMs: 10000 })
  }
  if (fresh.length) await update($, warned, list => [...list, ...fresh].slice(-20))
}

async function refresh($: EngineInterface) {
  const at = await $.clock.now()
  const live = await fetchLive($)
  if (live) return store($, { ...live, at, isLive: true })

  const rl = (await $.session.usage()).rateLimits
  const prev = await read($, reading)
  const five = pick(rl, 'five_hour')
  const week = pick(rl, 'seven_day')
  // Keep a newer live reading rather than replacing it with an older reply's.
  if (!five && !week && prev) return store($, { ...prev, at, isLive: false })
  await store($, { five, week, at, isLive: false })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await refresh($)
    $.clock.every(REFRESH_MS, () => refresh($))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits') && e.rateLimits.length) {
      const prev = await read($, reading)
      await store($, {
        five: pick(e.rateLimits, 'five_hour') ?? prev?.five ?? null,
        week: pick(e.rateLimits, 'seven_day') ?? prev?.week ?? null,
        at: await $.clock.now(),
        isLive: prev?.isLive ?? false,
      })
    }
    return next(e)
  })
}
