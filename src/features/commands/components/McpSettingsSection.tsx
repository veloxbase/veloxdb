import { CheckIcon, CopyIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { queryKeys } from '@/data/query-keys'
import { veloxDbRepository } from '@/data/repositories'
import type { ConnectionSummary, McpStatus } from '@/data/types'
import { useConnectionsQuery } from '@/features/connections/queries'
import {
  buildMcpClientConfigs,
  detectPlatform,
  formatActivityTime,
  mcpClientName,
  mcpConnectionRows,
  mcpToolLabel,
  type McpClientId,
} from '@/lib/mcp-config'
import { cn } from '@/lib/utils'

import { SettingsGroup, SettingsRow, SettingsToggle } from './settings-layout'

const VISIBLE_ACTIVITY = 8

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Settings → Veloxy → AI tools: MCP access for AI apps the user already has. */
export function McpSettingsSection() {
  const queryClient = useQueryClient()
  const statusQuery = useQuery({
    queryKey: queryKeys.mcpStatus(),
    queryFn: () => veloxDbRepository.getMcpStatus(),
  })
  const connectionsQuery = useConnectionsQuery()
  const [clientId, setClientId] = useState<McpClientId>('claude-desktop')
  const [copied, setCopied] = useState<McpClientId | null>(null)

  // Refresh the activity list as calls come in.
  useEffect(() => {
    let disposed = false
    let unlisten: (() => void) | undefined
    void listen('mcp://activity', () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.mcpStatus() })
    }).then((fn) => {
      if (disposed) fn()
      else unlisten = fn
    }).catch(() => {})
    return () => {
      disposed = true
      unlisten?.()
    }
  }, [queryClient])

  const enabledMutation = useMutation({
    mutationFn: (enabled: boolean) => veloxDbRepository.setMcpEnabled(enabled),
    onSuccess: (status) => queryClient.setQueryData<McpStatus>(queryKeys.mcpStatus(), status),
  })
  const shareMutation = useMutation({
    mutationFn: ({ id, allowed }: { id: string; allowed: boolean }) =>
      veloxDbRepository.setConnectionAiTools(id, allowed),
    onSuccess: (updated) =>
      queryClient.setQueryData<ConnectionSummary[]>(queryKeys.connections(), (current) =>
        current?.map((connection) => (connection.id === updated.id ? { ...connection, ...updated } : connection)),
      ),
  })
  const clearMutation = useMutation({
    mutationFn: () => veloxDbRepository.clearMcpActivity(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.mcpStatus() }),
  })

  const status = statusQuery.data
  const enabled = status?.enabled ?? false
  const connections = mcpConnectionRows(connectionsQuery.data ?? [])
  const sharedCount = connections.filter((connection) => connection.shared).length
  const configs = status?.launcher
    ? buildMcpClientConfigs(
        status.launcher,
        status.launcherArgs,
        detectPlatform(status.launcher, typeof navigator === 'undefined' ? '' : navigator.userAgent),
      )
    : []
  const config = configs.find((item) => item.id === clientId) ?? configs[0]

  const copy = async () => {
    if (!config) return
    await navigator.clipboard.writeText(config.snippet)
    setCopied(config.id)
    window.setTimeout(() => setCopied((current) => (current === config.id ? null : current)), 2000)
  }

  const error = enabledMutation.error ?? shareMutation.error ?? statusQuery.error

  return (
    <section aria-labelledby="mcp-settings-title" className="space-y-4 border-t border-border pt-6">
      <header>
        <h3 id="mcp-settings-title" className="text-[13px] font-semibold tracking-tight text-foreground">
          AI tools for other apps (MCP)
        </h3>
        <p className="mt-1 max-w-[60ch] text-xs leading-relaxed text-muted-foreground">
          Let AI apps you already use, such as Claude Desktop, Claude Code, Cursor and VS Code, read schemas
          and run read-only queries on the connections you share below, using their own subscription. No API
          key is needed here. Nothing they run can write: changes open in the editor for you to review and run.
        </p>
      </header>

      <SettingsGroup>
        <SettingsRow
          label="Let AI apps use VeloxDB"
          description={
            enabled
              ? status?.running
                ? `On while VeloxDB is open. ${sharedCount} connection${sharedCount === 1 ? '' : 's'} shared.`
                : 'On, but the server is not running. Turn it off and on again.'
              : 'Off. AI apps cannot reach VeloxDB.'
          }
        >
          <SettingsToggle
            value={enabled}
            label="Let AI apps use VeloxDB"
            disabled={statusQuery.isLoading || enabledMutation.isPending}
            onChange={(next) => enabledMutation.mutate(next)}
          />
        </SettingsRow>
      </SettingsGroup>

      {error ? (
        <p role="alert" className="flex items-start gap-1.5 text-[11px] leading-snug text-destructive">
          <WarningCircleIcon className="mt-px size-3.5 shrink-0" />
          {errorMessage(error)}
        </p>
      ) : null}

      <SettingsGroup title="Shared connections">
        {connections.length === 0 ? (
          <p className="px-4 py-3.5 text-[11px] text-muted-foreground">Add a connection first.</p>
        ) : (
          connections.map((connection) => (
            <SettingsRow
              key={connection.id}
              label={connection.name}
              description={
                connection.supported
                  ? connection.detail
                  : `${connection.detail}. Not supported yet: AI tools need PostgreSQL, MySQL, MariaDB or SQLite.`
              }
            >
              <SettingsToggle
                value={connection.shared}
                label={`Allow AI tools on this connection: ${connection.name}`}
                disabled={!connection.supported || shareMutation.isPending}
                onChange={(next) => shareMutation.mutate({ id: connection.id, allowed: next })}
              />
            </SettingsRow>
          ))
        )}
      </SettingsGroup>
      <p className="-mt-2 px-1 text-[11px] leading-snug text-muted-foreground">
        A shared connection can be read in full by the AI app, with the database user saved in VeloxDB. For
        sensitive data, connect with a read-only database user.
      </p>

      <SettingsGroup title="Connect an AI app">
        <div className="space-y-3 px-4 py-3.5">
          <div role="tablist" aria-label="AI app" className="flex flex-wrap gap-1">
            {configs.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={item.id === config?.id}
                onClick={() => setClientId(item.id)}
                className={cn(
                  'h-7 rounded-md border px-2.5 text-[11px] font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  item.id === config?.id
                    ? 'border-primary bg-primary/[0.08] text-foreground'
                    : 'border-border text-muted-foreground hover:text-foreground',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
          {config ? (
            <>
              <p className="text-[11px] leading-snug text-muted-foreground">{config.where}</p>
              <div className="relative">
                <pre
                  className={cn(
                    'max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-3 pr-20 font-mono text-[11px] leading-relaxed text-foreground',
                    // A one-line command wraps instead of running under the Copy button.
                    config.kind === 'shell' && 'whitespace-pre-wrap break-all',
                  )}
                >
                  {config.snippet}
                </pre>
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-2 right-2 h-7 gap-1 px-2 text-[11px]"
                  onClick={() => { void copy() }}
                >
                  {copied === config.id ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
                  {copied === config.id ? 'Copied' : 'Copy'}
                </Button>
              </div>
              {status?.launcherWarning ? (
                <p className="text-[11px] leading-snug text-amber-600 dark:text-amber-400">{status.launcherWarning}</p>
              ) : null}
              <p className="text-[11px] leading-snug text-muted-foreground">
                The config has no secret in it. VeloxDB must be open with AI tools on for the app to reach your
                databases.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {statusQuery.isLoading ? 'Loading…' : 'Could not find the VeloxDB executable to put in the config.'}
            </p>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Recent activity">
        {status?.activity.length ? (
          <>
            <ul className="divide-y divide-border">
              {status.activity.slice(0, VISIBLE_ACTIVITY).map((item) => (
                <li key={`${item.atMs}-${item.tool}-${item.summary ?? ''}`} className="px-4 py-2.5">
                  <div className="flex items-baseline justify-between gap-3 text-xs">
                    <span className={cn('min-w-0 truncate', item.ok ? 'text-foreground' : 'text-destructive')}>
                      {mcpClientName(item.client)} · {mcpToolLabel(item.tool)}
                      {item.connection ? <span className="text-muted-foreground"> on {item.connection}</span> : null}
                      {item.ok ? null : <span> (refused)</span>}
                    </span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{formatActivityTime(item.atMs)}</span>
                  </div>
                  {item.summary ? (
                    <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{item.summary}</p>
                  ) : null}
                </li>
              ))}
            </ul>
            <div className="flex justify-end px-4 py-2">
              <Button variant="ghost" size="sm" className="h-7 text-[11px]" onClick={() => clearMutation.mutate()}>
                Clear
              </Button>
            </div>
          </>
        ) : (
          <p className="px-4 py-3.5 text-[11px] text-muted-foreground">
            No calls yet. Calls from AI apps show here while VeloxDB is open.
          </p>
        )}
      </SettingsGroup>
    </section>
  )
}
