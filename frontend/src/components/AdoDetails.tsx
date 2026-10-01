interface Field {
  readonly label: string
  readonly value: string | null | undefined
}

interface Props {
  readonly fields: readonly Field[]
}

/**
 * Read-only fields brought across from Azure DevOps by the CSV import. Nothing in
 * the planner edits them — the next import would overwrite the edit — so they sit
 * outside the form rather than as disabled inputs.
 */
export function AdoDetails({ fields }: Props) {
  return (
    <section aria-labelledby="ado-details-heading" className="rounded-md bg-gray-50 px-3 py-2">
      <h3 id="ado-details-heading" className="text-xs font-medium uppercase tracking-wide text-gray-500">
        From Azure DevOps
      </h3>
      <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        {fields.map(({ label, value }) => (
          <div key={label} className="contents">
            <dt className="text-gray-500">{label}</dt>
            <dd className="min-w-0 break-words text-gray-800">{value || '—'}</dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

/** An Epic as the planner shows any work item: `[id] Title`, or what is known of it. */
export function formatEpic(id: number | null | undefined, title: string | null | undefined): string | null {
  if (id == null) return null
  return title ? `[${id}] ${title}` : `[${id}]`
}
