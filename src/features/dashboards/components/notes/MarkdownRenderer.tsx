import { useState, type ReactNode } from 'react'
import {
  CheckIcon,
  CopyIcon,
  InfoIcon,
  LightbulbIcon,
  WarningCircleIcon,
  WarningIcon,
  FlameIcon,
} from '@phosphor-icons/react'

type MarkdownRendererProps = {
  content: string
  variableValues?: Record<string, string>
  fontSize?: 'xs' | 'sm' | 'base' | 'lg'
  className?: string
}

/** Interpolates `{{varName}}` with values from variableValues */
export function interpolateVariables(
  text: string,
  variables: Record<string, string> = {},
): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, varName) => {
    return variables[varName] !== undefined ? variables[varName] : `{{${varName}}}`
  })
}

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="group relative my-2 overflow-hidden rounded-md border border-border/70 bg-muted/30">
      <div className="flex items-center justify-between border-b border-border/50 bg-muted/50 px-2.5 py-1 text-[11px] font-mono text-muted-foreground">
        <span>{language || 'text'}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-background hover:text-foreground"
          title="Copy code"
        >
          {copied ? <CheckIcon className="size-3 text-emerald-500" /> : <CopyIcon className="size-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      <pre className="overflow-x-auto p-2.5 font-mono text-[11.5px] leading-relaxed text-foreground">
        <code>{code}</code>
      </pre>
    </div>
  )
}

function AlertCallout({
  type,
  children,
}: {
  type: 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION'
  children: ReactNode
}) {
  const config = {
    NOTE: {
      label: 'Note',
      icon: <InfoIcon className="size-4 text-blue-500" />,
      style: 'border-blue-500/30 bg-blue-500/10 text-blue-900 dark:text-blue-200',
    },
    TIP: {
      label: 'Tip',
      icon: <LightbulbIcon className="size-4 text-emerald-500" />,
      style: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-900 dark:text-emerald-200',
    },
    IMPORTANT: {
      label: 'Important',
      icon: <FlameIcon className="size-4 text-purple-500" />,
      style: 'border-purple-500/30 bg-purple-500/10 text-purple-900 dark:text-purple-200',
    },
    WARNING: {
      label: 'Warning',
      icon: <WarningIcon className="size-4 text-amber-500" />,
      style: 'border-amber-500/30 bg-amber-500/10 text-amber-900 dark:text-amber-200',
    },
    CAUTION: {
      label: 'Caution',
      icon: <WarningCircleIcon className="size-4 text-red-500" />,
      style: 'border-red-500/30 bg-red-500/10 text-red-900 dark:text-red-200',
    },
  }[type]

  return (
    <div className={`my-2.5 rounded-md border p-3 text-xs leading-relaxed ${config.style}`}>
      <div className="mb-1 flex items-center gap-1.5 font-semibold text-[11px] uppercase tracking-wider">
        {config.icon}
        <span>{config.label}</span>
      </div>
      <div className="text-foreground/90">{children}</div>
    </div>
  )
}

