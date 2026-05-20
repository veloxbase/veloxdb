import {
  CommandIcon,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

const modKey = navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'

export function ShortcutSheet() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const shortcuts: Record<string, { key: string; description: string }[]> = {
    [t("shortcuts.general")]: [
      { key: 'Cmd/Ctrl + /', description: t("shortcuts.showSheet") },
      { key: 'Cmd/Ctrl + P', description: t("shortcuts.commandPalette") },
      { key: 'Cmd/Ctrl + Shift + C', description: t("shortcuts.openConnection") },
      { key: 'Cmd/Ctrl + Z', description: t("shortcuts.undo") },
      { key: 'Cmd/Ctrl + Shift + Z', description: t("shortcuts.redo") },
    ],
    [t("shortcuts.query")]: [
      { key: 'Cmd/Ctrl + Enter', description: t("shortcuts.runQuery") },
      { key: 'Cmd/Ctrl + Shift + F', description: t("shortcuts.formatSql") },
      { key: 'Tab', description: t("shortcuts.indent") },
      { key: 'Shift + Tab', description: t("shortcuts.outdent") },
    ],
    [t("shortcuts.diagram")]: [
      { key: t("shortcuts.clickDragTable"), description: t("shortcuts.moveTable") },
      { key: t("shortcuts.hoverDragEdge"), description: t("shortcuts.createFk") },
      { key: t("shortcuts.scroll"), description: t("shortcuts.panCanvas") },
      { key: t("shortcuts.cmdScroll"), description: t("shortcuts.zoom") },
      { key: t("shortcuts.spaceDrag"), description: t("shortcuts.panOverride") },
      { key: t("shortcuts.shiftClick"), description: t("shortcuts.multiSelect") },
      { key: 'Escape', description: t("shortcuts.clearSelection") },
      { key: '+ / -', description: t("shortcuts.zoomInOut") },
      { key: '0', description: t("shortcuts.resetZoom") },
    ],
    [t("shortcuts.results")]: [
      { key: '↑ ↓ ← →', description: t("shortcuts.navigateCells") },
      { key: 'Space', description: t("shortcuts.toggleRowSelection") },
      { key: 'Cmd/Ctrl + C', description: t("shortcuts.copyRows") },
    ],
  }

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    const cmd = e.metaKey || e.ctrlKey
    if (cmd && e.key === '/') {
      e.preventDefault()
      setOpen((v) => !v)
    }
  }, [])

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onKeyDown])

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg border-border p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <CommandIcon className="size-4 text-muted-foreground" />
            {t("shortcuts.title")}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t("shortcuts.description", { modKey })}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-auto px-5 py-4 space-y-4">
          {Object.entries(shortcuts).map(([section, entries]) => (
            <div key={section}>
              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {section}
              </h3>
              <div className="space-y-1.5">
                {entries.map((entry) => (
                  <div
                    key={entry.key}
                    className="flex items-center justify-between gap-3 rounded-sm px-2 py-1.5 transition hover:bg-accent/40"
                  >
                    <span className="text-xs text-foreground/90">{entry.description}</span>
                    <kbd
                      className={cn(
                        'shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted-foreground',
                      )}
                    >
                      {entry.key.replace('Cmd/Ctrl', modKey)}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
