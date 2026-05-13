import { useMemo, useState, type ReactNode } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'

import { open as openFilePicker } from '@tauri-apps/plugin-dialog'
import { FolderOpenIcon } from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from '@/components/ui/input-group'
import type { ConnectionInput, DatabaseEngine, SshAuthMethod } from '@/data/types'
import { cn } from '@/lib/utils'
import { parseConnectionString, buildConnectionString } from '@/lib/connection-string'

const sslModeSchema = z.enum(['disable', 'prefer', 'require'])
const sshAuthMethodSchema = z.enum(['keyfile', 'password'])

const connectionSchema = z
  .object({
    name: z.string().min(2, 'Enter a connection name.'),
    engine: z.enum(['postgres', 'mysql', 'sqlite']),
    host: z.string(),
    port: z.coerce.number().int().min(1).max(65535),
    database: z.string(),
    filePath: z.string().optional(),
    user: z.string(),
    password: z.string(),
    sslMode: sslModeSchema,
    sshEnabled: z.boolean(),
    sshHost: z.string().optional(),
    sshPort: z.coerce.number().int().min(1).max(65535).optional(),
    sshUser: z.string().optional(),
    sshAuthMethod: sshAuthMethodSchema.optional(),
    sshPassword: z.string().optional(),
    sshPrivateKeyPath: z.string().optional(),
    sshPassphrase: z.string().optional(),
  })
  .superRefine((values, ctx) => {
    if (values.engine !== 'sqlite') {
      if (!values.host || values.host.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Host is required.',
          path: ['host'],
        })
      }
      if (!values.database || values.database.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Database is required.',
          path: ['database'],
        })
      }
      if (!values.user || values.user.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'User is required.',
          path: ['user'],
        })
      }
      if (!values.password || values.password.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'Password is required.',
          path: ['password'],
        })
      }
    }
    if (values.engine === 'sqlite') {
      if (!values.filePath || values.filePath.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SQLite file path is required.',
          path: ['filePath'],
        })
      }
      return
    }
    if (!values.sshEnabled) return
    if (!values.sshHost || values.sshHost.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SSH host is required.',
        path: ['sshHost'],
      })
    }
    if (!values.sshUser || values.sshUser.trim().length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SSH user is required.',
        path: ['sshUser'],
      })
    }
    if (values.sshAuthMethod === 'password') {
      if (!values.sshPassword || values.sshPassword.trim().length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SSH password is required.',
          path: ['sshPassword'],
        })
      }
    }
  })

type ConnectionDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (values: ConnectionInput) => Promise<void> | void
  isPending?: boolean
}

function Field({
  label,
  error,
  inputId,
  children,
}: {
  label: string
  error?: string
  inputId: string
  children: ReactNode
}) {
  return (
    <label htmlFor={inputId} className="space-y-2 text-left text-xs text-muted-foreground">
      <span className="block">{label}</span>
      {children}
      {error ? <span className="block text-destructive">{error}</span> : null}
    </label>
  )
}

const selectClassName = cn(
  'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors',
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
)

type InputMode = 'string' | 'fields'

interface CustomParam {
  id: number
  key: string
  value: string
}

const engineOptions: Array<{
  value: DatabaseEngine
  label: string
  hint: string
  experimental?: boolean
}> = [
  { value: 'postgres', label: 'PostgreSQL', hint: 'Recommended default' },
  { value: 'mysql', label: 'MySQL', hint: 'Experimental', experimental: true },
  { value: 'sqlite', label: 'SQLite', hint: 'Experimental', experimental: true },
]

