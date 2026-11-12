import { invoke } from '@tauri-apps/api/core'

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

/** Compiles a native vector PDF report on desktop via printpdf. */
export async function generateReportPdf(input: GeneratePdfRequest): Promise<string> {
  return invoke<string>('generate_report_pdf', { input })
}
