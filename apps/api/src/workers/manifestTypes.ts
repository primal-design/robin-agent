export type PermissionLevel = 'auto_allowed' | 'needs_approval' | 'blocked'

export interface WorkerTool {
  id: string
  permission: PermissionLevel
}

export interface WorkerManifest {
  id: string
  name: string
  goal: string
  actions: {
    auto_allowed: string[]
    needs_approval: string[]
    blocked: string[]
  }
  memory_fields: string[]
  prompt: {
    system: string
  }
  tools: WorkerTool[]
}
