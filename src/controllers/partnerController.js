const User        = require('../models/User');
const Investment  = require('../models/Investment');
const Transaction = require('../models/Transaction');
const Profit      = require('../models/Profit');
const RefundRequest = require('../models/RefundRequest');
const Settings    = require('../models/Settings');
const { calculateBalance } = require('../utils/balanceEngine');
const { carAgeDays, formatIST } = require('../utils/ist');

// ── GET /api/partner/dashboard ────────────────────
const getPartnerDashboard = async (req, res, next) => {
  try {
    const uid = req.user._id;
    const [balance, activeInvs, profits, recentTxns] = await Promise.all([
      calculateBalance(uid),
      Investment.find({ user: uid, status: 'active' })
        .populate('car', 'carId make model year investmentStatus totalCost purchaseDate sale group')
        .populate('group', 'name series'),
      Profit.find({ user: uid })
        .populate('car', 'carId make model year')
        .sort({ saleDate: -1 }).limit(10),
      Transaction.find({ user: uid }).sort({ date: -1 }).limit(5),
    ]);

    const profitEarned   = profits.reduce((s,p)=>s+p.profitAmount,0);
    const profitCredited = profits.filter(p=>p.status==='credited').reduce((s,p)=>s+p.profitAmount,0);
    const profitPending  = profits.filter(p=>p.status==='pending').reduce((s,p)=>s+p.profitAmount,0);

    res.json({
      success: true,
      wallet: {
        ...balance,
        profitEarned, profitCredited, profitPending,
        carsActive: activeInvs.length,
        carsSold:   profits.filter((p,i,a) => a.findIndex(x=>x.car?._id?.toString()===p.car?._id?.toString())===i).length,
      },
      activeInvestments: activeInvs.map(inv => ({
        _id:    inv._id,
        amount: inv.amount,
        date:   formatIST(inv.date),
        sharePct: inv.car?.totalCost
          ? parseFloat(((inv.amount / inv.car.totalCost) * 100).toFixed(2)) : 0,
        car: {
          _id:   inv.car?._id,
          carId: inv.car?.carId,
          make:  inv.car?.make,
          model: inv.car?.model,
          year:  inv.car?.year,
          investmentStatus: inv.car?.investmentStatus,
          ageDays: carAgeDays(inv.car?.purchaseDate, inv.car?.sale?.soldDate),
        },
        group: inv.group ? { name: inv.group.name } : null,
      })),
      recentProfits: profits.slice(0,5).map(p => ({
        profitId:   p.profitId,
        carId:      p.car?.carId,
        carName:    (p.car?.make||'') + ' ' + (p.car?.model||''),
        profitAmount: p.profitAmount,
        sharePct:   p.sharePct,
        status:     p.status,
        saleDate:   formatIST(p.saleDate),
        creditedAt: p.creditedAt ? formatIST(p.creditedAt) : null,
      })),
      recentTransactions: recentTxns.map(t => ({
        txnId:  t.txnId, type: t.type,
        amount: t.amount, date: formatIST(t.date),
      })),
    });
  } catch (err) { next(err); }
};

