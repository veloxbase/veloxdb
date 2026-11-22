import type { ConnectionSummary, DatabaseEngine, McpOpenInEditorRequest } from '@/data/types'

/**
 * Engines whose database itself refuses writes from agent SQL, the only
 * ones AI apps can reach over MCP. Keep in sync with
 * `enforces_readonly_in_database` in src-tauri/src/engines/mod.rs.
 */
export const MCP_SUPPORTED_ENGINES: readonly DatabaseEngine[] = ['postgres', 'mysql', 'sqlite']

export function supportsAiTools(engine: DatabaseEngine): boolean {
  return MCP_SUPPORTED_ENGINES.includes(engine)
}

const ENGINE_LABELS: Partial<Record<DatabaseEngine, string>> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  sqlite: 'SQLite',
  mongo: 'MongoDB',
  duckdb: 'DuckDB',
  redis: 'Redis',
  clickhouse: 'ClickHouse',
  libsql: 'libSQL',
  turso: 'Turso',
  scylladb: 'ScyllaDB',
  cassandra: 'Cassandra',
  mssql: 'SQL Server',
  azuresql: 'Azure SQL',
}

/** One row of Settings → Veloxy → AI tools → Shared connections. */
export type McpConnectionRow = {
  id: string
  name: string
  /** "PostgreSQL · shop" or "SQLite · app.db". */
  detail: string
  supported: boolean
  /** Shared with AI apps: opted in and on a supported engine. */
  shared: boolean
}

export function mcpConnectionRows(connections: readonly ConnectionSummary[]): McpConnectionRow[] {
  return connections
    // Optimistic placeholders from an in-flight connect have no saved record yet.
    .filter((connection) => !connection.id.startsWith('temp_'))
    .map((connection) => {
      const supported = supportsAiTools(connection.engine)
      const engine = ENGINE_LABELS[connection.engine] ?? connection.engine
      const target = connection.engine === 'sqlite'
        ? (connection.filePath || connection.database).split(/[\\/]/).pop()
        : connection.database
      return {
        id: connection.id,
        name: connection.name,
        detail: target ? `${engine} · ${target}` : engine,
        supported,
        shared: supported && Boolean(connection.allowAiTools),
      }
    })
}

/** Name the server is registered under in each client. */
export const MCP_SERVER_NAME = 'veloxdb'

export type McpPlatform = 'mac' | 'windows' | 'linux'

export type McpClientId = 'claude-desktop' | 'claude-code' | 'cursor' | 'vscode'

export type McpClientConfig = {
  id: McpClientId
  label: string
  /** Where the snippet goes, in the user's words. */
  where: string
  snippet: string
  kind: 'json' | 'shell'
}

export function detectPlatform(launcher: string, userAgent = ''): McpPlatform {
  if (/^[a-z]:[\\/]/i.test(launcher) || launcher.startsWith('\\\\')) return 'windows'
  if (launcher.includes('.app/Contents/MacOS/') || /Mac/.test(userAgent)) return 'mac'
  return 'linux'
}

/** Quotes one argument for the shell the user is likely to paste into. */
export function quoteShellArg(arg: string, platform: McpPlatform): string {
  if (/^[\w@%+=:,./-]+$/.test(arg)) return arg
  if (platform === 'windows') return `"${arg.replace(/"/g, '\\"')}"`
  return `'${arg.replace(/'/g, `'\\''`)}'`
}

function claudeDesktopConfigPath(platform: McpPlatform): string {
  if (platform === 'mac') return '~/Library/Application Support/Claude/claude_desktop_config.json'
  if (platform === 'windows') return '%APPDATA%\\Claude\\claude_desktop_config.json'
  return '~/.config/Claude/claude_desktop_config.json'
}

/**
 * Config for each supported client. All of them launch VeloxDB with `--mcp`
 * over stdio; none holds a secret, because the bridge reads the app's
 * current port and token from a user-only file at call time.
 */
export function buildMcpClientConfigs(
  launcher: string,
  args: readonly string[],
  platform: McpPlatform,
): McpClientConfig[] {
  const server = { command: launcher, args: [...args] }
  const mcpServers = JSON.stringify({ mcpServers: { [MCP_SERVER_NAME]: server } }, null, 2)
  const command = [launcher, ...args].map((arg) => quoteShellArg(arg, platform)).join(' ')
  return [
    {
      id: 'claude-desktop',
      label: 'Claude Desktop',
      where: `Add to ${claudeDesktopConfigPath(platform)} (Settings → Developer → Edit Config), then restart Claude Desktop.`,
      snippet: mcpServers,
      kind: 'json',
    },
    {
      id: 'claude-code',
      label: 'Claude Code',
      where: 'Run in a terminal. Or add the Claude Desktop JSON to a project’s .mcp.json.',
      snippet: `claude mcp add --scope user ${MCP_SERVER_NAME} -- ${command}`,
      kind: 'shell',
    },
    {
      id: 'cursor',
      label: 'Cursor',
      where: 'Add to ~/.cursor/mcp.json (Cursor Settings → MCP → Add new server).',
      snippet: mcpServers,
      kind: 'json',
    },
    {
      id: 'vscode',
      label: 'VS Code',
      where: 'Add to .vscode/mcp.json in a workspace, or run “MCP: Open User Configuration”.',
      snippet: JSON.stringify({ servers: { [MCP_SERVER_NAME]: { type: 'stdio', ...server } } }, null, 2),
      kind: 'json',
    },
  ]
}

const CLIENT_NAMES: Record<string, string> = {
  'claude-code': 'Claude Code',
  'claude-ai': 'Claude Desktop',
  'cursor-vscode': 'Cursor',
  cursor: 'Cursor',
  'Visual Studio Code': 'VS Code',
  'visual-studio-code': 'VS Code',
}

/** Display name for the `clientInfo.name` an MCP client sends. */
export function mcpClientName(client: string): string {
  const trimmed = client.trim()
  return CLIENT_NAMES[trimmed] ?? (trimmed || 'An AI app')
}

const TOOL_LABELS: Record<string, string> = {
  list_connections: 'Listed connections',
  get_schema: 'Read the schema',
  run_readonly_query: 'Ran a read-only query',
  explain_query: 'Explained a query',
  open_in_editor: 'Opened SQL in the editor',
}

export function mcpToolLabel(tool: string): string {
  return TOOL_LABELS[tool] ?? tool
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Editor text for SQL an AI app sent with `open_in_editor`: a comment saying
 * where it came from, then the SQL. Nothing has run; the user runs it.
 */
export function editorSqlForMcpRequest(request: McpOpenInEditorRequest): string {
  const client = oneLine(mcpClientName(request.client))
  const title = request.title ? oneLine(request.title) : ''
  const header = title ? `-- ${client}: ${title}` : `-- From ${client}`
  return `${header}\n${request.sql.trim()}\n`
}

/** "just now", "5 min ago", "3 h ago", or a date for older calls. */
export function formatActivityTime(atMs: number, nowMs: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((nowMs - atMs) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(atMs).toLocaleDateString()
}
