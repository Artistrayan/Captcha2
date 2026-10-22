export function calculatePassRatePercent(total: number, passed: number): number {
  if (!Number.isFinite(total) || !Number.isFinite(passed) || total <= 0) return 0;
  const safeTotal = Math.floor(total);
  const safePassed = Math.max(0, Math.min(safeTotal, Math.floor(passed)));
  return safeTotal > 0 ? Math.round((safePassed / safeTotal) * 100) : 0;
}
