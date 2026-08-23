import { render, screen } from '@testing-library/react'
import { zxcvbn } from '@zxcvbn-ts/core'
import { PasswordStrengthBar } from '../PasswordStrengthBar'

const LABELS = ['Very weak', 'Weak', 'Fair', 'Good', 'Strong']

/** The label is driven by zxcvbn, so derive the expectation rather than hard-coding it. */
const expectedLabel = (password: string) => LABELS[zxcvbn(password).score]

describe('PasswordStrengthBar', () => {
  it('renders nothing for an empty password', () => {
    const { container } = render(<PasswordStrengthBar password="" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('labels a trivial password at the weak end of the scale', () => {
    render(<PasswordStrengthBar password="abc" />)
    expect(screen.getByText(new RegExp(`^${expectedLabel('abc')}`))).toBeInTheDocument()
  })

  it('labels a long random password at the strong end of the scale', () => {
    const strong = 'correct-horse-battery-staple-9471'
    render(<PasswordStrengthBar password={strong} />)
    expect(screen.getByText(new RegExp(`^${expectedLabel(strong)}`))).toBeInTheDocument()
  })

  it('scores a strong password above a trivial one', () => {
    expect(zxcvbn('correct-horse-battery-staple-9471').score).toBeGreaterThan(zxcvbn('abc').score)
  })

  it('appends the first zxcvbn suggestion when there is one', () => {
    const weak = 'password'
    const suggestion = zxcvbn(weak).feedback.suggestions[0]
    render(<PasswordStrengthBar password={weak} />)
    if (suggestion) {
      expect(screen.getByText(new RegExp(` — ${suggestion.slice(0, 20)}`))).toBeInTheDocument()
    } else {
      expect(screen.getByText(expectedLabel(weak))).toBeInTheDocument()
    }
  })

  it('always renders the five segments of the bar', () => {
    const { container } = render(<PasswordStrengthBar password="abc" />)
    expect(container.querySelectorAll('.h-1')).toHaveLength(5)
  })
})
