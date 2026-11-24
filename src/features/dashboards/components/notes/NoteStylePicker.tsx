import {
  ChatCenteredTextIcon,
  FlameIcon,
  InfoIcon,
  LightbulbIcon,
  SparkleIcon,
  SquaresFourIcon,
  TextAaIcon,
  WarningIcon,
} from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { NoteCardStyle, NoteFontSize, NoteOptions } from './note-options'

type NoteStylePickerProps = {
  options: NoteOptions
  onChange: (patch: Partial<NoteOptions>) => void
  className?: string
}

const STYLES: Array<{
  id: NoteCardStyle
  label: string
  icon: React.ReactNode
  color: string
}> = [
  { id: 'card', label: 'Card', icon: <SquaresFourIcon className="size-3.5" />, color: 'border-border' },
  { id: 'callout-info', label: 'Info', icon: <InfoIcon className="size-3.5 text-blue-500" />, color: 'border-blue-500/50 bg-blue-500/5' },
  { id: 'callout-success', label: 'Success', icon: <LightbulbIcon className="size-3.5 text-emerald-500" />, color: 'border-emerald-500/50 bg-emerald-500/5' },
  { id: 'callout-warning', label: 'Warning', icon: <WarningIcon className="size-3.5 text-amber-500" />, color: 'border-amber-500/50 bg-amber-500/5' },
  { id: 'callout-insight', label: 'Insight', icon: <SparkleIcon className="size-3.5 text-purple-500" />, color: 'border-purple-500/50 bg-purple-500/5' },
  { id: 'callout-danger', label: 'Alert', icon: <FlameIcon className="size-3.5 text-red-500" />, color: 'border-red-500/50 bg-red-500/5' },
  { id: 'banner', label: 'Banner', icon: <ChatCenteredTextIcon className="size-3.5" />, color: 'border-dashed border-border' },
]

export function NoteStylePicker({ options, onChange, className = '' }: NoteStylePickerProps) {
  return (
    <div className={`space-y-3 ${className}`}>
      {/* Preset Style Badges */}
      <div>
        <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Card Style Preset
        </label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {STYLES.map((st) => {
            const isSelected = options.style === st.id
            return (
              <button
                key={st.id}
                type="button"
                onClick={() => onChange({ style: st.id })}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-all ${st.color} ${
                  isSelected
                    ? 'ring-2 ring-primary ring-offset-1 bg-accent text-foreground'
                    : 'text-muted-foreground hover:text-foreground opacity-75 hover:opacity-100'
                }`}
              >
                {st.icon}
                <span>{st.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Font Size & Title Controls */}
      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <div>
          <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Font Size
          </label>
          <select
            value={options.fontSize}
            onChange={(e) => onChange({ fontSize: e.target.value as NoteFontSize })}
            className="mt-1 h-7 w-full rounded-md border border-input bg-background px-2 text-xs shadow-xs focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring"
          >
            <option value="xs">Small (12px)</option>
            <option value="sm">Normal (14px)</option>
            <option value="base">Medium (16px)</option>
            <option value="lg">Large (18px)</option>
          </select>
        </div>

        <div>
          <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Custom Icon / Emoji
          </label>
          <Input
            value={options.icon ?? ''}
            onChange={(e) => onChange({ icon: e.target.value || null })}
            placeholder="e.g. 💡 or 📌"
            className="mt-1 h-7 text-xs"
          />
        </div>

        <div>
          <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            Header Title
          </label>
          <Button
            type="button"
            variant={options.showTitle ? 'secondary' : 'outline'}
            size="sm"
            className="mt-1 h-7 w-full text-xs"
            onClick={() => onChange({ showTitle: !options.showTitle })}
          >
            <TextAaIcon className="size-3.5 mr-1" />
            {options.showTitle ? 'Title Visible' : 'Title Hidden'}
          </Button>
        </div>
      </div>
    </div>
  )
}
