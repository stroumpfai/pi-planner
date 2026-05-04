import { useFeatures } from '@/hooks/useFeatures'
import { FeatureCard } from './FeatureCard'

interface Props {
  readonly swimlineId: string
  readonly projectId: string
  readonly piId: string
}

export function FeatureZone({ swimlineId, projectId, piId }: Props) {
  const { data: allFeatures, isLoading } = useFeatures(projectId)

  const features = allFeatures?.filter(
    (f) => f.location === 'pi' && f.swimlane_id === swimlineId && f.pi_id === piId
  ) ?? []

  if (isLoading) {
    return <div className="p-2 text-xs text-gray-400">Loading…</div>
  }

  return (
    <div className="min-h-16 p-2 space-y-2">
      {features.length === 0 ? (
        <p className="text-xs text-gray-300 text-center py-4">Drop features here</p>
      ) : (
        features.map((f) => (
          <FeatureCard key={f.system_id} feature={f} projectId={projectId} />
        ))
      )}
    </div>
  )
}
