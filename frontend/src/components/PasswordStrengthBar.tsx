import { zxcvbn } from '@zxcvbn-ts/core'

const LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong']
const COLORS = ['bg-red-500', 'bg-orange-500', 'bg-yellow-400', 'bg-lime-500', 'bg-green-500']
const TEXT_COLORS = ['text-red-600', 'text-red-600', 'text-yellow-600', 'text-green-700', 'text-green-700']

interface Props {
  readonly password: string
}

export function PasswordStrengthBar({ password }: Props) {
  if (!password) return null
  const { score, feedback } = zxcvbn(password)
  const suggestion = feedback.suggestions[0]
  return (
    <div className="mt-1 space-y-1">
      <div className="flex gap-0.5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${i <= score ? COLORS[score] : 'bg-gray-200'}`}
          />
        ))}
      </div>
      <p className={`text-xs ${TEXT_COLORS[score]}`}>
        {LABELS[score]}{suggestion ? ` — ${suggestion}` : ''}
      </p>
    </div>
  )
}
