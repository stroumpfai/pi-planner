import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ImportCSVModal } from '../ImportCSVModal'
import { useCsvImport, useCsvDryRun } from '@/hooks/useCsvImport'
import * as csvParser from '@/utils/csvParser'
import type { Feature, PBI, PI } from '@/types'

vi.mock('@/hooks/useCsvImport')
// Only the file-reading entry points are faked; selectImportRows stays real so the
// tests exercise the actual remove-with-parent rules.
vi.mock('@/utils/csvParser', async (importOriginal) => ({
  ...(await importOriginal<typeof csvParser>()),
  parseImportCSV: vi.fn(),
  buildPreview: vi.fn(),
}))

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const mutateAsync = vi.fn()
const dryRun = vi.fn()

const fakeParseResult: csvParser.ParseResult = {
  rows: [{ rowNumber: 2, itemType: 'story', userId: null, title: 'Auth', effort: null, parentId: null, state: 'New' }],
  totalRows: 1,
  removedCount: 0,
  removedItems: [],
  removedFeatureIds: [],
  childrenOfRemovedCount: 0,
  hasStateColumn: true,
  errors: [],
}

const fakePreview: csvParser.ImportPreview = {
  totalRows: 1,
  removedRows: 0,
  childrenRemovedWithParent: 0,
  featureCount: 0,
  storyCount: 1,
  orphanCount: 0,
  hasStateColumn: true,
  stateValues: ['New'],
  hasErrors: false,
  errors: [],
}

const okResult = {
  created_features: 0,
  created_stories: 1,
  updated_features: 0,
  updated_stories: 0,
  removed_features: 0,
  removed_stories: 0,
  orphan_stories: 0,
  orphan_stories_placed: 0,
  orphan_stories_existing: [],
}

function makeFeature(id: number, systemId: string, title: string): Feature {
  return { id, system_id: systemId, title } as unknown as Feature
}
function makePBI(id: number, systemId: string, title: string, parent: string): PBI {
  return { id, system_id: systemId, title, parent_feature_system_id: parent } as unknown as PBI
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(useCsvImport).mockReturnValue({ mutateAsync } as unknown as ReturnType<typeof useCsvImport>)
  // The review step asks the server what the import would do before it does it.
  dryRun.mockResolvedValue({ ...okResult, plan: [], plan_truncated: false })
  vi.mocked(useCsvDryRun).mockReturnValue(
    { mutateAsync: dryRun } as unknown as ReturnType<typeof useCsvDryRun>,
  )
  vi.mocked(csvParser.parseImportCSV).mockReturnValue(fakeParseResult)
  vi.mocked(csvParser.buildPreview).mockReturnValue(fakePreview)
})

// jsdom does not implement File.text() — create a minimal mock that does
function makeFile(content = 'item_type,title\nstory,Auth'): File {
  return {
    text: () => Promise.resolve(content),
    name: 'test.csv',
    type: 'text/csv',
    size: content.length,
    lastModified: Date.now(),
  } as unknown as File
}

const defaultProps = {
  projectId: 'p-1',
  features: [] as Feature[],
  pbis: [] as PBI[],
  pis: [] as PI[],
  onClose: vi.fn(),
}

/** Preview/reconcile now lead to a review of the server's plan before the import. */
async function reviewAndConfirm() {
  await userEvent.click(screen.getByRole('button', { name: /review changes/i }))
  // Confirm is disabled until the server's plan lands, so wait for it to enable.
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /confirm import/i })).toBeEnabled(),
  )
  await userEvent.click(screen.getByRole('button', { name: /confirm import/i }))
}