// ── GET /api/partner/investments ──────────────────
const getPartnerInvestments = async (req, res, next) => {
  try {
    const uid  = req.user._id;
    const invs = await Investment.find({ user: uid })
      .populate({
        path: 'car',
        select: 'carId make model year fuel transmission color investmentStatus totalCost purchaseDate sale photos group commissionPct',
        populate: { path: 'group', select: 'name series' },
      })
      .sort({ date: -1 });

    res.json({
      success: true,
      count: invs.length,
      investments: invs.map(inv => ({
        _id:    inv._id,
        amount: inv.amount,
        status: inv.status,
        date:   formatIST(inv.date),
        sharePct: inv.car?.totalCost
          ? parseFloat(((inv.amount / inv.car.totalCost) * 100).toFixed(2)) : 0,
        car: {
          _id:   inv.car?._id,
          carId: inv.car?.carId,
          make:  inv.car?.make,
          model: inv.car?.model,
          year:  inv.car?.year,
          fuel:  inv.car?.fuel,
          transmission: inv.car?.transmission,
          color: inv.car?.color,
          investmentStatus: inv.car?.investmentStatus,
          totalCost: inv.car?.totalCost,
          ageDays: carAgeDays(inv.car?.purchaseDate, inv.car?.sale?.soldDate),
          soldDate: inv.car?.sale?.soldDate ? formatIST(inv.car.sale.soldDate) : null,
          photos: inv.car?.photos || [],
          group:  inv.car?.group ? { name: inv.car.group.name, series: inv.car.group.series } : null,
          // No dealer, buyer, commission, other investors
        },
      })),
    });
  } catch (err) { next(err); }
};

// ── GET /api/partner/profits ──────────────────────
const getPartnerProfits = async (req, res, next) => {
  try {
    const uid     = req.user._id;
    const profits = await Profit.find({ user: uid })
      .populate('car', 'carId make model year')
      .sort({ saleDate: -1 });

    res.json({
      success: true,
      count: profits.length,
      profits: profits.map(p => ({
        _id:            p._id,
        profitId:       p.profitId,
        carId:          p.car?.carId,
        carName:        (p.car?.make||'') + ' ' + (p.car?.model||''),
        carYear:        p.car?.year,
        investmentAmount: p.investmentAmount,
        sharePct:         p.sharePct,
        profitAmount:     p.profitAmount,
        // Formula hidden — partner sees share% and amount only
        status:           p.status,
        saleDate:         formatIST(p.saleDate),
        creditedAt:       p.creditedAt ? formatIST(p.creditedAt) : null,
        proof:            p.proof,
        // No deadline shown to partner
      })),
      totals: {
        earned:   profits.reduce((s,p)=>s+p.profitAmount,0),
        credited: profits.filter(p=>p.status==='credited').reduce((s,p)=>s+p.profitAmount,0),
        pending:  profits.filter(p=>p.status==='pending').reduce((s,p)=>s+p.profitAmount,0),
      },
    });
  } catch (err) { next(err); }
};

// ── GET /api/partner/transactions ─────────────────
const getPartnerTransactions = async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const uid   = req.user._id;
    const skip  = (Number(page)-1)*Number(limit);
    const total = await Transaction.countDocuments({ user: uid });
    const txns  = await Transaction.find({ user: uid })
      .sort({ date: -1 }).skip(skip).limit(Number(limit));

    const balance = await calculateBalance(uid);

    res.json({
      success: true,
      count: txns.length, total,
      balance,
      transactions: txns.map(t => ({
        _id:         t._id,
        txnId:       t.txnId,
        type:        t.type,
        amount:      t.amount,
        mode:        t.mode,
        referenceNo: t.referenceNo,
        notes:       t.notes,
        proof:       t.proof,
        balanceAfter:t.balanceAfter,
        date:        formatIST(t.date),
      })),
    });
  } catch (err) { next(err); }
};

