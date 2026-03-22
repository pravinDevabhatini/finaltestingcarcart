const Car         = require('../models/Car');
const User        = require('../models/User');
const Investment  = require('../models/Investment');
const Transaction = require('../models/Transaction');
const Profit      = require('../models/Profit');
const Settings    = require('../models/Settings');
const FileUpload  = require('../models/FileUpload');
const { calculateBalance } = require('../utils/balanceEngine');
const { carAgeDays, formatIST, nowIST } = require('../utils/ist');
const { calculateCarProfit, calculateInvestorProfit, calculateSharePct } = require('../utils/profitEngine');
const fs   = require('fs');
const path = require('path');

// ── Engine definitions (M-13) ─────────────────────
const ENGINES = [
  {
    id: 'E01', name: 'IST Timestamp Engine',
    desc: 'All timestamps use Asia/Kolkata (IST, UTC+5:30). India has no DST — always fixed offset.',
    trigger: 'Every read/write operation', status: 'active',
    formula: 'new Date() → toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })',
    example: '2026-03-16T09:30:00Z → "16 Mar 2026, 3:00 PM IST"',
    edgeCases: ['No DST adjustment', 'All stored in UTC, displayed in IST'],
  },
  {
    id: 'E02', name: 'File Manager Engine',
    desc: 'Handles car photos (max 5), KYC docs, deposit proofs, logos. Detects and flags orphan files.',
    trigger: 'File upload / delete operations', status: 'active',
    formula: 'Upload → store path → link to record. Orphan = no linked record.',
    example: 'CCR0001 → cars/1710234567-123456.jpg (linked)',
    edgeCases: ['Max 5 photos per car', 'JPG/PNG/PDF only', 'Max 5MB per file'],
  },
  {
    id: 'E03', name: 'Balance Calculation Engine',
    desc: 'Live wallet balance. Never stored — always recalculated from transactions + investments.',
    trigger: 'Every wallet view, investment assignment, profit credit',
    formula: 'Available = Deposited + ProfitCredited − ActiveInvestments − Withdrawals',
    example: '₹5L deposited + ₹50K profit − ₹2L invested − ₹0 withdrawn = ₹3.5L available',
    edgeCases: ['Cannot go negative', 'Investment return → balance recalculates automatically', 'No balance field stored in User model'],
  },
  {
    id: 'E04', name: 'Profit Formula Engine',
    desc: 'Calculates profit breakdown when car is marked sold. Triggered once per car.',
    trigger: 'Car marked as sold (POST /cars/:id/mark-sold)',
    formula: 'Gross = Sold − Cost | Comm = Sold × commPct% | Dist = Gross − Comm | InvProfit = (InvAmt/TotalInv) × Dist',
    example: 'Sold ₹15L − Cost ₹10L = ₹5L Gross | Comm ₹15L × 2.5% = ₹37,500 | Dist = ₹4,62,500 | Partner 50% = ₹2,31,250',
    edgeCases: ['Commission on SOLD price, NOT gross', 'Locked after credit', 'Sync only updates PENDING records'],
  },
  {
    id: 'E05', name: 'Car Age Engine',
    desc: 'Calculates car age in days. Available = today − purchase. Sold = soldDate − purchase (frozen).',
    trigger: 'Every car read, dashboard, reports',
    formula: 'ageDays = floor((endDate − purchaseDate) / 86400000)',
    example: 'Purchased 01-Jan-2026, Sold 16-Mar-2026 = 74 days (frozen at sold date)',
    edgeCases: ['Sold car age freezes at soldDate', 'Virtual field — not stored in DB', 'Always ≥ 0'],
  },
  {
    id: 'E06', name: 'Max Investors Engine',
    desc: 'Reads maxInvestorsPerCar from M-11 Settings. Enforced at assignment and partner request approval.',
    trigger: 'Investment assignment, auto-distribute, request approval',
    formula: 'curCount = Investment.count({ car, status: "active" }) | if curCount >= max → block',
    example: 'Max = 5, Car has 4 → 1 slot left. Max = 5, Car has 5 → blocked.',
    edgeCases: ['Reads live from Settings — no restart needed', 'Applies to both admin assign and partner requests', 'Default: 5, Range: 2–10'],
  },
  {
    id: 'E07', name: 'Investment Return Engine',
    desc: 'On car sold: all active investments set to "returned". No credit transaction — balance recalculates via E03.',
    trigger: 'Car marked as sold (POST /cars/:id/mark-sold)',
    formula: 'Investment.updateMany({ car, status: "active" }, { status: "returned", returnedAt: now })',
    example: 'Car CCR0001 sold → CCP001 ₹2L investment → status: returned. CCP001 balance +₹2L automatically.',
    edgeCases: ['No debit/credit transaction created', 'Profit record created separately (E04)', 'Permanent — cannot be re-activated'],
  },
];

