import { describe, expect, it } from 'vitest'

import { cssColorToHex } from './reports-client'

describe('cssColorToHex', () => {
  it('converts rgb and opaque rgba', () => {
    expect(cssColorToHex('rgb(11, 11, 12)')).toBe('#0b0b0c')
    expect(cssColorToHex('rgba(255, 0, 16, 1)')).toBe('#ff0010')
  })

  it('treats transparent and unknown values as missing', () => {
    expect(cssColorToHex('rgba(0, 0, 0, 0)')).toBeNull()
    expect(cssColorToHex('oklch(0.2 0 0)')).toBeNull()
  })
})
