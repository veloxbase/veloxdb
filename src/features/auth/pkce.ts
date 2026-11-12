const VERIFIER_BYTES = 32

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256(input: string): Promise<ArrayBuffer> {
  const data = new TextEncoder().encode(input)
  return crypto.subtle.digest('SHA-256', data)
}

export async function createPkcePair(): Promise<{
  state: string
  codeVerifier: string
  codeChallenge: string
}> {
  const verifierBytes = crypto.getRandomValues(new Uint8Array(VERIFIER_BYTES))
  const stateBytes = crypto.getRandomValues(new Uint8Array(16))
  const codeVerifier = toBase64Url(verifierBytes)
  const state = toBase64Url(stateBytes)
  const codeChallenge = toBase64Url(new Uint8Array(await sha256(codeVerifier)))
  return { state, codeVerifier, codeChallenge }
}

export async function computeS256Challenge(codeVerifier: string): Promise<string> {
  return toBase64Url(new Uint8Array(await sha256(codeVerifier)))
}

export function parseDesktopCallbackUrl(url: string): { code: string; state: string } {
  const parsed = new URL(url)
  const code = parsed.searchParams.get('code')?.trim() ?? ''
  const state = parsed.searchParams.get('state')?.trim() ?? ''
  if (!code) {
    throw new Error('Sign-in callback is missing an authorization code.')
  }
  return { code, state }
}
