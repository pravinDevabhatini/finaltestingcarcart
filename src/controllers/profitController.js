const Profit      = require('../models/Profit');
const Transaction = require('../models/Transaction');
const Car         = require('../models/Car');
const User        = require('../models/User');
const Settings    = require('../models/Settings');
const { formatIST, carAgeDays } = require('../utils/ist');

// ── helpers ───────────────────────────────────────
const safeProfit = (p) => ({
  _id: p._id, profitId: p.profitId,
  car:    p.car,
  user:   p.user,
  group:  p.group,
  investmentAmount: p.investmentAmount,
  sharePct:         p.sharePct,
  // Financial snapshot (hidden from partners — formula not shown)
  ...(p._showFormula ? {
    purchasePrice:  p.purchasePrice,
    serviceCharges: p.serviceCharges,
    totalCost:      p.totalCost,
    soldPrice:      p.soldPrice,
    grossProfit:    p.grossProfit,
    commissionPct:  p.commissionPct,
    commissionAmt:  p.commissionAmt,
    distributable:  p.distributable,
  } : {}),
  profitAmount:  p.profitAmount,
  saleDate:      formatIST(p.saleDate),
  creditDeadline:formatIST(p.creditDeadline),
  status:        p.status,
  proof:         p.proof,
  notes:         p.notes,
  creditedAt:    p.creditedAt ? formatIST(p.creditedAt) : null,
  locked:        p.locked,
  createdAt:     formatIST(p.createdAt),
});

// Deadline status helper — drives colour badges in frontend
const deadlineStatus = (creditDeadline, status) => {
  if (status === 'credited') return 'credited';
  const now       = Date.now();
  const deadline  = new Date(creditDeadline).getTime();
  const remaining = deadline - now;
  if (remaining < 0)  return 'overdue';
  const settings  = 24; // hrs — read dynamically below
  if (remaining < settings * 0.25 * 3600000) return 'urgent'; // last 25%
  return 'ok';
};

// ── GET /api/profits ──────────────────────────────
const getProfits = async (req, res, next) => {
  try {
    const { car, user, group, status, page = 1, limit = 50 } = req.query;
    const query = {};

    if (req.user.role === 'partner') query.user = req.user._id;
    else {
      if (car)   query.car   = car;
      if (user)  query.user  = user;
      if (group) query.group = group;
    }
    if (status) query.status = status;

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Profit.countDocuments(query);
    const profits = await Profit.find(query)
      .populate('car',  'carId make model year sale')
      .populate('user', 'userId name mobile bank')
      .populate('group','name series')
      .populate('creditedBy','userId name')
      .sort({ saleDate: -1 })
      .skip(skip).limit(Number(limit));

    // Show formula only to SA/AD/AC
    const showFormula = req.user.role !== 'partner';

    const settings = await Settings.getSingleton();

    res.json({
      success: true,
      count: profits.length, total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      profits: profits.map(p => ({
        ...safeProfit({ ...p.toObject(), _showFormula: showFormula }),
        deadlineStatus: deadlineStatus(p.creditDeadline, p.status),
        hoursRemaining: Math.max(0, Math.ceil((new Date(p.creditDeadline) - Date.now()) / 3600000)),
      })),
    });
  } catch (err) { next(err); }
};

// ── GET /api/profits/:id ──────────────────────────
const getProfit = async (req, res, next) => {
  try {
    const profit = await Profit.findById(req.params.id)
      .populate('car',  'carId make model year group sale purchasePrice serviceCharges totalCost commissionPct')
      .populate('user', 'userId name mobile bank')
      .populate('group','name series')
      .populate('creditedBy','userId name');

    if (!profit) return res.status(404).json({ success: false, message: 'Profit record not found.' });

    // Partners can only view own
    if (req.user.role === 'partner' && profit.user._id.toString() !== req.user._id.toString()) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const showFormula = req.user.role !== 'partner';
    res.json({
      success: true,
      profit: {
        ...safeProfit({ ...profit.toObject(), _showFormula: showFormula }),
        deadlineStatus: deadlineStatus(profit.creditDeadline, profit.status),
        hoursRemaining: Math.max(0, Math.ceil((new Date(profit.creditDeadline) - Date.now()) / 3600000)),
      },
    });
  } catch (err) { next(err); }
};

