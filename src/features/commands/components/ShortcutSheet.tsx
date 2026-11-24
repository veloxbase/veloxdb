import {
  CommandIcon,
} from '@phosphor-icons/react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  SHORTCUTS,
  formatHotkeyForPlatform,
  isMacPlatform,
  type ShortcutCategory,
} from '@/lib/shortcuts/registry'
import { useAppHotkey } from '@/lib/shortcuts/use-app-hotkey'

export function ShortcutSheet() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const isMac = isMacPlatform()
  const modKey = isMac ? '⌘' : 'Ctrl'

  useAppHotkey('shortcutSheet', () => {
    setOpen((v) => !v)
  })

  const categoryOrder: ShortcutCategory[] = ['global', 'query', 'ai', 'diagram', 'results']

  const categoryTitles: Record<ShortcutCategory, string> = {
    global: t('shortcuts.general'),
    query: t('shortcuts.query'),
    ai: t('shortcuts.ai'),
    diagram: t('shortcuts.diagram'),
    results: t('shortcuts.results'),
  }

  // Non-hotkey interaction gestures for the diagram & editor
  const interactionHints: Record<ShortcutCategory, { key: string; description: string }[]> = {
    global: [],
    query: [
      { key: 'Tab', description: t('shortcuts.indent') },
      { key: 'Shift + Tab', description: t('shortcuts.outdent') },
    ],
    ai: [],
    diagram: [
      { key: t('shortcuts.clickDragTable'), description: t('shortcuts.moveTable') },
      { key: t('shortcuts.hoverDragEdge'), description: t('shortcuts.createFk') },
      { key: t('shortcuts.scroll'), description: t('shortcuts.panCanvas') },
      { key: t('shortcuts.cmdScroll'), description: t('shortcuts.zoom') },
      { key: t('shortcuts.spaceDrag'), description: t('shortcuts.panOverride') },
      { key: t('shortcuts.shiftClick'), description: t('shortcuts.multiSelect') },
    ],
    results: [
      { key: '↑ ↓ ← →', description: t('shortcuts.navigateCells') },
      { key: 'Space', description: t('shortcuts.toggleRowSelection') },
    ],
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg border-border p-0 sm:max-w-lg">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <CommandIcon className="size-4 text-muted-foreground" />
            {t('shortcuts.title')}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {t('shortcuts.description', { modKey })}
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-auto px-5 py-4 space-y-4">
          {categoryOrder.map((cat) => {
            const registryShortcuts = Object.values(SHORTCUTS)
              .filter((s) => s.category === cat)
              .map((s) => ({
                key: formatHotkeyForPlatform(s.hotkey, isMac),
                description: t(s.labelKey, s.defaultLabel),
              }))

            const extraHints = interactionHints[cat] || []
            const entries = [...registryShortcuts, ...extraHints]
            if (entries.length === 0) return null

            return (
              <div key={cat}>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {categoryTitles[cat]}
                </h3>
                <div className="space-y-1.5">
                  {entries.map((entry) => (
                    <div
                      key={entry.key + entry.description}
                      className="flex items-center justify-between gap-3 rounded-sm px-2 py-1.5 transition hover:bg-accent/40"
                    >
                      <span className="text-xs text-foreground/90">{entry.description}</span>
                      <kbd
                        className={cn(
                          'shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted-foreground',
                        )}
                      >
                        {entry.key}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}

