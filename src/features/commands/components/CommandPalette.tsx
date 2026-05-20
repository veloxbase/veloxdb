import { ClockCounterClockwiseIcon, DatabaseIcon, PlayIcon, PlugIcon } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import type { TableInfo } from '@/data/types'

type CommandPaletteProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tables: TableInfo[]
  hasLastQuery: boolean
  onOpenConnection: () => void
  onRunLastQuery: () => void
  onSelectTable: (table: TableInfo) => void
}

export function CommandPalette({
  open,
  onOpenChange,
  tables,
  hasLastQuery,
  onOpenConnection,
  onRunLastQuery,
  onSelectTable,
}: CommandPaletteProps) {
  const { t } = useTranslation()

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <Command>
        <CommandInput placeholder={t("commandPalette.searchCommands")} />
        <CommandList>
          <CommandEmpty>{t("commandPalette.noCommands")}</CommandEmpty>

          <CommandGroup heading={t("commandPalette.actions")}>
            <CommandItem
              onSelect={() => {
                onOpenChange(false)
                onOpenConnection()
              }}
            >
              <PlugIcon />
              {t("commandPalette.openConnection")}
              <CommandShortcut>Cmd+Shift+C</CommandShortcut>
            </CommandItem>

            <CommandItem
              disabled={!hasLastQuery}
              onSelect={() => {
                onOpenChange(false)
                onRunLastQuery()
              }}
            >
              <PlayIcon />
              {t("commandPalette.runLastQuery")}
              <CommandShortcut>Cmd+Enter</CommandShortcut>
            </CommandItem>
          </CommandGroup>

          <CommandSeparator />

          <CommandGroup heading={t("commandPalette.tables")}>
            {tables.map((table) => (
              <CommandItem
                key={`${table.schema}.${table.name}`}
                value={`${table.schema}.${table.name}`}
                onSelect={() => {
                  onOpenChange(false)
                  onSelectTable(table)
                }}
              >
                <DatabaseIcon />
                {table.schema}.{table.name}
                <CommandShortcut>
                  <ClockCounterClockwiseIcon />
                </CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}

