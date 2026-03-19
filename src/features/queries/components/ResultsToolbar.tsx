import { Button } from '@/components/ui/button'

type ColumnVisibilityItem = {
  id: string
  label: string
  visible: boolean
  canHide: boolean
}

type ResultsToolbarProps = {
  columns: ColumnVisibilityItem[]
  canEdit: boolean
  isDirty: boolean
  isBusy: boolean
  onToggleColumn: (columnId: string, visible: boolean) => void
  onRefresh: () => void
  onCopy: () => void
  onDownloadCsv: () => void
  onDownloadJson: () => void
  onSave: () => void
}

export function ResultsToolbar({
  columns,
  canEdit,
  isDirty,
  isBusy,
  onToggleColumn,
  onRefresh,
  onCopy,
  onDownloadCsv,
  onDownloadJson,
  onSave,
}: ResultsToolbarProps) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/20 px-3 py-2">
      <div className="flex items-center gap-2">
        <Button variant="outline" size="xs" onClick={onRefresh} disabled={isBusy}>
          Refresh
        </Button>
        <Button variant="outline" size="xs" onClick={onCopy}>
          Copy
        </Button>
        <Button variant="outline" size="xs" onClick={onDownloadCsv}>
          Download CSV
        </Button>
        <Button variant="outline" size="xs" onClick={onDownloadJson}>
          Download JSON
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <details className="relative">
          <summary className="list-none">
            <Button variant="outline" size="xs" asChild>
              <span>Columns</span>
            </Button>
          </summary>
          <div className="absolute right-0 z-10 mt-1 min-w-44 border border-border bg-background p-2 shadow-sm">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
              Visibility
            </div>
            <div className="max-h-48 space-y-1 overflow-auto">
              {columns.map((column) => (
                <label
                  key={column.id}
                  className="flex cursor-pointer items-center gap-2 text-xs text-foreground"
                >
                  <input
                    type="checkbox"
                    className="size-3"
                    checked={column.visible}
                    disabled={!column.canHide}
                    onChange={(event) => onToggleColumn(column.id, event.target.checked)}
                  />
                  <span className="truncate">{column.label}</span>
                </label>
              ))}
            </div>
          </div>
        </details>

        <Button
          size="xs"
          onClick={onSave}
          disabled={isBusy || !canEdit || !isDirty}
          variant={isDirty ? 'default' : 'outline'}
        >
          {isBusy ? 'Saving...' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
