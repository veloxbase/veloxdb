import { invoke } from '@tauri-apps/api/core'

import { getCloudApiKeySync } from '@/features/auth/cloud-credentials'
import { getCloudUrl } from '@/features/auth/cloud-config'
import { compileAndPublishReport } from '@/features/dashboards/reports/reports-client'

type AgentMessage = {
  type?: string
  requestId?: string
  slug?: string
  dashboardId?: string
  widgetIds?: string[]
  variableValues?: Record<string, string>
  sqlHashes?: Record<string, string>
  emails?: string[]
  title?: string
}

type AgentStatusListener = (online: boolean) => void

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let stopped = true
const listeners = new Set<AgentStatusListener>()
let online = false

function notify(next: boolean) {
  online = next
  for (const listener of listeners) listener(next)
}

export function subscribeLiveAgent(listener: AgentStatusListener): () => void {
  listeners.add(listener)
  listener(online)
  return () => listeners.delete(listener)
}

export function isLiveAgentOnline() {
  return online
}

function wsUrl(token: string) {
  const http = getCloudUrl().replace(/\/$/, '')
  const ws = http.startsWith('https:') ? http.replace(/^https:/, 'wss:') : http.replace(/^http:/, 'ws:')
  return `${ws}/api/v1/agent/ws?token=${encodeURIComponent(token)}`
}

async function handleMessage(payload: AgentMessage) {
  const requestId = payload.requestId ?? ''
  const dashboardId = payload.dashboardId
  if (!dashboardId && payload.type !== 'hello_ok') {
    reply({ type: 'error', requestId, error: 'dashboardId required' })
    return
  }

  try {
    if (payload.type === 'run_widgets') {
      const widgets = await invoke('agent_run_widgets', {
        input: {
          dashboardId,
          widgetIds: payload.widgetIds ?? [],
          variableValues: payload.variableValues ?? {},
          sqlHashes: payload.sqlHashes ?? {},
        },
      })
      reply({ type: 'widget_results', requestId, widgets })
      return
    }
    if (payload.type === 'eval_alerts' && payload.slug) {
      const hits = await invoke<Array<{ widgetId: string; title: string; message: string; emails: string[] }>>('agent_eval_alerts', {
        input: {
          dashboardId,
          variableValues: payload.variableValues ?? {},
          sqlHashes: payload.sqlHashes ?? {},
        },
      })
      for (const hit of hits) {
        await fetch(`${getCloudUrl()}/api/v1/reports/${payload.slug}/notify`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${getCloudApiKeySync() ?? ''}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            type: 'alert',
            title: `VeloxDB alert: ${hit.title}`,
            message: hit.message,
            emails: hit.emails.length ? hit.emails : payload.emails,
            widgetId: hit.widgetId,
          }),
        })
      }
      reply({ type: 'alerts_done', requestId, hits })
      return
    }
    if (payload.type === 'render_pdf' && payload.slug) {
      const pdfBase64 = await invoke<string>('agent_render_pdf', {
        input: {
          dashboardId,
          title: payload.title ?? payload.slug,
          variableValues: payload.variableValues ?? {},
          sqlHashes: payload.sqlHashes ?? {},
        },
      })
      await fetch(`${getCloudUrl()}/api/v1/reports/${payload.slug}/notify`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${getCloudApiKeySync() ?? ''}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: 'pdf',
          title: payload.title ?? payload.slug,
          emails: payload.emails,
          pdfBase64,
          filename: `${payload.slug}.pdf`,
        }),
      })
      reply({ type: 'pdf_done', requestId })
      return
    }
    if (payload.type === 'republish' && dashboardId) {
      await compileAndPublishReport({
        dashboardId,
        title: payload.title ?? dashboardId,
        liveEnabled: true,
        variableValues: payload.variableValues,
      })
      reply({ type: 'republish_done', requestId })
    }
  } catch (error) {
    reply({
      type: 'error',
      requestId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

function reply(payload: Record<string, unknown>) {
  if (socket && socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(payload))
  }
}

function scheduleReconnect() {
  if (stopped) return
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = setTimeout(() => {
    void connectLiveAgent()
  }, 4000)
}

export function connectLiveAgent() {
  stopped = false
  const token = getCloudApiKeySync()
  if (!token) {
    notify(false)
    return
  }
  try {
    socket?.close()
  } catch {
    // ignore
  }
  const next = new WebSocket(wsUrl(token))
  socket = next
  next.onopen = () => {
    notify(true)
    next.send(JSON.stringify({ type: 'hello' }))
  }
  next.onclose = () => {
    notify(false)
    scheduleReconnect()
  }
  next.onerror = () => {
    notify(false)
  }
  next.onmessage = (event) => {
    try {
      void handleMessage(JSON.parse(String(event.data)) as AgentMessage)
    } catch {
      // ignore malformed
    }
  }
}

export function disconnectLiveAgent() {
  stopped = true
  if (reconnectTimer) clearTimeout(reconnectTimer)
  reconnectTimer = null
  socket?.close()
  socket = null
  notify(false)
}
