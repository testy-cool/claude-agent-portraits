import type { EngineInterface, Register } from 'claude-code'

// An animated portrait above the prompt that reacts to what Claude is doing:
// thinking, talking, reading, writing, running commands, failing, sleeping.
// Each state is a folder of PNG frames. Files ending in _v2, _v3 are other
// drawings of the same state; one is picked when the state starts and kept
// until it ends, so frames from different drawings never mix.

type State =
  | 'hi' | 'idle' | 'think' | 'talk' | 'read' | 'write' | 'tool' | 'success'
  | 'failure' | 'compact' | 'sleep' | 'wait' | 'interrupted' | 'search'
  | 'bash' | 'error' | 'heard'

const STATES: State[] = [
  'hi', 'idle', 'think', 'talk', 'read', 'write', 'tool', 'success', 'failure',
  'compact', 'sleep', 'wait', 'interrupted', 'search', 'bash', 'error', 'heard',
]

// Sets drawn before a state existed show the closest older one.
const FALLBACK: Partial<Record<State, State>> = {
  sleep: 'idle', wait: 'idle', interrupted: 'failure', search: 'tool',
  bash: 'tool', error: 'failure', heard: 'idle', hi: 'idle', success: 'idle',
  failure: 'idle', compact: 'think', read: 'tool', write: 'tool', tool: 'think',
  talk: 'idle', think: 'idle',
}

// States that play once and then hand over to the next one.
const HOLD: Partial<Record<State, number>> = {
  hi: 2000, success: 1500, failure: 1500, error: 1200, interrupted: 1500, heard: 700,
}

const TICK_MS = 150
const CYCLE_MS = 500
const TALK_MS = 130
const SLEEP_AFTER_MS = 5 * 60 * 1000

type Frames = Map<State, Map<string, string[]>>

const variantOf = (file: string) => /(_v\d+)?\.png$/.exec(file)?.[1] ?? ''
const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]!

function toolState(tool: string): State {
  if (tool === 'Read' || tool === 'NotebookRead') return 'read'
  if (tool === 'Write' || tool === 'Edit' || tool === 'NotebookEdit') return 'write'
  if (tool === 'Bash' || tool === 'PowerShell') return 'bash'
  if (/grep|glob|search|web|fetch|browse|scrape|crawl/i.test(tool)) return 'search'
  return 'tool'
}

// Everything the portrait remembers. Module state, so a reload starts over.
const P = {
  rows: 6,
  setName: 'oana',
  setDir: '',
  frames: new Map() as Frames,
  state: 'idle' as State,
  variant: '',
  since: 0,
  after: 'idle' as State,
  lastActive: 0,
  lastText: 0,
  shown: '',
  blinkAt: 0,
  blinkUntil: 0,
}

// --- Loading a set ---


// Where sets live, most specific first: this project, then pi's folder for this
// project (so a pi minion keeps its face), then the user's, then the bundled ones.
async function setFolders($: EngineInterface): Promise<string[]> {
  const project = await $.session.root()
  const home = (await $.env.get('HOME')) ?? ''
  return [
    `${project}/.claude/agent-portrait/emotes`,
    `${project}/.pi/extensions/pi-emote/emotes`,
    `${home}/.claude/agent-portrait/emotes`,
    `${$.plugin.root}/emotes`,
  ]
}

async function findSet($: EngineInterface, name: string): Promise<string> {
  for (const dir of await setFolders($)) if (await $.fs.exists(`${dir}/${name}`)) return `${dir}/${name}`
  return ''
}

// The set this project picked, in the config draw-portrait and /portrait write.
async function projectSet($: EngineInterface): Promise<string> {
  const project = await $.session.root()
  for (const file of [
    `${project}/.claude/agent-portrait/config.json`,
    `${project}/.pi/extensions/pi-emote/config.json`,
  ]) {
    if (!(await $.fs.exists(file))) continue
    try {
      const config = JSON.parse(String(await $.fs.read(file)))
      const name = config.emotes?.at?.(-1)?.['emote-set']
      if (typeof name === 'string' && name) return name
    } catch {}
  }
  return ''
}

async function saveProjectSet($: EngineInterface, name: string) {
  const file = `${await $.session.root()}/.claude/agent-portrait/config.json`
  let config: Record<string, unknown> = {}
  if (await $.fs.exists(file)) {
    try { config = JSON.parse(String(await $.fs.read(file))) } catch {}
  }
  config.emotes = [{ model: '*', 'emote-set': name }]
  await $.fs.write(file, JSON.stringify(config, null, 2) + '\n')
}

async function loadSet($: EngineInterface, name: string): Promise<boolean> {
  const dir = await findSet($, name)
  if (!dir) return false
  const found: Frames = new Map()
  for (const s of STATES) {
    if (!(await $.fs.exists(`${dir}/${s}`))) continue
    const byVariant = new Map<string, string[]>()
    const files = (await $.fs.list(`${dir}/${s}`))
      .filter((f: any) => f.name.endsWith('.png'))
      .map((f: any) => f.name)
      .sort()
    for (const f of files) {
      const v = variantOf(f)
      byVariant.set(v, [...(byVariant.get(v) ?? []), `${dir}/${s}/${f}`])
    }
    if (byVariant.size) found.set(s, byVariant)
  }
  if (!found.size) return false
  P.setName = name
  P.setDir = dir
  P.frames = found
  return true
}

