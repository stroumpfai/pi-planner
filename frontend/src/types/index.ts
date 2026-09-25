// Re-export generated types from OpenAPI spec as clean domain aliases
export type { components } from './api.generated'
import type { components } from './api.generated'

export type Project = components['schemas']['ProjectResponse']
export type ProjectCreate = components['schemas']['ProjectCreate']
export type ProjectUpdate = components['schemas']['ProjectUpdate']

export type Team = components['schemas']['TeamResponse']
export type TeamCreate = components['schemas']['TeamCreate']
export type TeamUpdate = components['schemas']['TeamUpdate']

export type TeamMember = components['schemas']['MemberResponse']
export type TeamMemberCreate = components['schemas']['MemberCreate']
export type TeamMemberUpdate = components['schemas']['MemberUpdate']
/** One dated version of a member's contract. Intervals are derived, so there is
 *  no end date here — a version holds until the next one's `effective_from`. */
export type PatternVersion = components['schemas']['PatternVersionResponse']
export type PatternVersionCreate = components['schemas']['PatternVersionCreate']
export type PatternVersionUpdate = components['schemas']['PatternVersionUpdate']
/** The first version, written with the member in one transaction (§3.3). */
export type FirstPatternVersion = components['schemas']['FirstPatternVersion']

export type TeamAssignment = components['schemas']['TeamProjectResponse']
export type TeamAssignmentCreate = components['schemas']['TeamProjectCreate']
export type TeamAssignmentUpdate = components['schemas']['TeamProjectUpdate']
export type TeamCapacity = components['schemas']['TeamCapacityResponse']
export type CapacitySprint = components['schemas']['CapacitySprint']
/** One member's capacity in one sprint, as the §5.4 steps produced it. */
export type CapacityBreakdown = components['schemas']['CapacityBreakdown']
export type MemberCapacityRow = components['schemas']['MemberCapacityRow']
export type ProjectCapacityRow = components['schemas']['ProjectCapacityRow']

/** What the Achievement view reads: the Capacity view's columns, the other half of the question. */
export type TeamAchievement = components['schemas']['TeamAchievementResponse']
/** One served project's Committed / Achieved / PD given / Velocity, in its own unit. */
export type ProjectAchievementRow = components['schemas']['ProjectAchievementRow']
/** A story or bug behind an Achieved cell. */
export type AchievedItem = components['schemas']['AchievedItem']

/** What a push into one project would write, per sprint (§6.7). */
export type PushPreview = components['schemas']['PushPreview']
/** One line of the review table: current · proposed · Δ · the PD behind it. */
export type PushSprintRow = components['schemas']['PushSprintRow']
/** One row of the per-project result list. Partial success is the normal outcome. */
export type ProjectPushResult = components['schemas']['ProjectPushResult']
export type TeamPushResponse = components['schemas']['TeamPushResponse']
/** Whether one project's sprints still agree with its team (§6.6). */
export type ProjectPushStatus = components['schemas']['ProjectPushStatus']

/** One absence rule, with its occurrences expanded inside the window that was read. */
export type Absence = components['schemas']['AbsenceResponse']
export type AbsenceCreate = components['schemas']['AbsenceCreate']
export type AbsenceUpdate = components['schemas']['AbsenceUpdate']
/** One day an absence touches, and which halves of it. */
export type AbsenceOccurrence = components['schemas']['AbsenceOccurrence']
/** The three schedule shapes absences and meetings share (§3.4). */
export type ScheduleKind = NonNullable<AbsenceCreate['kind']>

/** One meeting: a schedule rule, where it starts, how long it runs, and who is in
 *  it. A recurring meeting is one row, never one per occurrence (§3.5). */
export type Meeting = components['schemas']['MeetingResponse']
export type MeetingCreate = components['schemas']['MeetingCreate']
export type MeetingUpdate = components['schemas']['MeetingUpdate']

export type PI = components['schemas']['PIResponse'] & { total_effort: number; total_available: number }
export type PICreate = components['schemas']['PICreate']
export type PIUpdate = components['schemas']['PIUpdate']
export type PIState = 'draft' | 'in_progress' | 'closed'

export type PIEvent = components['schemas']['PIEventResponse']
export type PIEventCreate = components['schemas']['PIEventCreate']
export type PIEventUpdate = components['schemas']['PIEventUpdate']
export type PIEventType = PIEvent['event_type']

export type Swimline = components['schemas']['SwimlineResponse'] & { effort: number; available: number }
export type SwimlineCreate = components['schemas']['SwimlineCreate']
export type SwimlineUpdate = components['schemas']['SwimlineUpdate']

export type Sprint = components['schemas']['SprintResponse'] & { effort: number }
export interface SprintCreate {
  sprint_index: number
  available: number
  start_date?: string | null
  end_date?: string | null
}
export type SprintUpdate = components['schemas']['SprintUpdate']

export type Feature = components['schemas']['FeatureResponse']
export type FeatureCreate = components['schemas']['FeatureCreate']
export type FeatureUpdate = components['schemas']['FeatureUpdate']
export type FeatureSplitRequest = components['schemas']['FeatureSplitRequest']

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
export type PlannedChange = components['schemas']['PlannedChange']

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

export interface Snapshot {
  system_id: string
  name: string
  created_at: string
  created_by: string | null
}

/** Which of the three State Lists an entry belongs to. */
export type StateItemType = 'feature' | 'story' | 'bug'

/** One entry in a project's State List. */
export interface ProjectState {
  system_id: string
  project_id: string
  item_type: StateItemType
  value: string
  position: number
  category: 'not_started' | 'in_progress' | 'done' | null
  created_at: string
}
