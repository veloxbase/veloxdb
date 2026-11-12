import {
  CaretDownIcon,
  CheckIcon,
  GearIcon,
  SparkleIcon,
} from '@phosphor-icons/react'
import { useState } from 'react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { OLLAMA_POPULAR_MODELS, OPENROUTER_POPULAR_MODELS } from '@/lib/openrouter-models'
import { isLocalAiEndpoint, useSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'

type VeloxyModelSelectorProps = {
  onOpenSettings: () => void
}

function providerLabel(baseUrl: string | null | undefined): string {
  const trimmed = baseUrl?.trim() ?? ''
  if (isLocalAiEndpoint(trimmed)) return 'Local model'
  if (!trimmed || trimmed.includes('openrouter.ai')) return 'OpenRouter'
  return 'Custom endpoint'
}

export function VeloxyModelSelector({ onOpenSettings }: VeloxyModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const activeModelSlug = useSettings((s) => s.veloxyModel)
  const baseUrl = useSettings((s) => s.veloxyBaseUrl)

  const presets = isLocalAiEndpoint(baseUrl) ? OLLAMA_POPULAR_MODELS : OPENROUTER_POPULAR_MODELS
  const activeModelLabel =
    presets.find((m) => m.id === activeModelSlug)?.label || activeModelSlug || 'Select Model'
  // Keep a custom model id (typed in Settings) selectable alongside the presets.
  const models = activeModelSlug && !presets.some((m) => m.id === activeModelSlug)
    ? [{ id: activeModelSlug, label: activeModelSlug }, ...presets]
    : presets

  const handleSelectModel = (id: string) => {
    useSettings.setState({ veloxyModel: id })
    setOpen(false)
  }

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
            <span className="text-[10px] font-normal text-muted-foreground">
              {providerLabel(baseUrl)}
            </span>
          </div>
        </div>

        <div className="max-h-60 overflow-y-auto space-y-0.5">
          {models.map((model) => {
            const isSelected = model.id === activeModelSlug
            return (
              <button
                key={model.id}
                type="button"
                onClick={() => handleSelectModel(model.id)}
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
          })}
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
