import { useState } from 'react'
import { openUrl } from '@tauri-apps/plugin-opener'
import {
  ArrowSquareOutIcon,
  CheckCircleIcon,
  SparkleIcon,
} from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCloudAuth } from '@/features/auth/AuthProvider'
import { cloudBillingUrl } from '@/features/auth/cloud-config'

export type UpgradeFeature = 'chartBuilder' | 'savedQueries' | 'aiDashboard'

const FEATURE_KEYS: Record<UpgradeFeature, string> = {
  chartBuilder: 'upgrade.featureChartBuilder',
  savedQueries: 'upgrade.featureSavedQueries',
  aiDashboard: 'upgrade.featureAiDashboard',
}

type UpgradeDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  feature?: UpgradeFeature
}

export function UpgradeDialog({ open, onOpenChange, feature }: UpgradeDialogProps) {
  const { t } = useTranslation()
  const { hasSession, signIn } = useCloudAuth()
  const [error, setError] = useState<string | null>(null)

  const handleUpgrade = async () => {
    setError(null)
    try {
      await openUrl(cloudBillingUrl())
      onOpenChange(false)
    } catch (caught) {
      console.error('Failed to open billing portal', caught)
      setError(t('upgrade.openBillingFailed'))
    }
  }

  const handleSignIn = async () => {
    try {
      await signIn()
      onOpenChange(false)
    } catch (caught) {
      console.error('Failed to initiate sign-in', caught)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[420px] gap-4 p-6">
        <DialogHeader className="gap-2 text-left">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <SparkleIcon className="size-5" weight="duotone" />
          </div>
          <DialogTitle className="text-sm font-semibold">
            {feature
              ? t('upgrade.titleFeature', { feature: t(FEATURE_KEYS[feature]) })
              : t('upgrade.title')}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {t('upgrade.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3">
          <div className="flex items-center gap-2 text-xs text-foreground/90">
            <CheckCircleIcon className="size-3.5 text-emerald-500 shrink-0" weight="fill" />
            <span>{t('upgrade.bulletDashboards')}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-foreground/90">
            <CheckCircleIcon className="size-3.5 text-emerald-500 shrink-0" weight="fill" />
            <span>{t('upgrade.bulletAi')}</span>
          </div>
          <div className="flex items-center gap-2 text-xs text-foreground/90">
            <CheckCircleIcon className="size-3.5 text-emerald-500 shrink-0" weight="fill" />
            <span>{t('upgrade.bulletWorkspaces')}</span>
          </div>
        </div>

        <DialogFooter className="flex-row items-center justify-end gap-2 pt-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-xs"
            onClick={() => onOpenChange(false)}
          >
            {t('upgrade.cancel')}
          </Button>

          {hasSession ? (
            <Button
              type="button"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => void handleUpgrade()}
            >
              <span>{t('upgrade.startTrial')}</span>
              <ArrowSquareOutIcon className="size-3.5" />
            </Button>
          ) : (
            <Button
              type="button"
              size="sm"
              className="text-xs"
              onClick={() => void handleSignIn()}
            >
              {t('upgrade.signIn')}
            </Button>
          )}
        </DialogFooter>
        {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
      </DialogContent>
    </Dialog>
  )
}
