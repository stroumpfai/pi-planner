import BLOCKED from '@/data/common-passwords.json'

const BLOCKED_PASSWORDS = new Set<string>(BLOCKED)

export function isCommonPassword(password: string): boolean {
  return BLOCKED_PASSWORDS.has(password.toLowerCase())
}
