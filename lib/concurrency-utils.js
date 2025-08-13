// Concurrency utilities shared between CLI commands and watcher

/**
 * Calculate utilization percent (0-100) as an integer.
 * Returns 0 when max concurrency is not positive.
 */
function calculateUtilizationPct(active, concurrency) {
  const activeVal = (typeof active === 'number' && isFinite(active) && active >= 0) ? active : 0;
  const maxVal = (typeof concurrency === 'number' && isFinite(concurrency)) ? concurrency : 0;
  if (maxVal <= 0) return 0;
  return Math.round((activeVal / maxVal) * 100);
}

/**
 * Determine level per frontend logic:
 * - 'disabled' when max <= 0
 * - 'critical' when utilization >= 95% OR active > max
 * - 'warning' when utilization in [70%, 94%]
 * - 'healthy' otherwise
 */
function getConcurrencyLevel(active, concurrency) {
  const maxVal = (typeof concurrency === 'number' && isFinite(concurrency)) ? concurrency : 0;
  if (maxVal <= 0) return 'disabled';
  const activeVal = (typeof active === 'number' && isFinite(active) && active >= 0) ? active : 0;
  const pct = calculateUtilizationPct(activeVal, maxVal);
  if (activeVal > maxVal || pct >= 95) return 'critical';
  if (pct >= 70) return 'warning';
  return 'healthy';
}

/**
 * Status message mirroring frontend indicator logic.
 */
function getConcurrencyStatusMessage(active, concurrency) {
  const maxVal = (typeof concurrency === 'number' && isFinite(concurrency)) ? concurrency : 0;
  const activeVal = (typeof active === 'number' && isFinite(active) && active >= 0) ? active : 0;
  if (maxVal <= 0) return 'Concurrency is disabled for your org.';
  const pct = calculateUtilizationPct(activeVal, maxVal);
  if (activeVal > maxVal || pct >= 100) return 'Concurrency limit reached.';
  if (pct >= 95) return 'Near capacity limit.';
  if (pct >= 70) return 'Approaching limit.';
  return 'Healthy utilization.';
}

module.exports = {
  calculateUtilizationPct,
  getConcurrencyLevel,
  getConcurrencyStatusMessage
};


