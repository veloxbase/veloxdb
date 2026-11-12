import {
  CheckCircleIcon,
  CircleNotchIcon,
  LightningIcon,
  SparkleIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'

import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { queryKeys } from '@/data/query-keys'
import type { Dashboard, DatabaseEngine } from '@/data/types'
import { useCloudAuth } from '@/features/auth/AuthProvider'
import { fetchAiModels } from '@/features/auth/cloud-client'
import { useConnectionsQuery } from '@/features/connections/queries'
import { generateAutonomousDashboard } from '@/features/dashboards/ai/generate-dashboard'
import type {
  DashboardGenerationStep,
  FailedWidget,
} from '@/features/dashboards/ai/dashboard-generator-types'
import { canUseDashboards } from '@/features/dashboards/engine-guard'
import { useSaveDashboardMutation } from '@/features/dashboards/queries'
import { isProBuild } from '@/lib/build-config'

const STEP_ORDER: Record<DashboardGenerationStep, number> = {
  idle: 0,
  introspecting: 1,
  synthesizing: 2,
  validating: 3,
  repairing: 4,
  composing: 5,
  done: 6,
  error: 0,
}

type GenerationSummary = {
  dashboard: Dashboard
  validated: number
  repaired: number
  failed: FailedWidget[]
  variables: number
}
import { notifyError, notifySuccess } from '@/lib/error-notifier'
import { isVeloxyConfigured, useSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'

type GenerateDashboardDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  connectionId: string | null
  onDashboardCreated: (dashboard: Dashboard) => void
  onOpenSettings: () => void
  onSignIn?: () => void
}

const STARTER_PROMPTS = [
  'Executive Sales & Revenue Overview',
  'Customer Churn & Retention Metrics',
  'Platform Activity & User Growth Trends',
  'Inventory, Orders & Fulfillment Breakdown',
]

export function GenerateDashboardDialog({
  open,
  onOpenChange,
  connectionId: initialConnectionId,
  onDashboardCreated,
  onOpenSettings,
  onSignIn,
}: GenerateDashboardDialogProps) {
  const { t } = useTranslation()
  const { hasSession, signIn } = useCloudAuth()
  const settings = useSettings()

  const [prompt, setPrompt] = useState('')
  const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(initialConnectionId)
  const [step, setStep] = useState<DashboardGenerationStep>('idle')
  const [stepDetail, setStepDetail] = useState<string>('')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [summary, setSummary] = useState<GenerationSummary | null>(null)

  const connectionsQuery = useConnectionsQuery()
  const allConnections = connectionsQuery.data ?? []
  const validConnections = allConnections.filter((c) => canUseDashboards(c.engine))

  const activeConnection = validConnections.find(
    (c) => c.id === (selectedConnectionId || initialConnectionId),
  ) ?? validConnections[0]

  const cloudModelsQuery = useQuery({
    queryKey: queryKeys.cloudModels(),
    queryFn: fetchAiModels,
    enabled: open && hasSession,
  })

  const modelLabel = hasSession
    ? (settings.veloxyCloudModel || cloudModelsQuery.data?.[0]?.slug || '')
    : settings.veloxyModel

  const authMode: 'cloud' | 'byok' = hasSession ? 'cloud' : 'byok'
  const apiKey = settings.veloxyOpenRouterApiKey

  const isConfigured = isVeloxyConfigured({
    authMode,
    hasSession,
    apiKey,
    model: settings.veloxyModel,
    cloudModel: settings.veloxyCloudModel || cloudModelsQuery.data?.[0]?.slug,
    baseUrl: settings.veloxyBaseUrl,
  })

  const saveMutation = useSaveDashboardMutation({
    onError: (error) => notifyError(error, { title: 'Failed to save generated dashboard' }),
  })

  const handleGenerate = async () => {
    if (!prompt.trim() || !activeConnection || !isConfigured || step !== 'idle') return

    setErrorMessage(null)
    setSummary(null)
    setStep('introspecting')
    setStepDetail('Starting database introspection...')

    try {
      const result = await generateAutonomousDashboard({
        connectionId: activeConnection.id,
        engine: activeConnection.engine as DatabaseEngine,
        databaseName: activeConnection.database,
        prompt: prompt.trim(),
        model: modelLabel,
        apiKey,
        baseUrl: settings.veloxyBaseUrl,
        authMode,
        onStepChange: (newStep, detail) => {
          setStep(newStep)
          if (detail) setStepDetail(detail)
        },
      })

      saveMutation.mutate(result.dashboard, {
        onSuccess: (saved) => {
          const repairedNote = result.repairedWidgetsCount > 0 ? `, ${result.repairedWidgetsCount} repaired` : ''
          notifySuccess(
            'Dashboard generated!',
            `Created "${saved.name}" with ${result.validatedWidgetsCount} widgets${repairedNote}.`,
          )
          if (result.failed.length === 0) {
            setStep('idle')
            setPrompt('')
            onOpenChange(false)
            onDashboardCreated(saved)
            return
          }
          // Keep the dialog open so the user can see which widgets were dropped and why.
          setSummary({
            dashboard: saved,
            validated: result.validatedWidgetsCount,
            repaired: result.repairedWidgetsCount,
            failed: result.failed,
            variables: result.variables.length,
          })
          setStep('done')
        },
        onError: (err) => {
          setStep('error')
          setErrorMessage(err instanceof Error ? err.message : 'Failed to save generated dashboard.')
        },
      })
    } catch (error) {
      setStep('error')
      setErrorMessage(error instanceof Error ? error.message : 'Failed to generate dashboard.')
    }
  }

  const handleClose = () => {
    if (step !== 'idle' && step !== 'error' && step !== 'done') {
      if (!window.confirm('Dashboard generation is in progress. Are you sure you want to cancel?')) {
        return
      }
    }
    setStep('idle')
    setErrorMessage(null)
    setSummary(null)
    onOpenChange(false)
  }

  const handleOpenGenerated = () => {
    if (!summary) return
    const created = summary.dashboard
    setStep('idle')
    setPrompt('')
    setSummary(null)
    onOpenChange(false)
    onDashboardCreated(created)
  }

  const isWorking = step !== 'idle' && step !== 'error' && step !== 'done'

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="overflow-hidden border-border p-0 sm:max-w-[560px]">
        {/* Header */}
        <DialogHeader className="border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <div className="flex size-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <SparkleIcon className="size-4" weight="fill" />
            </div>
            <div>
              <DialogTitle className="text-sm font-medium text-foreground">
                Generate Dashboard with Veloxy
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                Autonomous 1-shot BI: introspects schema, drafts metrics, and mounts a full grid.
              </p>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 p-5">
          {/* Unconfigured Warning */}
          {!isConfigured ? (
            <div className="rounded-md border border-amber-500/35 bg-amber-500/[0.08] p-3 text-xs text-amber-950 dark:text-amber-100">
              <div className="flex gap-2">
                <WarningCircleIcon className="mt-0.5 size-4 shrink-0 opacity-80" />
                <div className="space-y-2">
                  <p className="font-medium">Veloxy AI is not configured</p>
                  <p className="text-[11px] opacity-80">
                    Sign in to Velox Cloud or add your OpenRouter API key in Settings to use autonomous dashboard generation.
                  </p>
                  <div className="flex gap-2">
                    {isProBuild && !hasSession ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-amber-500/40 bg-background/60 text-xs"
                        onClick={() => { onSignIn?.(); void signIn(); }}
                      >
                        Sign in
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 border-amber-500/40 bg-background/60 text-xs"
                      onClick={() => { onOpenChange(false); onOpenSettings(); }}
                    >
                      Open Settings
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {/* Connection Picker if multiple */}
          {validConnections.length > 1 ? (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-foreground">Target Connection</label>
              <select
                value={activeConnection?.id}
                onChange={(e) => setSelectedConnectionId(e.target.value)}
                disabled={isWorking}
                className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs shadow-sm transition-colors focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
              >
                {validConnections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.engine} · {c.database})
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {/* Prompt Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground">What dashboard do you want to build?</label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. Executive Sales & Retention: monthly revenue trends, customer churn rate, top spending accounts, and category breakdowns."
              disabled={isWorking || !isConfigured}
              rows={3}
              className="resize-none text-xs leading-relaxed"
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault()
                  void handleGenerate()
                }
              }}
            />
          </div>

          {/* Starter Template Pills */}
          {!isWorking && isConfigured ? (
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Starter Suggestions
              </p>
              <div className="flex flex-wrap gap-1.5">
                {STARTER_PROMPTS.map((starter) => (
                  <button
                    key={starter}
                    type="button"
                    onClick={() => setPrompt(starter)}
                    className="rounded-full border border-border/70 bg-muted/30 px-2.5 py-1 text-[11px] text-muted-foreground transition hover:border-border hover:bg-accent/40 hover:text-foreground"
                  >
                    {starter}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {/* Progress Tracker during generation */}
          {isWorking ? (
            <div className="space-y-2.5 rounded-md border border-border/80 bg-muted/20 p-3.5">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground">Generating Autonomous Dashboard</p>
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <CircleNotchIcon className="size-3 animate-spin text-emerald-500" />
                  Working
                </span>
              </div>

              {/* Steps Progress Visual */}
              <div className="grid grid-cols-5 gap-1.5 text-[10px]">
                <StepBadge
                  label="1. Profile"
                  active={step === 'introspecting'}
                  done={STEP_ORDER[step] > 1}
                />
                <StepBadge
                  label="2. Queries"
                  active={step === 'synthesizing'}
                  done={STEP_ORDER[step] > 2}
                />
                <StepBadge
                  label="3. Validate"
                  active={step === 'validating'}
                  done={STEP_ORDER[step] > 3}
                />
                <StepBadge
                  label="4. Repair"
                  active={step === 'repairing'}
                  done={STEP_ORDER[step] > 4}
                />
                <StepBadge
                  label="5. Layout"
                  active={step === 'composing'}
                  done={STEP_ORDER[step] > 5}
                />
              </div>

              {stepDetail ? (
                <p className="text-[11px] leading-relaxed text-muted-foreground">{stepDetail}</p>
              ) : null}
            </div>
          ) : null}

          {/* Done summary with dropped widgets */}
          {step === 'done' && summary ? (
            <div className="space-y-2.5 rounded-md border border-border/80 bg-muted/20 p-3.5 text-xs">
              <div className="flex items-center gap-2">
                <CheckCircleIcon className="size-4 text-emerald-500" weight="fill" />
                <p className="font-semibold text-foreground">
                  {summary.validated} widget{summary.validated === 1 ? '' : 's'} verified
                  {summary.repaired > 0 ? `, ${summary.repaired} repaired` : ''}
                  {summary.variables > 0 ? `, ${summary.variables} filter${summary.variables === 1 ? '' : 's'}` : ''}
                </p>
              </div>
              {summary.failed.length > 0 ? (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">
                    {summary.failed.length} widget{summary.failed.length === 1 ? ' was' : 's were'} dropped after a repair attempt:
                  </p>
                  <ul className="max-h-40 space-y-1.5 overflow-y-auto">
                    {summary.failed.map((item) => (
                      <li key={`${item.title}:${item.sql}`} className="rounded border border-amber-500/30 bg-amber-500/[0.06] p-2">
                        <p className="font-medium text-foreground">{item.title}</p>
                        <p className="mt-0.5 break-words text-[11px] text-amber-800 dark:text-amber-200">{item.error}</p>
                        <pre className="mt-1 max-h-16 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-muted-foreground">{item.sql}</pre>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : null}

          {/* Error Message */}
          {errorMessage ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-xs leading-relaxed text-destructive">
              <p className="font-medium">Generation Error</p>
              <p className="mt-0.5 text-[11px] opacity-90">{errorMessage}</p>
            </div>
          ) : null}
        </div>

        {/* Footer */}
        <DialogFooter className="border-t border-border bg-muted/10 px-5 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
            disabled={isWorking}
            onClick={handleClose}
          >
            {t('common.cancel', 'Cancel')}
          </Button>

          {step === 'done' && summary ? (
            <Button
              type="button"
              size="sm"
              className="h-8 gap-1.5 text-xs font-medium"
              onClick={handleOpenGenerated}
            >
              <CheckCircleIcon className="size-3.5" weight="fill" />
              Open Dashboard
            </Button>
          ) : (
          <Button
            type="button"
            size="sm"
            className="h-8 gap-1.5 text-xs font-medium"
            disabled={!prompt.trim() || !activeConnection || !isConfigured || isWorking}
            onClick={() => void handleGenerate()}
          >
            {isWorking ? (
              <>
                <CircleNotchIcon className="size-3.5 animate-spin" />
                Generating…
              </>
            ) : (
              <>
                <LightningIcon className="size-3.5 fill-current" />
                Generate Dashboard
              </>
            )}
          </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function StepBadge({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  return (
    <div
      className={cn(
        'flex items-center justify-center gap-1 rounded border py-1 text-center font-medium transition',
        done
          ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
          : active
            ? 'border-ring/60 bg-muted/60 text-foreground animate-pulse'
            : 'border-border/40 bg-background/40 text-muted-foreground/60',
      )}
    >
      {done ? <CheckCircleIcon className="size-2.5" weight="bold" /> : null}
      <span>{label}</span>
    </div>
  )
}
