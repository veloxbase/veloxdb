import type { DatabaseEngine } from '@/data/types'
import { cn } from '@/lib/utils'

/** Logo files in /public. A `dark` variant is used on dark themes. */
const LOGOS: Record<DatabaseEngine, { light: string; dark?: string }> = {
  postgres: { light: '/postgresql.svg' },
  mysql: { light: '/mysql-light.svg', dark: '/mysql.svg' },
  sqlite: { light: '/sqlite.svg' },
  mssql: { light: '/mssql.svg' },
  azuresql: { light: '/azuresql.svg' },
  clickhouse: { light: '/clickhouse.svg' },
  duckdb: { light: '/duckdb.svg', dark: '/DuckDB_icon-darkmode.svg' },
  libsql: { light: '/libsql.svg' },
  turso: { light: '/turso-light.svg', dark: '/turso.svg' },
  mongo: { light: '/mongodb-light.svg', dark: '/mongodb.svg' },
  redis: { light: '/redis.svg' },
  cassandra: { light: '/cassandra.svg' },
  scylladb: { light: '/scylladb.svg' },
}

export function EngineLogo({ engine, className }: { engine: DatabaseEngine; className?: string }) {
  const logo = LOGOS[engine]
  const base = cn('size-4 shrink-0 object-contain', className)
  if (!logo.dark) return <img src={logo.light} alt="" aria-hidden className={base} />
  return (
    <>
      <img src={logo.light} alt="" aria-hidden className={cn(base, 'dark:hidden')} />
      <img src={logo.dark} alt="" aria-hidden className={cn(base, 'hidden dark:block')} />
    </>
  )
}
