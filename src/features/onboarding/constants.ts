export const ONBOARDING_COMPLETED_KEY = 'veloxdb.onboardingCompleted'
export const OPEN_CONNECT_ON_LAUNCH_KEY = 'veloxdb.openConnectOnLaunch'

export function readOnboardingCompleted(): boolean {
  return window.localStorage.getItem(ONBOARDING_COMPLETED_KEY) === 'true'
}

export function writeOnboardingCompleted(value: boolean) {
  window.localStorage.setItem(ONBOARDING_COMPLETED_KEY, String(value))
}

export function writeOpenConnectOnLaunch() {
  window.sessionStorage.setItem(OPEN_CONNECT_ON_LAUNCH_KEY, 'true')
}

export function consumeOpenConnectOnLaunch(): boolean {
  if (window.sessionStorage.getItem(OPEN_CONNECT_ON_LAUNCH_KEY) !== 'true') {
    return false
  }
  window.sessionStorage.removeItem(OPEN_CONNECT_ON_LAUNCH_KEY)
  return true
}