export function ConnectionDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending = false,
}: ConnectionDialogProps) {
  const defaultValues = useMemo(
    () => ({
      name: 'Local Database',
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
      sshAuthMethod: 'keyfile' as SshAuthMethod,
      sshPassword: '',
      sshPrivateKeyPath: '',
      sshPassphrase: '',
    }),
    [],
  )

  const form = useForm({
    resolver: zodResolver(connectionSchema),
    defaultValues,
  })

  const sshEnabled = useWatch({ control: form.control, name: 'sshEnabled' })
  const sshAuthMethod = useWatch({ control: form.control, name: 'sshAuthMethod' })
  const engine = useWatch({ control: form.control, name: 'engine' })

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
    if (!value.trim()) {
      setConnStringError(null)
      return
    }
    const parsed = parseConnectionString(value)
    if (!parsed) {
      setConnStringError('Invalid connection string format.')
      return
    }
    setConnStringError(null)
    form.setValue('host', parsed.host)
    form.setValue('port', parsed.port)
    form.setValue('database', parsed.database)
    form.setValue('filePath', parsed.filePath ?? '')
    form.setValue('user', parsed.user)
    form.setValue('password', parsed.password)
    form.setValue('sslMode', parsed.sslMode)
    form.setValue('engine', parsed.engine)

    const extra = parsed.extraParams
    if (extra) {
      if ('connect_timeout' in extra) {
        setAdvancedConnectTimeout(extra['connect_timeout'])
        delete extra['connect_timeout']
      }
      if ('application_name' in extra) {
        setAdvancedAppName(extra['application_name'])
        delete extra['application_name']
      }
      if ('options' in extra) {
        setAdvancedOptions(extra['options'])
        delete extra['options']
      }
      if ('keepalives' in extra) {
        setAdvancedKeepalives(extra['keepalives'] !== '0')
        delete extra['keepalives']
      }
      if ('keepalives_idle' in extra) {
        setAdvancedKeepalivesIdle(extra['keepalives_idle'])
        delete extra['keepalives_idle']
      }
      if ('sslrootcert' in extra) {
        setAdvancedSslRootCert(extra['sslrootcert'])
        delete extra['sslrootcert']
      }
      if ('sslcert' in extra) {
        setAdvancedSslCert(extra['sslcert'])
        delete extra['sslcert']
      }
      if ('sslkey' in extra) {
        setAdvancedSslKey(extra['sslkey'])
        delete extra['sslkey']
      }

      const remaining = Object.entries(extra)
      if (remaining.length > 0) {
        setCustomParams(
          remaining.map(([key, value], i) => ({ id: i + 1, key, value })),
        )
        setNextCustomId(remaining.length + 1)
        setAdvancedOpen(true)
      }
    }

    const cs = buildConnectionString({
      ...parsed,
      engine: parsed.engine,
      sslMode: parsed.sslMode,
      extraParams: extra,
    })
    setConnString(cs)
  }

  const handleModeToggle = (mode: InputMode) => {
    if (mode === 'string') {
      const fields = form.getValues()
      const cs = buildConnectionString({
        engine: fields.engine || 'postgres',
        user: fields.user || 'postgres',
        password: fields.password || '',
        host: fields.host || '127.0.0.1',
        port: Number(fields.port) || 5432,
        database: fields.database || 'postgres',
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
    for (const p of customParams) {
      if (p.key.trim()) extra[p.key.trim()] = p.value
    }
    return extra
  }

  const pickFile = async (
    setter: (path: string) => void,
    filters: { name: string; extensions: string[] }[],
  ) => {
    const selected = await openFilePicker({ multiple: false, filters })
    if (typeof selected === 'string') setter(selected)
  }

  const handleSubmit = form.handleSubmit((values) => {
    const extraParams = collectExtraParams()
    const input: ConnectionInput = {
      name: values.name,
      engine: values.engine,
      host: values.engine === 'sqlite' ? '' : values.host,
      port: values.engine === 'sqlite' ? 1 : values.port,
      database: values.engine === 'sqlite' ? (values.filePath || ':memory:') : values.database,
      filePath: values.filePath || null,
      user: values.engine === 'sqlite' ? '' : values.user,
      password: values.engine === 'sqlite' ? '' : values.password,
      sslMode: values.engine === 'postgres' ? values.sslMode : 'disable',
      extraParams:
        values.engine === 'postgres' && Object.keys(extraParams).length > 0 ? extraParams : null,
      sshConfig: values.engine !== 'sqlite' && values.sshEnabled
        ? {
            enabled: true,
            host: values.sshHost ?? '',
            port: values.sshPort ?? 22,
            user: values.sshUser ?? '',
            authMethod: values.sshAuthMethod ?? 'keyfile',
            password: values.sshPassword || null,
            privateKeyPath: values.sshPrivateKeyPath || null,
            passphrase: values.sshPassphrase || null,
          }
        : null,
    }
    void onSubmit(input)
  })

  const addCustomParam = () => {
    setCustomParams((prev) => [...prev, { id: nextCustomId, key: '', value: '' }])
    setNextCustomId((id) => id + 1)
  }

  const removeCustomParam = (id: number) => {
    setCustomParams((prev) => prev.filter((p) => p.id !== id))
  }

  const updateCustomParam = (id: number, field: 'key' | 'value', val: string) => {
    setCustomParams((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: val } : p)),
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl border border-border p-0 sm:max-w-2xl">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>New connection</DialogTitle>
          <DialogDescription>
            Credentials are sent straight to the Tauri backend and persisted there.
          </DialogDescription>
        </DialogHeader>

        <form className="flex flex-col max-h-[75vh]" onSubmit={handleSubmit}>
          <div className="overflow-y-auto space-y-5 px-6 py-4">
          <div className="flex rounded-lg border border-border/60 bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => handleModeToggle('string')}
              className={cn(
                'flex-1 rounded-md px-4 py-2 text-sm font-medium transition-all',
                inputMode === 'string'
                  ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Connection string
            </button>
            <button
              type="button"
              onClick={() => handleModeToggle('fields')}
              className={cn(
                'flex-1 rounded-md px-4 py-2 text-sm font-medium transition-all',
                inputMode === 'fields'
                  ? 'bg-background text-foreground shadow-sm ring-1 ring-border/50'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              Individual fields
            </button>
          </div>

          {inputMode === 'string' && (
            <div className="space-y-2">
              <label
                htmlFor="veloxdb-connection-string"
                className="block text-xs text-muted-foreground"
              >
                Connection URI
              </label>
              <Input
                id="veloxdb-connection-string"
                value={connString}
                onChange={(e) => handleConnStringChange(e.target.value)}
                placeholder="postgresql://... or mysql://... or sqlite:///..."
                className={connStringError ? 'border-destructive' : ''}
              />
              {connStringError && (
                <span className="block text-xs text-destructive">{connStringError}</span>
              )}
              <p className="text-[11px] text-muted-foreground/80">
                Paste a full connection URI with scheme (`postgresql://`, `mysql://`, or `sqlite:///`).
                Individual fields will be populated automatically.
              </p>
            </div>
          )}

          <div className={cn('grid gap-4 sm:grid-cols-2', inputMode === 'string' && 'hidden')}>
            <div className="space-y-2 sm:col-span-2">
              <span className="block text-left text-xs text-muted-foreground">Database engine</span>
              <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Database engine">
                {engineOptions.map((option) => {
                  const inputId = `veloxdb-connection-engine-${option.value}`
                  const selected = engine === option.value

                  return (
                    <label key={option.value} htmlFor={inputId} className="block h-full cursor-pointer">
                      <input
                        id={inputId}
                        type="radio"
                        value={option.value}
                        className="sr-only"
                        {...form.register('engine')}
                      />
                      <div
                        className={cn(
                          'flex h-full min-h-[92px] items-center gap-2.5 rounded-md border p-3 text-left transition-all',
                          selected
                            ? 'border-emerald-500/40 bg-emerald-500/10 ring-1 ring-emerald-500/30'
                            : 'border-border bg-background hover:border-primary/40',
                        )}
                      >
                        <div className="flex h-9 w-16 shrink-0 items-center justify-start">
                          {option.value === 'postgres' ? (
                            <img
                              src="/postgresql.svg"
                              alt="PostgreSQL"
                              className="h-full w-full object-contain object-left"
                            />
                          ) : null}
                          {option.value === 'mysql' ? (
                            <>
                              <img
                                src="/mysql-wordmark-dark.svg"
                                alt="MySQL"
                                className="h-full w-full object-contain object-left dark:hidden"
                              />
                              <img
                                src="/mysql-wordmark-light.svg"
                                alt="MySQL"
                                className="hidden h-full w-full object-contain object-left dark:block"
                              />
                            </>
                          ) : null}
                          {option.value === 'sqlite' ? (
                            <img
                              src="/sqlite.svg"
                              alt="SQLite"
                              className="h-full w-full object-contain object-left"
                            />
                          ) : null}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-foreground">{option.label}</span>
                            {option.experimental ? (
                            <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-normal text-amber-600 dark:text-amber-400">
                                Experimental
                              </span>
                            ) : null}
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">{option.hint}</p>
                        </div>
                      </div>
                    </label>
                  )
                })}
              </div>
              <p className="text-[11px] text-muted-foreground/80">
                PostgreSQL is the safest default. MySQL and SQLite are marked experimental and may
                have limited support.
              </p>
              {form.formState.errors.engine?.message ? (
                <span className="block text-xs text-destructive">
                  {form.formState.errors.engine.message}
                </span>
              ) : null}
            </div>

            <Field
              label="Connection name"
              inputId="veloxdb-connection-name"
              error={form.formState.errors.name?.message}
            >
              <Input
                id="veloxdb-connection-name"
                {...form.register('name')}
                placeholder="VeloxDB local"
              />
            </Field>

            {engine !== 'sqlite' ? (
              <>
                <Field
                  label="Host"
                  inputId="veloxdb-connection-host"
                  error={form.formState.errors.host?.message}
                >
                  <Input
                    id="veloxdb-connection-host"
                    {...form.register('host')}
                    placeholder="127.0.0.1"
                  />
                </Field>

                <Field
                  label="Port"
                  inputId="veloxdb-connection-port"
                  error={form.formState.errors.port?.message}
                >
                  <Input id="veloxdb-connection-port" {...form.register('port')} inputMode="numeric" />
                </Field>

                <Field
                  label="Database"
                  inputId="veloxdb-connection-database"
                  error={form.formState.errors.database?.message}
                >
                  <Input
                    id="veloxdb-connection-database"
                    {...form.register('database')}
                    placeholder={engine === 'mysql' ? 'my_database' : 'postgres'}
                  />
                </Field>

                <Field
                  label="User"
                  inputId="veloxdb-connection-user"
                  error={form.formState.errors.user?.message}
                >
                  <Input id="veloxdb-connection-user" {...form.register('user')} placeholder="root" />
                </Field>

                <Field
                  label="Password"
                  inputId="veloxdb-connection-password"
                  error={form.formState.errors.password?.message}
                >
                  <Input id="veloxdb-connection-password" {...form.register('password')} type="password" />
                </Field>
              </>
            ) : (
              <Field
                label="SQLite file path"
                inputId="veloxdb-connection-file-path"
                error={form.formState.errors.filePath?.message}
              >
                <Input
                  id="veloxdb-connection-file-path"
                  {...form.register('filePath')}
                  placeholder="/absolute/path/to/database.db or :memory:"
                />
              </Field>
            )}

            {engine === 'postgres' && (
              <Field
                label="SSL mode"
                inputId="veloxdb-connection-ssl-mode"
                error={form.formState.errors.sslMode?.message}
              >
                <select
                  id="veloxdb-connection-ssl-mode"
                  className={selectClassName}
                  {...form.register('sslMode')}
                >
                  <option value="disable">Disable (plain TCP)</option>
                  <option value="prefer">Prefer (try TLS; local Postgres)</option>
                  <option value="require">Require (Neon, hosted Postgres)</option>
                </select>
              </Field>
            )}
          </div>

          {engine !== 'sqlite' && (
          <div className="border-t border-border pt-4">
            <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-foreground">
              <input
                type="checkbox"
                {...form.register('sshEnabled')}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              Connect via SSH tunnel
            </label>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground/70">
              Tunnel the database connection through a bastion/jump host. Key-based auth is
              recommended. Password auth requires{' '}
              <code className="rounded bg-muted px-1 py-px text-[11px]">sshpass</code> installed.
            </p>
          </div>
          )}

          {engine !== 'sqlite' && sshEnabled && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="SSH host"
                inputId="veloxdb-ssh-host"
                error={form.formState.errors.sshHost?.message}
              >
                <Input
                  id="veloxdb-ssh-host"
                  {...form.register('sshHost')}
                  placeholder="bastion.example.com"
                />
              </Field>

              <Field
                label="SSH port"
                inputId="veloxdb-ssh-port"
                error={form.formState.errors.sshPort?.message}
              >
                <Input
                  id="veloxdb-ssh-port"
                  {...form.register('sshPort')}
                  inputMode="numeric"
                  placeholder="22"
                />
              </Field>

              <Field
                label="SSH user"
                inputId="veloxdb-ssh-user"
                error={form.formState.errors.sshUser?.message}
              >
                <Input
                  id="veloxdb-ssh-user"
                  {...form.register('sshUser')}
                  placeholder="ubuntu"
                />
              </Field>

              <Field
                label="Auth method"
                inputId="veloxdb-ssh-auth-method"
                error={form.formState.errors.sshAuthMethod?.message}
              >
                <select
                  id="veloxdb-ssh-auth-method"
                  className={selectClassName}
                  {...form.register('sshAuthMethod')}
                >
                  <option value="keyfile">Key file (recommended)</option>
                  <option value="password">Password</option>
                </select>
              </Field>

              {sshAuthMethod === 'password' && (
                <Field
                  label="SSH password"
                  inputId="veloxdb-ssh-password"
                  error={form.formState.errors.sshPassword?.message}
                >
                  <Input
                    id="veloxdb-ssh-password"
                    {...form.register('sshPassword')}
                    type="password"
                    placeholder="SSH user password"
                  />
                </Field>
              )}

              {sshAuthMethod === 'keyfile' && (
                <>
                  <Field
                    label="Private key path"
                    inputId="veloxdb-ssh-key-path"
                    error={form.formState.errors.sshPrivateKeyPath?.message}
                  >
                    <Input
                      id="veloxdb-ssh-key-path"
                      {...form.register('sshPrivateKeyPath')}
                      placeholder="~/.ssh/id_rsa (optional)"
                    />
                  </Field>

                  <Field
                    label="Passphrase"
                    inputId="veloxdb-ssh-passphrase"
                    error={form.formState.errors.sshPassphrase?.message}
                  >
                    <Input
                      id="veloxdb-ssh-passphrase"
                      {...form.register('sshPassphrase')}
                      type="password"
                      placeholder="Key passphrase (optional)"
                    />
                  </Field>
                </>
              )}
            </div>
          )}

          {engine === 'postgres' && (
          <div className="border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setAdvancedOpen((o) => !o)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 -mx-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                aria-hidden="true"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={cn('shrink-0 transition-transform', advancedOpen && 'rotate-90')}
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
              <span>Advanced parameters</span>
            </button>
            <p className="mt-0.5 pl-6 text-[11px] text-muted-foreground/70">
              Additional PostgreSQL connection parameters (libpq-compatible). Optional and only
              applied to PostgreSQL.
            </p>

            {advancedOpen && (
              <div className="mt-4 space-y-4 pl-6">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    <span className="block">Connect timeout</span>
                    <Input
                      value={advancedConnectTimeout}
                      onChange={(e) => setAdvancedConnectTimeout(e.target.value)}
                      placeholder="12"
                      inputMode="numeric"
                    />
                  </div>

                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    <span className="block">Application name</span>
                    <Input
                      value={advancedAppName}
                      onChange={(e) => setAdvancedAppName(e.target.value)}
                      placeholder="VeloxDB"
                    />
                  </div>

                  <div className="space-y-1.5 text-xs text-muted-foreground">
                    <span className="block">Keepalives idle</span>
                    <Input
                      value={advancedKeepalivesIdle}
                      onChange={(e) => setAdvancedKeepalivesIdle(e.target.value)}
                      placeholder="60"
                      inputMode="numeric"
                    />
                  </div>

                  <div className="space-y-1.5 text-xs text-muted-foreground col-span-full sm:col-span-2">
                    <span className="block">Options</span>
                    <Input
                      value={advancedOptions}
                      onChange={(e) => setAdvancedOptions(e.target.value)}
                      placeholder="-c statement_timeout=30000"
                    />
                  </div>

                  <label className="flex items-center gap-2 pt-7 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={advancedKeepalives}
                      onChange={(e) => setAdvancedKeepalives(e.target.checked)}
                      className="h-4 w-4 rounded border-input"
                    />
                    Keepalives
                  </label>
                </div>

                <div className="border-t border-border/50 pt-4">
                  <span className="block text-xs text-muted-foreground mb-3">
                    TLS Certificates
                  </span>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-1.5 text-xs text-muted-foreground">
                      <span className="block">Root certificate</span>
                      <InputGroup>
                        <InputGroupInput
                          value={advancedSslRootCert}
                          onChange={(e) => setAdvancedSslRootCert(e.target.value)}
                          placeholder="/path/to/ca.crt"
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupButton
                            size="icon-xs"
                            title="Browse"
                            onClick={() => pickFile(setAdvancedSslRootCert, [{ name: 'Certificate', extensions: ['pem', 'crt', 'cer'] }])}
                          >
                            <FolderOpenIcon />
                          </InputGroupButton>
                        </InputGroupAddon>
                      </InputGroup>
                    </div>

                    <div className="space-y-1.5 text-xs text-muted-foreground">
                      <span className="block">Client certificate</span>
                      <InputGroup>
                        <InputGroupInput
                          value={advancedSslCert}
                          onChange={(e) => setAdvancedSslCert(e.target.value)}
                          placeholder="/path/to/client.crt"
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupButton
                            size="icon-xs"
                            title="Browse"
                            onClick={() => pickFile(setAdvancedSslCert, [{ name: 'Certificate', extensions: ['pem', 'crt', 'cer'] }])}
                          >
                            <FolderOpenIcon />
                          </InputGroupButton>
                        </InputGroupAddon>
                      </InputGroup>
                    </div>

                    <div className="space-y-1.5 text-xs text-muted-foreground">
                      <span className="block">Client key</span>
                      <InputGroup>
                        <InputGroupInput
                          value={advancedSslKey}
                          onChange={(e) => setAdvancedSslKey(e.target.value)}
                          placeholder="/path/to/client.key"
                        />
                        <InputGroupAddon align="inline-end">
                          <InputGroupButton
                            size="icon-xs"
                            title="Browse"
                            onClick={() => pickFile(setAdvancedSslKey, [{ name: 'Key', extensions: ['pem', 'key'] }])}
                          >
                            <FolderOpenIcon />
                          </InputGroupButton>
                        </InputGroupAddon>
                      </InputGroup>
                    </div>
                  </div>
                </div>

                <div className="border-t border-border/50 pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs text-muted-foreground">
                      Custom parameters
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={addCustomParam}
                      className="h-auto px-2 py-0.5 text-xs"
                    >
                      + Add
                    </Button>
                  </div>
                  {customParams.length > 0 ? (
                    <div className="space-y-2">
                      {customParams.map((param) => (
                        <div key={param.id} className="flex gap-2">
                          <Input
                            value={param.key}
                            onChange={(e) => updateCustomParam(param.id, 'key', e.target.value)}
                            placeholder="param name"
                            className="flex-1"
                          />
                          <Input
                            value={param.value}
                            onChange={(e) => updateCustomParam(param.id, 'value', e.target.value)}
                            placeholder="value"
                            className="flex-1"
                          />
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeCustomParam(param.id)}
                            className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive shrink-0"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              aria-hidden="true"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M18 6 6 18" />
                              <path d="m6 6 12 12" />
                            </svg>
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[11px] text-muted-foreground/60">
                      No custom parameters. Add one to pass extra PostgreSQL options.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
          )}

          </div>

          <DialogFooter className="border-t border-border px-6 py-4 shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? 'Connecting...' : 'Connect'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
