import { useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  ArrowSquareOutIcon,
  ChartBarIcon,
  CheckCircleIcon,
  LockSimpleIcon,
  SparkleIcon,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useCloudAuth } from '@/features/auth/AuthProvider'
import { cloudBillingUrl } from '@/features/auth/cloud-config'

export function DashboardGate() {
  const { t } = useTranslation()
  const { status, hasSession, signIn } = useCloudAuth()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSignIn = async () => {
    setError(null)
    setBusy(true)
    try {
      await signIn()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('account.signInFailed', 'Sign-in failed'))
    } finally {
      setBusy(false)
    }
  }

  const handleUpgrade = async () => {
    setError(null)
    try {
      await openUrl(cloudBillingUrl())
    } catch (caught) {
      console.error('Failed to open billing portal', caught)
      setError(t('upgrade.openBillingFailed'))
    }
  }

  return (
    <div className="flex h-full min-h-[420px] w-full flex-col items-center justify-center p-6 text-center">
      <div className="mx-auto flex max-w-[460px] flex-col items-center gap-4 rounded-xl border border-border/80 bg-card/60 p-8 shadow-sm backdrop-blur-sm">
        <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          {hasSession ? (
            <SparkleIcon className="size-6 text-primary" weight="duotone" />
          ) : (
            <LockSimpleIcon className="size-6 text-primary" weight="duotone" />
          )}
        </div>

        <div className="space-y-1.5">
          <h2 className="text-base font-semibold tracking-tight text-foreground">
            {hasSession ? t('upgrade.gateTitleSignedIn') : t('upgrade.gateTitle')}
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {hasSession ? t('upgrade.gateDescriptionSignedIn') : t('upgrade.gateDescription')}
          </p>
        </div>

        <div className="w-full space-y-2 rounded-lg border border-border/50 bg-muted/20 p-3 text-left">
          <div className="flex items-center gap-2 text-xs text-foreground/90">
            <CheckCircleIcon className="size-4 text-emerald-500 shrink-0" weight="fill" />
            <span>{t('upgrade.bulletCharts')}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-foreground/90">
            <CheckCircleIcon className="size-4 text-emerald-500 shrink-0" weight="fill" />
            <span>{t('upgrade.bulletVariables')}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-foreground/90">
            <CheckCircleIcon className="size-4 text-emerald-500 shrink-0" weight="fill" />
            <span>{t('upgrade.bulletGeneration')}</span>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 pt-2 sm:flex-row sm:justify-center">
          {hasSession ? (
            <Button
              type="button"
              size="default"
              className="w-full gap-1.5 text-xs sm:w-auto"
              onClick={() => void handleUpgrade()}
            >
              <span>{t('upgrade.startTrial')}</span>
              <ArrowSquareOutIcon className="size-3.5" />
            </Button>
          ) : (
            <Button
              type="button"
              size="default"
              className="w-full gap-1.5 text-xs sm:w-auto"
              disabled={busy || status === 'loading'}
              onClick={() => void handleSignIn()}
            >
              <ChartBarIcon className="size-4" />
              <span>{busy ? t('account.openingBrowser') : t('upgrade.signInToUnlock')}</span>
            </Button>
          )}
        </div>

        {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
      </div>
    </div>
  )
}
