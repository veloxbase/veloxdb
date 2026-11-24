import { describe, expect, it } from 'vitest'

import type { ConnectionSummary, DatabaseEngine } from '@/data/types'

import {
  buildMcpClientConfigs,
  detectPlatform,
  editorSqlForMcpRequest,
  formatActivityTime,
  mcpClientName,
  mcpConnectionRows,
  mcpToolLabel,
  quoteShellArg,
  supportsAiTools,
} from '@/lib/mcp-config'

const MAC_LAUNCHER = '/Applications/VeloxDB.app/Contents/MacOS/veloxdb'
const WINDOWS_LAUNCHER = 'C:\\Program Files\\VeloxDB\\veloxdb.exe'

describe('supportsAiTools', () => {
  it('allows only engines whose database enforces read-only', () => {
    expect(supportsAiTools('postgres')).toBe(true)
    expect(supportsAiTools('mysql')).toBe(true)
    expect(supportsAiTools('sqlite')).toBe(true)
    for (const engine of ['mongo', 'redis', 'duckdb', 'mssql', 'clickhouse', 'libsql'] as const) {
      expect(supportsAiTools(engine)).toBe(false)
    }
  })
})

describe('detectPlatform', () => {
  it('reads the platform from the launcher path', () => {
    expect(detectPlatform(MAC_LAUNCHER)).toBe('mac')
    expect(detectPlatform(WINDOWS_LAUNCHER)).toBe('windows')
    expect(detectPlatform('/home/me/Apps/VeloxDB.AppImage')).toBe('linux')
    expect(detectPlatform('/Users/me/veloxdb/target/debug/veloxdb', 'Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe('mac')
  })
})

describe('quoteShellArg', () => {
  it('leaves plain arguments alone', () => {
    expect(quoteShellArg('--mcp', 'mac')).toBe('--mcp')
    expect(quoteShellArg('/usr/local/bin/veloxdb', 'linux')).toBe('/usr/local/bin/veloxdb')
  })

  it('quotes spaces and quotes for the platform shell', () => {
    expect(quoteShellArg('/Applications/Velox DB.app/x', 'mac')).toBe("'/Applications/Velox DB.app/x'")
    expect(quoteShellArg("/tmp/it's here", 'linux')).toBe("'/tmp/it'\\''s here'")
    expect(quoteShellArg(WINDOWS_LAUNCHER, 'windows')).toBe('"C:\\Program Files\\VeloxDB\\veloxdb.exe"')
  })
})

describe('buildMcpClientConfigs', () => {
  const configs = buildMcpClientConfigs(MAC_LAUNCHER, ['--mcp'], 'mac')
  const byId = Object.fromEntries(configs.map((config) => [config.id, config]))

  it('covers each supported client', () => {
    expect(configs.map((config) => config.id)).toEqual(['claude-desktop', 'claude-code', 'cursor', 'vscode'])
  })

  it('launches VeloxDB with --mcp and holds no secret', () => {
    const desktop = JSON.parse(byId['claude-desktop'].snippet)
    expect(desktop).toEqual({ mcpServers: { veloxdb: { command: MAC_LAUNCHER, args: ['--mcp'] } } })
    expect(JSON.parse(byId.cursor.snippet)).toEqual(desktop)
    expect(JSON.parse(byId.vscode.snippet)).toEqual({
      servers: { veloxdb: { type: 'stdio', command: MAC_LAUNCHER, args: ['--mcp'] } },
    })
    for (const config of configs) {
      expect(config.snippet.toLowerCase()).not.toMatch(/token|bearer|password|api.?key/)
    }
  })

  it('gives Claude Code a ready-to-run command', () => {
    expect(byId['claude-code'].kind).toBe('shell')
    expect(byId['claude-code'].snippet).toBe(`claude mcp add --scope user veloxdb -- ${MAC_LAUNCHER} --mcp`)
  })

  it('names the Claude Desktop config file for the platform', () => {
    expect(byId['claude-desktop'].where).toContain('~/Library/Application Support/Claude/claude_desktop_config.json')
    const windows = buildMcpClientConfigs(WINDOWS_LAUNCHER, ['--mcp'], 'windows')
    expect(windows[0].where).toContain('%APPDATA%\\Claude\\claude_desktop_config.json')
    expect(JSON.parse(windows[0].snippet).mcpServers.veloxdb.command).toBe(WINDOWS_LAUNCHER)
    expect(windows[1].snippet).toBe(`claude mcp add --scope user veloxdb -- "${WINDOWS_LAUNCHER}" --mcp`)
  })

  it('keeps extra launcher arguments such as a custom endpoint', () => {
    const custom = buildMcpClientConfigs(MAC_LAUNCHER, ['--mcp', '--endpoint', '/tmp/my dir/mcp-endpoint.json'], 'mac')
    expect(JSON.parse(custom[0].snippet).mcpServers.veloxdb.args).toEqual(['--mcp', '--endpoint', '/tmp/my dir/mcp-endpoint.json'])
    expect(custom[1].snippet).toContain("--endpoint '/tmp/my dir/mcp-endpoint.json'")
  })
})

describe('editorSqlForMcpRequest', () => {
  it('labels SQL with the app and title, on one comment line', () => {
    expect(
      editorSqlForMcpRequest({
        connectionId: 'c',
        client: 'claude-code',
        title: 'Archive old orders\nDROP TABLE users',
        sql: '  UPDATE orders SET archived = true WHERE created_at < now() - interval \'1 year\';  ',
      }),
    ).toBe(
      "-- Claude Code: Archive old orders DROP TABLE users\nUPDATE orders SET archived = true WHERE created_at < now() - interval '1 year';\n",
    )
  })

  it('falls back to the client name without a title', () => {
    expect(editorSqlForMcpRequest({ connectionId: 'c', client: 'claude-ai', sql: 'SELECT 1' })).toBe(
      '-- From Claude Desktop\nSELECT 1\n',
    )
  })
})

describe('labels', () => {
  it('names known clients and tools', () => {
    expect(mcpClientName('cursor-vscode')).toBe('Cursor')
    expect(mcpClientName('my-agent')).toBe('my-agent')
    expect(mcpClientName('  ')).toBe('An AI app')
    expect(mcpToolLabel('run_readonly_query')).toBe('Ran a read-only query')
    expect(mcpToolLabel('something_new')).toBe('something_new')
  })

  it('formats activity times', () => {
    const now = 1_700_000_000_000
    expect(formatActivityTime(now - 10_000, now)).toBe('just now')
    expect(formatActivityTime(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(formatActivityTime(now - 3 * 3_600_000, now)).toBe('3 h ago')
  })
})

function connection(id: string, engine: DatabaseEngine, extra: Partial<ConnectionSummary> = {}): ConnectionSummary {
  return {
    id,
    name: `${id} db`,
    engine,
    host: 'localhost',
    port: 5432,
    database: 'shop',
    user: 'me',
    connectedAt: '0',
    sslMode: 'disable',
    tablePropertyEditingSupported: false,
    ...extra,
  }
}

describe('mcpConnectionRows', () => {
  const rows = mcpConnectionRows([
    connection('pg', 'postgres', { allowAiTools: true }),
    connection('my', 'mysql'),
    connection('lite', 'sqlite', { filePath: '/Users/me/data/app.db', allowAiTools: true }),
    connection('mongo', 'mongo', { allowAiTools: true }),
    connection('temp_123', 'postgres'),
  ])

  it('lists saved connections only', () => {
    expect(rows.map((row) => row.id)).toEqual(['pg', 'my', 'lite', 'mongo'])
  })

  it('shares only opted-in connections on supported engines', () => {
    expect(rows.map((row) => [row.id, row.supported, row.shared])).toEqual([
      ['pg', true, true],
      ['my', true, false],
      ['lite', true, true],
      // Opted in before engines were restricted: still not shared.
      ['mongo', false, false],
    ])
  })

  it('describes each connection by engine and database or file', () => {
    expect(rows.map((row) => row.detail)).toEqual([
      'PostgreSQL · shop',
      'MySQL · shop',
      'SQLite · app.db',
      'MongoDB · shop',
    ])
  })
})