async function listSets($: EngineInterface): Promise<string[]> {
  const names = new Set<string>()
  for (const dir of await setFolders($)) {
    if (!(await $.fs.exists(dir))) continue
    for (const e of await $.fs.list(dir)) if (e.kind !== 'file') names.add(e.name)
  }
  return [...names].sort()
}

// --- The state machine ---

function resolve(s: State): State {
  let at = s
  for (let i = 0; i < 4 && !P.frames.has(at); i++) at = FALLBACK[at] ?? 'idle'
  return at
}

function go(s: State, now: number, next: State = 'idle') {
  P.state = s
  P.after = next
  P.since = now
  P.lastActive = now
  const variants = [...(P.frames.get(resolve(s))?.keys() ?? [''])]
  P.variant = pick(variants)
}

function filesOf(s: State): string[] {
  const byVariant = P.frames.get(resolve(s))
  if (!byVariant) return []
  return byVariant.get(P.variant) ?? byVariant.get('') ?? [...byVariant.values()][0] ?? []
}

function named(list: string[], name: string) {
  return list.find((f) => f.endsWith(`/${name}${P.variant}.png`)) ?? list.find((f) => f.endsWith(`/${name}.png`))
}

// Which file should show right now.
function frameAt(now: number): string {
  const hold = HOLD[P.state]
  if (hold && now - P.since > hold) go(P.after, now)
  if (P.state === 'idle' && now - P.lastActive > SLEEP_AFTER_MS) go('sleep', now)
  if (P.state === 'talk' && now - P.lastText > 1500) go('idle', now)

  const s = resolve(P.state)
  const list = filesOf(P.state)
  if (!list.length) return ''

  if (s === 'idle') {
    const base = named(list, 'idle') ?? list[0]!
    const blink = named(list, 'idle_blink')
    if (!blink) return base
    if (now >= P.blinkAt) {
      P.blinkUntil = now + 150
      P.blinkAt = now + 3000 + Math.random() * 3000
    }
    return now < P.blinkUntil ? blink : base
  }
  if (s === 'think') {
    const base = named(list, 'think') ?? list[0]!
    const hard = named(list, 'think_hard')
    return hard && Math.floor((now - P.since) / 4000) % 2 === 1 ? hard : base
  }
  if (s === 'talk') {
    if (now - P.lastText > 250) return named(list, 'talk_close') ?? list[0]!
    return list[Math.floor(now / TALK_MS) % list.length]!
  }
  // Everything else ping-pongs through its frames.
  if (list.length === 1) return list[0]!
  const period = list.length * 2 - 2
  const i = Math.floor((now - P.since) / CYCLE_MS) % period
  return list[i < list.length ? i : period - i]!
}

async function show($: EngineInterface, s: State, next: State = 'idle') {
  go(s, await $.clock.now(), next)
}


export const register: Register = (on, options) => {
  const opts = options as { set?: string; rows?: number }
  P.rows = Math.max(3, Math.min(20, Number(opts.rows) || 6))
  P.setName = String(opts.set || 'oana')


  on('session.start', async ($, e, next) => {
    const picked = await projectSet($)
    if (!(picked && (await loadSet($, picked))) && !(await loadSet($, P.setName))) await loadSet($, 'oana')
    await $.command.register({
      name: 'portrait',
      description: 'Switch the agent portrait: /portrait <set>, or no name to list them',
    })
    await show($, 'hi')
    $.clock.every(TICK_MS, async () => {
      const file = frameAt(await $.clock.now())
      if (file && file !== P.shown) {
        P.shown = file
        $.ui.invalidate('ui.render')
      }
    })
    return next(e)
  })

  on('command.run', { command: 'portrait' }, async ($, e) => {
    const want = e.args.trim()
    const sets = await listSets($)
    if (!want) return { text: `Portrait: ${P.setName}\nSets: ${sets.join(', ')}` }
    if (!(await loadSet($, want))) return { text: `No portrait set named "${want}". Sets: ${sets.join(', ')}` }
    await saveProjectSet($, want)
    await show($, 'hi')
    return { text: `Portrait set to ${want} for this project, from ${P.setDir}` }
  })

  on('prompt.submit', async ($, e, next) => {
    await show($, 'heard', 'think')
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    for await (const chunk of next(e)) {
      if (chunk.kind === 'text' && chunk.text.trim()) {
        P.lastText = await $.clock.now()
        if (P.state !== 'talk') go('talk', P.lastText)
      } else if (chunk.kind === 'thinking' && P.state !== 'think') {
        await show($, 'think')
      }
      yield chunk
    }
  })

  on('tool.call', async ($, e, next) => {
    if (!e.agentId) await show($, toolState(e.tool))
    const result = await next(e)
    if (!e.agentId) {
      if ('isError' in result && result.isError) await show($, 'error', 'think')
      else await show($, 'think')
    }
    return result
  })

  on('session.compact', async ($, e, next) => {
    await show($, 'compact')
    const result = await next(e)
    await show($, 'idle')
    return result
  })

  on('turn.complete', async ($, e, next) => {
    if (e.reason === 'aborted') await show($, 'interrupted')
    else if (e.reason === 'error' || e.reason === 'refusal') await show($, 'failure')
    else await show($, 'success')
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.surface !== 'terminal' || !P.shown) return next(e)
    const { Box, Image } = $.ui.resolve(e)
    return (
      <Box height={P.rows}>
        <Image
          key="portrait"
          source={{ file: P.shown, format: 'png' }}
          columns={P.rows * 2}
          rows={P.rows}
          alt={`${P.setName}: ${P.state}`}
        />
      </Box>
    )
  })
}
