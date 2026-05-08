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
export type SprintCreate = components['schemas']['SprintCreate']
export type SprintUpdate = components['schemas']['SprintUpdate']

export type Feature = components['schemas']['FeatureResponse']
export type FeatureCreate = components['schemas']['FeatureCreate']
export type FeatureUpdate = components['schemas']['FeatureUpdate']

export type PBI = components['schemas']['PBIResponse']
export type PBICreate = components['schemas']['PBICreate']
export type PBIUpdate = components['schemas']['PBIUpdate']

export type Group = components['schemas']['GroupResponse']
export type GroupCreate = components['schemas']['GroupCreate'] & { pbi_ids?: string[] }
export type GroupUpdate = components['schemas']['GroupUpdate']

export type EditLock = components['schemas']['EditLockResponse']

export type User = components['schemas']['UserResponse']
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