describe('ImportCSVModal', () => {
  it('shows "Import CSV" title when open', async () => {
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    expect(screen.getByText('Import CSV')).toBeInTheDocument()
    // The file is parsed asynchronously — let the preview land before the test ends.
    await screen.findByText('Rows in file')
  })

  it('shows preview table after file is parsed', async () => {
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText('Rows in file')).toBeInTheDocument())
    expect(screen.getByText('Stories to import')).toBeInTheDocument()
  })

  it('disables Confirm Import when preview has validation errors', async () => {
    vi.mocked(csvParser.buildPreview).mockReturnValue({
      ...fakePreview,
      hasErrors: true,
      errors: [{ row: 1, message: 'Bad row' }],
    })
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /review changes/i }))
    expect(screen.getByRole('button', { name: /review changes/i })).toBeDisabled()
  })

  it('shows validation error messages when preview has errors', async () => {
    vi.mocked(csvParser.buildPreview).mockReturnValue({
      ...fakePreview,
      hasErrors: true,
      errors: [{ row: 2, message: 'Missing title' }],
    })
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    await waitFor(() => expect(screen.getByText(/missing title/i)).toBeInTheDocument())
  })

  it('calls mutateAsync with parsed rows and empty removals when no matches exist', async () => {
    mutateAsync.mockResolvedValue(okResult)
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /review changes/i }))
    await reviewAndConfirm()
    expect(mutateAsync).toHaveBeenCalledWith({ rows: expect.any(Array), removals: [], has_state_column: true, apply_reparenting: false, apply_type_changes: false })
  })

  it('shows "Import complete" after successful import', async () => {
    mutateAsync.mockResolvedValue(okResult)
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /review changes/i }))
    await reviewAndConfirm()
    await waitFor(() => expect(screen.getByText(/import complete/i)).toBeInTheDocument())
  })

  it('stays on "Import complete" when features/pbis refetch after the import', async () => {
    mutateAsync.mockResolvedValue(okResult)
    const file = makeFile()
    const { rerender } = render(
      <ImportCSVModal {...defaultProps} open file={file} features={[]} pbis={[]} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByRole('button', { name: /review changes/i }))
    await reviewAndConfirm()
    await waitFor(() => expect(screen.getByText(/import complete/i)).toBeInTheDocument())

    // The import invalidates the features/pbis queries — the refetch hands the
    // modal fresh arrays. The result summary must survive that.
    rerender(<ImportCSVModal {...defaultProps} open file={file} features={[]} pbis={[]} />)
    await waitFor(() => expect(screen.getByText(/import complete/i)).toBeInTheDocument())
    expect(screen.queryByText('Import CSV')).not.toBeInTheDocument()
  })

  it('names the feature holding orphans that already exist, and where it lives', async () => {
    mutateAsync.mockResolvedValue({
      ...okResult,
      created_stories: 0,
      updated_stories: 3,
      orphan_stories: 3,
      orphan_stories_placed: 0,
      orphan_stories_existing: [{ feature_title: 'Unassigned', location: 'pi', count: 3 }],
    })
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /review changes/i }))
    await reviewAndConfirm()
    await waitFor(() => expect(screen.getByText(/import complete/i)).toBeInTheDocument())
    expect(screen.getByText(/already exist under "Unassigned"/i)).toBeInTheDocument()
    expect(screen.getByText(/on the PI board, not the backlog/i)).toBeInTheDocument()
    // Nothing was placed, so the placement line must not appear.
    expect(screen.queryByText(/placed in "Unassigned"/i)).not.toBeInTheDocument()
  })

  it('reports newly placed orphans separately from existing ones', async () => {
    mutateAsync.mockResolvedValue({
      ...okResult,
      orphan_stories: 2,
      orphan_stories_placed: 1,
      orphan_stories_existing: [{ feature_title: 'Auth Feature', location: 'backlog', count: 1 }],
    })
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /review changes/i }))
    await reviewAndConfirm()
    await waitFor(() => expect(screen.getByText(/import complete/i)).toBeInTheDocument())
    expect(screen.getByText(/1 orphan story placed in "Unassigned" feature/i)).toBeInTheDocument()
    expect(screen.getByText(/already exists under "Auth Feature" — left in the backlog/i)).toBeInTheDocument()
  })

  it('shows "Import failed" after server error', async () => {
    mutateAsync.mockRejectedValue({
      response: { data: { detail: { errors: [{ row: 1, message: 'Server error' }] } } },
    })
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /review changes/i }))
    await reviewAndConfirm()
    await waitFor(() => expect(screen.getByText(/import failed/i)).toBeInTheDocument())
    expect(screen.getByText(/server error/i)).toBeInTheDocument()
  })

  // ── Reconcile step ─────────────────────────────────────────────────────────

  it('shows the reconcile step when a Removed item matches an existing item', async () => {
    vi.mocked(csvParser.parseImportCSV).mockReturnValue({
      ...fakeParseResult,
      removedItems: [{ rowNumber: 2, itemType: 'feature', userId: 101, title: 'Gone', effort: null, parentId: null, state: '' }],
    })
    render(
      <ImportCSVModal {...defaultProps} open file={makeFile()} features={[makeFeature(101, 'feat-1', 'Existing')]} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    expect(screen.getByText(/removed items already in the project/i)).toBeInTheDocument()
  })

  it('keeps matched items by default (empty removals)', async () => {
    mutateAsync.mockResolvedValue(okResult)
    vi.mocked(csvParser.parseImportCSV).mockReturnValue({
      ...fakeParseResult,
      removedItems: [{ rowNumber: 2, itemType: 'feature', userId: 101, title: 'Gone', effort: null, parentId: null, state: '' }],
    })
    render(
      <ImportCSVModal {...defaultProps} open file={makeFile()} features={[makeFeature(101, 'feat-1', 'Existing')]} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await reviewAndConfirm()
    expect(mutateAsync).toHaveBeenCalledWith({ rows: expect.any(Array), removals: [], has_state_column: true, apply_reparenting: false, apply_type_changes: false })
  })

  it('includes the system_id in removals when an item is toggled to Remove', async () => {
    mutateAsync.mockResolvedValue(okResult)
    vi.mocked(csvParser.parseImportCSV).mockReturnValue({
      ...fakeParseResult,
      removedItems: [{ rowNumber: 2, itemType: 'feature', userId: 101, title: 'Gone', effort: null, parentId: null, state: '' }],
    })
    render(
      <ImportCSVModal {...defaultProps} open file={makeFile()} features={[makeFeature(101, 'feat-1', 'Existing')]} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('checkbox'))
    await reviewAndConfirm()
    expect(mutateAsync).toHaveBeenCalledWith({ rows: expect.any(Array), removals: ['feat-1'], has_state_column: true, apply_reparenting: false, apply_type_changes: false })
  })

  it('holds the plan on screen while the import runs', async () => {
    let release: (v: unknown) => void = () => {}
    mutateAsync.mockReturnValue(new Promise((resolve) => { release = resolve }))
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /review changes/i }))
    await reviewAndConfirm()

    // What was approved stays visible until it has actually happened.
    expect(screen.getByText(/what this import will do/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /importing/i })).toBeDisabled()
    expect(screen.queryByText(/removed items already in the project/i)).not.toBeInTheDocument()

    release(okResult)
    await waitFor(() => expect(screen.getByText(/import complete/i)).toBeInTheDocument())
  })

  it('shows the plan the server returns, and the reason a row is unchanged', async () => {
    dryRun.mockResolvedValue({
      ...okResult,
      plan: [
        { action: 'created', item_type: 'feature', user_id: 101, title: 'Auth', row: 2, changes: [], detail: null },
        { action: 'updated', item_type: 'story', user_id: 201, title: 'Login', row: 3, changes: [], detail: null },
        { action: 'deleted', item_type: 'story', user_id: 202, title: 'Gone', row: null, changes: [], detail: 'with its feature' },
      ],
      plan_truncated: false,
    })
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /review changes/i }))
    await userEvent.click(screen.getByRole('button', { name: /review changes/i }))

    await waitFor(() => expect(screen.getByText('Auth')).toBeInTheDocument())
    // Count and label are separate text nodes, so match on the whole chip.
    expect(screen.getByText((_, el) => el?.textContent === '1 new')).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.textContent === '1 deleted')).toBeInTheDocument()
    expect(screen.getByText('with its feature')).toBeInTheDocument()
  })

  // A refresh is mostly rows that match; listing each one buries the few that act.
  it('keeps rows that change nothing out of the way, but counted and reachable', async () => {
    dryRun.mockResolvedValue({
      ...okResult,
      plan: [
        { action: 'moved', item_type: 'story', user_id: 301, title: 'Carried', row: 4, changes: [], detail: 'Auth → Payments' },
        { action: 'updated', item_type: 'story', user_id: 201, title: 'Untouched one', row: 2, changes: [], detail: null },
        { action: 'updated', item_type: 'story', user_id: 202, title: 'Untouched two', row: 3, changes: [], detail: null },
      ],
      plan_truncated: false,
    })
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /review changes/i }))
    await userEvent.click(screen.getByRole('button', { name: /review changes/i }))

    await waitFor(() => expect(screen.getByText('Carried')).toBeInTheDocument())
    expect(screen.getByText((_, el) => el?.textContent === '2 unchanged')).toBeInTheDocument()
    expect(screen.queryByText('Untouched one')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /2 rows unchanged/i }))
    expect(screen.getByText('Untouched one')).toBeInTheDocument()
    expect(screen.getAllByText('no change')).toHaveLength(2)
  })

  it('says so plainly when the whole file is a no-op', async () => {
    dryRun.mockResolvedValue({
      ...okResult,
      plan: [
        { action: 'updated', item_type: 'story', user_id: 201, title: 'Untouched', row: 2, changes: [], detail: null },
      ],
      plan_truncated: false,
    })
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /review changes/i }))
    await userEvent.click(screen.getByRole('button', { name: /review changes/i }))

    await waitFor(() =>
      expect(screen.getByText(/every row in this file matches/i)).toBeInTheDocument(),
    )
  })

  it('sends the reviewed body unchanged when the import is confirmed', async () => {
    mutateAsync.mockResolvedValue(okResult)
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /review changes/i }))
    await reviewAndConfirm()

    // What was reviewed is what runs — otherwise the plan describes something else.
    expect(mutateAsync).toHaveBeenCalledWith(dryRun.mock.calls[0][0])
  })

  // ── Remove-with-parent ─────────────────────────────────────────────────────

  const removedFeatureWithChild = {
    ...fakeParseResult,
    rows: [
      { rowNumber: 3, itemType: 'story' as const, userId: 201, title: 'Child', effort: 3, parentId: 101, state: 'New' },
    ],
    removedItems: [{ rowNumber: 2, itemType: 'feature' as const, userId: 101, title: 'Gone', effort: null, parentId: null, state: '' }],
    removedFeatureIds: [101],
    childrenOfRemovedCount: 1,
  }

  it('drops the child rows of a Removed feature that is being removed', async () => {
    mutateAsync.mockResolvedValue(okResult)
    vi.mocked(csvParser.parseImportCSV).mockReturnValue(removedFeatureWithChild)
    render(
      <ImportCSVModal {...defaultProps} open file={makeFile()} features={[makeFeature(101, 'feat-1', 'Existing')]} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('checkbox'))
    await reviewAndConfirm()
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ rows: [], removals: ['feat-1'] }),
    )
  })

  it('imports the child rows of a Removed feature the user keeps', async () => {
    mutateAsync.mockResolvedValue(okResult)
    vi.mocked(csvParser.parseImportCSV).mockReturnValue(removedFeatureWithChild)
    render(
      <ImportCSVModal {...defaultProps} open file={makeFile()} features={[makeFeature(101, 'feat-1', 'Existing')]} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    // Kept by default — the child row must come along rather than vanish silently.
    expect(screen.getByText(/1 child row from this file/i)).toBeInTheDocument()
    await reviewAndConfirm()
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [expect.objectContaining({ user_id: 201, title: 'Child' })],
        removals: [], apply_reparenting: false, apply_type_changes: false,
      }),
    )
  })

  it('shows removed counts on the done step', async () => {
    mutateAsync.mockResolvedValue({ ...okResult, removed_features: 1, removed_stories: 2 })
    vi.mocked(csvParser.parseImportCSV).mockReturnValue({
      ...fakeParseResult,
      removedItems: [{ rowNumber: 2, itemType: 'feature', userId: 101, title: 'Gone', effort: null, parentId: null, state: '' }],
    })
    render(
      <ImportCSVModal {...defaultProps} open file={makeFile()} features={[makeFeature(101, 'feat-1', 'Existing')]} pbis={[makePBI(201, 'pbi-1', 'S', 'feat-9')]} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
    await reviewAndConfirm()
    await waitFor(() => expect(screen.getByText(/features removed/i)).toBeInTheDocument())
    expect(screen.getByText(/stories removed/i)).toBeInTheDocument()
  })

  // ── Reconcile: the true weight of a removal ────────────────────────────────

  function makeBoardFeature(
    id: number | null, systemId: string, title: string,
    opts: { piId?: string; continuedFrom?: string } = {},
  ): Feature {
    return {
      id, system_id: systemId, title,
      location: opts.piId ? 'pi' : 'backlog',
      pi_id: opts.piId ?? null,
      continued_from_feature_id: opts.continuedFrom ?? null,
    } as unknown as Feature
  }

  const removedFeature101 = {
    ...fakeParseResult,
    removedItems: [{ rowNumber: 2, itemType: 'feature' as const, userId: 101, title: 'Gone', effort: null, parentId: null, state: '' }],
    removedFeatureIds: [101],
  }

  const twoPIs = [
    { system_id: 'pi-1', name: 'PI-1' },
    { system_id: 'pi-2', name: 'PI-2' },
  ] as unknown as PI[]

  /** Feature 101 on PI-1, carried into PI-2, with 3 stories then 2. */
  const splitLineage = [
    makeBoardFeature(101, 'feat-1', 'Auth', { piId: 'pi-1' }),
    makeBoardFeature(null, 'feat-2', 'Auth', { piId: 'pi-2', continuedFrom: 'feat-1' }),
  ]
  const splitStories = [
    makePBI(201, 'pbi-1', 'S1', 'feat-1'),
    makePBI(202, 'pbi-2', 'S2', 'feat-1'),
    makePBI(203, 'pbi-3', 'S3', 'feat-1'),
    makePBI(204, 'pbi-4', 'S4', 'feat-2'),
    makePBI(205, 'pbi-5', 'S5', 'feat-2'),
  ]

  async function openReconcile(props: Partial<typeof defaultProps>) {
    render(
      <ImportCSVModal {...defaultProps} {...props} open file={makeFile()} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByRole('button', { name: /next/i }))
    await userEvent.click(screen.getByRole('button', { name: /next/i }))
  }

  it('names the PIs a removed feature spans', async () => {
    vi.mocked(csvParser.parseImportCSV).mockReturnValue(removedFeature101)
    await openReconcile({ features: splitLineage, pbis: splitStories, pis: twoPIs })
    expect(screen.getByText(/Feature on PI-1, PI-2/)).toBeInTheDocument()
  })

  it('says a backlog feature is in the backlog', async () => {
    vi.mocked(csvParser.parseImportCSV).mockReturnValue(removedFeature101)
    await openReconcile({ features: [makeBoardFeature(101, 'feat-1', 'Auth')], pis: twoPIs })
    expect(screen.getByText(/Feature in the backlog/)).toBeInTheDocument()
  })

  it('warns that a removal takes continuations and stories with it', async () => {
    vi.mocked(csvParser.parseImportCSV).mockReturnValue(removedFeature101)
    await openReconcile({ features: splitLineage, pbis: splitStories, pis: twoPIs })
    expect(screen.getByText(/takes.*1 later-PI part.*and.*5 stories/s)).toBeInTheDocument()
  })

  it('counts every item a ticked feature destroys, not the ticked rows', async () => {
    vi.mocked(csvParser.parseImportCSV).mockReturnValue(removedFeature101)
    await openReconcile({ features: splitLineage, pbis: splitStories, pis: twoPIs })
    await userEvent.click(screen.getByRole('checkbox'))
    // 1 feature + 1 continuation + 5 stories
    expect(screen.getByText(/7 items in total/)).toBeInTheDocument()
  })

  it('counts an unsplit backlog feature as just itself', async () => {
    vi.mocked(csvParser.parseImportCSV).mockReturnValue(removedFeature101)
    await openReconcile({ features: [makeBoardFeature(101, 'feat-1', 'Auth')], pis: twoPIs })
    await userEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByText(/1 items? in total/)).toBeInTheDocument()
  })

  // ── Re-parenting: offered, never silent ────────────────────────────────────

  const movedStory = {
    ...fakeParseResult,
    rows: [
      { rowNumber: 2, itemType: 'feature' as const, userId: 102, title: 'Payments', effort: null, parentId: null, state: '' },
      { rowNumber: 3, itemType: 'story' as const, userId: 201, title: 'Login form', effort: 3, parentId: 102, state: 'New' },
    ],
  }

  function movedStoryProject(opts: { placed?: boolean } = {}) {
    return {
      features: [
        makeBoardFeature(101, 'feat-1', 'Auth'),
        makeBoardFeature(102, 'feat-2', 'Payments'),
      ],
      pbis: [{
        id: 201, system_id: 'pbi-1', title: 'Login form',
        parent_feature_system_id: 'feat-1',
        group_id: opts.placed === true ? 'grp-1' : null,
      } as unknown as PBI],
    }
  }

  it('offers the move when a story names a different parent, unticked', async () => {
    vi.mocked(csvParser.parseImportCSV).mockReturnValue(movedStory)
    render(
      <ImportCSVModal {...defaultProps} {...movedStoryProject()} open file={makeFile()} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByText(/1 story has moved to a different feature/i))
    // The target feature is emphasised in its own span, so the line is split.
    expect(screen.getByText((_, el) =>
      el?.tagName === 'LI' && /\[201\].+Login form.+Auth.+→.+Payments/.test(el.textContent ?? ''),
    )).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).not.toBeChecked()
  })

  it('sends apply_reparenting only once the move is ticked', async () => {
    mutateAsync.mockResolvedValue(okResult)
    vi.mocked(csvParser.parseImportCSV).mockReturnValue(movedStory)
    render(
      <ImportCSVModal {...defaultProps} {...movedStoryProject()} open file={makeFile()} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('checkbox'))
    await reviewAndConfirm()
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ apply_reparenting: true }),
    )
  })

  it('warns that ticked moves cost a sprint placement', async () => {
    vi.mocked(csvParser.parseImportCSV).mockReturnValue(movedStory)
    render(
      <ImportCSVModal {...defaultProps} {...movedStoryProject({ placed: true })} open file={makeFile()} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByRole('checkbox'))
    expect(screen.queryByText(/lose that placement/i)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByText(/1 of.*placed in\s+a sprint and will lose that placement/is)).toBeInTheDocument()
  })

  it('offers nothing when the story is already under the named feature', async () => {
    vi.mocked(csvParser.parseImportCSV).mockReturnValue({
      ...movedStory,
      rows: [{ rowNumber: 3, itemType: 'story' as const, userId: 201, title: 'Login form', effort: 3, parentId: 101, state: 'New' }],
    })
    render(
      <ImportCSVModal {...defaultProps} {...movedStoryProject()} open file={makeFile()} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByRole('button', { name: /review changes/i }))
    expect(screen.queryByText(/moved to a different feature/i)).not.toBeInTheDocument()
  })

  it('treats a continuation of the named feature as no move at all', async () => {
    vi.mocked(csvParser.parseImportCSV).mockReturnValue({
      ...movedStory,
      rows: [{ rowNumber: 3, itemType: 'story' as const, userId: 201, title: 'Carried', effort: 3, parentId: 101, state: 'New' }],
    })
    render(
      <ImportCSVModal
        {...defaultProps}
        open
        file={makeFile()}
        features={[
          makeBoardFeature(101, 'feat-1', 'Auth', { piId: 'pi-1' }),
          makeBoardFeature(null, 'feat-1b', 'Auth', { piId: 'pi-2', continuedFrom: 'feat-1' }),
        ]}
        pbis={[{ id: 201, system_id: 'pbi-1', title: 'Carried', parent_feature_system_id: 'feat-1b', group_id: null } as unknown as PBI]}
      />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByRole('button', { name: /review changes/i }))
    expect(screen.queryByText(/moved to a different feature/i)).not.toBeInTheDocument()
  })

  // ── Type changes: promote on request, never demote ─────────────────────────

  const asFeatureRow = {
    ...fakeParseResult,
    rows: [{ rowNumber: 2, itemType: 'feature' as const, userId: 201, title: 'Login form', effort: null, parentId: null, state: '' }],
  }
  const asStoryRow = {
    ...fakeParseResult,
    rows: [{ rowNumber: 2, itemType: 'story' as const, userId: 101, title: 'Auth', effort: 3, parentId: null, state: '' }],
  }

  function typedProject(opts: { placed?: boolean } = {}) {
    return {
      features: [makeBoardFeature(101, 'feat-1', 'Auth')],
      pbis: [{
        id: 201, system_id: 'pbi-1', title: 'Login form',
        parent_feature_system_id: 'feat-1',
        group_id: opts.placed === true ? 'grp-1' : null,
      } as unknown as PBI],
    }
  }

  it('offers a promotion, unticked, when a story arrives as a feature', async () => {
    vi.mocked(csvParser.parseImportCSV).mockReturnValue(asFeatureRow)
    render(
      <ImportCSVModal {...defaultProps} {...typedProject()} open file={makeFile()} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByText(/1 story is a feature in this file/i))
    expect(screen.getByRole('checkbox')).not.toBeChecked()
    expect(screen.getByText(/Login form: story → feature/)).toBeInTheDocument()
  })

  it('sends apply_type_changes only once the promotion is ticked', async () => {
    mutateAsync.mockResolvedValue(okResult)
    vi.mocked(csvParser.parseImportCSV).mockReturnValue(asFeatureRow)
    render(
      <ImportCSVModal {...defaultProps} {...typedProject()} open file={makeFile()} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('checkbox'))
    await reviewAndConfirm()
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ apply_type_changes: true }),
    )
  })

  it('warns that promoting a placed story costs its sprint', async () => {
    vi.mocked(csvParser.parseImportCSV).mockReturnValue(asFeatureRow)
    render(
      <ImportCSVModal {...defaultProps} {...typedProject({ placed: true })} open file={makeFile()} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByRole('checkbox'))
    await userEvent.click(screen.getByRole('checkbox'))
    expect(screen.getByText(/A feature is not placed in a sprint, so that placement goes/i)).toBeInTheDocument()
  })

  it('reports a demotion without offering it, and shows no checkbox', async () => {
    vi.mocked(csvParser.parseImportCSV).mockReturnValue(asStoryRow)
    render(
      <ImportCSVModal {...defaultProps} {...typedProject()} open file={makeFile()} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByText(/1 feature is a story in this file/i))
    expect(screen.getByText(/Not converted/i)).toBeInTheDocument()
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
  })

  it('offers nothing when the type is unchanged', async () => {
    vi.mocked(csvParser.parseImportCSV).mockReturnValue({
      ...fakeParseResult,
      rows: [{ rowNumber: 2, itemType: 'story' as const, userId: 201, title: 'Login form', effort: 3, parentId: null, state: '' }],
    })
    render(
      <ImportCSVModal {...defaultProps} {...typedProject()} open file={makeFile()} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByRole('button', { name: /review changes/i }))
    expect(screen.queryByText(/in this file/i)).not.toBeInTheDocument()
  })
})
