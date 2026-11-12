import { ChartBarIcon, ChartLineUpIcon, ClockCounterClockwiseIcon, DatabaseIcon, FlowArrowIcon, GearIcon, PlayIcon, PlugIcon, RobotIcon, SparkleIcon, TerminalIcon } from '@phosphor-icons/react'
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
import { getShortcutDisplay } from '@/lib/shortcuts/registry'

type CommandPaletteProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  tables: TableInfo[]
  hasLastQuery: boolean
  onOpenConnection: () => void
  onRunLastQuery: () => void
  onSelectTable: (table: TableInfo) => void
  onSwitchToQuery?: () => void
  onSwitchToModel?: () => void
  onSwitchToDashboard?: () => void
  onOpenSettings?: () => void
  onToggleVeloxy?: () => void
  /** Pro-only: hidden when omitted. */
  onCreateChartFromLastResult?: () => void
  canCreateChartFromLastResult?: boolean
  onGenerateDashboardWithAi?: () => void
}

export function CommandPalette({
  open,
  onOpenChange,
  tables,
  hasLastQuery,
  onOpenConnection,
  onRunLastQuery,
  onSelectTable,
  onSwitchToQuery,
  onSwitchToModel,
  onSwitchToDashboard,
  onOpenSettings,
  onToggleVeloxy,
  onCreateChartFromLastResult,
  canCreateChartFromLastResult,
  onGenerateDashboardWithAi,
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
              <CommandShortcut>{getShortcutDisplay("newConnection")}</CommandShortcut>
            </CommandItem>

            {onSwitchToQuery ? (
              <CommandItem
                onSelect={() => {
                  onOpenChange(false)
                  onSwitchToQuery()
                }}
              >
                <TerminalIcon />
                {t("commandPalette.switchToQuery")}
              </CommandItem>
            ) : null}

            {onSwitchToModel ? (
              <CommandItem
                onSelect={() => {
                  onOpenChange(false)
                  onSwitchToModel()
                }}
              >
                <FlowArrowIcon />
                {t("commandPalette.switchToModel")}
              </CommandItem>
            ) : null}

            {onSwitchToDashboard ? (
              <CommandItem
                onSelect={() => {
                  onOpenChange(false)
                  onSwitchToDashboard()
                }}
              >
                <ChartBarIcon />
                {t("commandPalette.switchToDashboard")}
              </CommandItem>
            ) : null}

            {onOpenSettings ? (
              <CommandItem
                onSelect={() => {
                  onOpenChange(false)
                  onOpenSettings()
                }}
              >
                <GearIcon />
                {t("commandPalette.openSettings")}
                <CommandShortcut>{getShortcutDisplay("openSettings")}</CommandShortcut>
              </CommandItem>
            ) : null}

            {onToggleVeloxy ? (
              <CommandItem
                onSelect={() => {
                  onOpenChange(false)
                  onToggleVeloxy()
                }}
              >
                <RobotIcon />
                {t("commandPalette.toggleVeloxy")}
                <CommandShortcut>{getShortcutDisplay("toggleAskVeloxy")}</CommandShortcut>
              </CommandItem>
            ) : null}

            <CommandItem
              disabled={!hasLastQuery}
              onSelect={() => {
                onOpenChange(false)
                onRunLastQuery()
              }}
            >
              <PlayIcon />
              {t("commandPalette.runLastQuery")}
              <CommandShortcut>{getShortcutDisplay("runQuery")}</CommandShortcut>
            </CommandItem>

            {onCreateChartFromLastResult ? (
              <CommandItem
                disabled={!canCreateChartFromLastResult}
                onSelect={() => {
                  onOpenChange(false)
                  onCreateChartFromLastResult()
                }}
              >
                <ChartLineUpIcon />
                {t("commandPalette.createChartFromLastResult")}
              </CommandItem>
            ) : null}

            {onGenerateDashboardWithAi ? (
              <CommandItem
                onSelect={() => {
                  onOpenChange(false)
                  onGenerateDashboardWithAi()
                }}
              >
                <SparkleIcon weight="fill" className="text-emerald-500" />
                {t("commandPalette.generateDashboardWithAi", "Generate Dashboard with Veloxy")}
              </CommandItem>
            ) : null}
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
