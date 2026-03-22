// ── M-13 Engine 13.1: IST Timestamp Utility ──────
// All timestamps in Asia/Kolkata (UTC+5:30)
// India does NOT observe DST — always UTC+5:30

const IST_TZ = 'Asia/Kolkata';

/**
 * Returns current IST Date object
 */
const nowIST = () => new Date();

/**
 * Formats a date to IST display string
 * Output: "16 Mar 2026 10:30 AM"
 */
const formatIST = (date = new Date()) => {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(date));
};

/**
 * Formats date only (no time)
 * Output: "16 Mar 2026"
 */
const formatDateIST = (date = new Date()) => {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: IST_TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(date));
};

/**
 * Calculate car age in days (M-13 Engine 13.5)
 * If sold: soldDate - purchaseDate (frozen)
 * If available: today - purchaseDate (live)
 */
const carAgeDays = (purchaseDate, soldDate = null) => {
  if (!purchaseDate) return 0;
  const end = soldDate ? new Date(soldDate) : new Date();
  const start = new Date(purchaseDate);
  return Math.max(0, Math.floor((end - start) / 86400000));
};

/**
 * Add hours to a date (for profit deadline)
 */
const addHours = (date, hours) => {
  const d = new Date(date);
  d.setHours(d.getHours() + hours);
  return d;
};

module.exports = { nowIST, formatIST, formatDateIST, carAgeDays, addHours, IST_TZ };
