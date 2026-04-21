export const ONBOARDING_COMPLETED_KEY = 'veloxdb.onboardingCompleted'

export function readOnboardingCompleted(): boolean {
  return window.localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true'
}

export function writeOnboardingCompleted(value: boolean) {
  window.localStorage.setItem(ONBOARDING_COMPLETED_KEY, String(value))
}