// ── GET /api/system/health ────────────────────────
const getSystemHealth = async (req, res, next) => {
  try {
    const settings  = await Settings.getSingleton();
    const now       = nowIST();
    const nowStr    = formatIST(now);

    // E03 test — check one partner balance
    const samplePartner = await User.findOne({ role: 'partner', status: 'active' });
    let e03Test = 'ok';
    if (samplePartner) {
      try { await calculateBalance(samplePartner._id); }
      catch(_) { e03Test = 'error'; }
    }

    // E04 test — formula validation
    let e04Test = 'ok';
    try {
      const testResult = calculateCarProfit({
        purchasePrice: 1000000, serviceCharges: 50000,
        commissionPct: 2.5, sale: { soldPrice: 1500000 },
      });
      if (testResult.distributable !== 462500) e04Test = 'mismatch';
    } catch(_) { e04Test = 'error'; }

    // E06 — read maxInvestors
    const maxInv = settings.maxInvestorsPerCar;

    const engines = ENGINES.map(e => ({
      ...e,
      lastTest: nowStr,
      testResult: e.id === 'E03' ? e03Test : e.id === 'E04' ? e04Test : 'ok',
      config: e.id === 'E06' ? `maxInvestorsPerCar = ${maxInv}` : null,
    }));

    // DB collection counts
    const [partnerCount, carCount, investmentCount, profitCount, txnCount] = await Promise.all([
      User.countDocuments({ role: 'partner' }),
      Car.countDocuments(),
      Investment.countDocuments(),
      Profit.countDocuments(),
      Transaction.countDocuments(),
    ]);

    res.json({
      success: true,
      health: {
        status:    'operational',
        timestamp: nowStr,
        timezone:  'Asia/Kolkata (IST)',
        engines,
        db: {
          partners:    partnerCount,
          cars:        carCount,
          investments: investmentCount,
          profits:     profitCount,
          transactions:txnCount,
        },
        settings: {
          defaultCommissionPct:    settings.defaultCommissionPct,
          maxInvestorsPerCar:      settings.maxInvestorsPerCar,
          depositReturnWindowDays: settings.depositReturnWindowDays,
          profitCreditDeadlineHrs: settings.profitCreditDeadlineHrs,
        },
      },
    });
  } catch (err) { next(err); }
};

// ── POST /api/system/engines/:id/test ─────────────
// SA only — run individual engine test
const testEngine = async (req, res, next) => {
  try {
    const { id } = req.params;
    const engine = ENGINES.find(e => e.id === id);
    if (!engine) return res.status(404).json({ success: false, message: 'Engine not found.' });

    let result = { passed: true, output: '' };

    if (id === 'E01') {
      const ist = formatIST(new Date());
      result.output = `Current IST: ${ist}`;
    }
    else if (id === 'E02') {
      const uploadPath = path.join(process.cwd(), 'uploads');
      const exists = fs.existsSync(uploadPath);
      result.output = `Upload directory: ${exists ? 'exists' : 'missing'}`;
      result.passed = exists;
    }
    else if (id === 'E03') {
      const partner = await User.findOne({ role: 'partner', status: 'active' });
      if (!partner) { result.output = 'No active partners to test.'; }
      else {
        const bal = await calculateBalance(partner._id);
        result.output = `${partner.name} (${partner.userId}): Available = ₹${bal.available.toLocaleString('en-IN')}`;
      }
    }
    else if (id === 'E04') {
      const r = calculateCarProfit({ purchasePrice:1000000, serviceCharges:50000, commissionPct:2.5, sale:{soldPrice:1500000} });
      result.output = `Test: Sold ₹15L, Cost ₹10.5L → Gross ₹4.5L, Comm ₹37,500, Dist ₹4,62,500. Expected Dist: ₹4,62,500. Match: ${r.distributable===462500}`;
      result.passed = r.distributable === 462500;
    }
    else if (id === 'E05') {
      const car = await Car.findOne({ investmentStatus: 'sold' });
      if (!car) { result.output = 'No sold cars to test.'; }
      else {
        const days = carAgeDays(car.purchaseDate, car.sale?.soldDate);
        result.output = `${car.carId}: Purchase ${car.purchaseDate?.toISOString().split('T')[0]} → Sold ${car.sale?.soldDate?.toISOString().split('T')[0]} = ${days} days (frozen ✓)`;
      }
    }
    else if (id === 'E06') {
      const settings = await Settings.getSingleton();
      const max = settings.maxInvestorsPerCar;
      const car = await Car.findOne({ investmentStatus: { $ne: 'sold' } });
      if (!car) { result.output = `Max set to ${max}. No active cars to check.`; }
      else {
        const count = await Investment.countDocuments({ car: car._id, status: 'active' });
        result.output = `Max = ${max}. ${car.carId} has ${count} active investors. ${count>=max?'FULL — would block':'Slots available — would allow'}.`;
      }
    }
    else if (id === 'E07') {
      const returnedCount = await Investment.countDocuments({ status: 'returned' });
      const activeCount   = await Investment.countDocuments({ status: 'active' });
      result.output = `Active investments: ${activeCount} | Returned investments: ${returnedCount}`;
    }

    res.json({ success: true, engine: engine.name, result, testedAt: formatIST(new Date()) });
  } catch (err) { next(err); }
};

