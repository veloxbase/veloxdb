import { cn } from '@/lib/utils'

type ModelSkeletonGraphProps = {
  className?: string
}

function SkeletonTableNode({
  titleWidth = 'w-24',
  columnsCount = 4,
  className,
}: {
  titleWidth?: string
  columnsCount?: number
  className?: string
}) {
  return (
    <div
      className={cn(
        'w-[200px] rounded-lg border border-border/80 bg-background/90 shadow-sm select-none',
        className
      )}
    >
      {/* Table Header */}
      <div className="flex items-center gap-2 border-b border-border/70 bg-muted/40 px-3 py-2">
        <div className="size-2 rounded-full bg-muted-foreground/40" />
        <div className={cn('h-2.5 rounded bg-muted-foreground/30', titleWidth)} />
      </div>

      {/* Column Rows */}
      <div className="p-2 space-y-2">
        {Array.from({ length: columnsCount }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              {i === 0 ? (
                <div className="size-2 shrink-0 rounded-sm bg-amber-500/50" />
              ) : (
                <div className="size-1.5 shrink-0 rounded-full bg-muted/70" />
              )}
              <div
                className={cn(
                  'h-2 rounded bg-muted/80',
                  i === 0 ? 'w-16' : i === 1 ? 'w-20' : i === 2 ? 'w-14' : 'w-18'
                )}
              />
            </div>
            <div className="h-1.5 w-8 rounded bg-muted/50" />
          </div>
        ))}
      </div>
    </div>
  )
}

export function ModelSkeletonGraph({ className }: ModelSkeletonGraphProps) {
  return (
    <div
      className={cn(
        'relative flex size-full min-h-[400px] flex-1 items-center justify-center overflow-hidden bg-muted/5 select-none animate-in fade-in-0 duration-200',
        className
      )}
      aria-label="Loading schema diagram"
      role="status"
    >
      {/* Subtle Dot Grid Background */}
      <div
        className="absolute inset-0 opacity-[0.08] dark:opacity-[0.12]"
        style={{
          backgroundImage: 'radial-gradient(currentColor 1px, transparent 1px)',
          backgroundSize: '16px 16px',
        }}
      />

      {/* SVG Connecting Bezier Edges */}
      <svg
        className="pointer-events-none absolute inset-0 size-full stroke-muted-foreground/30"
        fill="none"
      >
        {/* Curve 1: Node 1 (left) to Node 2 (center) */}
        <path
          d="M 330 220 C 400 220, 420 280, 490 280"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
        {/* Curve 2: Node 2 (center) to Node 3 (right) */}
        <path
          d="M 690 300 C 760 300, 780 200, 850 200"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
      </svg>

      {/* Table Nodes Layout */}
      <div className="relative z-10 flex w-full max-w-4xl items-center justify-around gap-6 px-8">
        {/* Left Node */}
        <div className="animate-pulse">
          <SkeletonTableNode titleWidth="w-20" columnsCount={4} />
        </div>

        {/* Center Node */}
        <div className="animate-pulse [animation-delay:200ms] mt-12">
          <SkeletonTableNode titleWidth="w-28" columnsCount={5} />
        </div>

        {/* Right Node */}
        <div className="animate-pulse [animation-delay:400ms] -mt-10">
          <SkeletonTableNode titleWidth="w-24" columnsCount={4} />
        </div>
      </div>
    </div>
  )
}
