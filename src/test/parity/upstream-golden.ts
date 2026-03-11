import { upstreamParityFixtures } from "./upstream-parity-fixtures"
import { runUpstreamFixture, type UpstreamGolden } from "./upstream-parity"

export const upstreamGolden: UpstreamGolden[] = upstreamParityFixtures.map(runUpstreamFixture)
