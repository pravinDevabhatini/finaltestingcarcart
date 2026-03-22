const Investment        = require('../models/Investment');
const InvestmentRequest = require('../models/InvestmentRequest');
const Car               = require('../models/Car');
const User              = require('../models/User');
const Settings          = require('../models/Settings');
const { calculateBalance, validateInvestmentBalance } = require('../utils/balanceEngine');
const { formatIST } = require('../utils/ist');

// ── helpers ───────────────────────────────────────
const safeInv = (i) => ({
  _id: i._id,
  car:    i.car,
  user:   i.user,
  group:  i.group,
  amount: i.amount,
  status: i.status,
  date:       formatIST(i.date),
  returnedAt: i.returnedAt ? formatIST(i.returnedAt) : null,
  createdAt:  formatIST(i.createdAt),
});

// ── GET /api/investments ──────────────────────────
const getInvestments = async (req, res, next) => {
  try {
    const { car, user, group, status, page = 1, limit = 50 } = req.query;
    const query = {};

    // Partner sees only own investments
    if (req.user.role === 'partner') query.user = req.user._id;
    else {
      if (car)   query.car   = car;
      if (user)  query.user  = user;
      if (group) query.group = group;
    }
    if (status) query.status = status;

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Investment.countDocuments(query);
    const invs  = await Investment.find(query)
      .populate('car',  'carId make model year investmentStatus totalCost')
      .populate('user', 'userId name mobile group')
      .populate('group','name series')
      .sort({ date: -1 })
      .skip(skip).limit(Number(limit));

    res.json({
      success: true,
      count: invs.length, total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      investments: invs.map(safeInv),
    });
  } catch (err) { next(err); }
};

// ── POST /api/investments ─────────────────────────
// Admin assigns investment to a partner (M-07 section 7.3)
const assignInvestment = async (req, res, next) => {
  try {
    const { carId, userId, amount } = req.body;
    if (!carId || !userId || !amount) {
      return res.status(400).json({ success: false, message: 'Car, partner and amount are required.' });
    }
    if (Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be positive.' });
    }

    // Validate car
    const car = await Car.findById(carId).populate('group');
    if (!car) return res.status(404).json({ success: false, message: 'Car not found.' });
    if (car.investmentStatus === 'sold') {
      return res.status(400).json({ success: false, message: 'Cannot invest in a sold car.' });
    }

    // Validate partner
    const partner = await User.findById(userId);
    if (!partner || partner.role !== 'partner') {
      return res.status(404).json({ success: false, message: 'Partner not found.' });
    }
    if (partner.status === 'disabled') {
      return res.status(400).json({ success: false, message: 'Partner account is disabled.' });
    }

    // Check max investors (reads from M-11 Settings — M-13 Engine 13.6)
    const settings  = await Settings.getSingleton();
    const maxInv    = settings.maxInvestorsPerCar;
    const curCount  = await Investment.countDocuments({ car: carId, status: 'active' });
    if (curCount >= maxInv) {
      return res.status(400).json({ success: false, message: `Maximum ${maxInv} investors per car reached.` });
    }

    // Check if partner already invested in this car
    const existing = await Investment.findOne({ car: carId, user: userId, status: 'active' });
    if (existing) {
      return res.status(400).json({ success: false, message: 'Partner already has an active investment in this car.' });
    }

    // Check remaining capacity on car
    const remaining = car.totalCost - car.totalInvested;
    if (Number(amount) > remaining) {
      return res.status(400).json({
        success: false,
        message: `Investment exceeds remaining capacity. Available: ₹${remaining.toLocaleString('en-IN')}.`,
      });
    }

    // Check partner balance (M-13 Engine 13.3)
    const balCheck = await validateInvestmentBalance(userId, Number(amount));
    if (!balCheck.valid) {
      return res.status(400).json({ success: false, message: balCheck.message });
    }

    // Create investment
    const inv = await Investment.create({
      car:    carId,
      user:   userId,
      group:  car.group._id,
      amount: Number(amount),
      createdBy: req.user._id,
    });

    // Update car totalInvested + status
    car.totalInvested += Number(amount);
    if (car.totalInvested >= car.totalCost) {
      car.investmentStatus = 'fully_invested';
    } else {
      car.investmentStatus = 'partially_invested';
    }
    await car.save();

    await inv.populate([
      { path: 'car',  select: 'carId make model year' },
      { path: 'user', select: 'userId name mobile' },
    ]);

    res.status(201).json({
      success: true,
      message: `Investment of ₹${Number(amount).toLocaleString('en-IN')} assigned to ${partner.name} for ${car.carId}.`,
      investment: safeInv(inv),
    });
  } catch (err) { next(err); }
};

