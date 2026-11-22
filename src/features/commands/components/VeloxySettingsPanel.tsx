import {
  ArrowSquareOutIcon,
  CaretDownIcon,
  CaretRightIcon,
  CheckCircleIcon,
  EyeIcon,
  EyeSlashIcon,
  SpinnerGapIcon,
  TrashIcon,
  WarningCircleIcon,
} from '@phosphor-icons/react'
import { useCallback, useId, useState, type ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
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
import { openExternal } from '@/lib/open-external'
import { useSettings } from '@/lib/settings'
import { cn } from '@/lib/utils'

import { McpSettingsSection } from './McpSettingsSection'
import { SettingsPage } from './settings-layout'

type TestState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'ok'; ms: number }
  | { status: 'error'; message: string }

type Readiness =
  | { ready: true }
  | { ready: false; reason: string }

function shortLabel(provider: AiProvider): string {
  return provider.label.replace(/ \((local|Claude|Grok|OpenAI-compatible)\)$/, '')
}

function readiness(provider: AiProvider, apiKey: string, model: string, baseUrl: string): Readiness {
  if (!baseUrl.trim()) return { ready: false, reason: `Enter the endpoint URL for ${shortLabel(provider)}.` }
  if (provider.requiresKey && !apiKey.trim()) return { ready: false, reason: `Add your ${shortLabel(provider)} API key to turn on Veloxy.` }
  if (!model.trim()) return { ready: false, reason: 'Choose a model.' }
  return { ready: true }
}

