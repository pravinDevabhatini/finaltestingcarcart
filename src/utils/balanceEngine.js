// ── M-13 Engine 13.3: Balance Calculation Engine ─
const Transaction = require('../models/Transaction');
const Investment  = require('../models/Investment');

/**
 * Calculate partner wallet balance
 * Available = Deposits + ProfitCredited - ActiveInvestments - Withdrawals
 */
const calculateBalance = async (userId) => {
  // All transactions for this user
  const txns = await Transaction.find({ user: userId });

  const totalDeposited = txns
    .filter(t => t.type === 'credit')
    .reduce((s, t) => s + t.amount, 0);

  const totalWithdrawn = txns
    .filter(t => t.type === 'debit')
    .reduce((s, t) => s + t.amount, 0);

  const profitCredited = txns
    .filter(t => t.type === 'profit_credit')
    .reduce((s, t) => s + t.amount, 0);

  // Active investments (not returned)
  const investments = await Investment.find({ user: userId, status: 'active' });
  const activeInvestments = investments.reduce((s, i) => s + i.amount, 0);

  const available = totalDeposited + profitCredited - activeInvestments - totalWithdrawn;

  return {
    totalDeposited,
    totalWithdrawn,
    profitCredited,
    activeInvestments,
    available: Math.max(0, available), // never negative
  };
};

/**
 * Validate investment amount against available balance
 */
const validateInvestmentBalance = async (userId, amount) => {
  const balance = await calculateBalance(userId);
  return {
    valid: balance.available >= amount,
    available: balance.available,
    requested: amount,
    message: balance.available < amount
      ? `Insufficient balance. Available: ₹${balance.available.toLocaleString('en-IN')}. Requested: ₹${amount.toLocaleString('en-IN')}.`
      : 'Balance sufficient',
  };
};

module.exports = { calculateBalance, validateInvestmentBalance };
