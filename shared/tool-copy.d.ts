export interface ToolCopyCase {
  label: string
  name: string
  action: string
  command: string
  text: string | null
}

export const TOOL_COPY_CASES: ToolCopyCase[]

export function describeTool(name: string, action?: string, command?: string): string | null