// ── POST /api/partner/refund-request ─────────────
const requestRefund = async (req, res, next) => {
  try {
    const { reason, notes } = req.body;
    if (!reason) return res.status(400).json({ success: false, message: 'Reason is required.' });

    const settings = await Settings.getSingleton();
    const balance  = await calculateBalance(req.user._id);

    if (balance.available <= 0) {
      return res.status(400).json({ success: false, message: 'No available balance to refund.' });
    }

    // Check 90-day window from first deposit
    const firstDeposit = await Transaction.findOne({ user: req.user._id, type: 'credit' }).sort({ date: 1 });
    if (!firstDeposit) return res.status(400).json({ success: false, message: 'No deposits found.' });
    const daysSince = Math.floor((Date.now() - firstDeposit.date) / 86400000);
    if (daysSince < settings.depositReturnWindowDays) {
      return res.status(400).json({
        success: false,
        message: `Refund available after ${settings.depositReturnWindowDays} days. ${settings.depositReturnWindowDays - daysSince} days remaining.`,
      });
    }

    // Check no existing pending request
    const existing = await RefundRequest.findOne({ user: req.user._id, status: 'pending' });
    if (existing) return res.status(400).json({ success: false, message: 'A pending refund request already exists.' });

    const partner = await User.findById(req.user._id);
    const refund  = await RefundRequest.create({
      user:   req.user._id,
      amount: balance.available,
      reason, notes: notes||'',
      bankSnapshot: {
        bankName:  partner.bank?.bankName  || '',
        accountNo: partner.bank?.accountNo || '',
        ifsc:      partner.bank?.ifsc      || '',
      },
    });

    res.status(201).json({
      success: true,
      message: `Refund request of ₹${balance.available.toLocaleString('en-IN')} submitted.`,
      refund,
    });
  } catch (err) { next(err); }
};

// ── GET /api/partner/refund-requests ─────────────
const getRefundRequests = async (req, res, next) => {
  try {
    const reqs = await RefundRequest.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, refunds: reqs });
  } catch (err) { next(err); }
};

// ── GET /api/partner/profile ──────────────────────
const getProfile = async (req, res, next) => {
  try {
    const partner = await User.findById(req.user._id).populate('group', 'name series cap status');
    if (!partner) return res.status(404).json({ success: false, message: 'Partner not found.' });
    res.json({
      success: true,
      profile: {
        _id:     partner._id,
        userId:  partner.userId,
        name:    partner.name,
        mobile:  partner.mobile,
        email:   partner.email,
        group:   partner.group,
        joinedAt:formatIST(partner.joinedAt),
        bank:    partner.bank,
        kyc:     partner.kyc,
        notifications: partner.notifications,
      },
    });
  } catch (err) { next(err); }
};

// ── PUT /api/partner/bank ─────────────────────────
const updateBank = async (req, res, next) => {
  try {
    const { bankName, accountNo, ifsc, branch } = req.body;
    if (!bankName || !accountNo || !ifsc) {
      return res.status(400).json({ success: false, message: 'Bank name, account number and IFSC required.' });
    }
    const partner = await User.findByIdAndUpdate(req.user._id,
      { bank: { bankName, accountNo, ifsc, branch: branch||'' } },
      { new: true }
    );
    res.json({ success: true, message: 'Bank details updated.', bank: partner.bank });
  } catch (err) { next(err); }
};

// ── PUT /api/partner/notifications ────────────────
const updateNotifications = async (req, res, next) => {
  try {
    const { whatsapp, email } = req.body;
    const partner = await User.findByIdAndUpdate(req.user._id,
      { notifications: { whatsapp: !!whatsapp, email: !!email } },
      { new: true }
    );
    res.json({ success: true, message: 'Preferences saved.', notifications: partner.notifications });
  } catch (err) { next(err); }
};

// ── POST /api/partner/kyc ─────────────────────────
const uploadKYC = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });
    const { docType } = req.body; // aadhaar | pan
    if (!['aadhaar','pan'].includes(docType)) {
      return res.status(400).json({ success: false, message: 'docType must be aadhaar or pan.' });
    }
    const partner = await User.findById(req.user._id);
    partner.kyc[docType] = { file: req.file.filename, status: 'uploaded' };
    if (partner.kyc.status === 'pending') partner.kyc.status = 'uploaded';
    await partner.save();
    res.json({ success: true, message: `${docType} uploaded. Awaiting verification.`, kyc: partner.kyc });
  } catch (err) { next(err); }
};

module.exports = {
  getPartnerDashboard, getPartnerInvestments, getPartnerProfits,
  getPartnerTransactions, requestRefund, getRefundRequests,
  getProfile, updateBank, updateNotifications, uploadKYC,
};
