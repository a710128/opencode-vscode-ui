import * as cp from "node:child_process"
import * as net from "node:net"
import { getHttpProxy } from "./settings"
import type { Client, SessionInfo, SessionStatus } from "./sdk"

export type RuntimeState = "starting" | "ready" | "error" | "stopped" | "stopping"

export type WorkspaceRuntime = {
  workspaceId: string
  dir: string
  name: string
  port: number
  url: string
  state: RuntimeState
  sessions: Map<string, SessionInfo>
  sessionStatuses: Map<string, SessionStatus>
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

export function startupFailure(proc: cp.ChildProcess) {
  let done = false
  let onError: ((err: NodeJS.ErrnoException) => void) | undefined
  let onExit: ((code: number | null, signal: NodeJS.Signals | null) => void) | undefined

  const cleanup = () => {
    if (onError) {
      proc.off("error", onError)
    }

    if (onExit) {
      proc.off("exit", onExit)
    }
  }

  const promise = new Promise<never>((_, reject) => {
    const fail = (message: string) => {
      if (done) {
        return
      }

      done = true
      cleanup()
      reject(new Error(message))
    }

    onError = (err: NodeJS.ErrnoException) => {
      fail(formatSpawnError(err))
    }

    onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      if (done) {
        return
      }

      fail(`server exited before ready (code=${code ?? "unknown"} signal=${signal ?? "none"})`)
    }

    proc.once("error", onError)
    proc.once("exit", onExit)
  })

  return {
    promise,
    dispose() {
      done = true
      cleanup()
    },
  }
}

export function spawn(dir: string, port: number) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENCODE_CALLER: "vscode-ui",
  }
  const proxy = getHttpProxy()

  if (proxy) {
    env.HTTP_PROXY = proxy
    env.HTTPS_PROXY = proxy
    env.http_proxy = proxy
    env.https_proxy = proxy
  } else {
    clearEmptyProxyEnv(env)
  }

  return cp.spawn("opencode", ["serve", "--port", String(port), "--hostname", "127.0.0.1"], {
    cwd: dir,
    detached: process.platform !== "win32",
    env,
  })
}

function clearEmptyProxyEnv(env: NodeJS.ProcessEnv) {
  for (const key of ["HTTP_PROXY", "HTTPS_PROXY", "http_proxy", "https_proxy"] as const) {
    const value = env[key]

    if (typeof value === "string" && value.trim().length === 0) {
      delete env[key]
    }
  }
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

function formatSpawnError(err: NodeJS.ErrnoException) {
  if (err.code === "ENOENT") {
    return 'failed to start opencode: command "opencode" was not found on the current host PATH'
  }

  if (err.code === "EACCES") {
    return 'failed to start opencode: command "opencode" is not executable on the current host'
  }

  const message = err.message || String(err)
  return err.code ? `${message} (code=${err.code})` : message
}
