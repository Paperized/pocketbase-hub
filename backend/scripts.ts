import { spawn } from 'child_process'
import path from 'path'

export interface ScriptResult {
  stdout: string
  stderr: string
  exitCode: number
}

export async function runScript(
  scriptName: string,
  args: string[] = [],
  env: Record<string, string> = {}
): Promise<ScriptResult> {
  const scriptsDir = process.env.SCRIPTS_DIR || '/config/scripts'
  const scriptPath = path.join(scriptsDir, scriptName)

  return new Promise((resolve) => {
    const proc = spawn('bash', [scriptPath, ...args], {
      env: { ...process.env, ...env },
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.on('close', (code: number | null) => {
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1 })
    })
  })
}
