const Car         = require('../models/Car');
const User        = require('../models/User');
const Group       = require('../models/Group');
const Investment  = require('../models/Investment');
const Transaction = require('../models/Transaction');
const Profit      = require('../models/Profit');
const { calculateBalance } = require('../utils/balanceEngine');
const { carAgeDays, formatIST } = require('../utils/ist');

// ── GET /api/dashboard/admin ──────────────────────
// SA, AD, AC — full platform overview
const getAdminDashboard = async (req, res, next) => {
  try {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      // Platform counters
      totalPartners, activePartners, disabledPartners,
      totalCars, openCars, partialCars, fullCars, soldCars,
      totalGroups,
      // Financial
      totalDeposits, totalWithdrawals, totalProfitPaid,
      pendingProfitCount, pendingProfitAmt,
      creditedProfitAmt,
      overdueCount,
      // This month
      depositsThisMonth, salesThisMonth,
      // Active investments
      activeInvAgg,
      // Recent activity
      recentTxns, recentSales,
    ] = await Promise.all([
      User.countDocuments({ role:'partner' }),
      User.countDocuments({ role:'partner', status:'active' }),
      User.countDocuments({ role:'partner', status:'disabled' }),
      Car.countDocuments(),
      Car.countDocuments({ investmentStatus:'open' }),
      Car.countDocuments({ investmentStatus:'partially_invested' }),
      Car.countDocuments({ investmentStatus:'fully_invested' }),
      Car.countDocuments({ investmentStatus:'sold' }),
      Group.countDocuments({ status:'open' }),
      // Financial aggregations
      Transaction.aggregate([{ $match:{ type:'credit' }},          { $group:{ _id:null, total:{ $sum:'$amount' }}}]),
      Transaction.aggregate([{ $match:{ type:'debit' }},           { $group:{ _id:null, total:{ $sum:'$amount' }}}]),
      Transaction.aggregate([{ $match:{ type:'profit_credit' }},   { $group:{ _id:null, total:{ $sum:'$amount' }}}]),
      Profit.countDocuments({ status:'pending' }),
      Profit.aggregate([{ $match:{ status:'pending' }},  { $group:{ _id:null, total:{ $sum:'$profitAmount' }}}]),
      Profit.aggregate([{ $match:{ status:'credited' }}, { $group:{ _id:null, total:{ $sum:'$profitAmount' }}}]),
      Profit.countDocuments({ status:'pending', creditDeadline:{ $lt: now }}),
      // This month
      Transaction.aggregate([{ $match:{ type:'credit', date:{ $gte: thisMonth }}}, { $group:{ _id:null, total:{ $sum:'$amount' }}}]),
      Car.countDocuments({ investmentStatus:'sold', 'sale.soldDate':{ $gte: thisMonth }}),
      // Active investments total
      Investment.aggregate([{ $match:{ status:'active' }}, { $group:{ _id:null, total:{ $sum:'$amount' }}}]),
      // Recent 5 transactions
      Transaction.find().populate('user','name userId').sort({ date:-1 }).limit(5),
      // Recent 5 car sales
      Car.find({ investmentStatus:'sold' }).populate('group','name').sort({ 'sale.soldDate':-1 }).limit(5),
    ]);

    // Group breakdown
    const groups = await Group.find({ status:'open' }).sort({ series:1, name:1 });
    const groupSummary = await Promise.all(groups.map(async g => {
      const [members, cars, invAgg] = await Promise.all([
        User.countDocuments({ group: g._id, role:'partner', status:'active' }),
        Car.countDocuments({ group: g._id }),
        Investment.aggregate([{ $match:{ group: g._id, status:'active' }}, { $group:{ _id:null, total:{ $sum:'$amount' }}}]),
      ]);
      return { _id: g._id, name: g.name, series: g.series, members, cars, activeInvested: invAgg[0]?.total||0 };
    }));

    // Monthly trend — last 6 months deposits + sales
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
    sixMonthsAgo.setDate(1);
    const monthlyDeposits = await Transaction.aggregate([
      { $match: { type:'credit', date:{ $gte: sixMonthsAgo }}},
      { $group: { _id:{ year:{ $year:'$date' }, month:{ $month:'$date' }}, total:{ $sum:'$amount' }}},
      { $sort: { '_id.year':1, '_id.month':1 }},
    ]);

    res.json({
      success: true,
      dashboard: {
        partners: { total:totalPartners, active:activePartners, disabled:disabledPartners },
        cars:     { total:totalCars, open:openCars, partial:partialCars, full:fullCars, sold:soldCars },
        groups:   totalGroups,
        financials: {
          totalDeposited:   totalDeposits[0]?.total    || 0,
          totalWithdrawn:   totalWithdrawals[0]?.total || 0,
          totalProfitPaid:  totalProfitPaid[0]?.total  || 0,
          pendingProfit:    pendingProfitAmt[0]?.total  || 0,
          creditedProfit:   creditedProfitAmt[0]?.total || 0,
          activeInvested:   activeInvAgg[0]?.total     || 0,
          pendingProfitCount,
          overdueCount,
        },
        thisMonth: {
          deposits: depositsThisMonth[0]?.total || 0,
          sales:    salesThisMonth,
        },
        groupSummary,
        recentActivity: {
          transactions: recentTxns.map(t => ({
            txnId: t.txnId, type: t.type, amount: t.amount,
            userName: t.user?.name, userId: t.user?.userId,
            date: formatIST(t.date),
          })),
          sales: recentSales.map(c => ({
            carId: c.carId, make: c.make, model: c.model,
            group: c.group?.name,
            soldPrice: c.sale?.soldPrice,
            soldDate: c.sale?.soldDate ? formatIST(c.sale.soldDate) : null,
          })),
        },
        monthlyTrend: monthlyDeposits,
        generatedAt: formatIST(new Date()),
      },
    });
  } catch (err) { next(err); }
};

