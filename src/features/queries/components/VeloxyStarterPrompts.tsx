import {
  ChartBarIcon,
  CodeIcon,
  DatabaseIcon,
  SparkleIcon,
} from '@phosphor-icons/react'

type VeloxyStarterPromptsProps = {
  activeWorkspace?: string
  onSelectPrompt: (prompt: string) => void
  disabled?: boolean
}

type PromptItem = {
  icon: typeof SparkleIcon
  title: string
  prompt: string
}

const STARTERS_BY_WORKSPACE: Record<string, PromptItem[]> = {
  query: [
    {
      icon: DatabaseIcon,
      title: 'What’s in this database?',
      prompt: 'Give me a short tour of this database: important tables, what they store, and how they relate.',
    },
    {
      icon: SparkleIcon,
      title: 'Show me the first table',
      prompt: 'Write a simple SELECT that shows a useful sample of rows from the most important table.',
    },
    {
      icon: CodeIcon,
      title: 'Find slow queries & propose indexes',
      prompt: 'Analyze table relations and suggest missing indexes for frequently joined foreign keys.',
    },
  ],
  dashboard: [
    {
      icon: ChartBarIcon,
      title: 'Suggest 4 KPI metric cards',
      prompt: 'Suggest 4 essential KPI metric cards and SQL queries for key business metrics.',
    },
    {
      icon: SparkleIcon,
      title: 'Analyze revenue & order trends',
      prompt: 'Draft a grouped time-series query with monthly totals suitable for a line chart.',
    },
    {
      icon: DatabaseIcon,
      title: 'Top customer cohort distribution',
      prompt: 'Write an aggregation query showing customer distribution by order volume.',
    },
  ],
  model: [
    {
      icon: DatabaseIcon,
      title: 'Audit missing primary keys & constraints',
      prompt: 'Inspect database tables and list any tables missing primary keys or proper constraints.',
    },
    {
      icon: SparkleIcon,
      title: 'Inspect circular foreign key relations',
      prompt: 'Analyze schema graph for potential circular dependency cycles or cascading risks.',
    },
    {
      icon: CodeIcon,
      title: 'Suggest normalized schema improvements',
      prompt: 'Review table schemas and suggest normalization or column type optimizations.',
    },
  ],
}

export function VeloxyStarterPrompts({
  activeWorkspace = 'query',
  onSelectPrompt,
  disabled = false,
}: VeloxyStarterPromptsProps) {
  const normalizedKey = activeWorkspace.toLowerCase()
  const starters = STARTERS_BY_WORKSPACE[normalizedKey] ?? STARTERS_BY_WORKSPACE.query

  return (
    <div className="mt-4 space-y-1.5 px-1">
      <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/75">
        Suggested prompts
      </p>
      <div className="flex flex-col gap-1.5">
        {starters.map((item) => {
          const Icon = item.icon
          return (
            <button
              key={item.title}
              type="button"
              disabled={disabled}
              onClick={() => onSelectPrompt(item.prompt)}
              className="group flex items-center gap-2.5 rounded-md border border-border/70 bg-muted/20 px-2.5 py-2 text-left transition-colors hover:border-border hover:bg-muted/50 disabled:opacity-50"
            >
              <div className="flex size-5 shrink-0 items-center justify-center rounded border border-border/60 bg-background/80 text-muted-foreground group-hover:text-foreground">
                <Icon className="size-3" weight="duotone" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-medium text-foreground/90 group-hover:text-foreground">
                  {item.title}
                </p>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
