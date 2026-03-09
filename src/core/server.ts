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
    env: {
      ...process.env,
      OPENCODE_CALLER: "vscode-ui",
    },
  })
}

export async function stop(proc?: cp.ChildProcess) {
  if (!proc || proc.killed) {
    return
  }

  const done = new Promise<void>((resolve) => {
    proc.once("exit", () => resolve())
    proc.once("close", () => resolve())
  })

  proc.kill()
  await Promise.race([done, wait(400)])

  if (proc.killed) {
    return
  }

  proc.kill("SIGKILL")
  await Promise.race([done, wait(400)])
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
