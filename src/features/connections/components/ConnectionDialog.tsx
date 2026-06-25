import { useMemo, useState, useEffect, type ReactNode } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTranslation } from 'react-i18next'

import { open as openFilePicker } from '@tauri-apps/plugin-dialog'
import { FolderOpenIcon, PlugsConnectedIcon } from '@phosphor-icons/react'

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

type InputMode = 'string' | 'fields'
type SshAuthMethodForm = 'keyfile' | 'password'
type EngineOption = {
  value: DatabaseEngine
  label: string
  hint: string
  experimental: boolean
  defaultPort: number
  defaultDatabase: string
  defaultUser: string
  requiresAuth: boolean
}

const ENGINE_DEFAULTS: Record<DatabaseEngine, Omit<EngineOption, 'value' | 'label'>> = {
  postgres: { hint: 'Recommended for production', experimental: false, defaultPort: 5432, defaultDatabase: 'postgres', defaultUser: 'postgres', requiresAuth: true },
  mysql: { hint: 'Experimental support', experimental: true, defaultPort: 3306, defaultDatabase: '', defaultUser: 'root', requiresAuth: true },
  sqlite: { hint: 'Experimental support', experimental: true, defaultPort: 0, defaultDatabase: '', defaultUser: '', requiresAuth: false },
  mongo: { hint: 'Experimental support', experimental: true, defaultPort: 27017, defaultDatabase: 'admin', defaultUser: '', requiresAuth: false },
  duckdb: { hint: 'Embedded OLAP', experimental: true, defaultPort: 0, defaultDatabase: '', defaultUser: '', requiresAuth: false },
  redis: { hint: 'Key-value store', experimental: true, defaultPort: 6379, defaultDatabase: '', defaultUser: '', requiresAuth: false },
}

const engineOptions: EngineOption[] = (Object.entries(ENGINE_DEFAULTS) as [DatabaseEngine, typeof ENGINE_DEFAULTS['postgres']][]).map(
  ([value, defaults]) => ({ value, label: value === 'postgres' ? 'PostgreSQL' : value === 'mysql' ? 'MySQL' : value === 'sqlite' ? 'SQLite' : value === 'mongo' ? 'MongoDB' : value === 'duckdb' ? 'DuckDB' : 'Redis', ...defaults })
)

const connectionSchema = z.object({
  name: z.string().min(2, 'Enter a connection name.'),
  engine: z.enum(['postgres', 'mysql', 'sqlite', 'mongo', 'duckdb', 'redis'] as const),
  host: z.string(),
  port: z.coerce.number().int().min(1).max(65535),
  database: z.string(),
  filePath: z.string().optional(),
  user: z.string(),
  password: z.string(),
  sslMode: z.enum(['disable', 'prefer', 'require'] as const),
  sshEnabled: z.boolean(),
  sshHost: z.string().optional(),
  sshPort: z.coerce.number().int().min(1).max(65535).optional(),
  sshUser: z.string().optional(),
  sshAuthMethod: z.enum(['keyfile', 'password'] as const).optional(),
  sshPassword: z.string().optional(),
  sshPrivateKeyPath: z.string().optional(),
  sshPassphrase: z.string().optional(),
}).superRefine((values, ctx) => {
    if (values.engine === 'sqlite' || values.engine === 'duckdb') {
      if (!values.filePath || values.filePath.trim().length === 0) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'File path is required.', path: ['filePath'] })
      }
      return
    }

  if (values.engine === 'mongo') {
    if (!values.host || values.host.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Host is required.', path: ['host'] })
    }
    if (!values.database || values.database.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Auth database is required.', path: ['database'] })
    }
    // Password and user are optional for MongoDB
    return
  }

  // PostgreSQL and MySQL
  if (!values.host || values.host.trim().length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Host is required.', path: ['host'] })
  }
  if (!values.database || values.database.trim().length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Database is required.', path: ['database'] })
  }
  if (!values.user || values.user.trim().length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'User is required.', path: ['user'] })
  }
  if (!values.password || values.password.trim().length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Password is required.', path: ['password'] })
  }

  if (!values.sshEnabled) return
  if (!values.sshHost || values.sshHost.trim().length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SSH host is required.', path: ['sshHost'] })
  }
  if (!values.sshUser || values.sshUser.trim().length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SSH user is required.', path: ['sshUser'] })
  }
  if (values.sshAuthMethod === 'password') {
    if (!values.sshPassword || values.sshPassword.trim().length === 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'SSH password is required.', path: ['sshPassword'] })
    }
  }
})

type ConnectionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: ConnectionInput) => Promise<void> | void
  isPending?: boolean
}

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
  // PostgreSQL wire-compatible
  { key: 'postgres', label: 'PostgreSQL', engine: 'postgres', defaultHost: '127.0.0.1', defaultPort: 5432, defaultDatabase: 'postgres', defaultUser: 'postgres', defaultSsl: 'prefer', description: 'Local or self-hosted PostgreSQL' },
  { key: 'supabase', label: 'Supabase', engine: 'postgres', defaultHost: 'db.xxxxx.supabase.co', defaultPort: 5432, defaultDatabase: 'postgres', defaultUser: 'postgres', defaultSsl: 'require', description: 'Hosted PostgreSQL with real-time, auth, storage' },
  { key: 'neon', label: 'Neon', engine: 'postgres', defaultHost: 'ep-xxxxx.us-east-1.aws.neon.tech', defaultPort: 5432, defaultDatabase: 'neondb', defaultUser: 'neondb_owner', defaultSsl: 'require', description: 'Serverless PostgreSQL with branching' },
  { key: 'cockroachdb', label: 'CockroachDB', engine: 'postgres', defaultHost: '127.0.0.1', defaultPort: 26257, defaultDatabase: 'defaultdb', defaultUser: 'root', defaultSsl: 'require', description: 'Distributed SQL, PostgreSQL-compatible' },
  { key: 'timescaledb', label: 'TimescaleDB', engine: 'postgres', defaultHost: '127.0.0.1', defaultPort: 5432, defaultDatabase: 'postgres', defaultUser: 'postgres', defaultSsl: 'prefer', description: 'Time-series PostgreSQL extension' },
  { key: 'yugabytedb', label: 'YugabyteDB', engine: 'postgres', defaultHost: '127.0.0.1', defaultPort: 5433, defaultDatabase: 'yugabyte', defaultUser: 'yugabyte', defaultSsl: 'prefer', description: 'Distributed PostgreSQL-compatible' },
  // MySQL wire-compatible
  { key: 'mysql', label: 'MySQL', engine: 'mysql', defaultHost: '127.0.0.1', defaultPort: 3306, defaultDatabase: '', defaultUser: 'root', defaultSsl: 'prefer', description: 'Local or self-hosted MySQL' },
  { key: 'mariadb', label: 'MariaDB', engine: 'mysql', defaultHost: '127.0.0.1', defaultPort: 3306, defaultDatabase: '', defaultUser: 'root', defaultSsl: 'prefer', description: 'Community fork of MySQL' },
  { key: 'planetscale', label: 'PlanetScale', engine: 'mysql', defaultHost: 'aws.connect.psdb.cloud', defaultPort: 3306, defaultDatabase: '', defaultUser: 'root', defaultSsl: 'require', description: 'Serverless MySQL platform' },
  { key: 'tidb', label: 'TiDB', engine: 'mysql', defaultHost: '127.0.0.1', defaultPort: 4000, defaultDatabase: 'test', defaultUser: 'root', defaultSsl: 'prefer', description: 'Distributed MySQL-compatible (HTAP)' },
  { key: 'aurora', label: 'Aurora MySQL', engine: 'mysql', defaultHost: 'xxxxx.cluster-xxx.us-east-1.rds.amazonaws.com', defaultPort: 3306, defaultDatabase: '', defaultUser: 'admin', defaultSsl: 'require', description: 'AWS MySQL-compatible cloud database' },
]

