// Re-export generated types from OpenAPI spec as clean domain aliases
export type { components } from './api.generated'
import type { components } from './api.generated'

export type Project = components['schemas']['ProjectResponse']
export type ProjectCreate = components['schemas']['ProjectCreate']
export type ProjectUpdate = components['schemas']['ProjectUpdate']

export type PI = components['schemas']['PIResponse'] & { total_effort: number; total_capacity: number }
export type PICreate = components['schemas']['PICreate']
export type PIUpdate = components['schemas']['PIUpdate']
export type PIState = 'draft' | 'in_progress' | 'closed'

export type Swimline = components['schemas']['SwimlineResponse'] & { effort: number; capacity: number }
export type SwimlineCreate = components['schemas']['SwimlineCreate']
export type SwimlineUpdate = components['schemas']['SwimlineUpdate']

export type Sprint = components['schemas']['SprintResponse'] & { effort: number }
export interface SprintCreate {
  sprint_index: number
  capacity: number
  start_date?: string | null
  end_date?: string | null
}
export type SprintUpdate = components['schemas']['SprintUpdate']

export type Feature = components['schemas']['FeatureResponse']
export type FeatureCreate = components['schemas']['FeatureCreate']
export type FeatureUpdate = components['schemas']['FeatureUpdate']

export type PBI = components['schemas']['PBIResponse']
export type PBICreate = components['schemas']['PBICreate']
export type PBIUpdate = components['schemas']['PBIUpdate']

export type Group = components['schemas']['GroupResponse'] & {
  is_implicit: boolean
  story_system_id: string | null
}
export type GroupCreate = components['schemas']['GroupCreate'] & { pbi_ids?: string[] }
export type GroupUpdate = components['schemas']['GroupUpdate']

export interface PlaceStoryRequest {
  sprint_index: number
}

export interface PlaceStoryResponse {
  story: PBI
  group: Group
}

export type EditLock = components['schemas']['EditLockResponse']

export type User = components['schemas']['UserResponse']
export type UserCreate = components['schemas']['UserCreate']
export type UserUpdate = components['schemas']['UserUpdate']
export type PasswordReset = components['schemas']['PasswordReset']
export type ChangePassword = components['schemas']['ChangePassword']
export type LoginRequest = components['schemas']['LoginRequest']
export type TokenResponse = components['schemas']['TokenResponse']

export type CsvRow = components['schemas']['CsvRow']
export type CsvImportRequest = components['schemas']['CsvImportRequest']
export type CsvImportResult = components['schemas']['CsvImportResult']

export interface ApiError {
  error: string
  message: string
  details?: Record<string, unknown>
}

export interface ApiKey {
  id: string
  username: string
  name: string
  purpose: string | null
  created_at: string
  expires_at: string | null
  last_used_at: string | null
  is_active: boolean
}

export interface ApiKeyCreate {
  username: string
  name: string
  purpose?: string
  expires_in_days?: number
}

export interface ApiKeyCreateResponse {
  id: string
  full_token: string
  username: string
  name: string
  created_at: string
  expires_at: string | null
}
