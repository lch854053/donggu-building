// Stored PNU data retains the legacy code, while construction HUB APIs now
// require the current administrative code for Dong-gu.
export const DONGGU_LEGACY_SIGUNGU = "29110";
export const DONGGU_HUB_SIGUNGU = "12210";

export function normalizeDongguHubSigungu(sigunguCd) {
  return sigunguCd === DONGGU_LEGACY_SIGUNGU ? DONGGU_HUB_SIGUNGU : sigunguCd;
}

// The demolition register remains indexed under the pre-integration code.
export function normalizeDongguLegacySigungu(sigunguCd) {
  return sigunguCd === DONGGU_HUB_SIGUNGU ? DONGGU_LEGACY_SIGUNGU : sigunguCd;
}
