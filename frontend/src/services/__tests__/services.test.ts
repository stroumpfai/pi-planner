import { vi, describe, it, expect, beforeEach } from 'vitest'
import { authApi } from '../auth'
import { csvImportApi } from '../csvImport'
import { editLockApi } from '../editLock'
import { featuresApi } from '../features'
import { groupsApi } from '../groups'
import { pbisApi } from '../pbis'
import { pisApi } from '../pis'
import { projectsApi } from '../projects'
import { snapshotsApi } from '../snapshots'
import { sprintsApi } from '../sprints'
import { swimlinesApi } from '../swimlines'
import { apiKeysApi } from '../apiKeys'
import { usersApi } from '../users'
import { piEventsApi } from '../piEvents'
import { api } from '../api'

vi.mock('../api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
  },
}))

const mockGet = vi.mocked(api.get)
const mockPost = vi.mocked(api.post)
const mockPut = vi.mocked(api.put)
const mockPatch = vi.mocked(api.patch)
const mockDelete = vi.mocked(api.delete)

beforeEach(() => {
  vi.clearAllMocks()
})

// ── authApi ────────────────────────────────────────────────────────────────────

describe('authApi', () => {
  it('login calls POST /auth/login', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await authApi.login({ username: 'u', password: 'p' })
    expect(mockPost).toHaveBeenCalledWith('/auth/login', { username: 'u', password: 'p' })
  })

  it('logout calls POST /auth/logout', async () => {
    mockPost.mockResolvedValue({} as never)
    await authApi.logout()
    expect(mockPost).toHaveBeenCalledWith('/auth/logout')
  })

  it('me calls GET /auth/me', async () => {
    mockGet.mockResolvedValue({ data: {} } as never)
    await authApi.me()
    expect(mockGet).toHaveBeenCalledWith('/auth/me')
  })
})

// ── csvImportApi ───────────────────────────────────────────────────────────────

describe('csvImportApi', () => {
  it('execute calls POST /projects/:id/import/csv', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await csvImportApi.execute('p-1', { rows: [] })
    expect(mockPost).toHaveBeenCalledWith('/projects/p-1/import/csv', { rows: [] })
  })
})

// ── editLockApi ────────────────────────────────────────────────────────────────

describe('editLockApi', () => {
  it('get calls GET /projects/:id/edit-lock', async () => {
    mockGet.mockResolvedValue({ data: {} } as never)
    await editLockApi.get('p-1')
    expect(mockGet).toHaveBeenCalledWith('/projects/p-1/edit-lock')
  })

  it('acquire calls POST /projects/:id/edit-lock/acquire', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await editLockApi.acquire('p-1')
    expect(mockPost).toHaveBeenCalledWith('/projects/p-1/edit-lock/acquire')
  })

  it('release calls POST /projects/:id/edit-lock/release', async () => {
    mockPost.mockResolvedValue({} as never)
    await editLockApi.release('p-1')
    expect(mockPost).toHaveBeenCalledWith('/projects/p-1/edit-lock/release')
  })

  it('keepalive calls POST /projects/:id/edit-lock/keepalive', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await editLockApi.keepalive('p-1')
    expect(mockPost).toHaveBeenCalledWith('/projects/p-1/edit-lock/keepalive')
  })
})

// ── featuresApi ────────────────────────────────────────────────────────────────

describe('featuresApi', () => {
  it('list calls GET /projects/:id/features with sort param', async () => {
    mockGet.mockResolvedValue({ data: [] } as never)
    await featuresApi.list('proj-1', 'name')
    expect(mockGet).toHaveBeenCalledWith('/projects/proj-1/features', { params: { sort: 'name' } })
  })

  it('get calls GET /features/:id', async () => {
    mockGet.mockResolvedValue({ data: {} } as never)
    await featuresApi.get('feat-1')
    expect(mockGet).toHaveBeenCalledWith('/features/feat-1')
  })

  it('create calls POST /projects/:id/features', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await featuresApi.create('proj-1', { title: 'Auth' })
    expect(mockPost).toHaveBeenCalledWith('/projects/proj-1/features', { title: 'Auth' })
  })

  it('update calls PATCH /features/:id', async () => {
    mockPatch.mockResolvedValue({ data: {} } as never)
    await featuresApi.update('feat-1', { title: 'Updated' })
    expect(mockPatch).toHaveBeenCalledWith('/features/feat-1', { title: 'Updated' })
  })

  it('delete calls DELETE /features/:id', async () => {
    mockDelete.mockResolvedValue({} as never)
    await featuresApi.delete('feat-1')
    expect(mockDelete).toHaveBeenCalledWith('/features/feat-1')
  })
})

// ── groupsApi ──────────────────────────────────────────────────────────────────

