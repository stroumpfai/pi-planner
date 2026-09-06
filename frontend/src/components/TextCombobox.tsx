interface Props {
  readonly id: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly suggestions: readonly string[]
  readonly placeholder?: string
  readonly maxLength?: number
  readonly className?: string
}

/**
 * A text field that suggests what the team already says.
 *
 * Role and organisation are free text (teams.md §3.2): there is no roles table,
 * nothing to administer, and no value is rejected. A plain `<select>` would imply
 * a list somebody maintains, and a plain input spells "SW-Arch" four ways by the
 * fourth member — so the suggestions are derived from the team's own existing
 * values and anything typed is still accepted.
 *
 * Built on `<datalist>` rather than a listbox widget on purpose: it is a real
 * text input to assistive technology and to Cypress, which is exactly what a
 * field that accepts anything should be.
 */
export function TextCombobox({
  id,
  value,
  onChange,
  suggestions,
  placeholder,
  maxLength = 50,
  className,
}: Props) {
  const listId = `${id}-suggestions`
  return (
    <>
      <input
        id={id}
        name={id}
        type="text"
        list={suggestions.length > 0 ? listId : undefined}
        value={value}
        placeholder={placeholder}
        maxLength={maxLength}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        className={
          className ??
          'mt-1 block w-full rounded-md border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm'
        }
      />
      {suggestions.length > 0 && (
        <datalist id={listId}>
          {suggestions.map((suggestion) => (
            <option key={suggestion} value={suggestion} />
          ))}
        </datalist>
      )}
    </>
  )
}
