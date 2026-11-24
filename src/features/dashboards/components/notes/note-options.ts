export type NoteCardStyle =
  | 'card'
  | 'callout-info'
  | 'callout-success'
  | 'callout-warning'
  | 'callout-insight'
  | 'callout-danger'
  | 'banner'

export type NoteFontSize = 'xs' | 'sm' | 'base' | 'lg'

export type NoteOptions = {
  content: string
  style: NoteCardStyle
  fontSize: NoteFontSize
  showTitle: boolean
  icon: string | null
}

export const DEFAULT_NOTE_OPTIONS: NoteOptions = {
  content: '',
  style: 'card',
  fontSize: 'sm',
  showTitle: true,
  icon: null,
}

export function parseNoteOptions(rawOptions: unknown, defaultContent = ''): NoteOptions {
  if (typeof rawOptions !== 'object' || rawOptions === null) {
    return { ...DEFAULT_NOTE_OPTIONS, content: defaultContent }
  }

  const opt = rawOptions as Record<string, unknown>
  const content = typeof opt.content === 'string' ? opt.content : defaultContent

  const validStyles: NoteCardStyle[] = [
    'card',
    'callout-info',
    'callout-success',
    'callout-warning',
    'callout-insight',
    'callout-danger',
    'banner',
  ]
  const style: NoteCardStyle = typeof opt.style === 'string' && validStyles.includes(opt.style as NoteCardStyle)
    ? (opt.style as NoteCardStyle)
    : 'card'

  const validFontSizes: NoteFontSize[] = ['xs', 'sm', 'base', 'lg']
  const fontSize: NoteFontSize = typeof opt.fontSize === 'string' && validFontSizes.includes(opt.fontSize as NoteFontSize)
    ? (opt.fontSize as NoteFontSize)
    : 'sm'

  const showTitle = typeof opt.showTitle === 'boolean' ? opt.showTitle : style !== 'banner'
  const icon = typeof opt.icon === 'string' && opt.icon.trim() ? opt.icon.trim() : null

  return {
    content,
    style,
    fontSize,
    showTitle,
    icon,
  }
}
