import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { Widget } from '@/data/types'
import { NoteStylePicker } from './NoteStylePicker'
import { parseNoteOptions, type NoteOptions } from './note-options'
import { RichNoteEditor } from './RichNoteEditor'

type NoteEditorDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  widget: Widget | null
  variableValues?: Record<string, string>
  onSave: (widget: Widget) => void
}

export function NoteEditorDialog({
  open,
  onOpenChange,
  widget,
  variableValues = {},
  onSave,
}: NoteEditorDialogProps) {
  const [title, setTitle] = useState('')
  const [options, setOptions] = useState<NoteOptions>(() => parseNoteOptions(widget?.viz?.options))

  useEffect(() => {
    if (open && widget) {
      setTitle(widget.title)
      setOptions(parseNoteOptions(widget.viz?.options))
    }
  }, [open, widget])

  if (!widget) return null

  const handleSave = () => {
    const updatedWidget: Widget = {
      ...widget,
      title: title.trim() || 'Note',
      viz: {
        chartType: 'line', // placeholder for note widget
        encodings: {},
        options: {
          ...widget.viz?.options,
          ...options,
          content: options.content,
        },
      },
    }

    onSave(updatedWidget)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl border border-border p-0 sm:max-w-3xl">
        <DialogHeader className="border-b border-border px-5 py-3.5">
          <DialogTitle>Edit Note Card</DialogTitle>
          <DialogDescription>
            Customize your Markdown note, choose presentation presets (Callout, Banner, Card), and insert variables.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[75vh] overflow-y-auto space-y-4 px-5 py-4">
          {/* Note Title */}
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Note Title
            </label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Key Takeaways & Action Items"
              className="mt-1 h-8 text-xs font-medium"
            />
          </div>

          {/* Style Presets & Font Size */}
          <NoteStylePicker
            options={options}
            onChange={(patch) => setOptions((prev) => ({ ...prev, ...patch }))}
            className="rounded-md border border-border/70 bg-muted/10 p-3"
          />

          {/* Rich Markdown Editor */}
          <div>
            <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground mb-1 block">
              Note Content (Markdown)
            </label>
            <RichNoteEditor
              content={options.content}
              onChange={(content) => setOptions((prev) => ({ ...prev, content }))}
              variableValues={variableValues}
              fontSize={options.fontSize}
              minHeight="180px"
            />
          </div>
        </div>

        <DialogFooter className="border-t border-border px-5 py-3">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
