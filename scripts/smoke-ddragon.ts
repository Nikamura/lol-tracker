import assert from "node:assert/strict";
import { ddragonVersion, refreshDdragonVersions } from "../src/web/lib/ddragon.js";

const catalog = (data: unknown): typeof fetch => async () => new Response(JSON.stringify(data));
await refreshDdragonVersions(catalog(["16.18.1", "14.24.1", "9.24.2", "9.24.1"]));
assert.equal(ddragonVersion("16.19.820.7193"), "16.18.1", "unpublished game patch uses published assets");
assert.equal(ddragonVersion("14.24.498.6553"), "14.24.1", "historical matches retain their patch");
assert.equal(ddragonVersion("9.24.123.456"), "9.24.2", "asset releases need not end in .1");
for (const version of [null, undefined, "", "invalid"]) assert.equal(ddragonVersion(version), "16.18.1");
await refreshDdragonVersions(catalog(["16.19.1", "16.18.1"]));
assert.equal(ddragonVersion("16.19.820.7193"), "16.19.1", "refresh adopts newly published patch");
const warn = console.warn;
console.warn = () => {};
try {
  for (const data of [[], {}, [123], ["invalid"]]) {
    await refreshDdragonVersions(catalog(data));
    assert.equal(ddragonVersion(null), "16.19.1");
  }
  await refreshDdragonVersions(async () => { throw new Error("offline"); });
  assert.equal(ddragonVersion(null), "16.19.1", "network failure preserves last known catalog");
} finally {
  console.warn = warn;
}
console.log("Data Dragon smoke checks passed");