describe('groupsApi', () => {
  it('list calls GET /swimlines/:id/groups', async () => {
    mockGet.mockResolvedValue({ data: [] } as never)
    await groupsApi.list('sw-1')
    expect(mockGet).toHaveBeenCalledWith('/swimlines/sw-1/groups')
  })

  it('get calls GET /groups/:id', async () => {
    mockGet.mockResolvedValue({ data: {} } as never)
    await groupsApi.get('g-1')
    expect(mockGet).toHaveBeenCalledWith('/groups/g-1')
  })

  it('create calls POST /swimlines/:id/groups', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await groupsApi.create('sw-1', { name: 'Sprint 1', feature_system_id: 'f-1' })
    expect(mockPost).toHaveBeenCalledWith('/swimlines/sw-1/groups', { name: 'Sprint 1', feature_system_id: 'f-1' })
  })

  it('update calls PATCH /groups/:id', async () => {
    mockPatch.mockResolvedValue({ data: {} } as never)
    await groupsApi.update('g-1', { name: 'Renamed' })
    expect(mockPatch).toHaveBeenCalledWith('/groups/g-1', { name: 'Renamed' })
  })

  it('delete calls DELETE /groups/:id', async () => {
    mockDelete.mockResolvedValue({} as never)
    await groupsApi.delete('g-1')
    expect(mockDelete).toHaveBeenCalledWith('/groups/g-1')
  })
})

// ── pbisApi ────────────────────────────────────────────────────────────────────

describe('pbisApi', () => {
  it('list calls GET /projects/:id/pbis without feature filter', async () => {
    mockGet.mockResolvedValue({ data: [] } as never)
    await pbisApi.list('p-1')
    expect(mockGet).toHaveBeenCalledWith('/projects/p-1/pbis', { params: {} })
  })

  it('list calls GET /projects/:id/pbis with feature_id filter', async () => {
    mockGet.mockResolvedValue({ data: [] } as never)
    await pbisApi.list('p-1', 'f-1')
    expect(mockGet).toHaveBeenCalledWith('/projects/p-1/pbis', { params: { feature_id: 'f-1' } })
  })

  it('get calls GET /pbis/:id', async () => {
    mockGet.mockResolvedValue({ data: {} } as never)
    await pbisApi.get('pbi-1')
    expect(mockGet).toHaveBeenCalledWith('/pbis/pbi-1')
  })

  it('create calls POST /projects/:id/pbis', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await pbisApi.create('p-1', { title: 'Login', item_type: 'story', parent_feature_system_id: 'f-1' })
    expect(mockPost).toHaveBeenCalledWith('/projects/p-1/pbis', expect.objectContaining({ title: 'Login' }))
  })

  it('update calls PATCH /pbis/:id', async () => {
    mockPatch.mockResolvedValue({ data: {} } as never)
    await pbisApi.update('pbi-1', { title: 'Updated' })
    expect(mockPatch).toHaveBeenCalledWith('/pbis/pbi-1', { title: 'Updated' })
  })

  it('delete calls DELETE /pbis/:id', async () => {
    mockDelete.mockResolvedValue({} as never)
    await pbisApi.delete('pbi-1')
    expect(mockDelete).toHaveBeenCalledWith('/pbis/pbi-1')
  })

  it('place calls POST /pbis/:id/place', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await pbisApi.place('pbi-1', { sprint_index: 0 })
    expect(mockPost).toHaveBeenCalledWith('/pbis/pbi-1/place', { sprint_index: 0 })
  })

  it('unplace calls DELETE /pbis/:id/place', async () => {
    mockDelete.mockResolvedValue({} as never)
    await pbisApi.unplace('pbi-1')
    expect(mockDelete).toHaveBeenCalledWith('/pbis/pbi-1/place')
  })
})

// ── pisApi ─────────────────────────────────────────────────────────────────────

describe('pisApi', () => {
  it('list calls GET /projects/:id/pis', async () => {
    mockGet.mockResolvedValue({ data: [] } as never)
    await pisApi.list('p-1')
    expect(mockGet).toHaveBeenCalledWith('/projects/p-1/pis')
  })

  it('get calls GET /pis/:id', async () => {
    mockGet.mockResolvedValue({ data: {} } as never)
    await pisApi.get('pi-1')
    expect(mockGet).toHaveBeenCalledWith('/pis/pi-1')
  })

  it('create calls POST /projects/:id/pis', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await pisApi.create('p-1', { name: 'Q1' })
    expect(mockPost).toHaveBeenCalledWith('/projects/p-1/pis', { name: 'Q1' })
  })

  it('update calls PATCH /pis/:id', async () => {
    mockPatch.mockResolvedValue({ data: {} } as never)
    await pisApi.update('pi-1', { name: 'Q2' })
    expect(mockPatch).toHaveBeenCalledWith('/pis/pi-1', { name: 'Q2' })
  })

  it('delete calls DELETE /pis/:id', async () => {
    mockDelete.mockResolvedValue({} as never)
    await pisApi.delete('pi-1')
    expect(mockDelete).toHaveBeenCalledWith('/pis/pi-1')
  })
})

