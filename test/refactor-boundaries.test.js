import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import archpms from "../api/archpms.js";
import vworldParcel from "../api/vworld-parcel.js";

function makeResponse() {
  const state = { headers: {} };
  return {
    state,
    setHeader(name, value) { state.headers[name] = value; },
    status(code) { state.status = code; return this; },
    json(body) { state.body = body; return this; },
  };
}

function getRequest(query) {
  return { method: "GET", headers: { origin: "http://localhost:3000" }, query };
}

test("browser API layer loads after transforms and keeps the shared request contract", async () => {
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.ok(page.indexOf('src="transform.js"') < page.indexOf('src="app-api.js"'));

  const context = vm.createContext({
    URLSearchParams,
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ juso: [{ roadAddr: "test" }] }) }),
  });
  vm.runInContext(readFileSync(new URL("../transform.js", import.meta.url), "utf8"), context);
  vm.runInContext(readFileSync(new URL("../app-api.js", import.meta.url), "utf8"), context);

  assert.deepEqual(await context.searchJuso("동구"), [{ roadAddr: "test" }]);
});

test("footer derives the update date from the deployed document metadata", () => {
  const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(page, /id="lastUpdated"/);
  assert.match(page, /document\.lastModified/);
  assert.doesNotMatch(page, /마지막 업데이트\s*:\s*2026\.\s*7\.\s*11/);
});

test("archpms keeps an empty HUB response when odcloud fallback is unavailable", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const originalBldKey = process.env.BLD_SERVICE_KEY;
  const originalOdcloudKey = process.env.ODCLOUD_SERVICE_KEY;
  process.env.BLD_SERVICE_KEY = "test-service-key";
  delete process.env.ODCLOUD_SERVICE_KEY;
  globalThis.fetch = async () => new Response(JSON.stringify({
    response: { header: { resultCode: "00" }, body: { items: { item: [] }, totalCount: 0 } },
  }), { status: 200 });

  try {
    const res = makeResponse();
    await archpms(getRequest({
      op: "getApBasisOulnInfo", sigunguCd: "29110", bjdongCd: "11800",
      platGbCd: "0", bun: "0100", ji: "0000",
    }), res);
    assert.equal(res.state.status, 200);
    assert.deepEqual(res.state.body, { items: [], totalCount: 0 });
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBldKey === undefined) delete process.env.BLD_SERVICE_KEY;
    else process.env.BLD_SERVICE_KEY = originalBldKey;
    if (originalOdcloudKey === undefined) delete process.env.ODCLOUD_SERVICE_KEY;
    else process.env.ODCLOUD_SERVICE_KEY = originalOdcloudKey;
  }
});

test("vworld parcel keeps single and batch response shapes", { concurrency: false }, async () => {
  const originalFetch = globalThis.fetch;
  const originalKey = process.env.VWORLD_KEY;
  process.env.VWORLD_KEY = "test-vworld-key";
  globalThis.fetch = async (url) => {
    const filter = new URL(String(url)).searchParams.get("attrFilter") || "";
    const pnu = filter.split(":").at(-1);
    return new Response(JSON.stringify({
      response: {
        status: "OK",
        result: { featureCollection: { features: [{
          properties: { pnu, addr: "test addr", jibun: "100" },
          geometry: { type: "Point", coordinates: [126.9, 35.1] },
        }] } },
      },
    }), { status: 200 });
  };

  try {
    const first = "2911010300100140000";
    const second = "2911010300100150000";
    const singleRes = makeResponse();
    await vworldParcel(getRequest({ pnu: first }), singleRes);
    assert.equal(singleRes.state.status, 200);
    assert.equal(singleRes.state.body.pnu, "12210" + first.slice(5));
    assert.equal(singleRes.state.body.sigunguCd, "12210");

    const batchRes = makeResponse();
    await vworldParcel(getRequest({ pnus: `${first},${second}` }), batchRes);
    assert.equal(batchRes.state.status, 200);
    assert.equal(batchRes.state.body.features.length, 2);
    assert.deepEqual(batchRes.state.body.features.map(feature => feature.properties.pnu), [first, second]);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.VWORLD_KEY;
    else process.env.VWORLD_KEY = originalKey;
  }
});
