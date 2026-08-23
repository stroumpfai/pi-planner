import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ImportCSVModal } from '../ImportCSVModal'
import { useCsvImport } from '@/hooks/useCsvImport'
import * as csvParser from '@/utils/csvParser'
import type { Feature, PBI } from '@/types'

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
  vi.mocked(useCsvImport).mockReturnValue({ mutateAsync } as ReturnType<typeof useCsvImport>)
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
  onClose: vi.fn(),
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
    await waitFor(() => screen.getByRole('button', { name: /confirm import/i }))
    expect(screen.getByRole('button', { name: /confirm import/i })).toBeDisabled()
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
    await waitFor(() => screen.getByRole('button', { name: /confirm import/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm import/i }))
    expect(mutateAsync).toHaveBeenCalledWith({ rows: expect.any(Array), removals: [], has_state_column: true })
  })

  it('shows "Import complete" after successful import', async () => {
    mutateAsync.mockResolvedValue(okResult)
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /confirm import/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm import/i }))
    await waitFor(() => expect(screen.getByText(/import complete/i)).toBeInTheDocument())
  })

  it('stays on "Import complete" when features/pbis refetch after the import', async () => {
    mutateAsync.mockResolvedValue(okResult)
    const file = makeFile()
    const { rerender } = render(
      <ImportCSVModal {...defaultProps} open file={file} features={[]} pbis={[]} />,
      { wrapper: makeWrapper() },
    )
    await waitFor(() => screen.getByRole('button', { name: /confirm import/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm import/i }))
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
    await waitFor(() => screen.getByRole('button', { name: /confirm import/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm import/i }))
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
    await waitFor(() => screen.getByRole('button', { name: /confirm import/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm import/i }))
    await waitFor(() => expect(screen.getByText(/import complete/i)).toBeInTheDocument())
    expect(screen.getByText(/1 orphan story placed in "Unassigned" feature/i)).toBeInTheDocument()
    expect(screen.getByText(/already exists under "Auth Feature" — left in the backlog/i)).toBeInTheDocument()
  })

  it('shows "Import failed" after server error', async () => {
    mutateAsync.mockRejectedValue({
      response: { data: { detail: { errors: [{ row: 1, message: 'Server error' }] } } },
    })
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /confirm import/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm import/i }))
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
    await userEvent.click(screen.getByRole('button', { name: /confirm import/i }))
    expect(mutateAsync).toHaveBeenCalledWith({ rows: expect.any(Array), removals: [], has_state_column: true })
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
    await userEvent.click(screen.getByRole('button', { name: /confirm import/i }))
    expect(mutateAsync).toHaveBeenCalledWith({ rows: expect.any(Array), removals: ['feat-1'], has_state_column: true })
  })

  it('stays on the preview screen while importing when there is nothing to reconcile', async () => {
    let release: (v: unknown) => void = () => {}
    mutateAsync.mockReturnValue(new Promise((resolve) => { release = resolve }))
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /confirm import/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm import/i }))

    // The reconcile heading has no list to show here — it must not flash up.
    expect(screen.queryByText(/removed items already in the project/i)).not.toBeInTheDocument()
    expect(screen.getByText(/import csv/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /importing/i })).toBeDisabled()

    release(okResult)
    await waitFor(() => expect(screen.getByText(/import complete/i)).toBeInTheDocument())
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
    await userEvent.click(screen.getByRole('button', { name: /confirm import/i }))
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
    await userEvent.click(screen.getByRole('button', { name: /confirm import/i }))
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        rows: [expect.objectContaining({ user_id: 201, title: 'Child' })],
        removals: [],
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
    await userEvent.click(screen.getByRole('button', { name: /confirm import/i }))
    await waitFor(() => expect(screen.getByText(/features removed/i)).toBeInTheDocument())
    expect(screen.getByText(/stories removed/i)).toBeInTheDocument()
  })
})
