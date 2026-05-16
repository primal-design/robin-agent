import type { WorkerManifest, PermissionLevel } from '../workers/manifestTypes.js'

export function checkPermission(toolName: string, manifest: WorkerManifest): PermissionLevel {
  const { actions } = manifest
  if (actions.blocked.includes(toolName))        return 'blocked'
  if (actions.needs_approval.includes(toolName)) return 'needs_approval'
  if (actions.auto_allowed.includes(toolName))   return 'auto_allowed'
  return 'needs_approval'
}
