/** Where a player response says which ads to play, and when. */
const AD_KEYS = ["adPlacements", "playerAds", "adSlots", "adBreakHeartbeatParams"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Takes the ads out of a player response, in place. The response may be the
 * value itself or lie under `playerResponse`. Returns whether anything was
 * removed. Other values are left alone.
 */
export function pruneAds(value: unknown): boolean {
  if (!isRecord(value)) return false;
  let removed = false;
  for (const key of AD_KEYS) {
    if (key in value) {
      delete value[key];
      removed = true;
    }
  }
  if (isRecord(value.playerResponse)) removed = pruneAds(value.playerResponse) || removed;
  return removed;
}
