import BLOCKED from '@/data/common-passwords.json'

const BLOCKED_PASSWORDS = new Set<string>(BLOCKED)

const APP_TERMS = ['piplanner', 'pi-planner', 'pi_planner', 'piplan']

export function isAppNamePassword(password: string): boolean {
  const lower = password.toLowerCase()
  return APP_TERMS.some((t) => lower.includes(t))
}

export function isCommonPassword(password: string): boolean {
  return BLOCKED_PASSWORDS.has(password.toLowerCase())
}