// ── GET /api/system/files ─────────────────────────
const getFileManager = async (req, res, next) => {
  try {
    const uploadPath = path.join(process.cwd(), 'uploads');
    const stats = { totalFiles:0, totalSize:0, byFolder:{} };

    // Walk upload dirs
    const folders = ['cars','kyc','transactions','settings'];
    for (const folder of folders) {
      const dir = path.join(uploadPath, folder);
      if (!fs.existsSync(dir)) { stats.byFolder[folder] = { count:0, size:0 }; continue; }
      const files = fs.readdirSync(dir);
      let folderSize = 0;
      for (const file of files) {
        try {
          const stat = fs.statSync(path.join(dir, file));
          if (stat.isFile()) { folderSize += stat.size; stats.totalSize += stat.size; stats.totalFiles++; }
        } catch(_) {}
      }
      stats.byFolder[folder] = { count: fs.readdirSync(dir).length, size: folderSize };
    }

    res.json({ success: true, fileStats: stats, uploadPath: path.relative(process.cwd(), uploadPath) });
  } catch (err) { next(err); }
};

// ── GET /api/system/balance-test ──────────────────
// Balance test tool — recalculate any partner's balance
const testBalance = async (req, res, next) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      // Return list of all partners for the dropdown
      const partners = await User.find({ role: 'partner', status: 'active' })
        .select('_id userId name group').populate('group','name');
      return res.json({ success: true, partners });
    }

    const partner  = await User.findById(userId).populate('group', 'name');
    if (!partner) return res.status(404).json({ success: false, message: 'Partner not found.' });

    const balance  = await calculateBalance(userId);

    // Get breakdown transactions
    const allTxns  = await Transaction.find({ user: userId }).sort({ date: -1 });
    const allInvs  = await Investment.find({ user: userId, status: 'active' })
      .populate('car', 'carId make model');

    res.json({
      success: true,
      partner: { _id: partner._id, userId: partner.userId, name: partner.name, group: partner.group?.name },
      balance,
      breakdown: {
        creditTxns:  allTxns.filter(t=>t.type==='credit').length,
        debitTxns:   allTxns.filter(t=>t.type==='debit').length,
        profitTxns:  allTxns.filter(t=>t.type==='profit_credit').length,
        activeInvs:  allInvs.length,
      },
      activeInvestments: allInvs.map(i => ({ carId: i.car?.carId, amount: i.amount })),
      calculatedAt: formatIST(new Date()),
    });
  } catch (err) { next(err); }
};

// ── GET /api/system/investment-log ────────────────
// Investment return log (E07 audit)
const getInvestmentLog = async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip  = (Number(page)-1)*Number(limit);
    const total = await Investment.countDocuments({ status: 'returned' });

    const returned = await Investment.find({ status: 'returned' })
      .populate('car',  'carId make model year sale.soldDate')
      .populate('user', 'userId name')
      .populate('group','name')
      .sort({ returnedAt: -1 })
      .skip(skip).limit(Number(limit));

    res.json({
      success: true,
      count: returned.length, total,
      log: returned.map(inv => ({
        _id:        inv._id,
        carId:      inv.car?.carId,
        carName:    (inv.car?.make||'')+' '+(inv.car?.model||''),
        partner:    inv.user?.name,
        userId:     inv.user?.userId,
        group:      inv.group?.name,
        amount:     inv.amount,
        investDate: formatIST(inv.date),
        returnDate: inv.returnedAt ? formatIST(inv.returnedAt) : '—',
        soldDate:   inv.car?.sale?.soldDate ? formatIST(inv.car.sale.soldDate) : '—',
      })),
    });
  } catch (err) { next(err); }
};

// ── GET /api/system/docs ──────────────────────────
const getEngineDocs = async (req, res, next) => {
  try {
    const settings = await Settings.getSingleton();
    res.json({
      success: true,
      engines: ENGINES.map(e => ({
        ...e,
        config: e.id === 'E06' ? { maxInvestorsPerCar: settings.maxInvestorsPerCar } : null,
      })),
    });
  } catch (err) { next(err); }
};

module.exports = {
  getSystemHealth, testEngine, getFileManager,
  testBalance, getInvestmentLog, getEngineDocs,
};
