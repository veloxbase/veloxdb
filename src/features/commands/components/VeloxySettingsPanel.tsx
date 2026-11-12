import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  CheckIcon,
  EyeIcon,
  EyeSlashIcon,
  LightningIcon,
  SpinnerGapIcon,
  TrashIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { useCallback, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { loadAiApiKey, saveAiApiKey } from '@/lib/ai-credentials'
import {
  AI_PROVIDERS,
  fetchProviderModels,
  getAiProvider,
  requestChatCompletion,
  type AiModelOption,
  type AiProvider,
  type AiProviderId,
} from '@/lib/ai-providers'
import { isVeloxyConfigured, useSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'

import { SettingsGroup, SettingsPage, SettingsRow } from './settings-layout'

type TestState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ok'; ms: number; model: string }
  | { status: 'error'; message: string }

function providerHost(provider: AiProvider): string {
  if (!provider.baseUrl) return 'Any OpenAI-compatible URL'
  try {
    const url = new URL(provider.baseUrl)
    return url.host
  } catch {
    return provider.baseUrl
  }
}

const HOSTED = AI_PROVIDERS.filter((provider) => !provider.local && provider.id !== 'custom')
const SELF_HOSTED = AI_PROVIDERS.filter((provider) => provider.local || provider.id === 'custom')

function ProviderTile({
  provider,
  selected,
  onSelect,
}: {
  provider: AiProvider
  selected: boolean
  onSelect: (id: AiProviderId) => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => onSelect(provider.id)}
      className={cn(
        'group relative flex min-w-0 flex-col items-start rounded-lg border px-3 py-2.5 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        selected
          ? 'border-primary bg-primary/[0.07]'
          : 'border-border bg-background hover:border-foreground/25 hover:bg-muted/40',
      )}
    >
      <span className="flex w-full items-center justify-between gap-2">
        <span className={cn('truncate text-xs font-medium', selected ? 'text-foreground' : 'text-foreground/90')}>
          {provider.label.replace(/ \((local|Claude|Grok|OpenAI-compatible)\)$/, '')}
        </span>
        {selected ? <CheckIcon className="size-3.5 shrink-0 text-primary" weight="bold" /> : null}
      </span>
      <span className="mt-0.5 w-full truncate text-[11px] text-muted-foreground">{providerHost(provider)}</span>
    </button>
  )
}

/**
 * The API key is edited as a draft and saved explicitly, so the keychain is
 * written once (not on every keystroke) and the user sees that it was saved.
 * Keyed by provider + saved key, so it resets when either changes.
 */
function ApiKeyField({ provider, savedKey }: { provider: AiProvider; savedKey: string }) {
  const [draft, setDraft] = useState(savedKey)
  const [reveal, setReveal] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dirty = draft.trim() !== savedKey.trim()

  const save = async (value: string) => {
    setSaving(true)
    setError(null)
    try {
      await saveAiApiKey(provider.id, value.trim())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  let status: { tone: 'ok' | 'warn' | 'muted' | 'error'; text: string }
  if (error) status = { tone: 'error', text: `Couldn't save the key: ${error}` }
  else if (dirty) status = { tone: 'warn', text: 'Not saved yet' }
  else if (savedKey) status = { tone: 'ok', text: 'Saved in your system keychain' }
  else if (provider.requiresKey) {
    status = { tone: 'muted', text: provider.keyUrl ? `No key yet. Create one at ${provider.keyUrl}` : 'No key yet' }
  } else status = { tone: 'muted', text: 'Optional for this provider' }

  return (
    <div className="w-[300px] space-y-1.5">
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (dirty && !saving) void save(draft)
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Input
            type={reveal ? 'text' : 'password'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={provider.keyPlaceholder}
            spellCheck={false}
            autoComplete="off"
            aria-label={`${provider.label} API key`}
            className="h-8 pr-8 font-mono text-[11px]"
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={reveal ? 'Hide key' : 'Show key'}
            title={reveal ? 'Hide key' : 'Show key'}
          >
            {reveal ? <EyeSlashIcon className="size-3.5" /> : <EyeIcon className="size-3.5" />}
          </button>
        </div>
        <Button type="submit" size="sm" className="h-8 px-3 text-xs" disabled={!dirty || saving}>
          {saving ? <SpinnerGapIcon className="size-3.5 animate-spin" /> : 'Save key'}
        </Button>
        {savedKey && !dirty ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 w-8 px-0 text-muted-foreground hover:text-destructive"
            onClick={() => { setDraft(''); void save('') }}
            title="Remove key from keychain"
            aria-label="Remove key from keychain"
          >
            <TrashIcon className="size-3.5" />
          </Button>
        ) : null}
      </form>
      <p
        className={cn(
          'flex items-center gap-1 text-[11px]',
          status.tone === 'ok' && 'text-emerald-600 dark:text-emerald-400',
          status.tone === 'warn' && 'text-amber-600 dark:text-amber-400',
          status.tone === 'error' && 'text-destructive',
          status.tone === 'muted' && 'text-muted-foreground',
        )}
        role="status"
      >
        {status.tone === 'ok' ? <CheckCircleIcon className="size-3.5 shrink-0" weight="fill" /> : null}
        {status.tone === 'error' ? <WarningCircleIcon className="size-3.5 shrink-0" /> : null}
        <span className="min-w-0 break-words">{status.text}</span>
      </p>
    </div>
  )
}

export function VeloxySettingsPanel() {
  const providerId = useSettings((s) => s.veloxyProvider)
  const apiKey = useSettings((s) => s.veloxyApiKey)
  const baseUrl = useSettings((s) => s.veloxyBaseUrl)
  const model = useSettings((s) => s.veloxyModel)
  const provider = getAiProvider(providerId)

  const [modelOptions, setModelOptions] = useState<AiModelOption[]>(() => provider.models)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [test, setTest] = useState<TestState>({ status: 'idle' })

  const refreshModels = useCallback(async () => {
    const state = useSettings.getState()
    const current = getAiProvider(state.veloxyProvider)
    setModelOptions(current.models)
    setModelsError(null)
    if (current.requiresKey && !state.veloxyApiKey.trim()) return
    setModelsLoading(true)
    try {
      const options = await fetchProviderModels(state.veloxyProvider, state.veloxyApiKey, state.veloxyBaseUrl)
      if (useSettings.getState().veloxyProvider === state.veloxyProvider) setModelOptions(options)
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : 'Could not list models.')
    } finally {
      setModelsLoading(false)
    }
  }, [])

  const selectProvider = useCallback(async (id: AiProviderId) => {
    if (id === useSettings.getState().veloxyProvider) return
    const next = getAiProvider(id)
    const current = useSettings.getState()
    useSettings.setState({
      veloxyProvider: id,
      veloxyApiKey: '',
      // Keep a custom URL when switching to Custom; presets bring their own.
      veloxyBaseUrl: next.baseUrl || (id === 'custom' ? current.veloxyBaseUrl : ''),
      veloxyModel: next.models[0]?.id ?? '',
    })
    setModelOptions(next.models)
    setModelsError(null)
    setTest({ status: 'idle' })
    await loadAiApiKey()
    void refreshModels()
  }, [refreshModels])

  const runTest = async () => {
    const state = useSettings.getState()
    setTest({ status: 'running' })
    const started = performance.now()
    try {
      await requestChatCompletion({
        baseUrl: state.veloxyBaseUrl,
        apiKey: state.veloxyApiKey,
        model: state.veloxyModel,
        systemPrompt: 'You are a connectivity check.',
        userPrompt: 'Reply with the single word OK.',
        temperature: 0,
      })
      setTest({ status: 'ok', ms: Math.round(performance.now() - started), model: state.veloxyModel })
    } catch (error) {
      setTest({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const configured = isVeloxyConfigured({ provider: providerId, apiKey, model, baseUrl })

  return (
    <SettingsPage
      title="Veloxy AI"
      description="Veloxy answers questions about your data, writes SQL and builds dashboards using a model you choose. Requests go straight from this app to the provider."
    >
      <SettingsGroup title="Provider">
        <div className="space-y-3 p-4" role="radiogroup" aria-label="AI provider">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {HOSTED.map((option) => (
              <ProviderTile key={option.id} provider={option} selected={option.id === providerId} onSelect={(id) => { void selectProvider(id) }} />
            ))}
          </div>
          <p className="pt-1 text-[11px] text-muted-foreground">Run on your own machine or server</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {SELF_HOSTED.map((option) => (
              <ProviderTile key={option.id} provider={option} selected={option.id === providerId} onSelect={(id) => { void selectProvider(id) }} />
            ))}
          </div>
        </div>
      </SettingsGroup>

      <SettingsGroup title={`${provider.label} connection`}>
        {provider.local ? null : (
          <SettingsRow label="API key" description="Kept in your operating system's keychain, never in app files.">
            <ApiKeyField key={`${provider.id}:${apiKey}`} provider={provider} savedKey={apiKey} />
          </SettingsRow>
        )}
        <SettingsRow label="Model" description="Pick a suggestion or type any model id this provider offers.">
          <div className="flex w-[300px] items-center gap-1.5">
            <Input
              list="veloxy-model-options"
              value={model}
              onChange={(e) => useSettings.setState({ veloxyModel: e.target.value })}
              className="h-8 min-w-0 flex-1 font-mono text-[11px]"
              placeholder={provider.models[0]?.id ?? 'model-id'}
              spellCheck={false}
              aria-label="Model"
            />
            <datalist id="veloxy-model-options">
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </datalist>
            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 px-0"
              onClick={() => void refreshModels()}
              disabled={modelsLoading}
              title="Load models from the provider"
              aria-label="Load models from the provider"
            >
              <ArrowsClockwiseIcon className={cn('size-3.5', modelsLoading && 'animate-spin')} />
            </Button>
          </div>
        </SettingsRow>
        <SettingsRow
          label="Endpoint"
          description={provider.id === 'custom'
            ? 'Base URL of an OpenAI-compatible API, ending before /chat/completions.'
            : 'Change only to route through a proxy or gateway.'}
        >
          <Input
            value={baseUrl}
            onChange={(e) => useSettings.setState({ veloxyBaseUrl: e.target.value })}
            onBlur={() => { void refreshModels() }}
            className="h-8 w-[300px] font-mono text-[11px]"
            placeholder={provider.baseUrl || 'https://llm.example.com/v1'}
            spellCheck={false}
            aria-label="Endpoint"
          />
        </SettingsRow>
        {modelsError ? (
          <p className="px-4 pb-3 text-[11px] text-destructive">{modelsError}</p>
        ) : null}
      </SettingsGroup>

      <div className="flex items-start justify-between gap-4 rounded-lg border border-border px-4 py-3">
        <div className="min-w-0 text-[11px] leading-relaxed">
          {test.status === 'idle' && (
            <span className="text-muted-foreground">
              {configured ? 'Send a one-word request to check the key, model and endpoint.' : 'Finish the connection settings above, then test them.'}
            </span>
          )}
          {test.status === 'running' && <span className="text-muted-foreground">Contacting {provider.label}…</span>}
          {test.status === 'ok' && (
            <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
              <CheckCircleIcon className="size-4 shrink-0" weight="fill" />
              {provider.label} answered with {test.model} in {test.ms} ms. Veloxy is ready.
            </span>
          )}
          {test.status === 'error' && (
            <span className="flex items-start gap-1.5 text-destructive">
              <WarningCircleIcon className="mt-px size-4 shrink-0" />
              <span className="min-w-0 break-words">{test.message}</span>
            </span>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1.5 text-xs"
          disabled={!configured || test.status === 'running'}
          onClick={() => { void runTest() }}
        >
          {test.status === 'running'
            ? <SpinnerGapIcon className="size-3.5 animate-spin" />
            : <LightningIcon className="size-3.5" />}
          Test connection
        </Button>
      </div>
    </SettingsPage>
  )
}
