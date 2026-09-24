/** German relative time for the history list. Falls back to an absolute date
 *  once entries are a week or older. `now` is injectable for deterministic tests. */
export function formatRelative(ms: number, now: number = Date.now()): string {
  const s = Math.floor((now - ms) / 1000);
  if (s < 60) return "gerade eben";
  const min = Math.floor(s / 60);
  if (min < 60) return `vor ${min} Min.`;
  const h = Math.floor(s / 3600);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.floor(s / 86400);
  if (d < 7) return d === 1 ? "vor 1 Tag" : `vor ${d} Tagen`;
  return new Date(ms).toLocaleDateString("de-DE", { day: "2-digit", month: "short", year: "numeric" });
}