// ── POST /api/investments/auto-distribute ─────────
// Admin auto-distributes car cost equally among selected partners
const autoDistribute = async (req, res, next) => {
  try {
    const { carId, userIds } = req.body;
    if (!carId || !userIds || !Array.isArray(userIds) || userIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Car and partner list are required.' });
    }

    const car      = await Car.findById(carId).populate('group');
    if (!car) return res.status(404).json({ success: false, message: 'Car not found.' });
    if (car.investmentStatus === 'sold') {
      return res.status(400).json({ success: false, message: 'Cannot invest in a sold car.' });
    }

    const settings = await Settings.getSingleton();
    if (userIds.length > settings.maxInvestorsPerCar) {
      return res.status(400).json({ success: false, message: `Max ${settings.maxInvestorsPerCar} investors per car.` });
    }

    // Check no existing investors
    const existing = await Investment.countDocuments({ car: carId, status: 'active' });
    if (existing > 0) {
      return res.status(400).json({ success: false, message: 'Car already has active investors. Use manual assignment.' });
    }

    const perShare = Math.floor(car.totalCost / userIds.length);
    const results  = [];
    const errors   = [];

    for (const uid of userIds) {
      try {
        const partner  = await User.findById(uid);
        if (!partner) { errors.push(`User ${uid}: not found`); continue; }

        const balCheck = await validateInvestmentBalance(uid, perShare);
        if (!balCheck.valid) { errors.push(`${partner.name}: ${balCheck.message}`); continue; }

        const inv = await Investment.create({
          car: carId, user: uid, group: car.group._id,
          amount: perShare, createdBy: req.user._id,
        });
        results.push({ partner: partner.name, amount: perShare, investmentId: inv._id });
      } catch (e) { errors.push(`User ${uid}: ${e.message}`); }
    }

    if (results.length > 0) {
      car.totalInvested    = results.length * perShare;
      car.investmentStatus = car.totalInvested >= car.totalCost ? 'fully_invested' : 'partially_invested';
      await car.save();
    }

    res.status(201).json({
      success: true,
      message: `Auto-distributed ₹${perShare.toLocaleString('en-IN')} each to ${results.length} partner(s).`,
      results, errors,
    });
  } catch (err) { next(err); }
};

// ── DELETE /api/investments/:id ───────────────────
// Remove investment (only if car not sold)
const removeInvestment = async (req, res, next) => {
  try {
    const inv = await Investment.findById(req.params.id).populate('car');
    if (!inv) return res.status(404).json({ success: false, message: 'Investment not found.' });
    if (inv.car.investmentStatus === 'sold') {
      return res.status(400).json({ success: false, message: 'Cannot remove investment from a sold car.' });
    }
    if (inv.status !== 'active') {
      return res.status(400).json({ success: false, message: 'Investment is not active.' });
    }

    // Update car totalInvested
    const car = await Car.findById(inv.car._id);
    car.totalInvested = Math.max(0, car.totalInvested - inv.amount);
    car.investmentStatus = car.totalInvested === 0 ? 'open'
      : car.totalInvested >= car.totalCost ? 'fully_invested' : 'partially_invested';
    await car.save();

    await Investment.findByIdAndDelete(req.params.id);

    res.json({
      success: true,
      message: `Investment removed. ₹${inv.amount.toLocaleString('en-IN')} returned to partner balance.`,
    });
  } catch (err) { next(err); }
};

// ── GET /api/investments/requests ────────────────
const getRequests = async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const query = {};
    if (req.user.role === 'partner') query.user = req.user._id;
    if (status) query.status = status;

    // Auto-expire
    await InvestmentRequest.updateMany(
      { status: 'pending', expiresAt: { $lt: new Date() } },
      { status: 'expired' }
    );

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await InvestmentRequest.countDocuments(query);
    const reqs  = await InvestmentRequest.find(query)
      .populate('car',  'carId make model year totalCost totalInvested investmentStatus')
      .populate('user', 'userId name mobile')
      .populate('reviewedBy', 'userId name')
      .sort({ createdAt: -1 })
      .skip(skip).limit(Number(limit));

    res.json({ success: true, count: reqs.length, total, requests: reqs });
  } catch (err) { next(err); }
};

