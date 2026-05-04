import { vi, describe, it, expect, beforeEach } from 'vitest'
import { projectsApi } from '../projects'
import { featuresApi } from '../features'
import { api } from '../api'

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockGet = vi.mocked(api.get)
const mockPost = vi.mocked(api.post)
const mockPatch = vi.mocked(api.patch)
const mockDelete = vi.mocked(api.delete)

beforeEach(() => vi.clearAllMocks())

describe('projectsApi', () => {
  it('list calls GET /projects/', async () => {
    mockGet.mockResolvedValue({ data: [] } as never)
    await projectsApi.list()
    expect(mockGet).toHaveBeenCalledWith('/projects/')
  })

  it('create calls POST /projects/', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await projectsApi.create({ name: 'Test' })
    expect(mockPost).toHaveBeenCalledWith('/projects/', { name: 'Test' })
  })

  it('delete calls DELETE /projects/:id', async () => {
    mockDelete.mockResolvedValue({} as never)
    await projectsApi.delete('abc')
    expect(mockDelete).toHaveBeenCalledWith('/projects/abc')
  })
})

describe('featuresApi', () => {
  it('list calls GET /projects/:id/features with sort param', async () => {
    mockGet.mockResolvedValue({ data: [] } as never)
    await featuresApi.list('proj-1', 'name')
    expect(mockGet).toHaveBeenCalledWith('/projects/proj-1/features', { params: { sort: 'name' } })
  })

  it('update calls PATCH /features/:id', async () => {
    mockPatch.mockResolvedValue({ data: {} } as never)
    await featuresApi.update('feat-1', { title: 'Updated' })
    expect(mockPatch).toHaveBeenCalledWith('/features/feat-1', { title: 'Updated' })
  })
})
