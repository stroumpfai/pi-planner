import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { holidayCalendarsApi, piHolidaysApi, teamHolidaysApi } from '@/services/holidays'
import type {
  HolidayCalendarCreate,
  HolidayCalendarUpdate,
  HolidayEntryFields,
  HolidayEntryUpdate,
} from '@/types'

/**
 * A calendar edit moves every team that enables it, and their capacity with it,
 * so a write here refreshes the calendar caches **and** every team's holiday and
 * capacity caches. The app-wide stream (useHolidayCalendarsSSE) does the same for
 * everyone else watching; this is the writer's own immediate refresh.
 */
export function invalidateHolidays(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: ['holidayCalendars'] })
  qc.invalidateQueries({ queryKey: ['holidayCalendar'] })
  qc.invalidateQueries({ queryKey: ['teamHolidays'] })
  qc.invalidateQueries({ queryKey: ['holidayCleanup'] })
  qc.invalidateQueries({ queryKey: ['teamCapacity'] })
  qc.invalidateQueries({ queryKey: ['team-achievement'] })
  qc.invalidateQueries({ queryKey: ['piHolidays'] })
  qc.invalidateQueries({ queryKey: ['teamCapacityStatus'] })
}

export const useHolidayCalendars = () =>
  useQuery({ queryKey: ['holidayCalendars'], queryFn: holidayCalendarsApi.list })

export const useHolidayCalendar = (id: string, year?: number) =>
  useQuery({
    queryKey: ['holidayCalendar', id, year ?? null],
    queryFn: () => holidayCalendarsApi.get(id, year),
    enabled: id !== '',
  })

function useHolidayMutation<A, R>(fn: (args: A) => Promise<R>) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: () => invalidateHolidays(qc),
    onError: () => invalidateHolidays(qc),
  })
}

export const useCreateHolidayCalendar = () =>
  useHolidayMutation((body: HolidayCalendarCreate) => holidayCalendarsApi.create(body))

export const useUpdateHolidayCalendar = () =>
  useHolidayMutation(({ id, body, etag }: { id: string; body: HolidayCalendarUpdate; etag: string }) =>
    holidayCalendarsApi.update(id, body, etag),
  )

export const useDeleteHolidayCalendar = () =>
  useHolidayMutation(({ id, etag }: { id: string; etag: string }) => holidayCalendarsApi.delete(id, etag))

export const useCreateHolidayEntry = (calendarId: string) =>
  useHolidayMutation((body: HolidayEntryFields) => holidayCalendarsApi.createEntry(calendarId, body))

export const useUpdateHolidayEntry = (calendarId: string) =>
  useHolidayMutation(({ entryId, body, etag }: { entryId: string; body: HolidayEntryUpdate; etag: string }) =>
    holidayCalendarsApi.updateEntry(calendarId, entryId, body, etag),
  )

export const useDeleteHolidayEntry = (calendarId: string) =>
  useHolidayMutation(({ entryId, etag }: { entryId: string; etag: string }) =>
    holidayCalendarsApi.deleteEntry(calendarId, entryId, etag),
  )

export const useCopyYear = (calendarId: string) =>
  useHolidayMutation((entries: HolidayEntryFields[]) => holidayCalendarsApi.copyYear(calendarId, entries))

/** Keyed by team **and window**, as absences are: the window is part of the answer. */
export const useTeamHolidays = (teamId: string, from: string, to: string) =>
  useQuery({
    queryKey: ['teamHolidays', teamId, from, to],
    queryFn: () => teamHolidaysApi.get(teamId, from, to),
    enabled: teamId !== '',
  })

export const useSetCalendarEnabled = (teamId: string) =>
  useHolidayMutation(({ calendarId, enabled }: { calendarId: string; enabled: boolean }) =>
    enabled ? teamHolidaysApi.enable(teamId, calendarId) : teamHolidaysApi.disable(teamId, calendarId),
  )

export const useSetHolidayException = (teamId: string) =>
  useHolidayMutation(
    ({ memberId, entryId, day, works }: { memberId: string; entryId: string; day: string; works: boolean }) =>
      teamHolidaysApi.setException(teamId, memberId, entryId, day, works),
  )

export const useHolidayCleanup = (teamId: string, enabled: boolean) =>
  useQuery({
    queryKey: ['holidayCleanup', teamId],
    queryFn: () => teamHolidaysApi.cleanup(teamId),
    enabled: enabled && teamId !== '',
  })

export const useApplyHolidayCleanup = (teamId: string) => {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (absenceIds: string[]) => teamHolidaysApi.applyCleanup(teamId, absenceIds),
    onSuccess: () => {
      invalidateHolidays(qc)
      qc.invalidateQueries({ queryKey: ['absences', teamId] })
    },
  })
}

/**
 * The PI board's holiday chips (§8.1).
 *
 * Calendar and switch writes broadcast on team channels, which a board does not
 * listen to, so the chips refresh on the board's own sprint events and on a
 * short stale time rather than live.
 */
export const usePIHolidays = (piId: string) =>
  useQuery({
    queryKey: ['piHolidays', piId],
    queryFn: () => piHolidaysApi.get(piId),
    enabled: piId !== '',
    staleTime: 60 * 1000,
  })