/** Formats inline markdown: bold, italic, strike, inline code, links */
function formatInline(text: string): ReactNode[] {
  // Regex to match inline tokens
  const tokenRegex = /(\*\*[^*]+\*\*|\*[^*]+\*|~~[^~]+~~|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  const parts = text.split(tokenRegex)

  return parts.map((part, index) => {
    if (!part) return null

    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return <em key={index} className="italic text-foreground/90">{part.slice(1, -1)}</em>
    }
    if (part.startsWith('~~') && part.endsWith('~~')) {
      return <del key={index} className="line-through text-muted-foreground">{part.slice(2, -2)}</del>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={index}
          className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[0.88em] text-foreground border border-border/50"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    if (part.startsWith('[') && part.includes('](') && part.endsWith(')')) {
      const match = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (match) {
        return (
          <a
            key={index}
            href={match[2]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:text-primary/80 transition-colors"
          >
            {match[1]}
          </a>
        )
      }
    }

    return part
  })
}

export function MarkdownRenderer({
  content,
  variableValues = {},
  fontSize = 'sm',
  className = '',
}: MarkdownRendererProps) {
  const interpolated = interpolateVariables(content, variableValues)
  const lines = interpolated.split('\n')

  const elements: ReactNode[] = []
  let i = 0

  const fontClass = {
    xs: 'text-xs leading-relaxed',
    sm: 'text-sm leading-relaxed',
    base: 'text-base leading-relaxed',
    lg: 'text-lg leading-relaxed',
  }[fontSize]

  while (i < lines.length) {
    const line = lines[i]!

    // 1. Code Blocks (```)
    if (line.trim().startsWith('```')) {
      const language = line.trim().slice(3).trim()
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith('```')) {
        codeLines.push(lines[i]!)
        i++
      }
      i++ // consume closing ```
      elements.push(
        <CodeBlock key={`code-${elements.length}`} code={codeLines.join('\n')} language={language} />,
      )
      continue
    }

    // 2. Alert Callouts (e.g. `> [!NOTE]`)
    if (line.trim().startsWith('> [!')) {
      const alertMatch = line.trim().match(/^>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i)
      if (alertMatch) {
        const alertType = alertMatch[1]!.toUpperCase() as 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION'
        const alertLines: string[] = []
        i++
        while (i < lines.length && lines[i]!.trim().startsWith('>')) {
          alertLines.push(lines[i]!.replace(/^>\s?/, ''))
          i++
        }
        elements.push(
          <AlertCallout key={`alert-${elements.length}`} type={alertType}>
            {alertLines.map((l, lIdx) => (
              <p key={lIdx} className={lIdx > 0 ? 'mt-1' : ''}>
                {formatInline(l)}
              </p>
            ))}
          </AlertCallout>,
        )
        continue
      }
    }

    // 3. Regular Blockquotes (`> text`)
    if (line.trim().startsWith('>')) {
      const quoteLines: string[] = []
      while (i < lines.length && lines[i]!.trim().startsWith('>')) {
        quoteLines.push(lines[i]!.replace(/^>\s?/, ''))
        i++
      }
      elements.push(
        <blockquote
          key={`quote-${elements.length}`}
          className="my-2 border-l-3 border-primary/40 pl-3 italic text-muted-foreground"
        >
          {quoteLines.map((l, lIdx) => (
            <p key={lIdx}>{formatInline(l)}</p>
          ))}
        </blockquote>,
      )
      continue
    }

    // 4. Tables (`| a | b |`)
    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i]!.trim().startsWith('|') && lines[i]!.trim().endsWith('|')) {
        tableLines.push(lines[i]!.trim())
        i++
      }

      if (tableLines.length >= 2) {
        const parseRow = (r: string) =>
          r
            .slice(1, -1)
            .split('|')
            .map((c) => c.trim())

        const headers = parseRow(tableLines[0]!)
        const isSeparator = /^[\s|:-]+$/.test(tableLines[1]!)
        const rows = (isSeparator ? tableLines.slice(2) : tableLines.slice(1)).map(parseRow)

        elements.push(
          <div key={`table-${elements.length}`} className="my-2.5 overflow-x-auto rounded-md border border-border">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-muted/40 font-semibold text-foreground">
                  {headers.map((h, hIdx) => (
                    <th key={hIdx} className="px-3 py-1.5">{formatInline(h)}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {rows.map((row, rIdx) => (
                  <tr key={rIdx} className="hover:bg-muted/20">
                    {row.map((cell, cIdx) => (
                      <td key={cIdx} className="px-3 py-1.5">{formatInline(cell)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
        )
        continue
      }
    }

    // 5. Horizontal Rules (---)
    if (/^(\*{3,}|-{3,}|_{3,})$/.test(line.trim())) {
      elements.push(<hr key={`hr-${elements.length}`} className="my-3 border-border/80" />)
      i++
      continue
    }

    // 6. Headings (# H1, ## H2, ### H3, #### H4)
    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={`h1-${elements.length}`} className="mb-2 mt-4 text-xl font-bold tracking-tight text-foreground border-b border-border/50 pb-1 first:mt-0">
          {formatInline(line.slice(2))}
        </h1>,
      )
      i++
      continue
    }
    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={`h2-${elements.length}`} className="mb-1.5 mt-3 text-lg font-semibold tracking-tight text-foreground first:mt-0">
          {formatInline(line.slice(3))}
        </h2>,
      )
      i++
      continue
    }
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={`h3-${elements.length}`} className="mb-1 mt-2.5 text-sm font-semibold text-foreground first:mt-0">
          {formatInline(line.slice(4))}
        </h3>,
      )
      i++
      continue
    }
    if (line.startsWith('#### ')) {
      elements.push(
        <h4 key={`h4-${elements.length}`} className="mb-1 mt-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground first:mt-0">
          {formatInline(line.slice(5))}
        </h4>,
      )
      i++
      continue
    }

    // 7. Checklists / Task lists (`- [ ] ` or `- [x] `)
    if (/^-\s+\[([ xX])\]\s+/.test(line.trim())) {
      const taskItems: Array<{ checked: boolean; text: string }> = []
      while (i < lines.length && /^-\s+\[([ xX])\]\s+/.test(lines[i]!.trim())) {
        const m = lines[i]!.trim().match(/^-\s+\[([ xX])\]\s+(.*)$/)
        if (m) {
          taskItems.push({
            checked: m[1]?.toLowerCase() === 'x',
            text: m[2] || '',
          })
        }
        i++
      }
      elements.push(
        <ul key={`tasks-${elements.length}`} className="my-2 space-y-1 pl-1">
          {taskItems.map((item, tIdx) => (
            <li key={tIdx} className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={item.checked}
                readOnly
                className="mt-0.5 size-3.5 rounded border-border text-primary focus:ring-0"
              />
              <span className={item.checked ? 'line-through text-muted-foreground' : 'text-foreground'}>
                {formatInline(item.text)}
              </span>
            </li>
          ))}
        </ul>,
      )
      continue
    }

    // 8. Unordered Lists (`* ` or `- `)
    if (/^[-*]\s+/.test(line.trim())) {
      const listItems: string[] = []
      while (i < lines.length && /^[-*]\s+/.test(lines[i]!.trim()) && !/^-\s+\[([ xX])\]\s+/.test(lines[i]!.trim())) {
        listItems.push(lines[i]!.trim().replace(/^[-*]\s+/, ''))
        i++
      }
      elements.push(
        <ul key={`ul-${elements.length}`} className="my-2 list-disc space-y-0.5 pl-5">
          {listItems.map((item, lIdx) => (
            <li key={lIdx} className="text-foreground/90">{formatInline(item)}</li>
          ))}
        </ul>,
      )
      continue
    }

    // 9. Ordered Lists (`1. `)
    if (/^\d+\.\s+/.test(line.trim())) {
      const listItems: string[] = []
      while (i < lines.length && /^\d+\.\s+/.test(lines[i]!.trim())) {
        listItems.push(lines[i]!.trim().replace(/^\d+\.\s+/, ''))
        i++
      }
      elements.push(
        <ol key={`ol-${elements.length}`} className="my-2 list-decimal space-y-0.5 pl-5">
          {listItems.map((item, lIdx) => (
            <li key={lIdx} className="text-foreground/90">{formatInline(item)}</li>
          ))}
        </ol>,
      )
      continue
    }

    // 10. Empty lines / Paragraphs
    if (!line.trim()) {
      elements.push(<div key={`blank-${elements.length}`} className="h-2" />)
      i++
      continue
    }

    // Regular paragraph
    elements.push(
      <p key={`p-${elements.length}`} className="my-1 text-foreground/90 first:mt-0 last:mb-0">
        {formatInline(line)}
      </p>,
    )
    i++
  }

  if (elements.length === 0) {
    return <span className="italic text-muted-foreground/60">Empty note</span>
  }

  return (
    <div className={`prose-sm max-w-none break-words ${fontClass} ${className}`}>
      {elements}
    </div>
  )
}
