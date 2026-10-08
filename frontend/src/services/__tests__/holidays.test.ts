import { vi, describe, it, expect, beforeEach, type Mock } from 'vitest'
import { AxiosError, AxiosHeaders } from 'axios'
import {
  holidayCalendarsApi,
  holidayErrorCode,
  holidayErrorMessage,
  piHolidaysApi,
  teamHolidaysApi,
} from '../holidays'
import * as apiModule from '../api'

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof apiModule>()
  return { ...actual, api: { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() } }
})

const api = apiModule.api as unknown as Record<'get' | 'post' | 'put' | 'patch' | 'delete', Mock>

function apiError(detail: unknown) {
  return new AxiosError('409', '409', undefined, undefined, {
    status: 409, statusText: '', headers: {}, config: { headers: new AxiosHeaders() },
    data: { detail },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const method of [api.get, api.post, api.put, api.patch, api.delete]) {
    method.mockImplementation(() => Promise.resolve({ data: { ok: true } }))
  }
})

describe('holidayErrorMessage / holidayErrorCode', () => {
  it("reads the server's structured detail", () => {
    const err = apiError({ error: 'CALENDAR_NAME_TAKEN', message: 'That name is taken' })
    expect(holidayErrorMessage(err, 'fallback')).toBe('That name is taken')
    expect(holidayErrorCode(err)).toBe('CALENDAR_NAME_TAKEN')
  })

  it('falls back when the error carries no structured detail', () => {
    expect(holidayErrorMessage(new Error('Network Error'), 'fallback')).toBe('fallback')
    expect(holidayErrorCode(new Error('Network Error'))).toBeNull()
    expect(holidayErrorMessage(apiError('plain string'), 'fallback')).toBe('fallback')
    expect(holidayErrorCode(apiError('plain string'))).toBeNull()
  })

  it('falls back when the detail has a code but no message', () => {
    expect(holidayErrorMessage(apiError({ error: 'STALE' }), 'fallback')).toBe('fallback')
  })
})

describe('holidayCalendarsApi', () => {
  it('lists and reads calendars, passing the year only when given', async () => {
    await expect(holidayCalendarsApi.list()).resolves.toEqual({ ok: true })
    expect(api.get).toHaveBeenCalledWith('/holiday-calendars')

    await holidayCalendarsApi.get('c-1', 2026)
    expect(api.get).toHaveBeenLastCalledWith('/holiday-calendars/c-1', { params: { year: 2026 } })
    await holidayCalendarsApi.get('c-1')
    expect(api.get).toHaveBeenLastCalledWith('/holiday-calendars/c-1', { params: undefined })
  })

  it('creates, updates and deletes a calendar, quoting the ETag on writes to a row', async () => {
    await expect(holidayCalendarsApi.create({ name: 'CH' })).resolves.toEqual({ ok: true })
    expect(api.post).toHaveBeenCalledWith('/holiday-calendars', { name: 'CH' })

    await expect(holidayCalendarsApi.update('c-1', { name: 'CH-ZH' }, '"e1"')).resolves.toEqual({ ok: true })
    expect(api.patch).toHaveBeenCalledWith('/holiday-calendars/c-1', { name: 'CH-ZH' }, { headers: { 'If-Match': '"e1"' } })

    await holidayCalendarsApi.delete('c-1', '"e2"')
    expect(api.delete).toHaveBeenCalledWith('/holiday-calendars/c-1', { headers: { 'If-Match': '"e2"' } })
  })

  it('creates, updates and deletes an entry', async () => {
    const fields = { label: 'Xmas', start_date: '2026-12-25' }
    await expect(holidayCalendarsApi.createEntry('c-1', fields)).resolves.toEqual({ ok: true })
    expect(api.post).toHaveBeenCalledWith('/holiday-calendars/c-1/entries', fields)

    await expect(holidayCalendarsApi.updateEntry('c-1', 'e-1', { label: 'Christmas' }, '"x"')).resolves.toEqual({ ok: true })
    expect(api.patch).toHaveBeenCalledWith(
      '/holiday-calendars/c-1/entries/e-1', { label: 'Christmas' }, { headers: { 'If-Match': '"x"' } },
    )

    await holidayCalendarsApi.deleteEntry('c-1', 'e-1', '"y"')
    expect(api.delete).toHaveBeenCalledWith('/holiday-calendars/c-1/entries/e-1', { headers: { 'If-Match': '"y"' } })
  })

  it('previews and applies a copy-year', async () => {
    await expect(holidayCalendarsApi.previewCopyYear('c-1', 2026)).resolves.toEqual({ ok: true })
    expect(api.get).toHaveBeenCalledWith('/holiday-calendars/c-1/copy-year', { params: { from_year: 2026 } })

    const entries = [{ label: 'NY', start_date: '2027-01-01' }]
    await expect(holidayCalendarsApi.copyYear('c-1', entries)).resolves.toEqual({ ok: true })
    expect(api.post).toHaveBeenCalledWith('/holiday-calendars/c-1/copy-year', { entries })
  })

  it('uploads an .ics as multipart with the dry-run flag and the year range', async () => {
    const file = new File(['BEGIN:VCALENDAR'], 'ch.ics')
    await expect(holidayCalendarsApi.importIcs('c-1', file, { dryRun: true, fromYear: 2026, toYear: 2027 }))
      .resolves.toEqual({ ok: true })
    const [url, form, config] = api.post.mock.calls[0] as [string, FormData, unknown]
    expect(url).toBe('/holiday-calendars/c-1/import/ics')
    expect(form.get('file')).toBe(file)
    expect(config).toEqual({
      headers: { 'Content-Type': 'multipart/form-data' },
      params: { dry_run: true, from_year: 2026, to_year: 2027 },
    })
  })

  it('builds the export link under /api/v1', () => {
    expect(holidayCalendarsApi.exportIcsUrl('c-1')).toBe('/api/v1/holiday-calendars/c-1/export/ics')
  })
})

