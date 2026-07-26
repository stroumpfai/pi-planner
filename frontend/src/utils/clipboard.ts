import { toast } from '@/stores/toastStore'

/**
 * Copy text to the clipboard, surfacing a toast on success/failure. Mirrors the
 * handler in `UserManagementModal`'s SecretRevealPanel. Returns a promise that
 * resolves to whether the copy succeeded.
 */
export async function copyToClipboard(
  text: string,
  successMessage = 'Copied to clipboard',
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    toast.success(successMessage)
    return true
  } catch {
    toast.error('Failed to copy to clipboard')
    return false
  }
}
