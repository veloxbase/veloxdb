import { useTranslation } from 'react-i18next'

import {
  DEFAULT_CHART_PAPER_HEX,
  normalizePaperHex,
  type ChartPaperFieldValue,
  type ChartPaperWidgetTint,
} from '@/features/dashboards/charts/chart-paper'
import type { ChartPaperStrength } from '@/lib/settings'

type ChartPaperFieldsProps = {
  idPrefix: string
  value: ChartPaperFieldValue
  onChange: (next: ChartPaperFieldValue) => void
}

const fieldClass =
  'h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs shadow-sm transition-colors focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring'

export function ChartPaperFields({ idPrefix, value, onChange }: ChartPaperFieldsProps) {
  const { t } = useTranslation()
  const pickerHex = normalizePaperHex(value.color) ?? DEFAULT_CHART_PAPER_HEX

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor={`${idPrefix}-tint`} className="mb-1.5 block text-xs text-muted-foreground">
          {t('chartPaper.tint')}
        </label>
        <select
          id={`${idPrefix}-tint`}
          value={value.tint}
          onChange={(event) => onChange({ ...value, tint: event.target.value as ChartPaperFieldValue['tint'] })}
          className={fieldClass}
        >
          <option value="inherit">{t('chartPaper.inherit')}</option>
          <option value="auto">{t('chartPaper.auto')}</option>
          <option value="neutral">{t('chartPaper.neutral')}</option>
          <option value="accent">{t('chartPaper.accent')}</option>
          <option value="custom">{t('chartPaper.custom')}</option>
        </select>
      </div>

      {value.tint === 'custom' ? (
        <div>
          <label htmlFor={`${idPrefix}-color`} className="mb-1.5 block text-xs text-muted-foreground">
            {t('chartPaper.color')}
          </label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={t('chartPaper.color')}
              value={pickerHex}
              onChange={(event) => onChange({ ...value, tint: 'custom' as ChartPaperWidgetTint, color: event.target.value })}
              className="size-8 shrink-0 cursor-pointer border border-input bg-background p-0.5"
            />
            <input
              id={`${idPrefix}-color`}
              value={value.color}
              onChange={(event) => onChange({ ...value, color: event.target.value })}
              spellCheck={false}
              className={fieldClass}
            />
          </div>
        </div>
      ) : null}

      <div>
        <label htmlFor={`${idPrefix}-strength`} className="mb-1.5 block text-xs text-muted-foreground">
          {t('chartPaper.strength')}
        </label>
        <select
          id={`${idPrefix}-strength`}
          value={value.strength}
          onChange={(event) => onChange({
            ...value,
            strength: event.target.value as 'inherit' | ChartPaperStrength,
          })}
          className={fieldClass}
        >
          <option value="inherit">{t('chartPaper.inherit')}</option>
          <option value="off">{t('chartPaper.off')}</option>
          <option value="soft">{t('chartPaper.soft')}</option>
          <option value="medium">{t('chartPaper.medium')}</option>
        </select>
      </div>
    </div>
  )
}