// ── POST /api/profits/:id/credit ──────────────────
// AC / AD / SA — credit profit to partner
const creditProfit = async (req, res, next) => {
  try {
    const { notes, proof } = req.body;

    const profit = await Profit.findById(req.params.id).populate('user').populate('car');
    if (!profit) return res.status(404).json({ success: false, message: 'Profit record not found.' });
    if (profit.status === 'credited') {
      return res.status(400).json({ success: false, message: 'Profit already credited. Locked record.' });
    }
    if (profit.locked) {
      return res.status(400).json({ success: false, message: 'Record is locked and cannot be modified.' });
    }

    // Mark credited — pre-save hook locks the record + sets creditedAt
    profit.status    = 'credited';
    profit.notes     = notes || '';
    profit.proof     = proof || req.file?.filename || null;
    profit.creditedBy = req.user._id;
    await profit.save();

    // Create profit_credit transaction (wallet increases)
    await Transaction.create({
      user:        profit.user._id,
      type:        'profit_credit',
      amount:      profit.profitAmount,
      mode:        'bank_transfer',
      referenceNo: profit.profitId,
      notes:       `Profit credit for ${profit.car?.carId || 'car'}`,
      balanceAfter: 0, // recalculated on wallet view
      createdBy:   req.user._id,
    });

    await profit.populate('creditedBy', 'userId name');
    res.json({
      success: true,
      message: `Profit of ₹${profit.profitAmount.toLocaleString('en-IN')} credited to ${profit.user.name}.`,
      profit: safeProfit({ ...profit.toObject(), _showFormula: true }),
    });
  } catch (err) { next(err); }
};

// ── POST /api/profits/sync ────────────────────────
// Recalculate pending profit records for a car
// Only recalculates PENDING records — credited records are locked (M-08 rule)
const syncProfits = async (req, res, next) => {
  try {
    const { carId } = req.body;
    if (!carId) return res.status(400).json({ success: false, message: 'Car ID required.' });

    const car = await Car.findById(carId);
    if (!car || car.investmentStatus !== 'sold') {
      return res.status(400).json({ success: false, message: 'Car not found or not sold.' });
    }

    const pendingProfits = await Profit.find({ car: carId, status: 'pending' });
    if (pendingProfits.length === 0) {
      return res.json({ success: true, message: 'No pending profits to sync.', updated: 0 });
    }

    // Recalculate based on current car sale data
    const totalInvested = pendingProfits.reduce((s, p) => s + p.investmentAmount, 0);
    const { calculateInvestorProfit, calculateSharePct } = require('../utils/profitEngine');

    let updated = 0;
    for (const p of pendingProfits) {
      const { grossProfit, commission, distributable } = {
        grossProfit:  car.sale.soldPrice - car.totalCost,
        commission:   Math.round(car.sale.soldPrice * car.commissionPct / 100),
        distributable: (car.sale.soldPrice - car.totalCost) - Math.round(car.sale.soldPrice * car.commissionPct / 100),
      };
      p.grossProfit    = grossProfit;
      p.commissionAmt  = commission;
      p.distributable  = distributable;
      p.sharePct       = calculateSharePct(p.investmentAmount, totalInvested);
      p.profitAmount   = calculateInvestorProfit(p.investmentAmount, totalInvested, distributable);
      await p.save();
      updated++;
    }

    res.json({ success: true, message: `${updated} pending profit records synced.`, updated });
  } catch (err) { next(err); }
};

// ── GET /api/profits/summary ──────────────────────
const getProfitSummary = async (req, res, next) => {
  try {
    const [pending, credited, totalPending, totalCredited, overdueCount] = await Promise.all([
      Profit.countDocuments({ status: 'pending' }),
      Profit.countDocuments({ status: 'credited' }),
      Profit.aggregate([{ $match: { status: 'pending' } },  { $group: { _id: null, total: { $sum: '$profitAmount' } } }]),
      Profit.aggregate([{ $match: { status: 'credited' } }, { $group: { _id: null, total: { $sum: '$profitAmount' } } }]),
      Profit.countDocuments({ status: 'pending', creditDeadline: { $lt: new Date() } }),
    ]);

    res.json({
      success: true,
      summary: {
        pendingCount:  pending,
        creditedCount: credited,
        pendingAmount: totalPending[0]?.total  || 0,
        creditedAmount:totalCredited[0]?.total || 0,
        overdueCount,
      },
    });
  } catch (err) { next(err); }
};

// ── GET /api/profits/by-car/:carId ────────────────
// All profit records for one car — used in M-08 section 8.2
const getProfitsByCar = async (req, res, next) => {
  try {
    const profits = await Profit.find({ car: req.params.carId })
      .populate('user', 'userId name mobile bank')
      .populate('creditedBy', 'userId name');

    const car = await Car.findById(req.params.carId).populate('group', 'name');
    if (!car) return res.status(404).json({ success: false, message: 'Car not found.' });

    const totalDistributable = profits.reduce((s, p) => s + p.profitAmount, 0);

    res.json({
      success: true,
      car: {
        carId: car.carId, make: car.make, model: car.model, year: car.year,
        group: car.group, soldPrice: car.sale?.soldPrice, soldDate: car.sale?.soldDate,
        grossProfit: car.profit?.grossProfit, commission: car.profit?.commission,
        distributable: car.profit?.distributable,
      },
      profits: profits.map(p => ({
        ...safeProfit({ ...p.toObject(), _showFormula: true }),
        deadlineStatus: deadlineStatus(p.creditDeadline, p.status),
      })),
      totalDistributable,
    });
  } catch (err) { next(err); }
};

module.exports = {
  getProfits, getProfit, creditProfit,
  syncProfits, getProfitSummary, getProfitsByCar,
};