// ── projectsApi ────────────────────────────────────────────────────────────────

describe('projectsApi', () => {
  it('list calls GET /projects/', async () => {
    mockGet.mockResolvedValue({ data: [] } as never)
    await projectsApi.list()
    expect(mockGet).toHaveBeenCalledWith('/projects/')
  })

  it('get calls GET /projects/:id', async () => {
    mockGet.mockResolvedValue({ data: {} } as never)
    await projectsApi.get('p-1')
    expect(mockGet).toHaveBeenCalledWith('/projects/p-1')
  })

  it('create calls POST /projects/', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await projectsApi.create({ name: 'Test' })
    expect(mockPost).toHaveBeenCalledWith('/projects/', { name: 'Test' })
  })

  it('update calls PATCH /projects/:id', async () => {
    mockPatch.mockResolvedValue({ data: {} } as never)
    await projectsApi.update('p-1', { name: 'Updated' })
    expect(mockPatch).toHaveBeenCalledWith('/projects/p-1', { name: 'Updated' })
  })

  it('delete calls DELETE /projects/:id', async () => {
    mockDelete.mockResolvedValue({} as never)
    await projectsApi.delete('abc')
    expect(mockDelete).toHaveBeenCalledWith('/projects/abc')
  })
})

// ── sprintsApi ─────────────────────────────────────────────────────────────────

describe('sprintsApi', () => {
  it('list calls GET /pis/:id/sprints', async () => {
    mockGet.mockResolvedValue({ data: [] } as never)
    await sprintsApi.list('pi-1')
    expect(mockGet).toHaveBeenCalledWith('/pis/pi-1/sprints')
  })

  it('create calls POST /pis/:id/sprints', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await sprintsApi.create('pi-1', { sprint_index: 0, capacity: 20 })
    expect(mockPost).toHaveBeenCalledWith('/pis/pi-1/sprints', { sprint_index: 0, capacity: 20 })
  })

  it('update calls PATCH /sprints/:id', async () => {
    mockPatch.mockResolvedValue({ data: {} } as never)
    await sprintsApi.update('s-1', { capacity: 10 })
    expect(mockPatch).toHaveBeenCalledWith('/sprints/s-1', { capacity: 10 })
  })
})

// ── apiKeysApi ───────────────────────────────────────────────────────────────

describe('apiKeysApi', () => {
  it('listAll calls GET /api-keys/admin/all-keys', async () => {
    mockGet.mockResolvedValue({ data: [] } as never)
    await apiKeysApi.listAll()
    expect(mockGet).toHaveBeenCalledWith('/api-keys/admin/all-keys')
  })

  it('create calls POST /api-keys/admin/keys', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await apiKeysApi.create({ username: 'u', name: 'CI' })
    expect(mockPost).toHaveBeenCalledWith('/api-keys/admin/keys', { username: 'u', name: 'CI' })
  })

  it('cycle calls POST /api-keys/admin/cycle/:id', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await apiKeysApi.cycle('k-1')
    expect(mockPost).toHaveBeenCalledWith('/api-keys/admin/cycle/k-1')
  })

  it('revoke calls DELETE /api-keys/admin/keys/:id', async () => {
    mockDelete.mockResolvedValue({} as never)
    await apiKeysApi.revoke('k-1')
    expect(mockDelete).toHaveBeenCalledWith('/api-keys/admin/keys/k-1')
  })
})

// ── usersApi ─────────────────────────────────────────────────────────────────

describe('usersApi', () => {
  it('list calls GET /users/', async () => {
    mockGet.mockResolvedValue({ data: [] } as never)
    await usersApi.list()
    expect(mockGet).toHaveBeenCalledWith('/users/')
  })

  it('create calls POST /users/', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await usersApi.create({ username: 'u', password: 'p', role: 'reader' })
    expect(mockPost).toHaveBeenCalledWith('/users/', { username: 'u', password: 'p', role: 'reader' })
  })

  it('update calls PUT /users/:username', async () => {
    mockPut.mockResolvedValue({ data: {} } as never)
    await usersApi.update('u', { role: 'editor' })
    expect(mockPut).toHaveBeenCalledWith('/users/u', { role: 'editor' })
  })

  it('delete calls DELETE /users/:username', async () => {
    mockDelete.mockResolvedValue({} as never)
    await usersApi.delete('u')
    expect(mockDelete).toHaveBeenCalledWith('/users/u')
  })

  it('resetPassword calls POST /users/:username/reset-password', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await usersApi.resetPassword('u', { new_password: 'newpassword12' })
    expect(mockPost).toHaveBeenCalledWith('/users/u/reset-password', { new_password: 'newpassword12' })
  })

  it('changePassword calls POST /auth/change-password', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await usersApi.changePassword({ old_password: 'oldpassword12', new_password: 'newpassword12' })
    expect(mockPost).toHaveBeenCalledWith('/auth/change-password', {
      old_password: 'oldpassword12',
      new_password: 'newpassword12',
    })
  })
})

