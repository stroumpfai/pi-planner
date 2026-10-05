import { api, errorDetail } from './api'
import type {
  CopyYearPreview,
  EntriesCreatedResult,
  HolidayCalendarCreate,
  HolidayCalendarDetail,
  HolidayCalendarSummary,
  HolidayCalendarUpdate,
  HolidayCleanup,
  HolidayEntry,
  HolidayEntryFields,
  HolidayEntryUpdate,
  IcsImportResult,
  PIHolidays,
  TeamHolidays,
} from '@/types'

/**
 * Shared holiday calendars (spec/public-holidays.md).
 *
 * A calendar belongs to no team, so its routes carry no team id and take no
 * edit lock; concurrency is the per-row ETag, which rides in each row's body
 * the way absences' does. The team's side — the switch, the exceptions, the
 * cleanup — lives under the team.
 */

const calendars = '/holiday-calendars'
const calendarUrl = (id: string) => `${calendars}/${id}`
const ifMatch = (etag: string) => ({ headers: { 'If-Match': etag } })

export type HolidayErrorCode =
  | 'CALENDAR_NAME_TAKEN'
  | 'CALENDAR_LIMIT_REACHED'
  | 'HOLIDAY_LIMIT_REACHED'
  | 'TEAM_CALENDAR_LIMIT_REACHED'
  | 'CALENDAR_NOT_ENABLED'
  | 'INVALID_HOLIDAY'
  | 'INVALID_ICS'
  | 'NOT_A_DUPLICATE'
  | 'STALE'

export function holidayErrorMessage(err: unknown, fallback: string): string {
  return errorDetail(err)?.message ?? fallback
}

export function holidayErrorCode(err: unknown): HolidayErrorCode | null {
  const code = errorDetail(err)?.error
  return (code as HolidayErrorCode | undefined) ?? null
}

export const holidayCalendarsApi = {
  list: () => api.get<HolidayCalendarSummary[]>(calendars).then((r) => r.data),

  get: (id: string, year?: number) =>
    api
      .get<HolidayCalendarDetail>(calendarUrl(id), { params: year ? { year } : undefined })
      .then((r) => r.data),

  create: (body: HolidayCalendarCreate) =>
    api.post<HolidayCalendarDetail>(calendars, body).then((r) => r.data),

  update: (id: string, body: HolidayCalendarUpdate, etag: string) =>
    api.patch<HolidayCalendarDetail>(calendarUrl(id), body, ifMatch(etag)).then((r) => r.data),

  delete: (id: string, etag: string) => api.delete(calendarUrl(id), ifMatch(etag)),

  createEntry: (id: string, body: HolidayEntryFields) =>
    api.post<HolidayEntry>(`${calendarUrl(id)}/entries`, body).then((r) => r.data),

  updateEntry: (id: string, entryId: string, body: HolidayEntryUpdate, etag: string) =>
    api
      .patch<HolidayEntry>(`${calendarUrl(id)}/entries/${entryId}`, body, ifMatch(etag))
      .then((r) => r.data),

  deleteEntry: (id: string, entryId: string, etag: string) =>
    api.delete(`${calendarUrl(id)}/entries/${entryId}`, ifMatch(etag)),

  previewCopyYear: (id: string, fromYear: number) =>
    api
      .get<CopyYearPreview>(`${calendarUrl(id)}/copy-year`, { params: { from_year: fromYear } })
      .then((r) => r.data),

  copyYear: (id: string, entries: HolidayEntryFields[]) =>
    api.post<EntriesCreatedResult>(`${calendarUrl(id)}/copy-year`, { entries }).then((r) => r.data),

  /** Merge an `.ics` file; `dryRun` previews without writing (§7.1). */
  importIcs: (id: string, file: File, options: { dryRun: boolean; fromYear: number; toYear: number }) => {
    const form = new FormData()
    form.append('file', file)
    return api
      .post<IcsImportResult>(`${calendarUrl(id)}/import/ics`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
        params: { dry_run: options.dryRun, from_year: options.fromYear, to_year: options.toYear },
      })
      .then((r) => r.data)
  },

  exportIcsUrl: (id: string) => `/api/v1${calendarUrl(id)}/export/ics`,
}

export const teamHolidaysApi = {
  get: (teamId: string, from: string, to: string) =>
    api.get<TeamHolidays>(`/teams/${teamId}/holidays`, { params: { from, to } }).then((r) => r.data),

  enable: (teamId: string, calendarId: string) =>
    api.put(`/teams/${teamId}/holiday-calendars/${calendarId}`),

  disable: (teamId: string, calendarId: string) =>
    api.delete(`/teams/${teamId}/holiday-calendars/${calendarId}`),

  /** The member works this day of the holiday (`works`), or is off after all. */
  setException: (teamId: string, memberId: string, entryId: string, day: string, works: boolean) => {
    const url = `/teams/${teamId}/members/${memberId}/holiday-exceptions/${entryId}/${day}`
    return works ? api.put(url) : api.delete(url)
  },

  cleanup: (teamId: string) =>
    api.get<HolidayCleanup>(`/teams/${teamId}/holiday-cleanup`).then((r) => r.data),

  applyCleanup: (teamId: string, absenceIds: string[]) =>
    api
      .post<{ deleted: number }>(`/teams/${teamId}/holiday-cleanup`, { absence_ids: absenceIds })
      .then((r) => r.data),
}

export const piHolidaysApi = {
  get: (piId: string) => api.get<PIHolidays>(`/pis/${piId}/holidays`).then((r) => r.data),
}
