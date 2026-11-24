import { describe, expect, it } from 'vitest'
import { DEFAULT_NOTE_OPTIONS, parseNoteOptions } from './note-options'

describe('parseNoteOptions', () => {
  it('returns default options when given null or non-object', () => {
    expect(parseNoteOptions(null, 'hello')).toEqual({
      ...DEFAULT_NOTE_OPTIONS,
      content: 'hello',
    })
  })

  it('parses valid note options correctly', () => {
    const raw = {
      content: 'Important metrics insight',
      style: 'callout-insight',
      fontSize: 'base',
      showTitle: false,
      icon: '💡',
    }

    expect(parseNoteOptions(raw)).toEqual({
      content: 'Important metrics insight',
      style: 'callout-insight',
      fontSize: 'base',
      showTitle: false,
      icon: '💡',
    })
  })

  it('falls back to default style and fontSize when given invalid values', () => {
    const raw = {
      content: 'Some note',
      style: 'invalid-style',
      fontSize: 'huge',
    }

    const parsed = parseNoteOptions(raw)
    expect(parsed.style).toBe('card')
    expect(parsed.fontSize).toBe('sm')
  })

  it('defaults showTitle to false for banner style', () => {
    const raw = {
      content: '# Section 1',
      style: 'banner',
    }

    const parsed = parseNoteOptions(raw)
    expect(parsed.showTitle).toBe(false)
  })
})
