import { useMemo, useState, useEffect, useCallback, type ReactNode } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'

import { open as openFilePicker } from '@tauri-apps/plugin-dialog'
import {
  CaretRightIcon, CheckCircleIcon, FolderOpenIcon, LinkIcon, PlugsConnectedIcon,
  SpinnerGapIcon, TextAlignLeftIcon, WarningCircleIcon, XIcon,
} from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput,
} from '@/components/ui/input-group'
import type { ConnectionInput, DatabaseEngine } from '@/data/types'
import { cn } from '@/lib/utils'
import { parseConnectionString, buildConnectionString } from '@/lib/connection-string'
import { veloxDbRepository } from '@/data/repositories'
import { ENGINE_FORM_CONFIG, type EngineFormConfig } from './engine-form-config'
import { EngineLogo } from './EngineLogo'

type InputMode = 'string' | 'fields'
type SshAuthMethodForm = 'keyfile' | 'password'

/** Every engine, grouped by kind so the full list is easy to scan. */
const ENGINE_GROUPS: { title: string; engines: DatabaseEngine[] }[] = [
  { title: 'Relational', engines: ['postgres', 'mysql', 'sqlite', 'mssql', 'azuresql'] },
  { title: 'Analytics', engines: ['clickhouse', 'duckdb'] },
  { title: 'Edge SQLite', engines: ['libsql', 'turso'] },
  { title: 'NoSQL', engines: ['mongo', 'redis', 'cassandra', 'scylladb'] },
]

const engineOptions: { value: DatabaseEngine; label: string }[] = [
  { value: 'postgres',   label: 'PostgreSQL' },
  { value: 'mysql',      label: 'MySQL' },
  { value: 'sqlite',     label: 'SQLite' },
  { value: 'clickhouse', label: 'ClickHouse' },
  { value: 'libsql',     label: 'libSQL' },
  { value: 'turso',      label: 'Turso' },
  { value: 'mssql',      label: 'SQL Server' },
  { value: 'azuresql',   label: 'Azure SQL' },
  { value: 'scylladb',   label: 'ScyllaDB' },
  { value: 'cassandra',  label: 'Cassandra' },
  { value: 'duckdb',     label: 'DuckDB' },
  { value: 'mongo',      label: 'MongoDB' },
  { value: 'redis',      label: 'Redis' },
]

// ── Database Flavors ────────────────────────────────────────────

type DatabaseFlavor = {
  key: string
  label: string
  engine: DatabaseEngine
  defaultHost: string
  defaultPort: number
  defaultDatabase: string
  defaultUser: string
  defaultSsl: 'disable' | 'prefer' | 'require'
  description: string
}

const DATABASE_FLAVORS: DatabaseFlavor[] = [
  { key: 'postgres',    label: 'PostgreSQL',  engine: 'postgres', defaultHost: '127.0.0.1',                                       defaultPort: 5432, defaultDatabase: 'postgres',           defaultUser: 'postgres',       defaultSsl: 'prefer',  description: 'Local or self-hosted PostgreSQL' },
  { key: 'supabase',    label: 'Supabase',    engine: 'postgres', defaultHost: 'db.xxxxx.supabase.co',                             defaultPort: 5432, defaultDatabase: 'postgres',           defaultUser: 'postgres',       defaultSsl: 'require', description: 'Hosted PostgreSQL with real-time, auth, storage' },
  { key: 'neon',        label: 'Neon',        engine: 'postgres', defaultHost: 'ep-xxxxx.us-east-1.aws.neon.tech',                defaultPort: 5432, defaultDatabase: 'neondb',             defaultUser: 'neondb_owner',   defaultSsl: 'require', description: 'Serverless PostgreSQL with branching' },
  { key: 'cockroachdb', label: 'CockroachDB', engine: 'postgres', defaultHost: '127.0.0.1',                                       defaultPort: 26257,defaultDatabase: 'defaultdb',          defaultUser: 'root',           defaultSsl: 'require', description: 'Distributed SQL, PostgreSQL-compatible' },
  { key: 'timescaledb', label: 'TimescaleDB', engine: 'postgres', defaultHost: '127.0.0.1',                                       defaultPort: 5432, defaultDatabase: 'postgres',           defaultUser: 'postgres',       defaultSsl: 'prefer',  description: 'Time-series PostgreSQL extension' },
  { key: 'yugabytedb',  label: 'YugabyteDB',  engine: 'postgres', defaultHost: '127.0.0.1',                                       defaultPort: 5433, defaultDatabase: 'yugabyte',           defaultUser: 'yugabyte',       defaultSsl: 'prefer',  description: 'Distributed PostgreSQL-compatible' },
  { key: 'mysql',       label: 'MySQL',       engine: 'mysql',    defaultHost: '127.0.0.1',                                       defaultPort: 3306, defaultDatabase: '',                   defaultUser: 'root',           defaultSsl: 'prefer',  description: 'Local or self-hosted MySQL' },
  { key: 'mariadb',     label: 'MariaDB',     engine: 'mysql',    defaultHost: '127.0.0.1',                                       defaultPort: 3306, defaultDatabase: '',                   defaultUser: 'root',           defaultSsl: 'prefer',  description: 'Community fork of MySQL' },
  { key: 'planetscale', label: 'PlanetScale', engine: 'mysql',    defaultHost: 'aws.connect.psdb.cloud',                           defaultPort: 3306, defaultDatabase: '',                   defaultUser: 'root',           defaultSsl: 'require', description: 'Serverless MySQL platform' },
  { key: 'tidb',        label: 'TiDB',        engine: 'mysql',    defaultHost: '127.0.0.1',                                       defaultPort: 4000, defaultDatabase: 'test',               defaultUser: 'root',           defaultSsl: 'prefer',  description: 'Distributed MySQL-compatible (HTAP)' },
  { key: 'aurora',      label: 'Aurora MySQL',engine: 'mysql',    defaultHost: 'xxxxx.cluster-xxx.us-east-1.rds.amazonaws.com',    defaultPort: 3306, defaultDatabase: '',                   defaultUser: 'admin',          defaultSsl: 'require', description: 'AWS MySQL-compatible cloud database' },
]

