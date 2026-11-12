import { cn } from '@/lib/utils'

type ChartSkeletonProps = {
  className?: string
}

export function ChartSkeleton({ className }: ChartSkeletonProps) {
  return (
    <div
      className={cn(
        'relative flex size-full min-h-[120px] flex-col justify-end p-4 select-none',
        className
      )}
      aria-label="Loading chart"
      role="status"
    >
      {/* Background horizontal guide lines */}
      <div className="absolute inset-x-4 top-4 bottom-10 flex flex-col justify-between opacity-30">
        <div className="w-full border-b border-dashed border-border" />
        <div className="w-full border-b border-dashed border-border" />
        <div className="w-full border-b border-dashed border-border" />
      </div>

      {/* Bar silhouettes */}
      <div className="relative z-10 flex h-3/4 items-end justify-around gap-2 px-2 pb-2">
        <div className="h-2/5 w-full max-w-[28px] animate-pulse rounded-t bg-muted/70" />
        <div className="h-4/5 w-full max-w-[28px] animate-pulse rounded-t bg-muted/90 [animation-delay:150ms]" />
        <div className="h-3/5 w-full max-w-[28px] animate-pulse rounded-t bg-muted/60 [animation-delay:300ms]" />
        <div className="h-full w-full max-w-[28px] animate-pulse rounded-t bg-muted/80 [animation-delay:450ms]" />
        <div className="h-1/2 w-full max-w-[28px] animate-pulse rounded-t bg-muted/70 [animation-delay:600ms]" />
        <div className="h-3/4 w-full max-w-[28px] animate-pulse rounded-t bg-muted/90 [animation-delay:750ms]" />
      </div>

      {/* Bottom baseline */}
      <div className="border-t border-border/80 pt-2">
        <div className="flex justify-between px-1">
          <div className="h-1.5 w-8 rounded bg-muted/50" />
          <div className="h-1.5 w-8 rounded bg-muted/50" />
          <div className="h-1.5 w-8 rounded bg-muted/50" />
          <div className="h-1.5 w-8 rounded bg-muted/50" />
        </div>
      </div>
    </div>
  )
}