function flavorsForEngine(engine: DatabaseEngine): DatabaseFlavor[] {
  return DATABASE_FLAVORS.filter((f) => f.engine === engine)
}

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

  const engineInfo = ENGINE_DEFAULTS[engine]

  // Auto-populate defaults when engine changes
  useEffect(() => {
    form.setValue('port', engineInfo.defaultPort)
    form.setValue('database', engineInfo.defaultDatabase)
    form.setValue('user', engineInfo.defaultUser)
    if (engine === 'sqlite') {
      form.setValue('host', '')
      form.setValue('password', '')
    }
  }, [engine, form, engineInfo.defaultPort, engineInfo.defaultDatabase, engineInfo.defaultUser])

  const [flavor, setFlavor] = useState<string>('postgres')

  // When flavor changes, auto-populate defaults
  useEffect(() => {
    const f = DATABASE_FLAVORS.find((d) => d.key === flavor)
    if (!f) return
    form.setValue('host', f.defaultHost)
    form.setValue('port', f.defaultPort)
    form.setValue('database', f.defaultDatabase)
    form.setValue('user', f.defaultUser)
    form.setValue('sslMode', f.defaultSsl)
  }, [flavor, form])

  // Reset flavor when engine changes
  useEffect(() => {
    setFlavor(engine)
  }, [engine])

  const [inputMode, setInputMode] = useState<InputMode>('fields')
  const [connString, setConnString] = useState('')
  const [connStringError, setConnStringError] = useState<string | null>(null)
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

  const handleConnStringChange = (value: string) => {
    setConnString(value)
    if (!value.trim()) { setConnStringError(null); return }
    const parsed = parseConnectionString(value)
    if (!parsed) { setConnStringError(t("connection.invalidConnectionString")); return }
    setConnStringError(null)
    form.setValue('host', parsed.host)
    form.setValue('port', parsed.port)
    form.setValue('database', parsed.database)
    form.setValue('filePath', parsed.filePath ?? '')
    form.setValue('user', parsed.user)
    form.setValue('password', parsed.password)
    form.setValue('sslMode', parsed.sslMode)
    form.setValue('engine', parsed.engine)
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
        extraParams: collectExtraParams(),
      })
      setConnString(cs)
      setConnStringError(null)
    }
    setInputMode(mode)
  }

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

  const handleSubmit = form.handleSubmit((values) => {
    const extraParams = collectExtraParams()
    const isSqlEngine = values.engine === 'postgres' || values.engine === 'mysql'
    const input: ConnectionInput = {
      name: values.name,
      engine: values.engine,
      host: values.engine === 'sqlite' ? '' : values.host,
      port: values.engine === 'sqlite' ? 1 : values.port,
      database: values.engine === 'sqlite' ? (values.filePath || ':memory:') : values.database,
      filePath: values.filePath || null,
      user: values.engine === 'sqlite' ? '' : values.user,
      password: values.engine === 'sqlite' ? '' : values.password,
      sslMode: isSqlEngine ? values.sslMode : 'disable',
      extraParams: isSqlEngine && Object.keys(extraParams).length > 0 ? extraParams : null,
      sshConfig: values.engine !== 'sqlite' && values.sshEnabled ? {
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
    void onSubmit(input)
  })

  const addCustomParam = () => { setCustomParams((prev) => [...prev, { id: nextCustomId, key: '', value: '' }]); setNextCustomId((id) => id + 1) }
  const removeCustomParam = (id: number) => { setCustomParams((prev) => prev.filter((p) => p.id !== id)) }
  const updateCustomParam = (id: number, field: 'key' | 'value', val: string) => {
    setCustomParams((prev) => prev.map((p) => (p.id === id ? { ...p, [field]: val } : p)))
  }

  const showHostPort = engine !== 'sqlite' && engine !== 'duckdb'
  const showSsl = engine === 'postgres' || engine === 'mysql'

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl border border-border p-0 sm:max-w-4xl">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>{t("connection.newConnection")}</DialogTitle>
          <DialogDescription>{t("connection.credentialsInfo")}</DialogDescription>
        </DialogHeader>

        <form className="flex flex-col max-h-[75vh]" onSubmit={handleSubmit}>
          <div className="overflow-y-auto space-y-5 px-6 py-4">
            {/* Mode toggle: connection string vs fields */}
            <div className="flex rounded-lg border border-border/60 bg-muted/40 p-0.5">
              {(['string', 'fields'] as const).map((mode) => (
                <button key={mode} type="button" onClick={() => handleModeToggle(mode)}
                  className={cn(
                    'flex-1 rounded-md px-4 py-2 text-sm font-medium transition-all',
                    inputMode === mode
                      ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
                      : 'text-muted-foreground hover:text-foreground',
                  )}>
                  {mode === 'string' ? t("connection.connectionStringMode") : t("connection.individualFields")}
                </button>
              ))}
            </div>

            {/* Connection string mode */}
            {inputMode === 'string' && (
              <div className="space-y-2">
                <label htmlFor="veloxdb-connection-string" className="block text-xs text-muted-foreground">{t("connection.connectionUriLabel")}</label>
                <Input id="veloxdb-connection-string" value={connString}
                  onChange={(e) => handleConnStringChange(e.target.value)}
                  placeholder={t("connection.connectionUriPlaceholder")}
                  className={cn('font-mono text-xs', connStringError && 'border-destructive')} />
                {connStringError && <span className="block text-xs text-destructive">{connStringError}</span>}
                <p className="text-[11px] text-muted-foreground/80">{t("connection.connectionUriDesc")}</p>
              </div>
            )}

            {/* Fields mode */}
            <div className={cn('space-y-5', inputMode === 'string' && 'hidden')}>
              {/* Engine selector */}
              <div>
                <span className="block text-left text-xs font-medium text-muted-foreground mb-3">{t("connection.databaseEngine")}</span>
                <div className="flex flex-wrap gap-2" role="radiogroup">
                  {engineOptions.map((option) => {
                    const selected = engine === option.value
                    return (
                      <label key={option.value} className="cursor-pointer">
                        <input type="radio" value={option.value} className="sr-only" {...form.register('engine')} />
                        <div className={cn(
                          'flex flex-col items-center justify-center gap-1.5 rounded-lg border px-4 py-3 transition-all select-none min-w-[100px]',
                          selected
                            ? 'border-emerald-500/50 bg-emerald-500/10 ring-1 ring-emerald-500/30'
                            : 'border-border bg-background hover:border-primary/30 hover:bg-muted/20',
                        )}>
                          <div className="flex h-10 items-center justify-center">
                            {option.value === 'postgres' && <img src="/postgresql.svg" alt="PG" className="h-8 w-auto" />}
                            {option.value === 'mysql' && (
                              <>
                                <img src="/mysql-wordmark-dark.svg" alt="MySQL" className="h-8 w-auto dark:hidden" />
                                <img src="/mysql-wordmark-light.svg" alt="MySQL" className="hidden h-8 w-auto dark:block" />
                              </>
                            )}
                            {option.value === 'sqlite' && <img src="/sqlite.svg" alt="SQLite" className="h-8 w-auto" />}
                            {option.value === 'mongo' && <img src="/mongodb-icon-light.svg" alt="MongoDB" className="h-8 w-auto" />}
                            {option.value === 'duckdb' && <img src="/DuckDB_icon-darkmode.svg" alt="DuckDB" className="h-8 w-auto" />}
                            {option.value === 'redis' && <img src="/redis.svg" alt="Redis" className="h-8 w-auto" />}
                          </div>
                          <span className="text-[11px] font-medium text-foreground leading-tight">{option.label}</span>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </div>

              {/* Flavor selector — for PG and MySQL wire-compatible databases */}
              {(engine === 'postgres' || engine === 'mysql') && (
                <div>
                  <span className="block text-left text-xs font-medium text-muted-foreground mb-2">Provider</span>
                  <select
                    value={flavor}
                    onChange={(e) => setFlavor(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {flavorsForEngine(engine).map((f) => (
                      <option key={f.key} value={f.key}>{f.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-[10px] text-muted-foreground/60">
                    {DATABASE_FLAVORS.find((f) => f.key === flavor)?.description}
                  </p>
                </div>
              )}

              {/* Connection name */}
              <Field label={t("connection.name")} inputId="veloxdb-connection-name" error={form.formState.errors.name?.message}>
                <Input id="veloxdb-connection-name" {...form.register('name')} placeholder={t("connection.connectionNamePlaceholder")} />
              </Field>

              {/* SQLite / DuckDB file path */}
              {engine === 'sqlite' && (
                <Field label={t("connection.databaseFile")} inputId="veloxdb-sqlite-path" error={form.formState.errors.filePath?.message}>
                  <InputGroup>
                    <InputGroupInput id="veloxdb-sqlite-path" {...form.register('filePath')} placeholder="/path/to/database.db" />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton size="icon-xs" title={t("connection.browse")} onClick={() => pickFile((p) => form.setValue('filePath', p), [{ name: 'SQLite', extensions: ['db', 'sqlite', 'sqlite3'] }])}>
                        <FolderOpenIcon />
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                </Field>
              )}
              {engine === 'duckdb' && (
                <Field label="Database File" inputId="veloxdb-duckdb-path" error={form.formState.errors.filePath?.message}>
                  <InputGroup>
                    <InputGroupInput id="veloxdb-duckdb-path" {...form.register('filePath')} placeholder=":memory: or /path/to/database.duckdb" />
                    <InputGroupAddon align="inline-end">
                      <InputGroupButton size="icon-xs" title={t("connection.browse")} onClick={() => pickFile((p) => form.setValue('filePath', p), [{ name: 'DuckDB', extensions: ['duckdb', 'db'] }])}>
                        <FolderOpenIcon />
                      </InputGroupButton>
                    </InputGroupAddon>
                  </InputGroup>
                  <p className="text-[10px] text-muted-foreground/70 mt-1">Leave empty or use ":memory:" for in-memory database</p>
                </Field>
              )}

              {/* Network fields — hidden for SQLite */}
              {showHostPort && (
                <div className="grid gap-4 sm:grid-cols-4">
                  <Field label={engine === 'mongo' ? 'Host' : t("connection.host")} inputId="veloxdb-host" error={form.formState.errors.host?.message}>
                    <Input id="veloxdb-host" {...form.register('host')} placeholder={engine === 'mongo' ? 'localhost' : '127.0.0.1'} />
                  </Field>
                  <Field label={t("connection.port")} inputId="veloxdb-port" error={form.formState.errors.port?.message}>
                    <Input id="veloxdb-port" {...form.register('port', { valueAsNumber: true })} inputMode="numeric" placeholder={String(engineInfo.defaultPort)} />
                  </Field>
                  <Field label={engine === 'mongo' ? 'Auth DB' : t("connection.database")} inputId="veloxdb-database"
                    error={form.formState.errors.database?.message}>
                    <Input id="veloxdb-database" {...form.register('database')}
                      placeholder={engine === 'mongo' ? 'admin' : engine === 'postgres' ? 'postgres' : 'database'} />
                  </Field>
                  <Field label={t("connection.user")} inputId="veloxdb-user" error={form.formState.errors.user?.message}>
                    <Input id="veloxdb-user" {...form.register('user')}
                      placeholder={engine === 'mongo' ? '(optional)' : engine === 'mysql' ? 'root' : 'postgres'} />
                  </Field>
                </div>
              )}

              {/* Password + SSL — only for non-SQLite */}
              {showHostPort && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t("connection.password")} inputId="veloxdb-password" error={form.formState.errors.password?.message}>
                    <Input id="veloxdb-password" {...form.register('password')} type="password"
                      placeholder={engine === 'mongo' ? '(optional)' : t("connection.passwordPlaceholder")} />
                  </Field>
                  {showSsl ? (
                    <Field label={t("connection.sslMode")} inputId="veloxdb-ssl-mode" error={form.formState.errors.sslMode?.message}>
                      <select id="veloxdb-ssl-mode" {...form.register('sslMode')}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                        <option value="prefer">{t("connection.prefer")} ({t("connection.default")})</option>
                        <option value="require">{t("connection.require")}</option>
                        <option value="disable">{t("connection.disable")}</option>
                      </select>
                    </Field>
                  ) : <div />}
                </div>
              )}

              {/* SSL mode — only for PG and MySQL */}
              {showSsl && (
                <Field label={t("connection.sslMode")} inputId="veloxdb-ssl-mode" error={form.formState.errors.sslMode?.message}>
                  <select id="veloxdb-ssl-mode" {...form.register('sslMode')}
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    <option value="prefer">{t("connection.prefer")} ({t("connection.default")})</option>
                    <option value="require">{t("connection.require")}</option>
                    <option value="disable">{t("connection.disable")}</option>
                  </select>
                </Field>
              )}

              {/* SSH toggle — not for SQLite */}
              {engine !== 'sqlite' && (
                <div className="border-t border-border pt-4">
                  <label className="flex items-center gap-2.5 cursor-pointer">
                    <input type="checkbox" {...form.register('sshEnabled')}
                      className="h-4 w-4 rounded border-input accent-emerald-500" />
                    <span className="text-sm font-medium text-foreground">{t("connection.sshTunnel")}</span>
                  </label>

                  {sshEnabled && (
                    <div className="mt-4 space-y-4 rounded-lg border border-border/60 bg-muted/20 p-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label={t("connection.sshHost")} inputId="veloxdb-ssh-host" error={form.formState.errors.sshHost?.message}>
                          <Input id="veloxdb-ssh-host" {...form.register('sshHost')} placeholder="192.168.1.100" />
                        </Field>
                        <Field label={t("connection.sshPort")} inputId="veloxdb-ssh-port" error={form.formState.errors.sshPort?.message}>
                          <Input id="veloxdb-ssh-port" {...form.register('sshPort', { valueAsNumber: true })} inputMode="numeric" placeholder="22" />
                        </Field>
                      </div>
                      <Field label={t("connection.sshUser")} inputId="veloxdb-ssh-user" error={form.formState.errors.sshUser?.message}>
                        <Input id="veloxdb-ssh-user" {...form.register('sshUser')} placeholder="root" />
                      </Field>

                      <div>
                        <span className="text-xs text-muted-foreground mb-1.5 block">{t("connection.authMethod")}</span>
                        <div className="flex gap-2">
                          {(['keyfile', 'password'] as const).map((method) => (
                            <label key={method} className={cn(
                              'flex-1 rounded-md border px-3 py-2 text-center text-xs font-medium cursor-pointer transition-all',
                              sshAuthMethod === method
                                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                : 'border-border bg-background text-muted-foreground hover:border-primary/30',
                            )}>
                              <input type="radio" value={method} className="sr-only" {...form.register('sshAuthMethod')} />
                              {method === 'keyfile' ? t("connection.sshKey") : t("connection.sshPassword")}
                            </label>
                          ))}
                        </div>
                      </div>

                      {sshAuthMethod === 'password' && (
                        <Field label={t("connection.sshPassword")} inputId="veloxdb-ssh-password" error={form.formState.errors.sshPassword?.message}>
                          <Input id="veloxdb-ssh-password" {...form.register('sshPassword')} type="password" placeholder={t("connection.sshPasswordPlaceholder")} />
                        </Field>
                      )}
                      {sshAuthMethod === 'keyfile' && (
                        <>
                          <Field label={t("connection.privateKeyPath")} inputId="veloxdb-ssh-key-path" error={form.formState.errors.sshPrivateKeyPath?.message}>
                            <Input id="veloxdb-ssh-key-path" {...form.register('sshPrivateKeyPath')} placeholder={t("connection.privateKeyPlaceholder")} />
                          </Field>
                          <Field label={t("connection.passphrase")} inputId="veloxdb-ssh-passphrase" error={form.formState.errors.sshPassphrase?.message}>
                            <Input id="veloxdb-ssh-passphrase" {...form.register('sshPassphrase')} type="password" placeholder={t("connection.passphrasePlaceholder")} />
                          </Field>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Advanced — PostgreSQL only */}
              {engine === 'postgres' && (
                <div className="border-t border-border pt-4">
                  <button type="button" onClick={() => setAdvancedOpen((o) => !o)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 -mx-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none"
                      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                      className={cn('shrink-0 transition-transform', advancedOpen && 'rotate-90')}>
                      <path d="m9 18 6-6-6-6" />
                    </svg>
                    {t("connection.advancedParameters")}
                  </button>
                  {advancedOpen && (
                    <div className="mt-4 space-y-4 pl-6">
                      <div className="grid gap-4 sm:grid-cols-3">
                        <div className="space-y-1.5 text-xs text-muted-foreground">
                          <span className="block">{t("connection.connectTimeoutLabel")}</span>
                          <Input value={advancedConnectTimeout} onChange={(e) => setAdvancedConnectTimeout(e.target.value)}
                            placeholder={t("connection.connectTimeoutPlaceholder")} inputMode="numeric" />
                        </div>
                        <div className="space-y-1.5 text-xs text-muted-foreground">
                          <span className="block">{t("connection.applicationNameLabel")}</span>
                          <Input value={advancedAppName} onChange={(e) => setAdvancedAppName(e.target.value)}
                            placeholder={t("connection.applicationNamePlaceholder")} />
                        </div>
                        <div className="space-y-1.5 text-xs text-muted-foreground">
                          <span className="block">{t("connection.keepalivesIdleLabel")}</span>
                          <Input value={advancedKeepalivesIdle} onChange={(e) => setAdvancedKeepalivesIdle(e.target.value)}
                            placeholder={t("connection.keepalivesIdlePlaceholder")} inputMode="numeric" />
                        </div>
                        <div className="space-y-1.5 text-xs text-muted-foreground col-span-full sm:col-span-2">
                          <span className="block">{t("connection.optionsLabel")}</span>
                          <Input value={advancedOptions} onChange={(e) => setAdvancedOptions(e.target.value)}
                            placeholder={t("connection.optionsPlaceholder")} />
                        </div>
                        <label className="flex items-center gap-2 pt-7 text-xs text-muted-foreground cursor-pointer">
                          <input type="checkbox" checked={advancedKeepalives} onChange={(e) => setAdvancedKeepalives(e.target.checked)}
                            className="h-4 w-4 rounded border-input" />
                          {t("connection.keepalivesLabel")}
                        </label>
                      </div>
                      {/* TLS certs */}
                      <div className="border-t border-border/50 pt-4">
                        <span className="block text-xs text-muted-foreground mb-3">{t("connection.tlsCertificates")}</span>
                        <div className="grid gap-4 sm:grid-cols-3">
                          {([['rootCert', advancedSslRootCert, setAdvancedSslRootCert, ['pem', 'crt', 'cer']],
                            ['clientCert', advancedSslCert, setAdvancedSslCert, ['pem', 'crt', 'cer']],
                            ['clientKey', advancedSslKey, setAdvancedSslKey, ['pem', 'key']]] as const).map(([label, value, setter, exts]) => (
                            <div key={label} className="space-y-1.5 text-xs text-muted-foreground">
                              <span className="block">{t(`connection.${label}Label` as any)}</span>
                              <InputGroup>
                                <InputGroupInput value={value} onChange={(e) => setter(e.target.value)}
                                  placeholder={t(`connection.${label}Placeholder` as any)} />
                                <InputGroupAddon align="inline-end">
                                  <InputGroupButton size="icon-xs" title={t("connection.browse")}
                                    onClick={() => pickFile(setter, [{ name: 'Certificate', extensions: [...exts] }])}>
                                    <FolderOpenIcon />
                                  </InputGroupButton>
                                </InputGroupAddon>
                              </InputGroup>
                            </div>
                          ))}
                        </div>
                      </div>
                      {/* Custom params */}
                      <div className="border-t border-border/50 pt-4">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs text-muted-foreground">{t("connection.customParamsLabel")}</span>
                          <Button type="button" variant="ghost" size="sm" onClick={addCustomParam} className="h-auto px-2 py-0.5 text-xs">
                            {t("connection.addCustomParam")}
                          </Button>
                        </div>
                        {customParams.length > 0 ? (
                          <div className="space-y-2">
                            {customParams.map((param) => (
                              <div key={param.id} className="flex gap-2">
                                <Input value={param.key} onChange={(e) => updateCustomParam(param.id, 'key', e.target.value)}
                                  placeholder={t("connection.paramNamePlaceholder")} className="flex-1" />
                                <Input value={param.value} onChange={(e) => updateCustomParam(param.id, 'value', e.target.value)}
                                  placeholder={t("connection.paramValuePlaceholder")} className="flex-1" />
                                <Button type="button" variant="ghost" size="sm" onClick={() => removeCustomParam(param.id)}
                                  className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive shrink-0">
                                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"
                                    fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M18 6 6 18" /><path d="m6 6 12 12" />
                                  </svg>
                                </Button>
                              </div>
                            ))}
                          </div>
                        ) : <p className="text-[11px] text-muted-foreground/60">{t("connection.noCustomParams")}</p>}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="border-t border-border px-6 py-4 shrink-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
              {t("connection.cancel")}
            </Button>
            <Button type="submit" disabled={isPending}>
              <PlugsConnectedIcon className={cn('size-4', isPending && 'animate-spin')} />
              {isPending ? t("connection.testing") : t("connection.connect")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
