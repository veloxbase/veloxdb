import { invoke } from '@tauri-apps/api/core'
import { getCloudUrl } from '@/features/auth/cloud-config'

export type PublishReportRequest = {
  dashboardId: string
  title: string
  description?: string
  slug?: string
  passcode?: string
  expiresInHours?: number
  columnMasks?: Record<string, string[]>
  variableValues?: Record<string, string>
  cloudUrl?: string
  liveEnabled?: boolean
  schedule?: Array<{ id: string; kind: string; cadence: string; emails?: string[] }>
}

export type PublishReportResponse = {
  id: string
  slug: string
  url: string
  title: string
  description?: string | null
  requiresPasscode: boolean
  expiresAt?: string | null
  createdAt: string
  updatedAt: string
}

export type PdfWidgetSummary = {
  id: string
  title: string
  kind: string
  columns: string[]
  rows: Record<string, string | null>[]
  content?: string
}

export type GeneratePdfRequest = {
  title: string
  description?: string
  outputPath: string
  widgets: PdfWidgetSummary[]
}

/** Publishes or updates an executive public report via native Rust backend. */
export async function compileAndPublishReport(
  params: Omit<PublishReportRequest, 'cloudUrl'> & { cloudUrl?: string },
): Promise<PublishReportResponse> {
  const cloudUrl = params.cloudUrl || getCloudUrl()
  return invoke<PublishReportResponse>('compile_and_publish_report', {
    input: {
      ...params,
      cloudUrl,
    },
  })
}

/** Revokes a published report from Velox Cloud. */
export async function revokePublishedReport(slug: string, customCloudUrl?: string): Promise<void> {
  const cloudUrl = customCloudUrl || getCloudUrl()
  return invoke<void>('revoke_published_report', { slug, cloudUrl })
}

/** Compiles a native vector PDF report on desktop via printpdf. */
export async function generateReportPdf(input: GeneratePdfRequest): Promise<string> {
  return invoke<string>('generate_report_pdf', { input })
}
