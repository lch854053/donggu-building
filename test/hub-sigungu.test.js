import { test } from "node:test";
import assert from "node:assert/strict";
import building from "../api/building.js";
import archpms from "../api/archpms.js";
import hspms from "../api/hspms.js";

function makeResponse() {
  const state = {};
  return {
    state,
    setHeader() {},
    status(code) { state.status = code; return this; },
    json(body) { state.body = body; return this; },
  };
}

const upstreamBody = JSON.stringify({
  response: {
    header: { resultCode: "00" },
    body: { items: { item: [] }, totalCount: 0 },
  },
});

test("construction HUB proxies use the operation-specific Dong-gu code", { concurrency: false }, async () => {
  const originalKey = process.env.BLD_SERVICE_KEY;
  const originalFetch = globalThis.fetch;
  const urls = [];
  process.env.BLD_SERVICE_KEY = "test-service-key";
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return new Response(upstreamBody, { status: 200 });
  };

  try {
    const common = {
      sigunguCd: "29110", bjdongCd: "11800", platGbCd: "0", bun: "0100", ji: "0000",
    };
    const cases = [
      [building, common],
      [archpms, { ...common, op: "getApHsTpInfo" }],
      [archpms, { ...common, sigunguCd: "12210", op: "getApDemolExtngMgmRgstInfo" }],
      [hspms, { ...common, op: "getHpDongOulnInfo" }],
    ];

    for (const [handler, query] of cases) {
      const res = makeResponse();
      await handler({ method: "GET", headers: { origin: "http://localhost:3000" }, query }, res);
      assert.equal(res.state.status, 200);
    }
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.BLD_SERVICE_KEY;
    else process.env.BLD_SERVICE_KEY = originalKey;
  }

  assert.deepEqual(
    urls.map((url) => new URL(url).searchParams.get("sigunguCd")),
    ["12210", "12210", "29110", "12210"],
  );
});
