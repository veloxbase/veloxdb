import {
  CircleNotchIcon,
  SparkleIcon,
  XIcon,
} from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

type MonacoInlinePromptWidgetProps = {
  isPending: boolean
  errorMessage: string | null
  onSubmit: (instruction: string) => void
  onClose: () => void
}

const STARTER_PROMPTS = [
  'Convert to CTE (WITH clause)',
  'Add 30-day date filter',
  'Add pagination & sort by latest',
  'Optimize joins & add aliases',
]

export function MonacoInlinePromptWidget({
  isPending,
  errorMessage,
  onSubmit,
  onClose,
}: MonacoInlinePromptWidgetProps) {
  const { t } = useTranslation()
  const [instruction, setInstruction] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // Auto-focus the input on mount
    inputRef.current?.focus()
  }, [])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      e.stopPropagation()
      if (instruction.trim() && !isPending) {
        onSubmit(instruction.trim())
      }
    }
  }

  return (
    <div
      className="w-[420px] max-w-[calc(100vw-40px)] rounded-lg border border-border/90 bg-popover/95 p-3 text-popover-foreground shadow-2xl backdrop-blur-md animate-in fade-in-0 zoom-in-95 duration-150"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose()
        }
      }}
    >
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <SparkleIcon className="size-3.5 text-emerald-500" weight="fill" />
          <span>{t('shortcuts.inlineRefactor', 'Inline Edit with Veloxy')}</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close inline edit"
        >
          <XIcon className="size-3.5" />
        </button>
      </div>

      <div className="relative">
        <Textarea
          ref={inputRef}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={isPending}
          rows={2}
          placeholder="Ask Veloxy to edit or generate SQL (e.g. 'Convert to CTE')..."
          className="resize-none border-border/70 bg-background/90 text-xs leading-relaxed placeholder:text-muted-foreground/60 focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {!isPending && !errorMessage ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {STARTER_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => {
                setInstruction(prompt)
                inputRef.current?.focus()
              }}
              className="rounded border border-border/60 bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground transition hover:border-border hover:bg-accent/60 hover:text-foreground"
            >
              {prompt}
            </button>
          ))}
        </div>
      ) : null}

      {errorMessage ? (
        <div className="mt-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
          {errorMessage}
        </div>
      ) : null}

      <div className="mt-2.5 flex items-center justify-between border-t border-border/40 pt-2 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <kbd className="rounded border border-border/80 bg-muted/60 px-1 py-0.2 text-[9px] font-mono">↵</kbd>
          <span>to Generate</span>
          <span className="opacity-40">·</span>
          <kbd className="rounded border border-border/80 bg-muted/60 px-1 py-0.2 text-[9px] font-mono">Esc</kbd>
          <span>to Cancel</span>
        </div>

        <Button
          size="sm"
          className="h-6 gap-1 text-[11px] font-medium"
          disabled={!instruction.trim() || isPending}
          onClick={() => {
            if (instruction.trim()) onSubmit(instruction.trim())
          }}
        >
          {isPending ? (
            <>
              <CircleNotchIcon className="size-3 animate-spin" />
              Working…
            </>
          ) : (
            <>
              <SparkleIcon className="size-3" weight="fill" />
              Generate
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
