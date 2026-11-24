import { WarningCircleIcon } from '@phosphor-icons/react'

/** Shown on a dashboard card/canvas when its `connectionId` no longer matches a saved connection. */
export function DashboardConnectionWarning() {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-sm bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-600 dark:text-amber-400"
      title="The connection this dashboard was created with no longer exists."
    >
      <WarningCircleIcon className="size-3" />
      Connection missing
    </span>
  )
}