const FLAVORS_BY_ENGINE: Record<string, DatabaseFlavor[]> = {}
for (const f of DATABASE_FLAVORS) {
  if (FLAVORS_BY_ENGINE[f.engine] === undefined) {
    FLAVORS_BY_ENGINE[f.engine] = []
  }
  FLAVORS_BY_ENGINE[f.engine].push(f)
}

// ── Zod schema ──────────────────────────────────────────────────

const connectionSchema = z.object({
  name: z.string().min(2, 'Enter a connection name.'),
  engine: z.enum([
    'postgres',
    'mysql',
    'sqlite',
    'mongo',
    'duckdb',
    'redis',
    'clickhouse',
    'libsql',
    'turso',
    'scylladb',
    'cassandra',
    'mssql',
    'azuresql',
  ] as const),
  host: z.string(),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string(),
  filePath: z.string().optional(),
  user: z.string(),
  password: z.string(),
  sslMode: z.enum(['disable', 'prefer', 'require'] as const),
  srv: z.boolean().optional(),
  sshEnabled: z.boolean(),
  sshHost: z.string().optional(),
  sshPort: z.coerce.number().int().min(1).max(65535).optional(),
  sshUser: z.string().optional(),
  sshAuthMethod: z.enum(['keyfile', 'password'] as const).optional(),
  sshPassword: z.string().optional(),
  sshPrivateKeyPath: z.string().optional(),
  sshPassphrase: z.string().optional(),
}).superRefine((values, ctx) => {
  const cfg = ENGINE_FORM_CONFIG[values.engine]

  if (cfg.showFilePicker) {
    if (!values.filePath || values.filePath.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'File path is required.', path: ['filePath'] })
    }
    return
  }

  if (cfg.fields.host.label && (!values.host || values.host.trim().length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Host is required.', path: ['host'] })
  }
  if (cfg.fields.database.label && (!values.database || values.database.trim().length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Database is required.', path: ['database'] })
  }
  if (cfg.requireUser && (!values.user || values.user.trim().length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'User is required.', path: ['user'] })
  }
  if (cfg.requirePassword && (!values.password || values.password.trim().length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Password is required.', path: ['password'] })
  }

  if (!values.sshEnabled) return
  if (!values.sshHost?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SSH host is required.', path: ['sshHost'] })
  if (!values.sshUser?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SSH user is required.', path: ['sshUser'] })
  if (values.sshAuthMethod === 'password' && !values.sshPassword?.trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SSH password is required.', path: ['sshPassword'] })
  }
})

type ConnectionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: ConnectionInput) => Promise<void> | void
  isPending?: boolean
}

// ── Field helper ─────────────────────────────────────────────────

function Field({ label, error, inputId, children }: { label: string; error?: string; inputId: string; children: ReactNode }) {
  return (
    <label htmlFor={inputId} className="space-y-1.5 text-left text-xs text-muted-foreground block">
      <span className="block font-medium">{label}</span>
      {children}
      {error ? <span className="block text-[11px] text-destructive">{error}</span> : null}
    </label>
  )
}

interface CustomParam { id: number; key: string; value: string }