describe('teamHolidaysApi', () => {
  it("reads a team's holidays over a window", async () => {
    await expect(teamHolidaysApi.get('t-1', '2026-01-01', '2026-03-31')).resolves.toEqual({ ok: true })
    expect(api.get).toHaveBeenCalledWith('/teams/t-1/holidays', { params: { from: '2026-01-01', to: '2026-03-31' } })
  })

  it('enables with PUT and disables with DELETE', async () => {
    await teamHolidaysApi.enable('t-1', 'c-1')
    expect(api.put).toHaveBeenCalledWith('/teams/t-1/holiday-calendars/c-1')
    await teamHolidaysApi.disable('t-1', 'c-1')
    expect(api.delete).toHaveBeenCalledWith('/teams/t-1/holiday-calendars/c-1')
  })

  it('marks a member as working a holiday with PUT, and clears the mark with DELETE', async () => {
    const url = '/teams/t-1/members/m-1/holiday-exceptions/e-1/2026-08-01'
    await teamHolidaysApi.setException('t-1', 'm-1', 'e-1', '2026-08-01', true)
    expect(api.put).toHaveBeenCalledWith(url)
    expect(api.delete).not.toHaveBeenCalled()
    await teamHolidaysApi.setException('t-1', 'm-1', 'e-1', '2026-08-01', false)
    expect(api.delete).toHaveBeenCalledWith(url)
  })

  it('lists and applies the duplicate-absence cleanup', async () => {
    await expect(teamHolidaysApi.cleanup('t-1')).resolves.toEqual({ ok: true })
    expect(api.get).toHaveBeenCalledWith('/teams/t-1/holiday-cleanup')
    await expect(teamHolidaysApi.applyCleanup('t-1', ['a-1', 'a-2'])).resolves.toEqual({ ok: true })
    expect(api.post).toHaveBeenCalledWith('/teams/t-1/holiday-cleanup', { absence_ids: ['a-1', 'a-2'] })
  })
})

describe('piHolidaysApi', () => {
  it("reads a PI's sprint holiday chips", async () => {
    await expect(piHolidaysApi.get('pi-1')).resolves.toEqual({ ok: true })
    expect(api.get).toHaveBeenCalledWith('/pis/pi-1/holidays')
  })
})
