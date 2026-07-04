import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  downloadPICSV,
  downloadPIPNG,
  DEFAULT_EXPORT_PNG_OPTIONS,
  type ExportPNGOptions,
} from '../pis'

// jsdom lacks these; the download helper creates an object URL and clicks an anchor.
const clickSpy = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(clickSpy)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  clickSpy.mockClear()
})

function mockResponse(opts: {
  ok?: boolean
  status?: number
  disposition?: string | null
}): Response {
  const headers = new Headers()
  if (opts.disposition) headers.set('Content-Disposition', opts.disposition)
  return {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    headers,
    blob: async () => new Blob(['data']),
  } as unknown as Response
}

describe('downloadPICSV', () => {
  it('fetches the CSV export endpoint with credentials', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse({ disposition: null }))

    await downloadPICSV('pi-1', 'Q1 2026')

    expect(fetch).toHaveBeenCalledWith('/api/v1/pis/pi-1/export/csv', { credentials: 'include' })
    expect(clickSpy).toHaveBeenCalledOnce()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })

  it('falls back to the PI name when no Content-Disposition is present', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse({ disposition: null }))
    const anchor = document.createElement('a')
    const createSpy = vi.spyOn(document, 'createElement').mockReturnValue(anchor)

    await downloadPICSV('pi-1', 'My PI')

    expect(anchor.download).toBe('My PI.csv')
    createSpy.mockRestore()
  })
})

describe('downloadPIPNG', () => {
  const allOn: ExportPNGOptions = {
    showPiEffort: true,
    showSprintEffort: true,
    showSwimlaneEffort: true,
    showEvents: true,
    swimlaneTextCenter: true,
    showExportDate: true,
  }

  it('encodes every option as a query param', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse({ disposition: null }))

    await downloadPIPNG('pi-9', 'Board', allOn)

    const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string, 'http://x')
    expect(url.pathname).toBe('/api/v1/pis/pi-9/export/png')
    expect(url.searchParams.get('show_pi_effort')).toBe('true')
    expect(url.searchParams.get('show_sprint_effort')).toBe('true')
    expect(url.searchParams.get('show_swimlane_effort')).toBe('true')
    expect(url.searchParams.get('show_events')).toBe('true')
    expect(url.searchParams.get('swimlane_text_center')).toBe('true')
    expect(url.searchParams.get('show_export_date')).toBe('true')
  })

  it('serializes false options as "false"', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse({ disposition: null }))

    await downloadPIPNG('pi-9', 'Board', DEFAULT_EXPORT_PNG_OPTIONS)

    const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string, 'http://x')
    expect(url.searchParams.get('show_pi_effort')).toBe('false')
    expect(url.searchParams.get('show_events')).toBe('false')
  })

  it('uses the filename from Content-Disposition when present', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockResponse({ disposition: 'attachment; filename="board-export.png"' }),
    )
    const anchor = document.createElement('a')
    const createSpy = vi.spyOn(document, 'createElement').mockReturnValue(anchor)

    await downloadPIPNG('pi-9', 'Board', DEFAULT_EXPORT_PNG_OPTIONS)

    expect(anchor.download).toBe('board-export.png')
    createSpy.mockRestore()
  })

  it('throws when the response is not ok', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse({ ok: false, status: 500 }))

    await expect(downloadPIPNG('pi-9', 'Board', DEFAULT_EXPORT_PNG_OPTIONS)).rejects.toThrow(
      'Export failed: 500',
    )
    expect(clickSpy).not.toHaveBeenCalled()
  })
})