export function ConnectionDialog({ open, onOpenChange, onSubmit, isPending = false }: ConnectionDialogProps) {
  const { t } = useTranslation()

  const defaultValues = useMemo(() => ({
    name: t("connection.localDatabase"),
    engine: 'postgres' as DatabaseEngine,
    host: '127.0.0.1',
    port: 5432,
    database: 'postgres',
    filePath: '',
    user: 'postgres',
    password: '',
    sslMode: 'prefer' as const,
    srv: false,
    sshEnabled: false,
    sshHost: '',
    sshPort: 22,
    sshUser: '',
    sshAuthMethod: 'keyfile' as SshAuthMethodForm,
    sshPassword: '',
    sshPrivateKeyPath: '',
    sshPassphrase: '',
  }), [t])

  const form = useForm({ resolver: zodResolver(connectionSchema), defaultValues })
  const sshEnabled = useWatch({ control: form.control, name: 'sshEnabled' })
  const sshAuthMethod = useWatch({ control: form.control, name: 'sshAuthMethod' })
  const engine = useWatch({ control: form.control, name: 'engine' })

  const cfg: EngineFormConfig = ENGINE_FORM_CONFIG[engine]

  // A test result only describes the details it ran with.
  useEffect(() => {
    const subscription = form.watch(() => setTest((prev) => (prev.status === 'idle' ? prev : { status: 'idle' })))
    return () => subscription.unsubscribe()
  }, [form])

  // ── Engine change handler (synchronous, no useEffect) ──────

  const handleEngineChange = useCallback((next: DatabaseEngine) => {
    const c = ENGINE_FORM_CONFIG[next]
    form.setValue('engine', next)
    form.setValue('port', c.defaultPort)
    form.setValue('database', c.defaultDatabase)
    form.setValue('user', c.defaultUser)
    form.setValue('sslMode', c.defaultSsl)
    if (c.showFilePicker) {
      form.setValue('host', '')
      form.setValue('password', '')
    } else {
      form.setValue('host', '127.0.0.1')
    }
    if (!c.requirePassword) form.setValue('password', '')
    if (!c.requireUser) form.setValue('user', '')
  }, [form])

  // ── Flavor ─────────────────────────────────────────────────

  const [flavor, setFlavor] = useState<string>('postgres')

  const handleFlavorChange = useCallback((key: string) => {
    setFlavor(key)
    const f = DATABASE_FLAVORS.find((d) => d.key === key)
    if (!f) return
    form.setValue('host', f.defaultHost)
    form.setValue('port', f.defaultPort)
    form.setValue('database', f.defaultDatabase)
    form.setValue('user', f.defaultUser)
    form.setValue('sslMode', f.defaultSsl)
  }, [form])

  useEffect(() => { setFlavor(engine) }, [engine])

  // ── Connection string mode ─────────────────────────────────

  const [inputMode, setInputMode] = useState<InputMode>('fields')
  const [connString, setConnString] = useState('')
  const [connStringError, setConnStringError] = useState<string | null>(null)
  const [test, setTest] = useState<
    { status: 'idle' } | { status: 'running' } | { status: 'ok'; ms: number } | { status: 'error'; message: string }
  >({ status: 'idle' })

  useEffect(() => {
    if (open) {
      setInputMode('fields')
      setConnString('')
      setConnStringError(null)
      setTest({ status: 'idle' })
      form.reset(defaultValues)
    }
  }, [open, form, defaultValues])

  const detectedEngine = useMemo(() => {
    if (!connString.trim()) return null
    const parsed = parseConnectionString(connString)
    return parsed?.engine ?? null
  }, [connString])

  const handleConnStringChange = (value: string) => {
    setConnString(value)
    if (!value.trim()) { setConnStringError(null); return }
    const parsed = parseConnectionString(value)
    if (!parsed) { setConnStringError(t("connection.invalidConnectionString")); return }
    setConnStringError(null)
    form.setValue('engine', parsed.engine)
    form.setValue('host', parsed.host)
    form.setValue('port', parsed.port)
    form.setValue('database', parsed.database)
    form.setValue('filePath', parsed.filePath ?? '')
    form.setValue('user', parsed.user)
    form.setValue('password', parsed.password)
    form.setValue('sslMode', parsed.sslMode)
    const extra = { ...parsed.extraParams }
    if ('connect_timeout' in extra) { setAdvancedConnectTimeout(extra['connect_timeout']); delete extra['connect_timeout'] }
    if ('application_name' in extra) { setAdvancedAppName(extra['application_name']); delete extra['application_name'] }
    if ('options' in extra) { setAdvancedOptions(extra['options']); delete extra['options'] }
    if ('keepalives' in extra) { setAdvancedKeepalives(extra['keepalives'] !== '0'); delete extra['keepalives'] }
    if ('keepalives_idle' in extra) { setAdvancedKeepalivesIdle(extra['keepalives_idle']); delete extra['keepalives_idle'] }
    if ('sslrootcert' in extra) { setAdvancedSslRootCert(extra['sslrootcert']); delete extra['sslrootcert'] }
    if ('sslcert' in extra) { setAdvancedSslCert(extra['sslcert']); delete extra['sslcert'] }
    if ('sslkey' in extra) { setAdvancedSslKey(extra['sslkey']); delete extra['sslkey'] }
    const remaining = Object.entries(extra)
    if (remaining.length > 0) {
      setCustomParams(remaining.map(([key, value], i) => ({ id: i + 1, key, value })))
      setNextCustomId(remaining.length + 1)
      setAdvancedOpen(true)
    }
  }

  const handleModeToggle = (mode: InputMode) => {
    if (mode === 'string') {
      const fields = form.getValues()
      const cs = buildConnectionString({
        engine: fields.engine || 'postgres',
        user: fields.user || '',
        password: fields.password || '',
        host: fields.host || '127.0.0.1',
        port: Number(fields.port) || 5432,
        database: fields.database || '',
        filePath: fields.filePath || '',
        sslMode: fields.sslMode || 'prefer',
        srvEnabled: fields.srv ?? false,
        extraParams: collectExtraParams(),
      })
      setConnString(cs)
      setConnStringError(null)
    }
    setInputMode(mode)
  }

  // ── Advanced / custom params ────────────────────────────────

  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [advancedConnectTimeout, setAdvancedConnectTimeout] = useState('')
  const [advancedAppName, setAdvancedAppName] = useState('')
  const [advancedOptions, setAdvancedOptions] = useState('')
  const [advancedKeepalives, setAdvancedKeepalives] = useState(true)
  const [advancedKeepalivesIdle, setAdvancedKeepalivesIdle] = useState('')
  const [advancedSslRootCert, setAdvancedSslRootCert] = useState('')
  const [advancedSslCert, setAdvancedSslCert] = useState('')
  const [advancedSslKey, setAdvancedSslKey] = useState('')
  const [customParams, setCustomParams] = useState<CustomParam[]>([])
  const [nextCustomId, setNextCustomId] = useState(1)

  const collectExtraParams = (): Record<string, string> => {
    const extra: Record<string, string> = {}
    if (advancedConnectTimeout) extra['connect_timeout'] = advancedConnectTimeout
    if (advancedAppName) extra['application_name'] = advancedAppName
    if (advancedOptions) extra['options'] = advancedOptions
    if (!advancedKeepalives) extra['keepalives'] = '0'
    if (advancedKeepalivesIdle) extra['keepalives_idle'] = advancedKeepalivesIdle
    if (advancedSslRootCert) extra['sslrootcert'] = advancedSslRootCert
    if (advancedSslCert) extra['sslcert'] = advancedSslCert
    if (advancedSslKey) extra['sslkey'] = advancedSslKey
    for (const p of customParams) { if (p.key.trim()) extra[p.key.trim()] = p.value }
    return extra
  }

  const pickFile = async (setter: (path: string) => void, filters: { name: string; extensions: string[] }[]) => {
    const selected = await openFilePicker({ multiple: false, filters })
    if (typeof selected === 'string') setter(selected)
  }

  const addCustomParam = () => { setCustomParams((prev) => [...prev, { id: nextCustomId, key: '', value: '' }]); setNextCustomId((id) => id + 1) }
  const removeCustomParam = (id: number) => { setCustomParams((prev) => prev.filter((p) => p.id !== id)) }
  const updateCustomParam = (id: number, field: 'key' | 'value', val: string) => {
    setCustomParams((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: val } : p)))
  }

  // ── Submit & test ────────────────────────────────────────

  const buildInput = (values: z.infer<typeof connectionSchema>): ConnectionInput => {
    const extraParams = collectExtraParams()
    const isSqlEngine = values.engine === 'postgres' || values.engine === 'mysql'
    return {
      name: values.name,
      engine: values.engine,
      host: cfg.showFilePicker ? '' : values.host,
      port: cfg.showFilePicker ? 1 : values.port,
      database: cfg.showFilePicker ? (values.filePath || ':memory:') : values.database,
      filePath: values.filePath || null,
      user: cfg.showFilePicker ? '' : values.user,
      password: cfg.showFilePicker ? '' : values.password,
      // Keep the TLS choice for every engine that supports it (PostgreSQL,
      // MySQL, ClickHouse, SQL Server, Azure SQL). Bare MongoDB/Redis
      // connection strings also carry their TLS mode through this field.
      sslMode: values.sslMode,
      srvEnabled: values.engine === 'mongo' ? (values.srv ?? false) : false,
      extraParams: isSqlEngine && Object.keys(extraParams).length > 0 ? extraParams : null,
      sshConfig: !cfg.showFilePicker && values.sshEnabled ? {
        enabled: true,
        host: values.sshHost ?? '',
        port: values.sshPort ?? 22,
        user: values.sshUser ?? '',
        authMethod: values.sshAuthMethod ?? 'keyfile',
        password: values.sshPassword || null,
        privateKeyPath: values.sshPrivateKeyPath || null,
        passphrase: values.sshPassphrase || null,
      } : null,
    }
  }

  const connectionStringIsInvalid = () => {
    if (inputMode !== 'string') return false
    if (!connString.trim()) {
      setConnStringError(t("connection.invalidConnectionString"))
      return true
    }
    return Boolean(connStringError)
  }

  const handleSubmit = form.handleSubmit((values) => {
    if (connectionStringIsInvalid()) return
    void onSubmit(buildInput(values))
  })

  const handleTest = form.handleSubmit(async (values) => {
    if (connectionStringIsInvalid()) return
    setTest({ status: 'running' })
    try {
      const { elapsedMs } = await veloxDbRepository.testConnection(buildInput(values))
      setTest({ status: 'ok', ms: elapsedMs })
    } catch (error) {
      setTest({ status: 'error', message: error instanceof Error ? error.message : String(error) })
    }
  })

  const showHostPort = !cfg.showFilePicker
  const engineLabel = engineOptions.find((option) => option.value === engine)?.label ?? engine
  const flavors = cfg.showFlavors ? (FLAVORS_BY_ENGINE[engine] ?? []) : []
  const fieldError = (name: keyof z.infer<typeof connectionSchema>) => form.formState.errors[name]?.message as string | undefined

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex h-[min(720px,90vh)] flex-col gap-0 overflow-hidden border-border p-0 sm:max-w-[940px]"
      >
        <DialogHeader className="shrink-0 border-b border-border px-6 py-4 text-left">
          <DialogTitle className="text-[15px] font-semibold tracking-tight">{t("connection.newConnection")}</DialogTitle>
          <DialogDescription className="text-xs">
            Choose a database, enter its details and test them before saving. Passwords are kept in your system keychain.
          </DialogDescription>
        </DialogHeader>

        <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
          <div className="flex min-h-0 flex-1">
            {/* Database list: every engine, always visible. */}
            <aside className="w-[210px] shrink-0 overflow-y-auto border-r border-border bg-muted/25 px-2.5 py-3" aria-label={t("connection.databaseEngine")}>
              <div className="space-y-4" role="radiogroup">
                {ENGINE_GROUPS.map((group) => (
                  <div key={group.title}>
                    <p className="px-2 pb-1 text-[11px] text-muted-foreground">{group.title}</p>
                    <div className="space-y-0.5">
                      {group.engines.map((value) => {
                        const selected = engine === value
                        const label = engineOptions.find((option) => option.value === value)?.label ?? value
                        return (
                          <button
                            key={value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            onClick={() => { if (!selected) handleEngineChange(value) }}
                            className={cn(
                              'flex w-full items-center gap-2.5 px-2 py-1.5 text-left text-xs transition-colors',
                              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                              selected
                                ? 'bg-background font-medium text-foreground ring-1 ring-border'
                                : 'text-muted-foreground hover:bg-background/60 hover:text-foreground',
                            )}
                          >
                            <EngineLogo engine={value} />
                            <span className="truncate">{label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </aside>

            {/* Form for the selected engine. */}
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-[620px] space-y-6 px-7 py-6">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <EngineLogo engine={engine} className="size-6" />
                    <h3 className="truncate text-sm font-semibold text-foreground">{engineLabel}</h3>
                  </div>
                  {!cfg.showFilePicker ? (
                    <div className="flex shrink-0 border border-border p-0.5" role="tablist" aria-label="How to enter details">
                      {(['fields', 'string'] as const).map((mode) => (
                        <button
                          key={mode}
                          type="button"
                          role="tab"
                          aria-selected={inputMode === mode}
                          onClick={() => handleModeToggle(mode)}
                          className={cn(
                            'flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-medium transition-colors',
                            inputMode === mode ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                          )}
                        >
                          {mode === 'string' ? <LinkIcon className="size-3.5" /> : <TextAlignLeftIcon className="size-3.5" />}
                          {mode === 'string' ? 'URL' : 'Fields'}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* Hosted presets fill in sensible defaults for that service. */}
                {flavors.length > 1 && inputMode === 'fields' ? (
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-foreground">Where it runs</p>
                    <div className="flex flex-wrap gap-1.5">
                      {flavors.map((f) => (
                        <button
                          key={f.key}
                          type="button"
                          onClick={() => handleFlavorChange(f.key)}
                          aria-pressed={flavor === f.key}
                          title={f.description}
                          className={cn(
                            'border px-2.5 py-1 text-[11px] transition-colors',
                            flavor === f.key
                              ? 'border-primary bg-primary/10 font-medium text-foreground'
                              : 'border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground',
                          )}
                        >
                          {f.key === engine ? 'Self-hosted' : f.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <Field label={t("connection.name")} inputId="veloxdb-connection-name" error={fieldError('name')}>
                  <Input id="veloxdb-connection-name" {...form.register('name')} placeholder={t("connection.connectionNamePlaceholder")} className="h-9" />
                </Field>

                {/* Connection string mode */}
                {inputMode === 'string' && (
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label htmlFor="veloxdb-connection-string" className="block text-xs font-medium text-foreground">
                        {t("connection.connectionUriLabel")}
                      </label>
                      {detectedEngine && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400">
                          <CheckCircleIcon className="size-3.5" weight="fill" />
                          {engineOptions.find((o) => o.value === detectedEngine)?.label ?? detectedEngine}
                        </span>
                      )}
                    </div>
                    <Input id="veloxdb-connection-string" value={connString}
                      onChange={(e) => handleConnStringChange(e.target.value)}
                      placeholder={t("connection.connectionUriPlaceholder")}
                      className={cn('h-9 font-mono text-xs', connStringError && 'border-destructive')} />
                    {connStringError && <span className="block text-[11px] text-destructive">{connStringError}</span>}
                    <p className="text-[11px] text-muted-foreground">{t("connection.connectionUriDesc")}</p>
                  </div>
                )}

                <div className={cn('space-y-6', inputMode === 'string' && 'hidden')}>
                  {/* File picker (SQLite, DuckDB) */}
                  {cfg.showFilePicker && (
                    <Field label={engine === 'duckdb' ? 'Database file' : t("connection.databaseFile")}
                      inputId="veloxdb-file-path" error={fieldError('filePath')}>
                      <InputGroup>
                        <InputGroupInput id="veloxdb-file-path" {...form.register('filePath')}
                          placeholder={engine === 'duckdb' ? ':memory: or /path/to/database.duckdb' : '/path/to/database.db'} />
                        <InputGroupAddon align="inline-end">
                          <InputGroupButton size="icon-xs" title={t("connection.browse")}
                            onClick={() => pickFile((p) => form.setValue('filePath', p),
                              [{ name: engine === 'duckdb' ? 'DuckDB' : 'SQLite', extensions: engine === 'duckdb' ? ['duckdb', 'db'] : ['db', 'sqlite', 'sqlite3'] }])}>
                            <FolderOpenIcon />
                          </InputGroupButton>
                        </InputGroupAddon>
                      </InputGroup>
                      {engine === 'duckdb' && <p className="mt-1 text-[11px] text-muted-foreground">Use :memory: for a temporary in-memory database.</p>}
                    </Field>
                  )}

                  {showHostPort && (
                    <FormSection title="Server">
                      <div className="grid gap-3 sm:grid-cols-[1fr_112px]">
                        <Field label={cfg.fields.host.label} inputId="veloxdb-host" error={fieldError('host')}>
                          <Input id="veloxdb-host" {...form.register('host')} placeholder={cfg.fields.host.placeholder} className="h-9" />
                        </Field>
                        <Field label={cfg.fields.port.label} inputId="veloxdb-port" error={fieldError('port')}>
                          <Input id="veloxdb-port" {...form.register('port', { valueAsNumber: true })} inputMode="numeric" placeholder={String(cfg.defaultPort)} className="h-9" />
                        </Field>
                      </div>
                      {cfg.fields.database.label ? (
                        <Field label={cfg.fields.database.label} inputId="veloxdb-database" error={fieldError('database')}>
                          <Input id="veloxdb-database" {...form.register('database')} placeholder={cfg.fields.database.placeholder} className="h-9" />
                        </Field>
                      ) : null}
                    </FormSection>
                  )}

                  {showHostPort && (cfg.fields.user.label || cfg.fields.password.label) ? (
                    <FormSection title="Sign in">
                      <div className="grid gap-3 sm:grid-cols-2">
                        {cfg.fields.user.label ? (
                          <Field label={cfg.fields.user.label} inputId="veloxdb-user" error={fieldError('user')}>
                            <Input id="veloxdb-user" {...form.register('user')} placeholder={cfg.fields.user.placeholder} className="h-9" autoComplete="off" />
                          </Field>
                        ) : null}
                        {cfg.fields.password.label ? (
                          <Field label={cfg.fields.password.label} inputId="veloxdb-password" error={fieldError('password')}>
                            <Input id="veloxdb-password" {...form.register('password')} type="password" placeholder={cfg.fields.password.placeholder} className="h-9" autoComplete="off" />
                          </Field>
                        ) : null}
                      </div>
                    </FormSection>
                  ) : null}

                  {showHostPort && (cfg.showSsl || cfg.showSrv || cfg.showSsh) ? (
                    <FormSection title="Security">
                      {cfg.showSsl ? (
                        <div className="flex items-center justify-between gap-4">
                          <div>
                            <p className="text-xs font-medium text-foreground">{t("connection.sslMode")}</p>
                            <p className="mt-0.5 text-[11px] text-muted-foreground">Encrypt traffic to the server. Hosted databases usually need Require.</p>
                          </div>
                          <div className="flex shrink-0 border border-border p-0.5" role="radiogroup" aria-label={t("connection.sslMode")}>
                            {(['prefer', 'require', 'disable'] as const).map((mode) => (
                              <label
                                key={mode}
                                className={cn(
                                  'cursor-pointer px-2.5 py-1 text-[11px] font-medium transition-colors',
                                  form.watch('sslMode') === mode ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                                )}
                              >
                                <input type="radio" value={mode} className="sr-only" {...form.register('sslMode')} />
                                {mode === 'prefer' ? 'Prefer' : mode === 'require' ? 'Require' : 'Off'}
                              </label>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {cfg.showSrv ? (
                        <label className="flex cursor-pointer items-center justify-between gap-4">
                          <span>
                            <span className="block text-xs font-medium text-foreground">Use SRV record</span>
                            <span className="mt-0.5 block text-[11px] text-muted-foreground">For MongoDB Atlas and other mongodb+srv:// hosts.</span>
                          </span>
                          <input id="veloxdb-mongo-srv" type="checkbox" {...form.register('srv')} className="size-4 accent-primary" />
                        </label>
                      ) : null}

                      {cfg.showSsh ? (
                        <div className="space-y-4">
                          <label className="flex cursor-pointer items-center justify-between gap-4">
                            <span>
                              <span className="block text-xs font-medium text-foreground">{t("connection.sshTunnel")}</span>
                              <span className="mt-0.5 block text-[11px] text-muted-foreground">Reach a database that is only open to a bastion or jump host.</span>
                            </span>
                            <input type="checkbox" {...form.register('sshEnabled')} className="size-4 accent-primary" />
                          </label>

                          {sshEnabled && (
                            <div className="space-y-3 border-l-2 border-border pl-4">
                              <div className="grid gap-3 sm:grid-cols-[1fr_112px]">
                                <Field label={t("connection.sshHost")} inputId="veloxdb-ssh-host" error={fieldError('sshHost')}>
                                  <Input id="veloxdb-ssh-host" {...form.register('sshHost')} placeholder="bastion.example.com" className="h-9" />
                                </Field>
                                <Field label={t("connection.sshPort")} inputId="veloxdb-ssh-port" error={fieldError('sshPort')}>
                                  <Input id="veloxdb-ssh-port" {...form.register('sshPort', { valueAsNumber: true })} inputMode="numeric" placeholder="22" className="h-9" />
                                </Field>
                              </div>
                              <Field label={t("connection.sshUser")} inputId="veloxdb-ssh-user" error={fieldError('sshUser')}>
                                <Input id="veloxdb-ssh-user" {...form.register('sshUser')} placeholder="ubuntu" className="h-9" />
                              </Field>
                              <div className="flex border border-border p-0.5" role="radiogroup" aria-label={t("connection.authMethod")}>
                                {(['keyfile', 'password'] as const).map((method) => (
                                  <label key={method} className={cn(
                                    'flex-1 cursor-pointer px-3 py-1.5 text-center text-[11px] font-medium transition-colors',
                                    sshAuthMethod === method ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                                  )}>
                                    <input type="radio" value={method} className="sr-only" {...form.register('sshAuthMethod')} />
                                    {method === 'keyfile' ? t("connection.sshKey") : t("connection.sshPassword")}
                                  </label>
                                ))}
                              </div>
                              {sshAuthMethod === 'password' && (
                                <Field label={t("connection.sshPassword")} inputId="veloxdb-ssh-password" error={fieldError('sshPassword')}>
                                  <Input id="veloxdb-ssh-password" {...form.register('sshPassword')} type="password" placeholder={t("connection.sshPasswordPlaceholder")} className="h-9" />
                                </Field>
                              )}
                              {sshAuthMethod === 'keyfile' && (
                                <div className="grid gap-3 sm:grid-cols-2">
                                  <Field label={t("connection.privateKeyPath")} inputId="veloxdb-ssh-key-path" error={fieldError('sshPrivateKeyPath')}>
                                    <InputGroup>
                                      <InputGroupInput id="veloxdb-ssh-key-path" {...form.register('sshPrivateKeyPath')} placeholder={t("connection.privateKeyPlaceholder")} />
                                      <InputGroupAddon align="inline-end">
                                        <InputGroupButton size="icon-xs" title={t("connection.browse")}
                                          onClick={() => pickFile((p) => form.setValue('sshPrivateKeyPath', p), [{ name: 'Private key', extensions: ['pem', 'key', 'ppk', '*'] }])}>
                                          <FolderOpenIcon />
                                        </InputGroupButton>
                                      </InputGroupAddon>
                                    </InputGroup>
                                  </Field>
                                  <Field label={t("connection.passphrase")} inputId="veloxdb-ssh-passphrase" error={fieldError('sshPassphrase')}>
                                    <Input id="veloxdb-ssh-passphrase" {...form.register('sshPassphrase')} type="password" placeholder={t("connection.passphrasePlaceholder")} className="h-9" />
                                  </Field>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : null}
                    </FormSection>
                  ) : null}

                  {/* Advanced (PostgreSQL / MySQL parameters) */}
                  {cfg.showAdvanced && (
                    <div>
                      <button type="button" onClick={() => setAdvancedOpen((o) => !o)} aria-expanded={advancedOpen}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                        <CaretRightIcon className={cn('size-3.5 transition-transform', advancedOpen && 'rotate-90')} />
                        {t("connection.advancedParameters")}
                      </button>
                      {advancedOpen && (
                        <div className="mt-4 space-y-5 border-l-2 border-border pl-4">
                          <div className="grid gap-3 sm:grid-cols-3">
                            <Field label={t("connection.connectTimeoutLabel")} inputId="veloxdb-adv-timeout">
                              <Input id="veloxdb-adv-timeout" value={advancedConnectTimeout} onChange={(e) => setAdvancedConnectTimeout(e.target.value)}
                                placeholder={t("connection.connectTimeoutPlaceholder")} inputMode="numeric" className="h-9" />
                            </Field>
                            <Field label={t("connection.applicationNameLabel")} inputId="veloxdb-adv-app">
                              <Input id="veloxdb-adv-app" value={advancedAppName} onChange={(e) => setAdvancedAppName(e.target.value)}
                                placeholder={t("connection.applicationNamePlaceholder")} className="h-9" />
                            </Field>
                            <Field label={t("connection.keepalivesIdleLabel")} inputId="veloxdb-adv-idle">
                              <Input id="veloxdb-adv-idle" value={advancedKeepalivesIdle} onChange={(e) => setAdvancedKeepalivesIdle(e.target.value)}
                                placeholder={t("connection.keepalivesIdlePlaceholder")} inputMode="numeric" className="h-9" />
                            </Field>
                          </div>
                          <Field label={t("connection.optionsLabel")} inputId="veloxdb-adv-options">
                            <Input id="veloxdb-adv-options" value={advancedOptions} onChange={(e) => setAdvancedOptions(e.target.value)}
                              placeholder={t("connection.optionsPlaceholder")} className="h-9" />
                          </Field>
                          <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
                            <input type="checkbox" checked={advancedKeepalives} onChange={(e) => setAdvancedKeepalives(e.target.checked)}
                              className="size-4 accent-primary" />
                            {t("connection.keepalivesLabel")}
                          </label>
                          <div className="space-y-3">
                            <p className="text-xs font-medium text-foreground">{t("connection.tlsCertificates")}</p>
                            <div className="grid gap-3 sm:grid-cols-3">
                              {([['rootCert', advancedSslRootCert, setAdvancedSslRootCert, ['pem', 'crt', 'cer']],
                                ['clientCert', advancedSslCert, setAdvancedSslCert, ['pem', 'crt', 'cer']],
                                ['clientKey', advancedSslKey, setAdvancedSslKey, ['pem', 'key']]] as const).map(([label, value, setter, exts]) => (
                                <Field key={label} label={t(`connection.${label}Label` as never)} inputId={`veloxdb-adv-${label}`}>
                                  <InputGroup>
                                    <InputGroupInput id={`veloxdb-adv-${label}`} value={value} onChange={(e) => setter(e.target.value)}
                                      placeholder={t(`connection.${label}Placeholder` as never)} />
                                    <InputGroupAddon align="inline-end">
                                      <InputGroupButton size="icon-xs" title={t("connection.browse")}
                                        onClick={() => pickFile(setter, [{ name: 'Certificate', extensions: [...exts] }])}>
                                        <FolderOpenIcon />
                                      </InputGroupButton>
                                    </InputGroupAddon>
                                  </InputGroup>
                                </Field>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-medium text-foreground">{t("connection.customParamsLabel")}</p>
                              <Button type="button" variant="ghost" size="sm" onClick={addCustomParam} className="h-7 px-2 text-xs">
                                {t("connection.addCustomParam")}
                              </Button>
                            </div>
                            {customParams.length > 0 ? (
                              <div className="space-y-2">
                                {customParams.map((param) => (
                                  <div key={param.id} className="flex gap-2">
                                    <Input value={param.key} onChange={(e) => updateCustomParam(param.id, 'key', e.target.value)}
                                      placeholder={t("connection.paramNamePlaceholder")} className="h-9 flex-1" aria-label="Parameter name" />
                                    <Input value={param.value} onChange={(e) => updateCustomParam(param.id, 'value', e.target.value)}
                                      placeholder={t("connection.paramValuePlaceholder")} className="h-9 flex-1" aria-label="Parameter value" />
                                    <Button type="button" variant="ghost" size="sm" onClick={() => removeCustomParam(param.id)}
                                      className="h-9 w-9 shrink-0 p-0 text-muted-foreground hover:text-destructive" aria-label="Remove parameter">
                                      <XIcon className="size-3.5" />
                                    </Button>
                                  </div>
                                ))}
                              </div>
                            ) : <p className="text-[11px] text-muted-foreground">{t("connection.noCustomParams")}</p>}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          <DialogFooter className="shrink-0 items-center border-t border-border px-6 py-3 sm:justify-between">
            <div className="min-w-0 flex-1 text-[11px] leading-snug" role="status">
              {test.status === 'idle' && <span className="text-muted-foreground">Test the details before you save them.</span>}
              {test.status === 'running' && <span className="text-muted-foreground">Connecting to {engineLabel}…</span>}
              {test.status === 'ok' && (
                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                  <CheckCircleIcon className="size-4 shrink-0" weight="fill" />
                  Connected in {test.ms} ms.
                </span>
              )}
              {test.status === 'error' && (
                <span className="flex items-start gap-1.5 text-destructive">
                  <WarningCircleIcon className="mt-px size-4 shrink-0" />
                  <span className="line-clamp-3 min-w-0 break-words">{test.message}</span>
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="outline" onClick={() => { void handleTest() }} disabled={isPending || test.status === 'running'}>
                {test.status === 'running' ? <SpinnerGapIcon className="size-4 animate-spin" /> : null}
                Test connection
              </Button>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
                {t("connection.cancel")}
              </Button>
              <Button type="submit" disabled={isPending}>
                <PlugsConnectedIcon className={cn('size-4', isPending && 'animate-spin')} />
                {isPending ? t("connection.testing") : t("connection.connect")}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h4 className="border-b border-border pb-1.5 text-xs font-medium text-foreground">{title}</h4>
      {children}
    </section>
  )
}
