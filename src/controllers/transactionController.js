const Transaction    = require('../models/Transaction');
const RefundRequest  = require('../models/RefundRequest');
const User           = require('../models/User');
const Settings       = require('../models/Settings');
const { calculateBalance } = require('../utils/balanceEngine');
const { formatIST }        = require('../utils/ist');

// ── helpers ───────────────────────────────────────
const safeTxn = (t) => ({
  _id: t._id, txnId: t.txnId,
  user:   t.user,
  type:   t.type,
  amount: t.amount,
  mode:   t.mode,
  referenceNo:  t.referenceNo,
  notes:        t.notes,
  proof:        t.proof,
  balanceAfter: t.balanceAfter,
  date:         formatIST(t.date),
  createdAt:    formatIST(t.createdAt),
});

// ── GET /api/transactions ─────────────────────────
// SA/AD/AC: all  |  Partner: own only
const getTransactions = async (req, res, next) => {
  try {
    const { user, type, page = 1, limit = 50 } = req.query;
    const query = {};

    if (req.user.role === 'partner') {
      query.user = req.user._id;
    } else if (user) {
      query.user = user;
    }
    if (type) query.type = type;

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Transaction.countDocuments(query);
    const txns  = await Transaction.find(query)
      .populate('user', 'userId name mobile group')
      .sort({ date: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({
      success: true,
      count: txns.length, total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      transactions: txns.map(safeTxn),
    });
  } catch (err) { next(err); }
};

// ── POST /api/transactions/deposit ────────────────
// AC, AD, SA only — add deposit for a partner
const addDeposit = async (req, res, next) => {
  try {
    const { userId, amount, mode, referenceNo, notes, date } = req.body;
    if (!userId || !amount || !mode) {
      return res.status(400).json({ success: false, message: 'User, amount and payment mode are required.' });
    }
    if (Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be positive.' });
    }

    const partner = await User.findById(userId).populate('group');
    if (!partner || partner.role !== 'partner') {
      return res.status(404).json({ success: false, message: 'Partner not found.' });
    }
    if (partner.status === 'disabled') {
      return res.status(400).json({ success: false, message: 'Cannot add deposit for a disabled partner.' });
    }

    // Calculate new balance after deposit
    const currentBal = await calculateBalance(userId);
    const balAfter   = currentBal.available + Number(amount);

    const txn = await Transaction.create({
      user:        userId,
      type:        'credit',
      amount:      Number(amount),
      mode,
      referenceNo: referenceNo || '',
      notes:       notes || '',
      proof:       req.file?.filename || null,
      balanceAfter: balAfter,
      date:        date ? new Date(date) : new Date(),
      createdBy:   req.user._id,
    });

    await txn.populate('user', 'userId name mobile group');

    res.status(201).json({
      success: true,
      message: `Deposit of ₹${Number(amount).toLocaleString('en-IN')} added for ${partner.name}.`,
      transaction: safeTxn(txn),
      newBalance: balAfter,
    });
  } catch (err) { next(err); }
};

// ── GET /api/transactions/wallet/:userId ──────────
// Full wallet breakdown for a partner
const getWallet = async (req, res, next) => {
  try {
    const { userId } = req.params;

    // Partners can only view own wallet
    if (req.user.role === 'partner' && req.user._id.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const partner = await User.findById(userId).populate('group', 'name series');
    if (!partner) return res.status(404).json({ success: false, message: 'Partner not found.' });

    const balance = await calculateBalance(userId);
    const txns    = await Transaction.find({ user: userId }).sort({ date: -1 }).limit(20);

    res.json({
      success: true,
      partner: { _id: partner._id, userId: partner.userId, name: partner.name, group: partner.group },
      balance,
      recentTransactions: txns.map(safeTxn),
    });
  } catch (err) { next(err); }
};

// ── POST /api/transactions/withdraw ───────────────
// Manual withdrawal (admin processes approved refund)
const addWithdrawal = async (req, res, next) => {
  try {
    const { userId, amount, mode, referenceNo, notes, date } = req.body;
    if (!userId || !amount || !mode) {
      return res.status(400).json({ success: false, message: 'User, amount and mode are required.' });
    }

    const bal = await calculateBalance(userId);
    if (Number(amount) > bal.available) {
      return res.status(400).json({
        success: false,
        message: `Insufficient balance. Available: ₹${bal.available.toLocaleString('en-IN')}.`,
      });
    }

    const balAfter = bal.available - Number(amount);
    const txn = await Transaction.create({
      user: userId, type: 'debit',
      amount: Number(amount), mode,
      referenceNo: referenceNo || '', notes: notes || '',
      proof: req.file?.filename || null,
      balanceAfter: balAfter,
      date: date ? new Date(date) : new Date(),
      createdBy: req.user._id,
    });

    await txn.populate('user', 'userId name mobile');
    res.status(201).json({ success: true, message: 'Withdrawal recorded.', transaction: safeTxn(txn), newBalance: balAfter });
  } catch (err) { next(err); }
};

// ── GET /api/transactions/refunds ─────────────────
const getRefunds = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const query = {};
    if (req.user.role === 'partner') query.user = req.user._id;
    if (status) query.status = status;

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await RefundRequest.countDocuments(query);
    const reqs  = await RefundRequest.find(query)
      .populate('user', 'userId name mobile bank')
      .populate('processedBy', 'userId name')
      .sort({ createdAt: -1 })
      .skip(skip).limit(Number(limit));

    res.json({ success: true, count: reqs.length, total, refunds: reqs });
  } catch (err) { next(err); }
};

// ── POST /api/transactions/refunds ────────────────
// Partner submits refund request (M-06 section 6.5)
const requestRefund = async (req, res, next) => {
  try {
    const { reason, notes } = req.body;
    if (!reason) return res.status(400).json({ success: false, message: 'Reason is required.' });

    const settings = await Settings.getSingleton();
    const bal      = await calculateBalance(req.user._id);

    if (bal.available <= 0) {
      return res.status(400).json({ success: false, message: 'No available balance to refund.' });
    }

    // Check 90-day window
    const firstDeposit = await Transaction.findOne({ user: req.user._id, type: 'credit' }).sort({ date: 1 });
    if (!firstDeposit) {
      return res.status(400).json({ success: false, message: 'No deposits found.' });
    }
    const daysSince = Math.floor((Date.now() - firstDeposit.date) / 86400000);
    if (daysSince < settings.depositReturnWindowDays) {
      return res.status(400).json({
        success: false,
        message: `Refund available after ${settings.depositReturnWindowDays} days from first deposit. ${settings.depositReturnWindowDays - daysSince} days remaining.`,
      });
    }

    // Check no pending refund
    const pending = await RefundRequest.findOne({ user: req.user._id, status: 'pending' });
    if (pending) {
      return res.status(400).json({ success: false, message: 'You already have a pending refund request.' });
    }

    const partner = await User.findById(req.user._id);
    const refund  = await RefundRequest.create({
      user:   req.user._id,
      amount: bal.available, // full balance only
      reason, notes: notes || '',
      bankSnapshot: {
        bankName:  partner.bank?.bankName  || '',
        accountNo: partner.bank?.accountNo || '',
        ifsc:      partner.bank?.ifsc      || '',
      },
    });

    res.status(201).json({
      success: true,
      message: `Refund request of ₹${bal.available.toLocaleString('en-IN')} submitted.`,
      refund,
    });
  } catch (err) { next(err); }
};

// ── PUT /api/transactions/refunds/:id ─────────────
// Admin processes refund — approve / reject / complete
const processRefund = async (req, res, next) => {
  try {
    const { status, processNote, proof } = req.body;
    const validStatuses = ['approved','rejected','completed'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }

    const refund = await RefundRequest.findById(req.params.id).populate('user');
    if (!refund) return res.status(404).json({ success: false, message: 'Refund request not found.' });
    if (refund.status === 'completed') {
      return res.status(400).json({ success: false, message: 'Refund already completed.' });
    }

    refund.status      = status;
    refund.processNote = processNote || '';
    refund.processedBy = req.user._id;
    refund.processedAt = new Date();
    if (proof) refund.proof = proof;
    await refund.save();

    // If completed — create debit transaction
    if (status === 'completed') {
      const bal    = await calculateBalance(refund.user._id);
      const balAfter = bal.available - refund.amount;
      await Transaction.create({
        user:        refund.user._id,
        type:        'debit',
        amount:      refund.amount,
        mode:        'bank_transfer',
        referenceNo: `REF-${refund._id.toString().slice(-6).toUpperCase()}`,
        notes:       `Deposit refund processed`,
        balanceAfter: Math.max(0, balAfter),
        createdBy:   req.user._id,
      });
    }

    res.json({ success: true, message: `Refund ${status}.`, refund });
  } catch (err) { next(err); }
};

// ── GET /api/transactions/summary ─────────────────
// Platform-wide deposit summary for dashboard
const getDepositSummary = async (req, res, next) => {
  try {
    const [totalCredits, totalDebits, totalProfitCredits, pendingRefunds] = await Promise.all([
      Transaction.aggregate([{ $match: { type: 'credit' } },       { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Transaction.aggregate([{ $match: { type: 'debit' } },        { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Transaction.aggregate([{ $match: { type: 'profit_credit' }}, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      RefundRequest.countDocuments({ status: 'pending' }),
    ]);

    res.json({
      success: true,
      summary: {
        totalDeposited:    totalCredits[0]?.total      || 0,
        totalWithdrawn:    totalDebits[0]?.total       || 0,
        totalProfitPaid:   totalProfitCredits[0]?.total || 0,
        pendingRefunds,
      },
    });
  } catch (err) { next(err); }
};

module.exports = {
  getTransactions, addDeposit, getWallet,
  addWithdrawal, getRefunds, requestRefund,
  processRefund, getDepositSummary,
};
