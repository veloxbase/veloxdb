import { useEffect, useState } from 'react'
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  DatabaseIcon,
  KeyboardIcon,
  PlugsConnectedIcon,
  SquaresFourIcon,
} from '@phosphor-icons/react'

import { Button } from '@/components/ui/button'
import { writeOnboardingCompleted } from '@/features/onboarding/constants'

const STEPS = [
  {
    id: 'welcome',
    kicker: 'Fast · Secure · Local-first',
    title: 'PostgreSQL, unleashed on your desktop',
    body:
      'Built for builders who live in SQL. VeloxDB keeps you in flow—snappy queries, crisp results, a workspace that feels premium. Your data stays between you and your database: private by design, secure by default, no extra cloud hop just to run a SELECT.',
    icon: DatabaseIcon,
  },
  {
    id: 'connections',
    kicker: 'Simple · Reliable',
    title: 'Connect once. Reconnect instantly.',
    body:
      'Save trusted profiles and jump between databases in one click—no ritual re-entering of host and port every session. From localhost to production-grade clusters, we keep the path short so you wire fast and ship faster.',
    icon: PlugsConnectedIcon,
  },
  {
    id: 'workspaces',
    kicker: 'Powerful · Visual',
    title: 'Query hard. Model clearly.',
    body:
      'A real editor for serious SQL, streaming results when you need answers now, and EXPLAIN when milliseconds matter. Toggle to Model for a live map of tables and relationships—clarity over chaos, all in one app.',
    icon: SquaresFourIcon,
  },
  {
    id: 'shortcuts',
    kicker: 'Productivity',
    title: 'Shortcuts that keep you in the zone',
    body:
      'Keyboard-driven workflow: Cmd/Ctrl+P for the palette, Cmd/Ctrl+Shift+C for connections, Cmd/Ctrl+Enter to run. Less mouse mileage, fewer tab dances—stay locked in on what matters.',
    icon: KeyboardIcon,
  },
] as const

type OnboardingFlowProps = {
  onComplete: () => void
}

export function OnboardingFlow({ onComplete }: OnboardingFlowProps) {
  const [step, setStep] = useState(0)

  useEffect(() => {
    document.documentElement.classList.toggle(
      'dark',
      window.matchMedia('(prefers-color-scheme: dark)').matches,
    )
  }, [])

  const finish = () => {
    writeOnboardingCompleted(true)
    onComplete()
  }

  const isLast = step === STEPS.length - 1
  const StepIcon = STEPS[step].icon

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 py-10">
        <div className="flex w-full max-w-lg flex-col gap-8">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="flex size-14 items-center justify-center border border-border bg-muted/30 text-primary">
              <StepIcon className="size-8" weight="duotone" aria-hidden />
            </div>
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary">
                {STEPS[step].kicker}
              </p>
              <h1 className="text-xl font-semibold leading-snug tracking-tight text-balance">
                {STEPS[step].title}
              </h1>
              <p className="text-sm leading-relaxed text-muted-foreground">{STEPS[step].body}</p>
            </div>
          </div>

          <div className="flex justify-center gap-2" role="tablist" aria-label="Onboarding progress">
            {STEPS.map((stepDef, index) => (
              <span
                key={stepDef.id}
                className={`h-1.5 w-8 transition-colors ${
                  index === step ? 'bg-primary' : 'bg-muted-foreground/25'
                }`}
                aria-current={index === step ? 'step' : undefined}
              />
            ))}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
            <Button type="button" variant="ghost" size="sm" onClick={finish}>
              Skip
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={step === 0}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
              >
                <ArrowLeftIcon aria-hidden />
                Back
              </Button>
              {isLast ? (
                <Button type="button" size="sm" onClick={finish}>
                  Get started
                </Button>
              ) : (
                <Button type="button" size="sm" onClick={() => setStep((s) => s + 1)}>
                  Next
                  <ArrowRightIcon aria-hidden />
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
