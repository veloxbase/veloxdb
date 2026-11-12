import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ArrowSquareOutIcon, SparkleIcon } from '@phosphor-icons/react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { queryKeys } from '@/data/query-keys'
import { useCloudAuth } from '@/features/auth/AuthProvider'
import { fetchAiUsage } from '@/features/auth/cloud-client'
import { cloudBillingUrl } from '@/features/auth/cloud-config'
import { subscribeLiveAgent } from '@/features/auth/live-agent'
import { useEntitlements } from '@/features/entitlements/useEntitlements'

export function AccountSettingsPanel() {
  const { t } = useTranslation()
  const { status, user, hasSession, signIn, signOut, connectWithApiKey } = useCloudAuth()
  const entitlements = useEntitlements()
  const [pasteKey, setPasteKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [agentOnline, setAgentOnline] = useState(false)

  useEffect(() => subscribeLiveAgent(setAgentOnline), [])

  const usageQuery = useQuery({
    queryKey: queryKeys.cloudUsage(),
    queryFn: fetchAiUsage,
    enabled: hasSession,
  })

  const handleSignIn = async () => {
    setError(null)
    setBusy(true)
    try {
      await signIn()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('account.signInFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handlePasteKey = async () => {
    setError(null)
    setBusy(true)
    try {
      await connectWithApiKey(pasteKey)
      setPasteKey('')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('account.connectFailed'))
    } finally {
      setBusy(false)
    }
  }

  const handleOpenBilling = async () => {
    setError(null)
    try {
      await openUrl(cloudBillingUrl(entitlements.plan))
    } catch (caught) {
      console.error('Failed to open billing portal', caught)
      setError(t('upgrade.openBillingFailed'))
    }
  }

  if (status === 'loading') {
    return <p className="text-xs text-muted-foreground">{t('account.loading')}</p>
  }

  if (!hasSession) {
    return (
      <div className="space-y-4">
        <p className="text-[11px] leading-snug text-muted-foreground">{t('account.signedOutDesc')}</p>
        <Button size="sm" className="h-8 text-xs" onClick={() => void handleSignIn()} disabled={busy}>
          {busy ? t('account.openingBrowser') : t('account.signIn')}
        </Button>
        <div className="space-y-2">
          <p className="text-[11px] text-muted-foreground">{t('account.pasteKeyDesc')}</p>
          <div className="flex items-center gap-2">
            <Input
              type="password"
              value={pasteKey}
              onChange={(event) => setPasteKey(event.target.value)}
              className="h-8 w-[220px] text-[11px]"
              placeholder="velox_..."
              spellCheck={false}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs"
              disabled={busy || !pasteKey.trim()}
              onClick={() => void handlePasteKey()}
            >
              {t('account.connect')}
            </Button>
          </div>
        </div>
        {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
      </div>
    )
  }

  const planLabel =
    entitlements.plan === 'pro'
      ? t('account.planPro')
      : entitlements.plan === 'cloud'
        ? entitlements.status === 'trialing'
          ? t('account.planCloudTrial')
          : t('account.planCloud')
        : entitlements.bi
          ? t('account.planPro')
          : t('account.planFree')

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-foreground">
              {user?.name || user?.email || t('account.signedIn')}
            </p>
            <span
              className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                entitlements.bi
                  ? 'bg-primary/10 text-primary border border-primary/20'
                  : 'bg-muted text-muted-foreground border border-border'
              }`}
            >
              {entitlements.bi ? <SparkleIcon className="size-3" weight="fill" /> : null}
              {planLabel}
            </span>
          </div>
          {user?.email ? <p className="mt-0.5 text-[11px] text-muted-foreground">{user.email}</p> : null}
          <p className="mt-1 text-[11px] text-muted-foreground">
            Live agent: {agentOnline ? 'Online' : 'Offline'}
          </p>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs shrink-0"
          onClick={() => void handleOpenBilling()}
        >
          <span>
            {entitlements.plan === 'pro' || entitlements.plan === 'cloud'
              ? t('account.manageSubscription')
              : t('account.startTrial')}
          </span>
          <ArrowSquareOutIcon className="size-3 text-muted-foreground" />
        </Button>
      </div>

      {usageQuery.data ? (
        <div className="rounded-md border border-border/60 bg-muted/20 p-2.5">
          <p className="text-[11px] text-muted-foreground">
            {t('account.usage', {
              plan: planLabel,
              daily: usageQuery.data.remaining.dailyRequests,
              monthly: usageQuery.data.remaining.monthlyRequests,
            })}
          </p>
        </div>
      ) : null}

      {error ? <p className="text-[11px] text-destructive">{error}</p> : null}

      <Button variant="outline" size="sm" className="h-8 text-xs text-destructive hover:text-destructive" onClick={() => void signOut()}>
        {t('account.signOut')}
      </Button>
    </div>
  )
}
