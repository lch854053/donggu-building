// api/_lib/proxy.js
// 모든 프록시 공통 유틸. '_' 접두 폴더라 Vercel이 엔드포인트로 만들지 않음.
// (@vercel/node 가 import 한 로컬 파일을 함수에 자동 번들링)

// 허용 출처: 운영 + 프리뷰(donggu-building-*.vercel.app) + 로컬
function isAllowedHost(host) {
  if (host === "localhost:3000") return true;
  return host.endsWith(".vercel.app") && host.startsWith("donggu-building");
}

function originOk(req) {
  const ref = req.headers.origin || req.headers.referer || "";
  if (!ref) return false;
  try { return isAllowedHost(new URL(ref).host); }
  catch { return false; }
}

// 공통 게이트: GET 강제 + 출처 검증.
// 통과 시 true. 막으면 응답까지 종료하고 false.
// jsonError=false 면 빈 본문(타일 등 바이너리 응답용).
export function guard(req, res, { jsonError = true } = {}) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405);
    jsonError ? res.json({ error: "GET만 허용" }) : res.end();
    return false;
  }
  if (!originOk(req)) {
    res.status(403);
    jsonError ? res.json({ error: "허용되지 않은 출처" }) : res.end();
    return false;
  }
  return true;
}

// 타임아웃 붙은 fetch. 초과 시 AbortError throw.
export async function fetchWithTimeout(url, { timeout = 5000, ...opts } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, { signal: ctrl.signal, ...opts });
  } finally {
    clearTimeout(timer);
  }
}

// 보안 헤더(캐시는 핸들러마다 달라 별도로 지정)
export function setSecurity(res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
}

// 필수 환경변수. 없으면 500 응답 후 null 반환.
export function requireEnv(res, name) {
  const v = process.env[name];
  if (!v) { res.status(500).json({ error: `${name} 미설정` }); return null; }
  return v;
}

// catch 공통: AbortError → 504, 그 외 → 502. (JSON 응답)
export function failJson(res, e, tag) {
  const aborted = e?.name === "AbortError";
  console.error(`[${tag}]`, aborted ? "timeout" : e?.message || e);
  return res.status(aborted ? 504 : 502).json({ error: "서버 오류" });
}
