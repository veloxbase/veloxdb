import { describe, expect, it } from 'vitest'

import { formatJsonValue, isJsonValue, parseJsonInput } from '@/features/queries/json-cell'

describe('isJsonValue', () => {
  it('accepts a JSON object', () => {
    expect(isJsonValue('{"a":1}')).toBe(true)
  })

  it('accepts a JSON array', () => {
    expect(isJsonValue('[1,2,3]')).toBe(true)
  })

  it('accepts nested objects and arrays', () => {
    expect(isJsonValue('{"a":{"b":[1,{"c":null}]}}')).toBe(true)
  })

  it('accepts JSON surrounded by whitespace', () => {
    expect(isJsonValue('  {"a":1}\n')).toBe(true)
    expect(isJsonValue('\t[1]  ')).toBe(true)
  })

  it('rejects null, undefined and empty strings', () => {
    expect(isJsonValue(null)).toBe(false)
    expect(isJsonValue(undefined)).toBe(false)
    expect(isJsonValue('')).toBe(false)
    expect(isJsonValue('   ')).toBe(false)
  })

  it('rejects a plain string', () => {
    expect(isJsonValue('hello')).toBe(false)
  })

  it('rejects a bare number', () => {
    expect(isJsonValue('42')).toBe(false)
  })

  it('rejects text that starts like JSON but does not parse', () => {
    expect(isJsonValue('{a:1}')).toBe(false)
  })
})

describe('formatJsonValue', () => {
  it('pretty-prints an object with 2-space indentation', () => {
    expect(formatJsonValue('{"a":1,"b":"x"}')).toBe('{\n  "a": 1,\n  "b": "x"\n}')
  })

  it('pretty-prints an array', () => {
    expect(formatJsonValue('[1,2]')).toBe('[\n  1,\n  2\n]')
  })

  it('pretty-prints nested structures', () => {
    expect(formatJsonValue('{"a":{"b":[1]}}')).toBe(
      '{\n  "a": {\n    "b": [\n      1\n    ]\n  }\n}',
    )
  })

  it('ignores surrounding whitespace in the input', () => {
    expect(formatJsonValue('  {"a":1}  ')).toBe('{\n  "a": 1\n}')
  })
})

describe('parseJsonInput', () => {
  it('compacts a formatted object', () => {
    expect(parseJsonInput('{\n  "a": 1,\n  "b": "x"\n}')).toEqual({ ok: true, value: '{"a":1,"b":"x"}' })
  })

  it('compacts an array', () => {
    expect(parseJsonInput('[\n  1,\n  2\n]')).toEqual({ ok: true, value: '[1,2]' })
  })

  it('compacts nested structures', () => {
    expect(parseJsonInput('{\n  "a": {\n    "b": [1]\n  }\n}')).toEqual({ ok: true, value: '{"a":{"b":[1]}}' })
  })

  it('ignores surrounding whitespace in the input', () => {
    expect(parseJsonInput('  {"a":1}  ')).toEqual({ ok: true, value: '{"a":1}' })
  })

  it('returns a non-empty error for invalid JSON', () => {
    const result = parseJsonInput('{a:1}')
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error.length > 0).toBe(true)
  })

  it('rejects an empty string', () => {
    expect(parseJsonInput('').ok).toBe(false)
  })

  it.each(['42', '"x"', 'null', 'true'])('rejects scalar JSON %s', (text) => {
    expect(parseJsonInput(text).ok).toBe(false)
  })
})
