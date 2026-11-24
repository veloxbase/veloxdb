import {
  CheckIcon,
  PlayIcon,
  SparkleIcon,
  XIcon,
} from '@phosphor-icons/react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'

type MonacoInlineDiffBarProps = {
  onAccept: () => void
  onAcceptAndRun: () => void
  onReject: () => void
}

export function MonacoInlineDiffBar({
  onAccept,
  onAcceptAndRun,
  onReject,
}: MonacoInlineDiffBarProps) {
  const { t } = useTranslation()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onReject()
      } else if (isMod && e.shiftKey && e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        onAcceptAndRun()
      } else if (isMod && e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        onAccept()
      }
    }

    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [onAccept, onAcceptAndRun, onReject])

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/90 bg-popover/95 px-3 py-1.5 text-popover-foreground shadow-xl backdrop-blur-md animate-in fade-in-0 zoom-in-95 duration-150">
      <div className="flex items-center gap-1.5 pr-2 border-r border-border/60 text-xs font-semibold text-foreground">
        <SparkleIcon className="size-3.5 text-emerald-500" weight="fill" />
        <span>{t('editor.refactorPreview', 'Refactor Preview')}</span>
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          size="sm"
          variant="default"
          className="h-6 gap-1 px-2 text-[11px] font-medium shadow-none"
          onClick={onAccept}
        >
          <CheckIcon className="size-3" weight="bold" />
          <span>Accept</span>
          <kbd className="rounded border border-primary-foreground/30 bg-primary-foreground/10 px-1 py-0.2 text-[9px] font-mono">⌘↵</kbd>
        </Button>

        <Button
          size="sm"
          variant="secondary"
          className="h-6 gap-1 px-2 text-[11px] font-medium"
          onClick={onAcceptAndRun}
        >
          <PlayIcon className="size-3 fill-current" />
          <span>Accept & Run</span>
          <kbd className="rounded border border-border/60 bg-muted/60 px-1 py-0.2 text-[9px] font-mono">⌘⇧↵</kbd>
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className="h-6 gap-1 px-2 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          onClick={onReject}
        >
          <XIcon className="size-3" />
          <span>Reject</span>
          <kbd className="rounded border border-border/60 bg-muted/60 px-1 py-0.2 text-[9px] font-mono">Esc</kbd>
        </Button>
      </div>
    </div>
  )
}
