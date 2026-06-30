import type { DatabaseEngine } from '@/data/types'

export type FieldConfig = {
  label: string
  placeholder: string
}

export type EngineFormConfig = {
  /** Default port for this engine */
  defaultPort: number
  /** Default database / auth-db / DB number name */
  defaultDatabase: string
  /** Default user name */
  defaultUser: string
  /** Which SSL mode to pre-select */
  defaultSsl: 'disable' | 'prefer' | 'require'
  /** Per-field labels and placeholders */
  fields: {
    host: FieldConfig
    port: { label: string }
    database: FieldConfig
    user: FieldConfig
    password: { label: string; placeholder: string }
  }
  /** Show the file picker for local databases (SQLite, DuckDB) */
  showFilePicker: boolean
  /** Show SSL mode dropdown (Postgres, MySQL) */
  showSsl: boolean
  /** Show SRV checkbox (MongoDB) */
  showSrv: boolean
  /** Show SSH tunnel toggle (all except SQLite, DuckDB, Redis) */
  showSsh: boolean
  /** Show advanced params section (Postgres) */
  showAdvanced: boolean
  /** Show provider flavor picker (Postgres, MySQL) */
  showFlavors: boolean
  /** User field is required */
  requireUser: boolean
  /** Password field is required */
  requirePassword: boolean
}

export const ENGINE_FORM_CONFIG: Record<DatabaseEngine, EngineFormConfig> = {
  postgres: {
    defaultPort: 5432,
    defaultDatabase: 'postgres',
    defaultUser: 'postgres',
    defaultSsl: 'prefer',
    fields: {
      host:     { label: 'Host', placeholder: '127.0.0.1' },
      port:     { label: 'Port' },
      database: { label: 'Database', placeholder: 'postgres' },
      user:     { label: 'User', placeholder: 'postgres' },
      password: { label: 'Password', placeholder: '••••••••' },
    },
    showFilePicker: false,
    showSsl: true,
    showSrv: false,
    showSsh: true,
    showAdvanced: true,
    showFlavors: true,
    requireUser: true,
    requirePassword: true,
  },
  mysql: {
    defaultPort: 3306,
    defaultDatabase: '',
    defaultUser: 'root',
    defaultSsl: 'prefer',
    fields: {
      host:     { label: 'Host', placeholder: '127.0.0.1' },
      port:     { label: 'Port' },
      database: { label: 'Database', placeholder: 'database' },
      user:     { label: 'User', placeholder: 'root' },
      password: { label: 'Password', placeholder: '••••••••' },
    },
    showFilePicker: false,
    showSsl: true,
    showSrv: false,
    showSsh: true,
    showAdvanced: false,
    showFlavors: true,
    requireUser: true,
    requirePassword: true,
  },
  sqlite: {
    defaultPort: 0,
    defaultDatabase: '',
    defaultUser: '',
    defaultSsl: 'disable',
    fields: {
      host:     { label: '', placeholder: '' },
      port:     { label: '' },
      database: { label: '', placeholder: '' },
      user:     { label: '', placeholder: '' },
      password: { label: '', placeholder: '' },
    },
    showFilePicker: true,
    showSsl: false,
    showSrv: false,
    showSsh: false,
    showAdvanced: false,
    showFlavors: false,
    requireUser: false,
    requirePassword: false,
  },
  mongo: {
    defaultPort: 27017,
    defaultDatabase: 'admin',
    defaultUser: '',
    defaultSsl: 'prefer',
    fields: {
      host:     { label: 'Host', placeholder: 'localhost' },
      port:     { label: 'Port' },
      database: { label: 'Auth DB', placeholder: 'admin' },
      user:     { label: 'User', placeholder: '(optional)' },
      password: { label: 'Password', placeholder: '(optional)' },
    },
    showFilePicker: false,
    showSsl: false,
    showSrv: true,
    showSsh: true,
    showAdvanced: false,
    showFlavors: false,
    requireUser: false,
    requirePassword: false,
  },
  duckdb: {
    defaultPort: 0,
    defaultDatabase: '',
    defaultUser: '',
    defaultSsl: 'disable',
    fields: {
      host:     { label: '', placeholder: '' },
      port:     { label: '' },
      database: { label: '', placeholder: '' },
      user:     { label: '', placeholder: '' },
      password: { label: '', placeholder: '' },
    },
    showFilePicker: true,
    showSsl: false,
    showSrv: false,
    showSsh: false,
    showAdvanced: false,
    showFlavors: false,
    requireUser: false,
    requirePassword: false,
  },
  redis: {
    defaultPort: 6379,
    defaultDatabase: '0',
    defaultUser: '',
    defaultSsl: 'disable',
    fields: {
      host:     { label: 'Host', placeholder: '127.0.0.1' },
      port:     { label: 'Port' },
      database: { label: 'DB Number', placeholder: '0' },
      user:     { label: 'User', placeholder: 'default (optional)' },
      password: { label: 'Password', placeholder: '(optional)' },
    },
    showFilePicker: false,
    showSsl: false,
    showSrv: false,
    showSsh: false,
    showAdvanced: false,
    showFlavors: false,
    requireUser: false,
    requirePassword: false,
  },
}