// ── piEventsApi ──────────────────────────────────────────────────────────────

describe('piEventsApi', () => {
  it('list calls GET /pis/:id/events', async () => {
    mockGet.mockResolvedValue({ data: [] } as never)
    await piEventsApi.list('pi-1')
    expect(mockGet).toHaveBeenCalledWith('/pis/pi-1/events')
  })

  it('create calls POST /pis/:id/events', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    const body = { name: 'Demo', event_date: '2026-03-01', event_type: 'milestone' } as const
    await piEventsApi.create('pi-1', body)
    expect(mockPost).toHaveBeenCalledWith('/pis/pi-1/events', body)
  })

  it('update calls PATCH /pis/:id/events/:eventId', async () => {
    mockPatch.mockResolvedValue({ data: {} } as never)
    await piEventsApi.update('pi-1', 'ev-1', { name: 'Renamed' })
    expect(mockPatch).toHaveBeenCalledWith('/pis/pi-1/events/ev-1', { name: 'Renamed' })
  })

  it('delete calls DELETE /pis/:id/events/:eventId', async () => {
    mockDelete.mockResolvedValue({} as never)
    await piEventsApi.delete('pi-1', 'ev-1')
    expect(mockDelete).toHaveBeenCalledWith('/pis/pi-1/events/ev-1')
  })
})

// ── swimlinesApi ───────────────────────────────────────────────────────────────

describe('swimlinesApi', () => {
  it('list calls GET /pis/:id/swimlines', async () => {
    mockGet.mockResolvedValue({ data: [] } as never)
    await swimlinesApi.list('pi-1')
    expect(mockGet).toHaveBeenCalledWith('/pis/pi-1/swimlines')
  })

  it('get calls GET /swimlines/:id', async () => {
    mockGet.mockResolvedValue({ data: {} } as never)
    await swimlinesApi.get('sw-1')
    expect(mockGet).toHaveBeenCalledWith('/swimlines/sw-1')
  })

  it('create calls POST /pis/:id/swimlines', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await swimlinesApi.create('pi-1', { name: 'Team A' })
    expect(mockPost).toHaveBeenCalledWith('/pis/pi-1/swimlines', { name: 'Team A' })
  })

  it('update calls PATCH /swimlines/:id', async () => {
    mockPatch.mockResolvedValue({ data: {} } as never)
    await swimlinesApi.update('sw-1', { name: 'Renamed' })
    expect(mockPatch).toHaveBeenCalledWith('/swimlines/sw-1', { name: 'Renamed' })
  })

  it('delete calls DELETE /swimlines/:id', async () => {
    mockDelete.mockResolvedValue({} as never)
    await swimlinesApi.delete('sw-1')
    expect(mockDelete).toHaveBeenCalledWith('/swimlines/sw-1')
  })

  it('reorder calls POST /swimlines/:id/reorder with order array', async () => {
    mockPost.mockResolvedValue({ data: [] } as never)
    await swimlinesApi.reorder('sw-1', ['sw-2', 'sw-3'])
    expect(mockPost).toHaveBeenCalledWith('/swimlines/sw-1/reorder', { order: ['sw-2', 'sw-3'] })
  })
})

// ── snapshotsApi ───────────────────────────────────────────────────────────────

describe('snapshotsApi', () => {
  it('list calls GET /projects/:id/snapshots/', async () => {
    mockGet.mockResolvedValue({ data: [] } as never)
    await snapshotsApi.list('p-1')
    expect(mockGet).toHaveBeenCalledWith('/projects/p-1/snapshots/')
  })

  it('create calls POST /projects/:id/snapshots/ with name', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await snapshotsApi.create('p-1', { name: 'Before refactor' })
    expect(mockPost).toHaveBeenCalledWith('/projects/p-1/snapshots/', { name: 'Before refactor' })
  })

  it('delete calls DELETE /projects/:id/snapshots/:snapshotId', async () => {
    mockDelete.mockResolvedValue({} as never)
    await snapshotsApi.delete('p-1', 'snap-1')
    expect(mockDelete).toHaveBeenCalledWith('/projects/p-1/snapshots/snap-1')
  })

  it('restore calls POST /projects/:id/snapshots/:snapshotId/restore', async () => {
    mockPost.mockResolvedValue({ data: {} } as never)
    await snapshotsApi.restore('p-1', 'snap-1')
    expect(mockPost).toHaveBeenCalledWith('/projects/p-1/snapshots/snap-1/restore')
  })
})
