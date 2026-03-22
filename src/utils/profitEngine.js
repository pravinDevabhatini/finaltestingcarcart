// ── M-13 Engine 13.4: Profit Formula Engine ──────
// Auto-calculates profit on car mark-sold

/**
 * Calculate car profit breakdown
 * Commission = Sold Price × commissionPct% (NOT Gross × %)
 */
const calculateCarProfit = (car) => {
  const totalCost   = car.purchasePrice + car.serviceCharges;
  const soldPrice   = car.sale.soldPrice;
  const grossProfit = soldPrice - totalCost;
  const commission  = Math.round(soldPrice * car.commissionPct / 100);
  const distributable = grossProfit - commission;
  return { grossProfit, commission, distributable };
};

/**
 * Calculate per-investor profit share
 */
const calculateInvestorProfit = (investmentAmount, totalInvested, distributable) => {
  if (!totalInvested || totalInvested === 0) return 0;
  const sharePct = investmentAmount / totalInvested;
  return Math.round(sharePct * distributable);
};

/**
 * Calculate share percentage
 */
const calculateSharePct = (investmentAmount, totalInvested) => {
  if (!totalInvested || totalInvested === 0) return 0;
  return parseFloat(((investmentAmount / totalInvested) * 100).toFixed(2));
};

module.exports = { calculateCarProfit, calculateInvestorProfit, calculateSharePct };
