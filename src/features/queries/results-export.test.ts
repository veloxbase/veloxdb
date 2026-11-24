import { describe, expect, it } from 'vitest'
import {
  buildMarkdownTableContent,
  buildSqlInsertContent,
} from './results-export'

describe('results-export', () => {
  describe('buildMarkdownTableContent', () => {
    it('returns empty string when columns are empty', () => {
      expect(buildMarkdownTableContent([], [])).toBe('')
    })

    it('builds a clean markdown table with headers and data', () => {
      const columns = ['id', 'username', 'email']
      const rows = [
        { id: '1', username: 'alice', email: 'alice@example.com' },
        { id: '2', username: 'bob', email: 'bob@example.com' },
      ]

      const expected = [
        '| id | username | email |',
        '| --- | --- | --- |',
        '| 1 | alice | alice@example.com |',
        '| 2 | bob | bob@example.com |',
      ].join('\n')

      expect(buildMarkdownTableContent(columns, rows)).toBe(expected)
    })

    it('escapes pipe characters and converts newlines to <br>', () => {
      const columns = ['id', 'bio']
      const rows = [
        { id: '1', bio: 'Line 1\nLine 2 | with pipes' },
        { id: '2', bio: null },
      ]

      const result = buildMarkdownTableContent(columns, rows)
      expect(result).toContain('Line 1<br>Line 2 \\| with pipes')
      expect(result).toContain('NULL')
    })
  })

  describe('buildSqlInsertContent', () => {
    it('returns empty string when columns or rows are empty', () => {
      expect(buildSqlInsertContent('users', [], [])).toBe('')
      expect(buildSqlInsertContent('users', ['id'], [])).toBe('')
    })

    it('builds valid SQL insert statement with quotes and NULLs', () => {
      const columns = ['id', 'name', 'status']
      const rows = [
        { id: '1', name: "O'Connor", status: 'active' },
        { id: '2', name: 'Bob', status: null },
      ]

      const result = buildSqlInsertContent('users', columns, rows)
      expect(result).toContain('INSERT INTO users ("id", "name", "status")')
      expect(result).toContain("('1', 'O''Connor', 'active')")
      expect(result).toContain("('2', 'Bob', NULL)")
      expect(result.endsWith(';')).toBe(true)
    })

    it('handles qualified schema table names cleanly', () => {
      const columns = ['id']
      const rows = [{ id: '10' }]
      const result = buildSqlInsertContent('"public"."accounts"', columns, rows)
      expect(result).toContain('INSERT INTO "public"."accounts" ("id")')
    })
  })
})
