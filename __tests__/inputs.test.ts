import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseInputs } from '../src/inputs.ts'

const ORIGINAL_ENV = { ...process.env }

function setInput(name: string, value: string): void {
  const key = `INPUT_${name.replace(/ /g, '_').toUpperCase()}`
  process.env[key] = value
}

function clearAllInputs(): void {
  for (const k of Object.keys(process.env)) {
    if (k.startsWith('INPUT_')) Reflect.deleteProperty(process.env, k)
  }
}

describe('parseInputs', () => {
  beforeEach(() => {
    clearAllInputs()
    Reflect.deleteProperty(process.env, 'B2_APPLICATION_KEY_ID')
    Reflect.deleteProperty(process.env, 'B2_APPLICATION_KEY')
  })

  afterEach(() => {
    clearAllInputs()
    process.env = { ...ORIGINAL_ENV }
  })

  it('reads credentials from action inputs', () => {
    setInput('action', 'upload')
    setInput('application-key-id', 'kid-1')
    setInput('application-key', 'sek-1')
    setInput('bucket', 'my-bucket')

    const r = parseInputs()
    expect(r.applicationKeyId).toBe('kid-1')
    expect(r.applicationKey).toBe('sek-1')
    expect(r.bucket).toBe('my-bucket')
    expect(r.action).toBe('upload')
  })

  it('falls back to B2_APPLICATION_KEY_ID / B2_APPLICATION_KEY env vars', () => {
    setInput('action', 'download')
    setInput('bucket', 'b')
    process.env.B2_APPLICATION_KEY_ID = 'env-kid'
    process.env.B2_APPLICATION_KEY = 'env-sek'

    const r = parseInputs()
    expect(r.applicationKeyId).toBe('env-kid')
    expect(r.applicationKey).toBe('env-sek')
  })

  it('rejects an unknown action value', () => {
    setInput('action', 'whatever')
    setInput('bucket', 'b')
    setInput('application-key-id', 'k')
    setInput('application-key', 's')
    expect(() => parseInputs()).toThrow(/Invalid 'action' input/)
  })

  it('throws when credentials are missing entirely', () => {
    setInput('action', 'upload')
    setInput('bucket', 'b')
    expect(() => parseInputs()).toThrow(/Missing credential/)
  })

  it('parses include/exclude as csv', () => {
    setInput('action', 'upload')
    setInput('application-key-id', 'k')
    setInput('application-key', 's')
    setInput('bucket', 'b')
    setInput('include', 'src/**, dist/**')
    setInput('exclude', '**/*.log')

    const r = parseInputs()
    expect(r.include).toEqual(['src/**', 'dist/**'])
    expect(r.exclude).toEqual(['**/*.log'])
  })

  it('parses booleans and integers', () => {
    setInput('action', 'upload')
    setInput('application-key-id', 'k')
    setInput('application-key', 's')
    setInput('bucket', 'b')
    setInput('concurrency', '8')
    setInput('part-size', '5000000')
    setInput('resume', 'false')
    setInput('dry-run', '1')

    const r = parseInputs()
    expect(r.concurrency).toBe(8)
    expect(r.partSize).toBe(5_000_000)
    expect(r.resume).toBe(false)
    expect(r.dryRun).toBe(true)
  })
})
