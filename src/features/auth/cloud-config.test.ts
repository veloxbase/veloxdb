import { describe, expect, it } from 'vitest'

import { cloudBillingUrl } from './cloud-config'

describe('cloudBillingUrl', () => {
  it('starts Polar Cloud checkout for free or unknown plans', () => {
    expect(cloudBillingUrl()).toMatch(/\/dashboard\/billing\?start=cloud$/)
    expect(cloudBillingUrl('free')).toMatch(/\/dashboard\/billing\?start=cloud$/)
  })

  it('opens billing without a trial start for paid plans', () => {
    expect(cloudBillingUrl('cloud')).toMatch(/\/dashboard\/billing$/)
    expect(cloudBillingUrl('pro')).toMatch(/\/dashboard\/billing$/)
    expect(cloudBillingUrl('cloud')).not.toContain('start=cloud')
  })
})
