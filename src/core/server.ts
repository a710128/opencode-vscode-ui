import * as cp from "node:child_process"
import * as net from "node:net"
import type { Client, SessionInfo } from "./sdk"

export type RuntimeState = "starting" | "ready" | "error" | "stopped" | "stopping"

export type WorkspaceRuntime = {
  dir: string
  name: string
  port: number
  url: string
  state: RuntimeState
  sessions: Map<string, SessionInfo>
  sessionsState: "idle" | "loading" | "ready" | "error"
  pid?: number
  proc?: cp.ChildProcess
  sdk?: Client
  err?: string
  sessionsErr?: string
}

export async function freeport() {
  return await new Promise<number>((resolve, reject) => {
    const srv = net.createServer()
    srv.once("error", reject)
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address()

      if (!addr || typeof addr === "string") {
        srv.close(() => reject(new Error("failed to allocate port")))
        return
      }

      srv.close((err) => {
        if (err) {
          reject(err)
          return
        }

        resolve(addr.port)
      })
    })
  })
}

export async function health(url: string, timeout: number, tries: number) {
  for (let i = 0; i < tries; i++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), timeout)

    try {
      const res = await fetch(`${url}/global/health`, {
        signal: ctrl.signal,
      })

      if (res.ok) {
        clearTimeout(timer)
        return
      }
    } catch {}

    clearTimeout(timer)

    await wait(400)
  }

  throw new Error("health check timed out")
}

export function spawn(dir: string, port: number) {
  return cp.spawn("opencode", ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: dir,
    detached: process.platform !== "win32",
    env: {
      ...process.env,
      OPENCODE_CALLER: "vscode-ui",
    },
  })
}

export async function stop(proc?: cp.ChildProcess) {
  if (!proc || proc.exitCode !== null || proc.signalCode !== null) {
    return
  }

  const done = new Promise<void>((resolve) => {
    proc.once("exit", () => resolve())
    proc.once("close", () => resolve())
  })

  if (await tree(proc, "SIGINT", 600, done)) {
    return
  }

  if (await tree(proc, "SIGTERM", 400, done)) {
    return
  }

  await tree(proc, "SIGKILL", 400, done)
}

async function tree(proc: cp.ChildProcess, sig: NodeJS.Signals, ms: number, done: Promise<void>) {
  const pid = proc.pid
  if (!pid || proc.exitCode !== null || proc.signalCode !== null) {
    return true
  }

  if (process.platform === "win32") {
    await killWindows(pid)
    await Promise.race([done, wait(ms)])
    return proc.exitCode !== null || proc.signalCode !== null
  }

  try {
    process.kill(-pid, sig)
  } catch {
    try {
      proc.kill(sig)
    } catch {
      return true
    }
  }

  await Promise.race([done, wait(ms)])
  return proc.exitCode !== null || proc.signalCode !== null
}

async function killWindows(pid: number) {
  await new Promise<void>((resolve) => {
    const killer = cp.spawn("taskkill", ["/pid", String(pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    })
    killer.once("exit", () => resolve())
    killer.once("error", () => resolve())
  })
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