// ── POST /api/investments/requests ───────────────
// Partner submits self-invest request
const submitRequest = async (req, res, next) => {
  try {
    const { carId, requestedAmount, notes } = req.body;
    if (!carId || !requestedAmount) {
      return res.status(400).json({ success: false, message: 'Car and amount are required.' });
    }

    const car = await Car.findById(carId);
    if (!car || car.investmentStatus === 'sold') {
      return res.status(400).json({ success: false, message: 'Car not available for investment.' });
    }

    const balCheck = await validateInvestmentBalance(req.user._id, Number(requestedAmount));
    if (!balCheck.valid) {
      return res.status(400).json({ success: false, message: balCheck.message });
    }

    // Expire in 5 hours (M-07 rule)
    const expiresAt = new Date(Date.now() + 5 * 60 * 60 * 1000);

    const request = await InvestmentRequest.create({
      user:            req.user._id,
      car:             carId,
      group:           car.group,
      requestedAmount: Number(requestedAmount),
      notes:           notes || '',
      expiresAt,
    });

    res.status(201).json({
      success: true,
      message: 'Investment request submitted. Expires in 5 hours if not actioned.',
      request,
    });
  } catch (err) { next(err); }
};

// ── PUT /api/investments/requests/:id ────────────
// Admin approves or rejects a partner request
const reviewRequest = async (req, res, next) => {
  try {
    const { action, notes } = req.body; // 'approve' | 'reject'
    if (!['approve','reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be approve or reject.' });
    }

    const request = await InvestmentRequest.findById(req.params.id).populate('car').populate('user');
    if (!request) return res.status(404).json({ success: false, message: 'Request not found.' });
    if (request.status !== 'pending') {
      return res.status(400).json({ success: false, message: `Request is already ${request.status}.` });
    }
    if (request.expiresAt < new Date()) {
      request.status = 'expired';
      await request.save();
      return res.status(400).json({ success: false, message: 'Request has expired.' });
    }

    request.status     = action === 'approve' ? 'approved' : 'rejected';
    request.reviewedBy = req.user._id;
    request.reviewedAt = new Date();
    await request.save();

    // If approved — create actual investment
    if (action === 'approve') {
      const car  = await Car.findById(request.car._id).populate('group');
      const settings = await Settings.getSingleton();
      const curCount = await Investment.countDocuments({ car: request.car._id, status: 'active' });

      if (curCount >= settings.maxInvestorsPerCar) {
        return res.status(400).json({ success: false, message: 'Car investor limit reached.' });
      }

      const balCheck = await validateInvestmentBalance(request.user._id, request.requestedAmount);
      if (!balCheck.valid) {
        return res.status(400).json({ success: false, message: balCheck.message });
      }

      await Investment.create({
        car:    request.car._id,
        user:   request.user._id,
        group:  car.group._id,
        amount: request.requestedAmount,
        createdBy: req.user._id,
      });

      car.totalInvested   += request.requestedAmount;
      car.investmentStatus = car.totalInvested >= car.totalCost ? 'fully_invested' : 'partially_invested';
      await car.save();
    }

    res.json({
      success: true,
      message: `Request ${action === 'approve' ? 'approved — investment created' : 'rejected'}.`,
      request,
    });
  } catch (err) { next(err); }
};

// ── GET /api/investments/stats ────────────────────
const getInvestmentStats = async (req, res, next) => {
  try {
    const [active, returned, totalActive, totalReturned] = await Promise.all([
      Investment.countDocuments({ status: 'active' }),
      Investment.countDocuments({ status: 'returned' }),
      Investment.aggregate([{ $match: { status: 'active' } },   { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Investment.aggregate([{ $match: { status: 'returned' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    ]);
    res.json({
      success: true,
      stats: {
        activeCount:    active,
        returnedCount:  returned,
        activeAmount:   totalActive[0]?.total   || 0,
        returnedAmount: totalReturned[0]?.total || 0,
      },
    });
  } catch (err) { next(err); }
};

module.exports = {
  getInvestments, assignInvestment, autoDistribute,
  removeInvestment, getRequests, submitRequest,
  reviewRequest, getInvestmentStats,
};
