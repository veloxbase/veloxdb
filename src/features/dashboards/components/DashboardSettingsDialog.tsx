import { PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { useState } from 'react'

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
import type { Dashboard, DashboardTheme, DashboardVariable } from '@/data/types'

const REFRESH_OPTIONS = [
  { label: 'Off', value: null },
  { label: '30 seconds', value: 30 },
  { label: '1 minute', value: 60 },
  { label: '5 minutes', value: 300 },
] as const

type DashboardSettingsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  dashboard: Dashboard
  onSave: (patch: Pick<Dashboard, 'refreshIntervalSec' | 'theme' | 'variables'>) => void
}

function emptyVariable(): DashboardVariable {
  return { name: 'var', type: 'text', defaultValue: '' }
}

export function DashboardSettingsDialog({
  open,
  onOpenChange,
  dashboard,
  onSave,
}: DashboardSettingsDialogProps) {
  const [refreshIntervalSec, setRefreshIntervalSec] = useState<number | null>(dashboard.refreshIntervalSec)
  const [theme, setTheme] = useState<DashboardTheme>(dashboard.theme)
  const [variables, setVariables] = useState<DashboardVariable[]>(dashboard.variables)

  const handleOpen = (nextOpen: boolean) => {
    if (nextOpen) {
      setRefreshIntervalSec(dashboard.refreshIntervalSec)
      setTheme(dashboard.theme)
      setVariables(dashboard.variables)
    }
    onOpenChange(nextOpen)
  }

  const handleSave = () => {
    onSave({ refreshIntervalSec, theme, variables })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogContent className="max-w-md border border-border">
        <DialogHeader>
          <DialogTitle>Dashboard settings</DialogTitle>
          <DialogDescription>Auto-refresh, theme override, and SQL variables for this dashboard.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div>
            <label htmlFor="dash-refresh" className="mb-1.5 block text-xs text-muted-foreground">Auto-refresh</label>
            <select
              id="dash-refresh"
              value={refreshIntervalSec ?? ''}
              onChange={(e) => {
                const raw = e.target.value
                setRefreshIntervalSec(raw === '' ? null : Number(raw))
              }}
              className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs"
            >
              {REFRESH_OPTIONS.map((option) => (
                <option key={option.label} value={option.value ?? ''}>{option.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="dash-theme" className="mb-1.5 block text-xs text-muted-foreground">Chart theme</label>
            <select
              id="dash-theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value as DashboardTheme)}
              className="h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs"
            >
              <option value="inherit">Inherit from app</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-xs text-muted-foreground">Variables</p>
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                onClick={() => setVariables((prev) => [...prev, emptyVariable()])}
                title="Add variable"
              >
                <PlusIcon />
              </Button>
            </div>
            {variables.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">Use {'{{varName}}'} in widget SQL.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {variables.map((variable, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      value={variable.name}
                      onChange={(e) => setVariables((prev) => prev.map((v, i) => i === index ? { ...v, name: e.target.value } : v))}
                      placeholder="name"
                      className="h-7 flex-1 text-xs"
                    />
                    <select
                      value={variable.type}
                      onChange={(e) => setVariables((prev) => prev.map((v, i) => i === index ? { ...v, type: e.target.value as DashboardVariable['type'] } : v))}
                      className="h-7 rounded-md border border-input bg-background px-2 text-xs"
                    >
                      <option value="text">Text</option>
                      <option value="number">Number</option>
                      <option value="date">Date</option>
                      <option value="select">Select</option>
                    </select>
                    <Input
                      value={variable.defaultValue}
                      onChange={(e) => setVariables((prev) => prev.map((v, i) => i === index ? { ...v, defaultValue: e.target.value } : v))}
                      placeholder="default"
                      className="h-7 flex-1 text-xs"
                    />
                    {variable.type === 'select' ? (
                      <Input
                        value={(variable.options ?? []).join(', ')}
                        onChange={(e) => setVariables((prev) => prev.map((v, i) => i === index
                          ? { ...v, options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) }
                          : v))}
                        placeholder="option1, option2"
                        className="h-7 flex-1 text-xs"
                      />
                    ) : null}
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      onClick={() => setVariables((prev) => prev.filter((_, i) => i !== index))}
                    >
                      <TrashIcon />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSave}>Save</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
