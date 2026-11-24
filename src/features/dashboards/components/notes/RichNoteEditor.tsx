import { useRef, useState, type KeyboardEvent } from 'react'
import {
  CodeBlockIcon,
  CodeIcon,
  ColumnsIcon,
  EyeIcon,
  ListBulletsIcon,
  ListChecksIcon,
  ListNumbersIcon,
  PencilSimpleIcon,
  QuotesIcon,
  RowsIcon,
  TableIcon,
  TextBIcon,
  TextHOneIcon,
  TextHTwoIcon,
  TextItalicIcon,
  TextStrikethroughIcon,
  SlidersHorizontalIcon,
} from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { MarkdownRenderer } from './MarkdownRenderer'
import type { NoteFontSize } from './note-options'

type RichNoteEditorProps = {
  content: string
  onChange: (value: string) => void
  variableValues?: Record<string, string>
  fontSize?: NoteFontSize
  minHeight?: string
  className?: string
}

export function RichNoteEditor({
  content,
  onChange,
  variableValues = {},
  fontSize = 'sm',
  minHeight = '140px',
  className = '',
}: RichNoteEditorProps) {
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>('edit')
  const [variablePickerOpen, setVariablePickerOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const availableVariables = Object.keys(variableValues)

  // Inserts text around or at selection
  const insertFormatting = (prefix: string, suffix = '') => {
    const el = textareaRef.current
    if (!el) {
      onChange(content + prefix + suffix)
      return
    }

    const start = el.selectionStart
    const end = el.selectionEnd
    const selected = content.substring(start, end)
    const replacement = prefix + (selected || 'text') + suffix
    const nextContent = content.substring(0, start) + replacement + content.substring(end)

    onChange(nextContent)

    setTimeout(() => {
      el.focus()
      const newCursor = start + prefix.length + (selected ? selected.length : 4)
      el.setSelectionRange(newCursor, newCursor)
    }, 0)
  }

  // Inserts a line-based prefix (e.g. # or > or - [ ])
  const insertLinePrefix = (prefix: string) => {
    const el = textareaRef.current
    if (!el) {
      onChange(content + '\n' + prefix)
      return
    }

    const start = el.selectionStart
    const lineStart = content.lastIndexOf('\n', start - 1) + 1
    const nextContent = content.substring(0, lineStart) + prefix + content.substring(lineStart)

    onChange(nextContent)

    setTimeout(() => {
      el.focus()
      const newCursor = start + prefix.length
      el.setSelectionRange(newCursor, newCursor)
    }, 0)
  }

  const insertTable = () => {
    const tableTemplate = '\n| Column 1 | Column 2 | Column 3 |\n|---|---|---|\n| Item 1 | Value A | 100 |\n| Item 2 | Value B | 200 |\n'
    insertFormatting(tableTemplate)
  }

  const insertCallout = (type: 'NOTE' | 'TIP' | 'WARNING' | 'IMPORTANT') => {
    const calloutTemplate = `\n> [!${type}]\n> Add important callout details here...\n`
    insertFormatting(calloutTemplate)
  }

  const insertVariable = (varName: string) => {
    insertFormatting(`{{${varName}}}`)
    setVariablePickerOpen(false)
  }

  // Handle keyboard shortcuts (Cmd+B, Cmd+I, etc.)
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault()
      insertFormatting('**', '**')
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault()
      insertFormatting('*', '*')
    } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e') {
      e.preventDefault()
      insertFormatting('`', '`')
    }
  }

  const wordCount = content.trim() ? content.trim().split(/\s+/).length : 0
  const charCount = content.length

  return (
    <div className={`flex flex-col rounded-md border border-border bg-card overflow-hidden ${className}`}>
      {/* Formatting Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-1 border-b border-border bg-muted/40 px-2 py-1">
        <div className="flex flex-wrap items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => insertFormatting('**', '**')}
            title="Bold (Cmd+B)"
          >
            <TextBIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => insertFormatting('*', '*')}
            title="Italic (Cmd+I)"
          >
            <TextItalicIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => insertFormatting('~~', '~~')}
            title="Strikethrough"
          >
            <TextStrikethroughIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => insertFormatting('`', '`')}
            title="Inline code"
          >
            <CodeIcon className="size-3.5" />
          </Button>

          <div className="mx-1 h-3.5 w-px bg-border/80" />

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => insertLinePrefix('# ')}
            title="Heading 1"
          >
            <TextHOneIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => insertLinePrefix('## ')}
            title="Heading 2"
          >
            <TextHTwoIcon className="size-3.5" />
          </Button>

          <div className="mx-1 h-3.5 w-px bg-border/80" />

          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => insertLinePrefix('- ')}
            title="Bullet list"
          >
            <ListBulletsIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => insertLinePrefix('1. ')}
            title="Numbered list"
          >
            <ListNumbersIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => insertLinePrefix('- [ ] ')}
            title="Task checklist"
          >
            <ListChecksIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => insertLinePrefix('> ')}
            title="Blockquote"
          >
            <QuotesIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => insertFormatting('\n```sql\n', '\n```\n')}
            title="Code block"
          >
            <CodeBlockIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={insertTable}
            title="Insert Table"
          >
            <TableIcon className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="size-6 text-muted-foreground hover:text-foreground"
            onClick={() => insertFormatting('\n---\n')}
            title="Horizontal Divider"
          >
            <RowsIcon className="size-3.5" />
          </Button>

          {/* Insert Alert Callout Popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 gap-1 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                Callout
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-36 p-1">
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent text-blue-600 dark:text-blue-400"
                onClick={() => insertCallout('NOTE')}
              >
                Note (Blue)
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent text-emerald-600 dark:text-emerald-400"
                onClick={() => insertCallout('TIP')}
              >
                Tip (Green)
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent text-amber-600 dark:text-amber-400"
                onClick={() => insertCallout('WARNING')}
              >
                Warning (Amber)
              </button>
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs hover:bg-accent text-purple-600 dark:text-purple-400"
                onClick={() => insertCallout('IMPORTANT')}
              >
                Important (Purple)
              </button>
            </PopoverContent>
          </Popover>

          {/* Insert Variable Popover */}
          {availableVariables.length > 0 ? (
            <Popover open={variablePickerOpen} onOpenChange={setVariablePickerOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 gap-1 px-1.5 text-[11px] text-amber-600 dark:text-amber-400 border-amber-500/30"
                >
                  <SlidersHorizontalIcon className="size-3" />
                  Insert {'{{var}}'}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-44 p-1">
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Dashboard Variables
                </p>
                {availableVariables.map((v) => (
                  <button
                    key={v}
                    type="button"
                    className="flex w-full items-center justify-between rounded px-2 py-1 text-left font-mono text-xs hover:bg-accent"
                    onClick={() => insertVariable(v)}
                  >
                    <span>{`{{${v}}}`}</span>
                    <span className="text-[10px] text-muted-foreground">{variableValues[v]}</span>
                  </button>
                ))}
              </PopoverContent>
            </Popover>
          ) : null}
        </div>

        {/* View Mode Switcher */}
        <div className="flex items-center rounded border border-border bg-background p-0.5">
          <button
            type="button"
            onClick={() => setViewMode('edit')}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              viewMode === 'edit'
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Edit mode"
          >
            <PencilSimpleIcon className="size-3" />
            Edit
          </button>
          <button
            type="button"
            onClick={() => setViewMode('split')}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors hidden sm:flex ${
              viewMode === 'split'
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Split view"
          >
            <ColumnsIcon className="size-3" />
            Split
          </button>
          <button
            type="button"
            onClick={() => setViewMode('preview')}
            className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors ${
              viewMode === 'preview'
                ? 'bg-primary/10 text-primary font-semibold'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            title="Preview mode"
          >
            <EyeIcon className="size-3" />
            Preview
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="grid grid-cols-1 divide-y sm:divide-y-0 sm:divide-x divide-border overflow-hidden" style={{ minHeight }}>
        {viewMode === 'edit' || viewMode === 'split' ? (
          <div className="relative flex flex-col p-2">
            <Textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => onChange(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Write Markdown notes, insights, table documentation, or type {{variable}} for parameters..."
              className="size-full resize-y border-0 bg-transparent font-mono text-xs leading-relaxed focus-visible:ring-0 p-1 shadow-none"
              style={{ minHeight }}
            />
          </div>
        ) : null}

        {viewMode === 'preview' || viewMode === 'split' ? (
          <div className="overflow-y-auto p-3 bg-muted/5" style={{ minHeight }}>
            <MarkdownRenderer
              content={content}
              variableValues={variableValues}
              fontSize={fontSize}
            />
          </div>
        ) : null}
      </div>

      {/* Footer Stats */}
      <div className="flex items-center justify-between border-t border-border bg-muted/20 px-2.5 py-1 text-[10px] text-muted-foreground font-mono">
        <span>Markdown formatted</span>
        <span>{wordCount} words • {charCount} chars</span>
      </div>
    </div>
  )
}