// ── GET /api/dashboard/partner ────────────────────
// Partner — own data only
const getPartnerDashboard = async (req, res, next) => {
  try {
    const userId = req.user._id;

    const [
      balance,
      activeInvestments,
      profitRecords,
      recentTxns,
    ] = await Promise.all([
      calculateBalance(userId),
      Investment.find({ user: userId, status:'active' })
        .populate('car','carId make model year investmentStatus totalCost purchaseDate sale'),
      Profit.find({ user: userId })
        .populate('car','carId make model year')
        .sort({ saleDate:-1 }).limit(10),
      Transaction.find({ user: userId })
        .sort({ date:-1 }).limit(5),
    ]);

    const profitEarned   = profitRecords.reduce((s,p)=>s+p.profitAmount,0);
    const profitCredited = profitRecords.filter(p=>p.status==='credited').reduce((s,p)=>s+p.profitAmount,0);
    const profitPending  = profitRecords.filter(p=>p.status==='pending').reduce((s,p)=>s+p.profitAmount,0);

    const carsActive = activeInvestments.length;
    const carsSold   = profitRecords.length;

    // Monthly profit chart data — last 6 months
    const sixAgo = new Date();
    sixAgo.setMonth(sixAgo.getMonth()-5); sixAgo.setDate(1);
    const monthlyProfit = await Profit.aggregate([
      { $match: { user: userId, status:'credited', creditedAt:{ $gte: sixAgo }}},
      { $group: { _id:{ year:{ $year:'$creditedAt'}, month:{ $month:'$creditedAt'}}, total:{ $sum:'$profitAmount' }}},
      { $sort: { '_id.year':1,'_id.month':1 }},
    ]);

    const monthlyInv = await Transaction.aggregate([
      { $match: { user: userId, type:'credit', date:{ $gte: sixAgo }}},
      { $group: { _id:{ year:{ $year:'$date'}, month:{ $month:'$date'}}, total:{ $sum:'$amount' }}},
      { $sort: { '_id.year':1,'_id.month':1 }},
    ]);

    res.json({
      success: true,
      dashboard: {
        wallet: {
          ...balance,
          profitEarned, profitCredited, profitPending,
          carsActive, carsSold,
        },
        activeInvestments: activeInvestments.map(inv => ({
          _id: inv._id,
          car: {
            carId: inv.car?.carId, make: inv.car?.make, model: inv.car?.model,
            year: inv.car?.year, investmentStatus: inv.car?.investmentStatus,
            ageDays: carAgeDays(inv.car?.purchaseDate, inv.car?.sale?.soldDate),
          },
          amount: inv.amount,
          sharePct: inv.car?.totalCost ? parseFloat(((inv.amount/inv.car.totalCost)*100).toFixed(2)) : 0,
          date: formatIST(inv.date),
        })),
        recentProfits: profitRecords.slice(0,5).map(p => ({
          profitId: p.profitId, carId: p.car?.carId,
          car: p.car?.make+' '+p.car?.model,
          amount: p.profitAmount, status: p.status,
          saleDate: formatIST(p.saleDate),
          creditedAt: p.creditedAt ? formatIST(p.creditedAt) : null,
        })),
        recentTransactions: recentTxns.map(t => ({
          txnId: t.txnId, type: t.type, amount: t.amount,
          date: formatIST(t.date),
        })),
        charts: { monthlyProfit, monthlyInvestments: monthlyInv },
        generatedAt: formatIST(new Date()),
      },
    });
  } catch (err) { next(err); }
};

module.exports = { getAdminDashboard, getPartnerDashboard };
