import { vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ImportCSVModal } from '../ImportCSVModal'
import { useCsvImport } from '@/hooks/useCsvImport'
import * as csvParser from '@/utils/csvParser'

vi.mock('@/hooks/useCsvImport')
vi.mock('@/utils/csvParser')

const makeWrapper = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  )
}

const mutateAsync = vi.fn()

const fakeParseResult: csvParser.ParseResult = {
  rows: [{ rowNumber: 2, itemType: 'story', userId: null, title: 'Auth', effort: null, parentId: null }],
  totalRows: 1,
  removedCount: 0,
  errors: [],
}

const fakePreview: csvParser.ImportPreview = {
  totalRows: 1,
  removedRows: 0,
  featureCount: 0,
  storyCount: 1,
  orphanCount: 0,
  hasErrors: false,
  errors: [],
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
  onClose: vi.fn(),
}

describe('ImportCSVModal', () => {
  it('shows "Import CSV" title when open', () => {
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    expect(screen.getByText('Import CSV')).toBeInTheDocument()
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

  it('calls mutateAsync with parsed rows when Confirm Import is clicked', async () => {
    mutateAsync.mockResolvedValue({
      created_features: 0,
      created_stories: 1,
      updated_features: 0,
      updated_stories: 0,
      orphan_stories: 0,
    })
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /confirm import/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm import/i }))
    expect(mutateAsync).toHaveBeenCalledWith({ rows: expect.any(Array) })
  })

  it('shows "Import complete" after successful import', async () => {
    mutateAsync.mockResolvedValue({
      created_features: 0,
      created_stories: 1,
      updated_features: 0,
      updated_stories: 0,
      orphan_stories: 0,
    })
    render(<ImportCSVModal {...defaultProps} open file={makeFile()} />, { wrapper: makeWrapper() })
    await waitFor(() => screen.getByRole('button', { name: /confirm import/i }))
    await userEvent.click(screen.getByRole('button', { name: /confirm import/i }))
    await waitFor(() => expect(screen.getByText(/import complete/i)).toBeInTheDocument())
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
})
