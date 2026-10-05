import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

// A fake disk: the plugin's own emotes folder holds oana and nova, each with
// two idle frames. Project and home folders hold nothing.
const written: string[] = []

function fakeDisk(on: On) {
  const sets = ['oana', 'nova']
  on('session.root', () => ({ value: '/project' }))
  on('env.get', () => ({ value: '/home/me' }))
  on('clock.now', () => ({ value: 1000 }))
  on('fs.read', () => ({ value: { base64: 'iVBORw0KGgo=' } }))
  on('fs.write', ($, e) => {
    written.push(String(e.path))
    return { value: undefined }
  })
  on('fs.exists', ($, e) => {
    const p = String(e.path)
    if (p.startsWith('/project') || p.startsWith('/home/me')) return { value: false }
    const known = /\/emotes$/.test(p) || sets.some(s => p.endsWith(`/emotes/${s}`) || p.endsWith(`/emotes/${s}/idle`))
    return { value: known }
  })
  on('fs.list', ($, e) => {
    const p = String(e.path)
    const entry = (name: string, kind: 'file' | 'dir') => ({ name, kind, size: 1, mtimeMs: 0 })
    if (p.endsWith('/emotes')) return { value: sets.map(s => entry(s, 'dir')) }
    if (p.endsWith('/idle')) return { value: [entry('idle.png', 'file'), entry('idle_blink.png', 'file')] }
    return { value: [] }
  })
}

test('lists the bundled sets and switches to one', async ($, on) => {
  fakeDisk(on)
  const listed = await $.command.run({ command: 'portrait', args: '' })
  expect(JSON.stringify(listed)).toContain('Sets: nova, oana')

  const switched = await $.command.run({ command: 'portrait', args: 'nova' })
  expect(JSON.stringify(switched)).toContain('Portrait set to nova for this project')
  expect(written).toContain('/project/.claude/agent-portrait/config.json')

  const missing = await $.command.run({ command: 'portrait', args: 'nobody' })
  expect(JSON.stringify(missing)).toContain('No portrait set named')
})
