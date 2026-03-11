import { readFileSync } from "node:fs"
import * as path from "node:path"
import { runComposerParity, type ComposerParityFixture } from "./composer-parity"
import { upstreamParityFixtures } from "./upstream-parity-fixtures"

const upstreamGolden = JSON.parse(readFileSync(path.join(process.cwd(), "src/test/parity/upstream-golden.json"), "utf8")) as Array<{
  name: string
  trigger: "slash" | "mention" | null
  items: unknown
  accepted?: unknown
}>

const local = new Map(upstreamParityFixtures.map((item) => [item.name, runComposerParity(toComposer(item))]))
const diffs = upstreamGolden.flatMap((golden) => {
  const current = local.get(golden.name)
  if (!current) {
    return [`Missing local fixture for ${golden.name}`]
  }

  const lines: string[] = []
  if (current.trigger !== golden.trigger) {
    lines.push(`trigger ${String(current.trigger)} !== ${String(golden.trigger)}`)
  }
  const left = JSON.stringify(current.items)
  const right = JSON.stringify(golden.items)
  if (left !== right) {
    lines.push(`items differ\ncurrent: ${left}\nupstream: ${right}`)
  }
  const currentAccepted = JSON.stringify(current.accepted)
  const goldenAccepted = JSON.stringify(golden.accepted)
  if (currentAccepted !== goldenAccepted) {
    lines.push(`accepted differ\ncurrent: ${currentAccepted}\nupstream: ${goldenAccepted}`)
  }
  return lines.length > 0 ? [`## ${golden.name}`, ...lines] : []
})

if (diffs.length === 0) {
  console.log("Composer parity matches upstream goldens.")
  process.exit(0)
}

console.log(diffs.join("\n"))
process.exit(1)

function toComposer(item: (typeof upstreamParityFixtures)[number]): ComposerParityFixture {
  return {
    name: item.name,
    draft: item.draft,
    cursor: item.cursor,
    acceptIndex: 0,
    agents: item.agents?.map((agent) => ({ name: agent.name, hidden: agent.hidden, mode: agent.mode })),
    mcpResources: Object.fromEntries((item.resources ?? []).map((resource) => [resource.client + resource.uri, {
      name: resource.name,
      uri: resource.uri,
      client: resource.client,
      description: resource.description,
      mimeType: resource.mimeType,
    }])),
    files: {
      recent: item.recent,
      workspace: item.files,
    },
    expected: {
      trigger: null,
      items: [],
    },
  }
}
