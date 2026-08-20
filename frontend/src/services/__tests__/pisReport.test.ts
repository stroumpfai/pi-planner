import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { downloadPIReport, DEFAULT_REPORT_OPTIONS, type ReportOptions } from '../pis'

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

describe('downloadPIReport', () => {
  it('encodes report_type, fmt and show_ids as query params', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse({ disposition: null }))
    const opts: ReportOptions = {
      ...DEFAULT_REPORT_OPTIONS,
      reportType: 'readout',
      format: 'pdf',
      showIds: false,
    }

    await downloadPIReport('pi-7', 'Board', opts)

    const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string, 'http://x')
    expect(url.pathname).toBe('/api/v1/pis/pi-7/report')
    expect(url.searchParams.get('report_type')).toBe('readout')
    expect(url.searchParams.get('fmt')).toBe('pdf')
    expect(url.searchParams.get('show_ids')).toBe('false')
    expect(fetch).toHaveBeenCalledWith(expect.any(String), { credentials: 'include' })
  })

  it('encodes the breakdown-only show_states and include_unplaced params', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse({ disposition: null }))
    const opts: ReportOptions = {
      reportType: 'breakdown',
      format: 'markdown',
      showIds: true,
      showStates: false,
      includeUnplaced: false,
    }

    await downloadPIReport('pi-7', 'Board', opts)

    const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string, 'http://x')
    expect(url.searchParams.get('report_type')).toBe('breakdown')
    expect(url.searchParams.get('show_states')).toBe('false')
    expect(url.searchParams.get('include_unplaced')).toBe('false')
  })

  it('defaults show_states and include_unplaced to true', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse({ disposition: null }))

    await downloadPIReport('pi-7', 'Board', DEFAULT_REPORT_OPTIONS)

    const url = new URL(vi.mocked(fetch).mock.calls[0][0] as string, 'http://x')
    expect(url.searchParams.get('show_states')).toBe('true')
    expect(url.searchParams.get('include_unplaced')).toBe('true')
  })

  it('uses a .md fallback filename for the breakdown report', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse({ disposition: null }))
    const anchor = document.createElement('a')
    const createSpy = vi.spyOn(document, 'createElement').mockReturnValue(anchor)

    await downloadPIReport('pi-7', 'My PI', {
      ...DEFAULT_REPORT_OPTIONS,
      reportType: 'breakdown',
    })

    expect(anchor.download).toBe('My PI-breakdown.md')
    createSpy.mockRestore()
  })

  it('defaults to a readiness markdown filename', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse({ disposition: null }))
    const anchor = document.createElement('a')
    const createSpy = vi.spyOn(document, 'createElement').mockReturnValue(anchor)

    await downloadPIReport('pi-7', 'My PI', DEFAULT_REPORT_OPTIONS)

    expect(anchor.download).toBe('My PI-readiness.md')
    createSpy.mockRestore()
  })

  it('uses a .pdf fallback filename for pdf format', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse({ disposition: null }))
    const anchor = document.createElement('a')
    const createSpy = vi.spyOn(document, 'createElement').mockReturnValue(anchor)

    await downloadPIReport('pi-7', 'My PI', {
      ...DEFAULT_REPORT_OPTIONS,
      reportType: 'readout',
      format: 'pdf',
    })

    expect(anchor.download).toBe('My PI-readout.pdf')
    createSpy.mockRestore()
  })

  it('prefers the filename from Content-Disposition when present', async () => {
    vi.mocked(fetch).mockResolvedValue(
      mockResponse({ disposition: 'attachment; filename="PI_2024.1-readiness.md"' }),
    )
    const anchor = document.createElement('a')
    const createSpy = vi.spyOn(document, 'createElement').mockReturnValue(anchor)

    await downloadPIReport('pi-7', 'ignored', DEFAULT_REPORT_OPTIONS)

    expect(anchor.download).toBe('PI_2024.1-readiness.md')
    createSpy.mockRestore()
  })

  it('throws when the response is not ok', async () => {
    vi.mocked(fetch).mockResolvedValue(mockResponse({ ok: false, status: 500 }))

    await expect(downloadPIReport('pi-7', 'Board', DEFAULT_REPORT_OPTIONS)).rejects.toThrow(
      'Export failed: 500',
    )
    expect(clickSpy).not.toHaveBeenCalled()
  })
})
