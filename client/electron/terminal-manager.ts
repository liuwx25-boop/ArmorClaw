import * as pty from 'node-pty'
import { getExtendedPath, getHomeDir } from './utils/platform'

const CONTAINER_NAME = 'openclaw'

export class TerminalManager {
  private ptyProcess: pty.IPty | null = null
  private dataCallback: ((data: string) => void) | null = null
  private exitCallback: ((code: number) => void) | null = null

  async spawn(cols: number, rows: number): Promise<void> {
    this.destroy()

    this.ptyProcess = pty.spawn('docker', ['exec', '-it', CONTAINER_NAME, '/bin/bash'], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: getHomeDir(),
      env: { ...process.env, PATH: getExtendedPath() } as { [key: string]: string }
    })

    this.ptyProcess.onData((data) => {
      this.dataCallback?.(data)
    })

    this.ptyProcess.onExit(({ exitCode }) => {
      this.exitCallback?.(exitCode)
      this.ptyProcess = null
    })
  }

  write(data: string): void {
    this.ptyProcess?.write(data)
  }

  resize(cols: number, rows: number): void {
    try {
      this.ptyProcess?.resize(cols, rows)
    } catch {
      // ignore resize errors on already-exited processes
    }
  }

  destroy(): void {
    if (this.ptyProcess) {
      this.ptyProcess.kill()
      this.ptyProcess = null
    }
  }

  onData(callback: (data: string) => void): void {
    this.dataCallback = callback
  }

  onExit(callback: (code: number) => void): void {
    this.exitCallback = callback
  }
}
