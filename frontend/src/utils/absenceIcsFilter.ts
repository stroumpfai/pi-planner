import type { AbsenceImportCandidate } from '@/types'

/**
 * Narrowing a long `.ics` preview to the rows worth looking at (teams.md §7.4.1).
 *
 * A team calendar export runs to hundreds of events, most of them other
 * people's, plus birthdays and meetings. The dialog keeps every row and its
 * tick; these functions only decide which rows are *shown*. That split is what
 * lets "Deselect 34 shown" mean exactly the 34 on screen, and lets the footer
 * count ticks the filters are hiding.
 *
 * Pure functions over plain data, so the rules are tested without a dialog.
 */

export type ImportStatus = NonNullable<AbsenceImportCandidate['action']>
export type ImportRepeats = AbsenceImportCandidate['repeats']
/** Rows the server matched to a member, rows it matched to nobody, or both. */
export type ImportWho = 'matched' | 'unmatched' | 'all'

export interface ImportFilter {
  readonly search: string
  /**
   * Narrows like every other chip. Defaults to `matched`: in a team file the
   * unmatched rows are mostly someone else's.
   */
  readonly who: ImportWho
  /** Empty means every status. An unmatched row counts as `create`. */
  readonly statuses: readonly ImportStatus[]
  /** Empty means every kind. */
  readonly repeats: readonly ImportRepeats[]
  /**
   * The rows that were ticked when *Ticked only* was pressed, or `null` when it
   * is off. A snapshot rather than a live test, so unticking a row on that list
   * leaves it there to be ticked again — a live filter would make it vanish
   * under the pointer.
   */
  readonly tickedOnly: readonly number[] | null
  /** In team mode: only rows given to this member. Empty means everyone. */
  readonly memberId: string
  /** ISO dates; empty leaves that side open. Only the list narrows — never the import. */
  readonly from: string
  readonly to: string
}

export const NO_FILTER: ImportFilter = {
  search: '',
  who: 'matched',
  statuses: [],
  repeats: [],
  tickedOnly: null,
  memberId: '',
  from: '',
  to: '',
}

/** The rows' current choices, as the dialog holds them — keyed by candidate index. */
export interface RowChoices {
  readonly ticked: Readonly<Record<number, boolean>>
  readonly assigned: Readonly<Record<number, string>>
}

const fold = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLocaleLowerCase()

/** "birthday, Geburtstag\nAnniversary" → the words, folded, blanks dropped. */
export function parseExcludeWords(text: string): string[] {
  return [...new Set(text.split(/[,;\n]/).map((word) => fold(word.trim())).filter(Boolean))]
}

export function isExcluded(candidate: AbsenceImportCandidate, words: readonly string[]): boolean {
  if (words.length === 0) return false
  const title = fold(candidate.title)
  return words.some((word) => title.includes(word))
}

/** The last day a row touches, or `null` for a rule that runs on. */
function lastDay(candidate: AbsenceImportCandidate): string | null {
  const { rule } = candidate
  if (rule.kind === 'range') return rule.end_date ?? rule.start_date
  return rule.end_date ?? null
}

/** Whether a row reaches into `[from, to]`. A recurring rule counts from its anchor. */
export function overlaps(candidate: AbsenceImportCandidate, from: string, to: string): boolean {
  const last = lastDay(candidate)
  if (from && last !== null && last < from) return false
  if (to && candidate.rule.start_date > to) return false
  return true
}

/**
 * The indices of the rows the filter shows, in date order.
 *
 * Excluded rows are never shown: the exclude words are a standing "not leave"
 * list, and there is no filter for reaching them other than editing the words.
 */
export function shownRows(
  candidates: readonly AbsenceImportCandidate[],
  choices: RowChoices,
  filter: ImportFilter,
  excludeWords: readonly string[],
  nameOf: (memberId: string) => string,
): number[] {
  const search = fold(filter.search.trim())
  return candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate, index }) => {
      if (isExcluded(candidate, excludeWords)) return false
      if (filter.who === 'matched' && candidate.member_id === null) return false
      if (filter.who === 'unmatched' && candidate.member_id !== null) return false
      const assigned = choices.assigned[index] ?? ''
      if (filter.memberId && assigned !== filter.memberId) return false
      if (filter.statuses.length > 0 && !filter.statuses.includes(candidate.action ?? 'create')) return false
      if (filter.repeats.length > 0 && !filter.repeats.includes(candidate.repeats)) return false
      if (filter.tickedOnly && !filter.tickedOnly.includes(index)) return false
      if (!overlaps(candidate, filter.from, filter.to)) return false
      if (search) {
        const haystack = fold(`${candidate.title} ${assigned ? nameOf(assigned) : ''}`)
        if (!haystack.includes(search)) return false
      }
      return true
    })
    .sort((a, b) => a.candidate.rule.start_date.localeCompare(b.candidate.rule.start_date) || a.index - b.index)
    .map(({ index }) => index)
}

/** The rows ticked right now: the snapshot *Ticked only* takes when pressed. */
export function tickedIndices(choices: RowChoices): number[] {
  return Object.entries(choices.ticked).filter(([, on]) => on).map(([index]) => Number(index))
}

/**
 * What each chip would show if pressed alone, under every *other* filter.
 *
 * Counted per facet, not over the whole file: a count that ignored the search
 * would promise rows a click doesn't deliver. It also answers "where did my
 * search hit go?" — a match among the unmatched rows shows on that chip.
 */
export function facetCounts(
  candidates: readonly AbsenceImportCandidate[],
  choices: RowChoices,
  filter: ImportFilter,
  excludeWords: readonly string[],
  nameOf: (memberId: string) => string,
) {
  const count = (patch: Partial<ImportFilter>) =>
    shownRows(candidates, choices, { ...filter, ...patch }, excludeWords, nameOf).length
  const facet = <K extends string>(options: readonly K[], patch: (option: K) => Partial<ImportFilter>) =>
    Object.fromEntries(
      options.map((option) => [option, count(patch(option))] as const).filter(([, n]) => n > 0),
    ) as Partial<Record<K, number>>
  return {
    who: {
      matched: count({ who: 'matched' }),
      unmatched: count({ who: 'unmatched' }),
      all: count({ who: 'all' }),
    },
    status: facet<ImportStatus>(['create', 'update', 'unchanged'], (status) => ({ statuses: [status] })),
    repeats: facet<ImportRepeats>(['single', 'weekly', 'yearly'], (kind) => ({ repeats: [kind] })),
  }
}

/** The file as a whole, before any filter: how much the exclude words removed, and how many rows matched nobody. */
export function counts(candidates: readonly AbsenceImportCandidate[], excludeWords: readonly string[]) {
  const kept = candidates.filter((c) => !isExcluded(c, excludeWords))
  return {
    total: candidates.length,
    excluded: candidates.length - kept.length,
    unmatched: kept.filter((c) => c.member_id === null).length,
  }
}
