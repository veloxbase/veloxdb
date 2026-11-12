import {
  CaretDownIcon,
  CheckIcon,
  GearIcon,
  SparkleIcon,
} from '@phosphor-icons/react'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { queryKeys } from '@/data/query-keys'
import { useCloudAuth } from '@/features/auth/AuthProvider'
import { fetchAiModels, fetchAiUsage, measureCloudLatency } from '@/features/auth/cloud-client'
import { isProBuild } from '@/lib/build-config'
import { OPENROUTER_POPULAR_MODELS } from '@/lib/openrouter-models'
import { useSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'

type VeloxyModelSelectorProps = {
  onOpenSettings: () => void
}

export function VeloxyModelSelector({ onOpenSettings }: VeloxyModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const { hasSession } = useCloudAuth()
  const settings = useSettings()

  const cloudModelsQuery = useQuery({
    queryKey: queryKeys.cloudModels(),
    queryFn: fetchAiModels,
    enabled: isProBuild && hasSession,
  })

  const cloudLatencyQuery = useQuery({
    queryKey: ['cloudLatency'],
    queryFn: measureCloudLatency,
    enabled: open && isProBuild && hasSession,
    staleTime: 15_000,
  })

  const cloudUsageQuery = useQuery({
    queryKey: queryKeys.cloudUsage(),
    queryFn: fetchAiUsage,
    enabled: open && isProBuild && hasSession,
    staleTime: 30_000,
  })

  const cloudModels = cloudModelsQuery.data ?? []
  const activeModelSlug = hasSession
    ? (settings.veloxyCloudModel || cloudModels[0]?.slug || '')
    : settings.veloxyModel

  const activeModelLabel = hasSession
    ? (cloudModels.find((m) => m.slug === activeModelSlug)?.displayName || activeModelSlug || 'Cloud AI')
    : (OPENROUTER_POPULAR_MODELS.find((m) => m.id === activeModelSlug)?.label || activeModelSlug || 'Select Model')

  const handleSelectCloudModel = (slug: string) => {
    useSettings.setState({ veloxyCloudModel: slug })
    setOpen(false)
  }

  const handleSelectOpenRouterModel = (id: string) => {
    useSettings.setState({ veloxyModel: id })
    setOpen(false)
  }

  const latency = cloudLatencyQuery.data

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-5 max-w-[140px] items-center gap-1 truncate rounded border border-border/80 bg-muted/40 px-1.5 text-[10px] font-medium text-foreground transition-colors hover:border-border hover:bg-accent/60"
          title={`Active model: ${activeModelLabel}`}
        >
          <SparkleIcon className="size-2.5 shrink-0 text-emerald-500" weight="fill" />
          <span className="truncate">{activeModelLabel}</span>
          <CaretDownIcon className="size-2.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-64 p-1.5 shadow-xl">
        <div className="mb-1.5 px-2 py-1.5 border-b border-border/60">
          <div className="flex items-center justify-between text-[11px] font-semibold text-foreground">
            <span>AI Model</span>
            <div className="flex items-center gap-1.5">
              {hasSession && latency ? (
                <span
                  className={cn(
                    'flex items-center gap-1 text-[10px] font-mono',
                    latency.ok
                      ? latency.latencyMs < 120
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                      : 'text-destructive'
                  )}
                  title={latency.ok ? `Gateway latency: ${latency.latencyMs}ms` : 'Gateway unreachable'}
                >
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      latency.ok
                        ? latency.latencyMs < 120
                          ? 'bg-emerald-500 animate-pulse'
                          : 'bg-amber-500'
                        : 'bg-destructive'
                    )}
                  />
                  {latency.ok ? `${latency.latencyMs}ms` : 'Offline'}
                </span>
              ) : null}
              <span className="text-[10px] font-normal text-muted-foreground">
                {hasSession ? 'Velox Cloud' : 'OpenRouter (BYOK)'}
              </span>
            </div>
          </div>
          {hasSession && cloudUsageQuery.data?.remaining ? (
            <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground font-mono">
              <span>Remaining quota:</span>
              <span className="font-semibold text-foreground">
                {cloudUsageQuery.data.remaining.dailyRequests} reqs left
              </span>
            </div>
          ) : null}
        </div>

        <div className="max-h-60 overflow-y-auto space-y-0.5">
          {hasSession ? (
            cloudModels.length > 0 ? (
              cloudModels.map((model) => {
                const isSelected = model.slug === activeModelSlug
                return (
                  <button
                    key={model.slug}
                    type="button"
                    onClick={() => handleSelectCloudModel(model.slug)}
                    className={cn(
                      'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors',
                      isSelected
                        ? 'bg-accent font-medium text-foreground'
                        : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                    )}
                  >
                    <div className="min-w-0 pr-2">
                      <p className="truncate text-xs font-medium">{model.displayName}</p>
                      <p className="truncate text-[10px] text-muted-foreground">{model.slug}</p>
                    </div>
                    {isSelected ? <CheckIcon className="size-3.5 shrink-0 text-emerald-500" /> : null}
                  </button>
                )
              })
            ) : (
              <p className="p-2 text-center text-xs text-muted-foreground">Loading Cloud models...</p>
            )
          ) : (
            OPENROUTER_POPULAR_MODELS.map((model) => {
              const isSelected = model.id === activeModelSlug
              return (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => handleSelectOpenRouterModel(model.id)}
                  className={cn(
                    'flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs transition-colors',
                    isSelected
                      ? 'bg-accent font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
                  )}
                >
                  <div className="min-w-0 pr-2">
                    <p className="truncate text-xs font-medium">{model.label}</p>
                    <p className="truncate text-[10px] text-muted-foreground">{model.id}</p>
                  </div>
                  {isSelected ? <CheckIcon className="size-3.5 shrink-0 text-emerald-500" /> : null}
                </button>
              )
            })
          )}
        </div>

        <div className="mt-1.5 border-t border-border/60 pt-1">
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onOpenSettings()
            }}
            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <GearIcon className="size-3" />
            <span>Configure Providers in Settings…</span>
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