/** Label above, control, then a hint: easier to scan than side-by-side rows. */
function FormField({
  label,
  htmlFor,
  aside,
  hint,
  children,
}: {
  label: string
  htmlFor?: string
  aside?: ReactNode
  hint?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-xs font-medium text-foreground">{label}</label>
        {aside}
      </div>
      {children}
      {hint ? <div className="text-[11px] leading-snug text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

const CLOUD_PROVIDERS = AI_PROVIDERS.filter((provider) => !provider.local && provider.id !== 'custom')
const SELF_HOSTED_PROVIDERS = AI_PROVIDERS.filter((provider) => provider.local || provider.id === 'custom')

function ProviderTile({ provider, selected, onSelect }: { provider: AiProvider; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'group flex h-10 min-w-0 items-center gap-2.5 border px-3 text-left transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        selected
          ? 'border-primary bg-primary/[0.08]'
          : 'border-border hover:border-foreground/25',
      )}
    >
      {/* Radio mark: the selected tile is the one with the filled dot. */}
      <span
        aria-hidden
        className={cn(
          'flex size-3.5 shrink-0 items-center justify-center rounded-full border transition-colors',
          selected ? 'border-primary' : 'border-muted-foreground/40 group-hover:border-muted-foreground/70',
        )}
      >
        <span className={cn('size-1.5 rounded-full bg-primary transition-transform', selected ? 'scale-100' : 'scale-0')} />
      </span>
      <span className={cn('min-w-0 truncate text-xs', selected ? 'font-semibold text-foreground' : 'font-medium text-foreground/80 group-hover:text-foreground')}>
        {shortLabel(provider)}
      </span>
    </button>
  )
}

function ProviderPicker({ value, onChange }: { value: AiProviderId; onChange: (id: AiProviderId) => void }) {
  const groups = [
    { title: 'Cloud provider (your API key)', providers: CLOUD_PROVIDERS },
    { title: 'On your machine or server', providers: SELF_HOSTED_PROVIDERS },
  ]
  return (
    <div className="space-y-3" role="radiogroup" aria-label="AI provider">
      {groups.map((group) => (
        <div key={group.title} className="space-y-1.5">
          <p className="text-xs font-medium text-foreground">{group.title}</p>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            {group.providers.map((provider) => (
              <ProviderTile
                key={provider.id}
                provider={provider}
                selected={provider.id === value}
                onSelect={() => onChange(provider.id)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

/**
 * Draft-and-save key editor: the keychain is written once, on Save, and the
 * hint says whether the key is saved. Keyed by provider + saved key so it
 * resets when either changes.
 */
function ApiKeyField({ provider, savedKey, onSaved }: { provider: AiProvider; savedKey: string; onSaved: () => void }) {
  const inputId = useId()
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
      if (value.trim()) onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  let hint: ReactNode
  if (error) {
    hint = <span className="flex items-center gap-1 text-destructive"><WarningCircleIcon className="size-3.5 shrink-0" />Couldn't save the key: {error}</span>
  } else if (dirty) {
    hint = <span className="text-amber-600 dark:text-amber-400">Press Save to store this key.</span>
  } else if (savedKey) {
    hint = <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircleIcon className="size-3.5 shrink-0" weight="fill" />Saved in your system keychain.</span>
  } else {
    hint = provider.requiresKey
      ? 'Stored in your system keychain, never in app files.'
      : 'Only needed if your server asks for one.'
  }

  return (
    <FormField
      label={provider.requiresKey ? `${shortLabel(provider)} API key` : 'API key (optional)'}
      htmlFor={inputId}
      aside={provider.keyUrl ? (
        <button
          type="button"
          onClick={() => { void openExternal(provider.keyUrl!) }}
          className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
        >
          Get a key <ArrowSquareOutIcon className="size-3" />
        </button>
      ) : null}
      hint={hint}
    >
      <form
        className="flex items-center gap-1.5"
        onSubmit={(e) => {
          e.preventDefault()
          if (dirty && !saving) void save(draft)
        }}
      >
        <div className="relative min-w-0 flex-1">
          <Input
            id={inputId}
            type={reveal ? 'text' : 'password'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={provider.keyPlaceholder}
            spellCheck={false}
            autoComplete="off"
            className="h-9 pr-9 font-mono text-xs"
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground hover:text-foreground"
            aria-label={reveal ? 'Hide key' : 'Show key'}
            title={reveal ? 'Hide key' : 'Show key'}
          >
            {reveal ? <EyeSlashIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </button>
        </div>
        {savedKey && !dirty ? (
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-1.5 text-xs text-muted-foreground hover:text-destructive"
            onClick={() => { setDraft(''); void save('') }}
          >
            <TrashIcon className="size-3.5" /> Remove
          </Button>
        ) : (
          <Button type="submit" className="h-9 min-w-[72px] text-xs" disabled={!dirty || saving}>
            {saving ? <SpinnerGapIcon className="size-4 animate-spin" /> : 'Save'}
          </Button>
        )}
      </form>
    </FormField>
  )
}

/** Searchable model list: suggestions, the provider's live list, or any typed id. */
function ModelPicker({
  provider,
  value,
  options,
  loading,
  error,
  onOpen,
  onChange,
}: {
  provider: AiProvider
  value: string
  options: AiModelOption[]
  loading: boolean
  error: string | null
  onOpen: () => void
  onChange: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const current = options.find((option) => option.id === value)
  const typed = search.trim()
  const canUseTyped = typed && !options.some((option) => option.id === typed)

  const pick = (id: string) => {
    onChange(id)
    setOpen(false)
    setSearch('')
  }

  return (
    <FormField
      label="Model"
      hint={error
        ? <span className="text-destructive">{error} You can still type a model id.</span>
        : `Suggestions for ${shortLabel(provider)}, plus every model your key can use. You can also type any model id.`}
    >
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (next) onOpen()
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'flex h-9 w-full items-center justify-between gap-3 border border-input bg-background px-3 text-left text-xs shadow-xs transition-colors',
              'hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            {value ? (
              <span className="flex min-w-0 items-baseline gap-2">
                <span className="truncate font-medium text-foreground">{current?.label ?? value}</span>
                {current && current.label !== value ? (
                  <span className="truncate font-mono text-[11px] text-muted-foreground">{value}</span>
                ) : null}
              </span>
            ) : (
              <span className="text-muted-foreground">Choose a model</span>
            )}
            <CaretDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] p-0">
          <Command>
            <CommandInput value={search} onValueChange={setSearch} placeholder="Search or type a model id" />
            <CommandList className="max-h-64">
              {loading ? (
                <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-muted-foreground">
                  <SpinnerGapIcon className="size-3.5 animate-spin" /> Loading models from {shortLabel(provider)}…
                </div>
              ) : null}
              {canUseTyped ? (
                <CommandGroup>
                  <CommandItem value={`__custom__${typed}`} onSelect={() => pick(typed)}>
                    Use <span className="font-mono">“{typed}”</span>
                  </CommandItem>
                </CommandGroup>
              ) : null}
              <CommandEmpty>No matching models.</CommandEmpty>
              <CommandGroup>
                {options.map((option) => (
                  <CommandItem
                    key={option.id}
                    value={`${option.label} ${option.id}`}
                    data-checked={option.id === value}
                    onSelect={() => pick(option.id)}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate">{option.label}</span>
                      {option.label !== option.id ? (
                        <span className="truncate font-mono text-[10px] text-muted-foreground">{option.id}</span>
                      ) : null}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </FormField>
  )
}

export function VeloxySettingsPanel() {
  const providerId = useSettings((s) => s.veloxyProvider)
  const apiKey = useSettings((s) => s.veloxyApiKey)
  const baseUrl = useSettings((s) => s.veloxyBaseUrl)
  const model = useSettings((s) => s.veloxyModel)
  const provider = getAiProvider(providerId)
  const endpointId = useId()

  const [modelOptions, setModelOptions] = useState<AiModelOption[]>(() => provider.models)
  const [modelsLoading, setModelsLoading] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)
  const [test, setTest] = useState<TestState>({ status: 'idle' })
  // Hosted providers rarely need a different endpoint; keep it out of the way.
  const [advancedOpen, setAdvancedOpen] = useState(false)

  const loadModels = useCallback(async (force = false) => {
    const state = useSettings.getState()
    const current = getAiProvider(state.veloxyProvider)
    const cacheKey = `${state.veloxyProvider}|${state.veloxyBaseUrl}|${state.veloxyApiKey.length}`
    if (!force && loadedFor === cacheKey) return
    setModelsError(null)
    if (current.requiresKey && !state.veloxyApiKey.trim()) {
      setModelOptions(current.models)
      return
    }
    setModelsLoading(true)
    try {
      const options = await fetchProviderModels(state.veloxyProvider, state.veloxyApiKey, state.veloxyBaseUrl)
      if (useSettings.getState().veloxyProvider === state.veloxyProvider) {
        setModelOptions(options)
        setLoadedFor(cacheKey)
      }
    } catch (error) {
      setModelsError(error instanceof Error ? error.message : 'Could not load the model list.')
    } finally {
      setModelsLoading(false)
    }
  }, [loadedFor])

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
    setLoadedFor(null)
    setTest({ status: 'idle' })
    setAdvancedOpen(false)
    await loadAiApiKey()
  }, [])

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
      setTest({ status: 'ok', ms: Math.round(performance.now() - started) })
    } catch (error) {
      setTest({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  }

  const state = readiness(provider, apiKey, model, baseUrl)
  const selfHosted = provider.local || provider.id === 'custom'
  const endpointField = (
      <FormField
        label="Endpoint"
        htmlFor={endpointId}
        hint={provider.id === 'custom'
          ? 'The base URL, ending before /chat/completions.'
          : provider.local
            ? `Default for ${shortLabel(provider)}. Change it if the server runs on another port or machine.`
            : 'Only change this to route requests through a proxy or gateway.'}
      >
        <Input
          id={endpointId}
          value={baseUrl}
          onChange={(e) => useSettings.setState({ veloxyBaseUrl: e.target.value })}
          onBlur={() => setLoadedFor(null)}
          className="h-9 font-mono text-xs"
          placeholder={provider.baseUrl || 'https://llm.example.com/v1'}
          spellCheck={false}
        />
      </FormField>
  )

  return (
    <SettingsPage
      title="Veloxy AI"
      description="Veloxy answers questions about your data, writes SQL and builds dashboards with a model you choose. Requests go straight from this app to that provider."
    >
      {/* Status: the one thing to read first. */}
      <div
        className={cn(
          'flex items-center justify-between gap-4 border px-4 py-3',
          test.status === 'error'
            ? 'border-destructive/40 bg-destructive/[0.06]'
            : state.ready
              ? 'border-emerald-500/30 bg-emerald-500/[0.06]'
              : 'border-amber-500/30 bg-amber-500/[0.06]',
        )}
      >
        <div className="flex min-w-0 items-start gap-2.5">
          <span
            className={cn(
              'mt-1 size-2 shrink-0 rounded-full',
              test.status === 'error' ? 'bg-destructive' : state.ready ? 'bg-emerald-500' : 'bg-amber-500',
            )}
            aria-hidden
          />
          <div className="min-w-0 text-xs leading-relaxed">
            {state.ready ? (
              <p className="text-foreground">
                Veloxy uses <span className="font-medium">{shortLabel(provider)}</span> with{' '}
                <span className="font-mono">{model}</span>.
              </p>
            ) : (
              <p className="text-foreground">{state.reason}</p>
            )}
            {test.status === 'running' ? <p className="text-muted-foreground">Sending a test request…</p> : null}
            {test.status === 'ok' ? (
              <p className="text-emerald-600 dark:text-emerald-400">Connected. The model replied in {test.ms} ms.</p>
            ) : null}
            {test.status === 'error' ? (
              <p className="break-words text-destructive">{test.message}</p>
            ) : null}
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-8 shrink-0 text-xs"
          disabled={!state.ready || test.status === 'running'}
          onClick={() => { void runTest() }}
        >
          {test.status === 'running' ? <SpinnerGapIcon className="size-3.5 animate-spin" /> : 'Test connection'}
        </Button>
      </div>

      <div className="space-y-2">
        <ProviderPicker value={providerId} onChange={(id) => { void selectProvider(id) }} />
        <p className="text-[11px] leading-snug text-muted-foreground">
          {provider.local
        ? `Runs on this computer. Start ${shortLabel(provider)} and load a model first.`
        : provider.id === 'custom'
          ? 'Any server that speaks the OpenAI chat API, such as vLLM, LiteLLM or a company gateway.'
          : `Uses your own ${shortLabel(provider)} account. You pay ${shortLabel(provider)} directly for what you use.`}
        </p>
      </div>

      {selfHosted ? endpointField : null}

      {provider.local ? null : (
        <ApiKeyField
          key={`${provider.id}:${apiKey}`}
          provider={provider}
          savedKey={apiKey}
          onSaved={() => { setLoadedFor(null); setTest({ status: 'idle' }) }}
        />
      )}

      <ModelPicker
        provider={provider}
        value={model}
        options={modelOptions}
        loading={modelsLoading}
        error={modelsError}
        onOpen={() => { void loadModels() }}
        onChange={(id) => { useSettings.setState({ veloxyModel: id }); setTest({ status: 'idle' }) }}
      />

      {!provider.local && provider.id !== 'custom' ? (
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          {advancedOpen ? <CaretDownIcon className="size-3" /> : <CaretRightIcon className="size-3" />}
          {advancedOpen ? 'Hide endpoint' : 'Use a different endpoint'}
        </button>
      ) : null}
      {!selfHosted && advancedOpen ? endpointField : null}

      <McpSettingsSection />
    </SettingsPage>
  )
}
