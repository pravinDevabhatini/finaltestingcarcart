const Car         = require('../models/Car');
const User        = require('../models/User');
const Group       = require('../models/Group');
const Investment  = require('../models/Investment');
const Transaction = require('../models/Transaction');
const Profit      = require('../models/Profit');
const { carAgeDays, formatIST } = require('../utils/ist');

// ── date filter helper ────────────────────────────
const buildDateFilter = (query = {}) => {
  const { dateFilter, selectedYear, selectedMonth, customFrom, customTo } = query;
  if (!dateFilter || dateFilter === 'all') return {};
  if (dateFilter === 'year' && selectedYear) {
    const y = Number(selectedYear);
    return { $gte: new Date(y, 0, 1), $lt: new Date(y + 1, 0, 1) };
  }
  if (dateFilter === 'month' && selectedYear && selectedMonth) {
    const y = Number(selectedYear), m = Number(selectedMonth) - 1;
    return { $gte: new Date(y, m, 1), $lt: new Date(y, m + 1, 1) };
  }
  if (dateFilter === 'custom' && customFrom && customTo) {
    return { $gte: new Date(customFrom), $lte: new Date(customTo + 'T23:59:59') };
  }
  return {};
};

// ── GET /api/reports/sold-cars ────────────────────
// 9.2 — Sold cars with full profit breakdown
const getSoldCarsReport = async (req, res, next) => {
  try {
    const soldDateFilter = buildDateFilter(req.query);
    const query = { investmentStatus: 'sold' };
    if (Object.keys(soldDateFilter).length) query['sale.soldDate'] = soldDateFilter;
    if (req.query.group) query.group = req.query.group;

    const cars = await Car.find(query)
      .populate('group', 'name series')
      .sort({ 'sale.soldDate': -1 });

    const rows = cars.map(c => {
      const gross       = (c.sale?.soldPrice||0) - c.totalCost;
      const commission  = Math.round((c.sale?.soldPrice||0) * c.commissionPct / 100);
      const distributable = gross - commission;
      return {
        carId:         c.carId,
        make:          c.make,
        model:         c.model,
        year:          c.year,
        group:         c.group?.name,
        purchasePrice: c.purchasePrice,
        serviceCharges:c.serviceCharges,
        totalCost:     c.totalCost,
        soldPrice:     c.sale?.soldPrice,
        grossProfit:   gross,
        commissionPct: c.commissionPct,
        commission,
        distributable,
        ageDays:       carAgeDays(c.purchaseDate, c.sale?.soldDate),
        soldDate:      c.sale?.soldDate ? formatIST(c.sale.soldDate) : null,
      };
    });

    const totals = rows.reduce((s, r) => ({
      purchasePrice:  s.purchasePrice  + r.purchasePrice,
      serviceCharges: s.serviceCharges + r.serviceCharges,
      totalCost:      s.totalCost      + r.totalCost,
      soldPrice:      s.soldPrice      + (r.soldPrice||0),
      grossProfit:    s.grossProfit    + r.grossProfit,
      commission:     s.commission     + r.commission,
      distributable:  s.distributable  + r.distributable,
    }), { purchasePrice:0, serviceCharges:0, totalCost:0, soldPrice:0, grossProfit:0, commission:0, distributable:0 });

    res.json({ success:true, count:rows.length, rows, totals });
  } catch (err) { next(err); }
};

// ── GET /api/reports/available-cars ──────────────
// 9.3 — Available (unsold) cars
const getAvailableCarsReport = async (req, res, next) => {
  try {
    const query = { investmentStatus: { $ne: 'sold' } };
    if (req.query.group)  query.group  = req.query.group;
    if (req.query.status) query.investmentStatus = req.query.status;

    const cars = await Car.find(query).populate('group','name series').sort({ createdAt:-1 });

    const rows = cars.map(c => {
      const invested  = c.totalInvested || 0;
      const remaining = c.totalCost - invested;
      const pct       = c.totalCost ? Math.min((invested/c.totalCost)*100, 100) : 0;
      return {
        carId: c.carId, make: c.make, model: c.model, year: c.year,
        group: c.group?.name,
        totalCost: c.totalCost, invested, remaining, fundedPct: parseFloat(pct.toFixed(1)),
        status: c.investmentStatus,
        ageDays: carAgeDays(c.purchaseDate, null),
        purchaseDate: formatIST(c.purchaseDate),
      };
    });
    res.json({ success:true, count:rows.length, rows });
  } catch (err) { next(err); }
};

// ── GET /api/reports/group-wise ───────────────────
// 9.4 — Group-wise profit summary
const getGroupWiseReport = async (req, res, next) => {
  try {
    const soldDateFilter = buildDateFilter(req.query);
    const groups = await Group.find().sort({ series:1, name:1 });

    const rows = await Promise.all(groups.map(async g => {
      const query = { group: g._id, investmentStatus:'sold' };
      if (Object.keys(soldDateFilter).length) query['sale.soldDate'] = soldDateFilter;

      const soldCars   = await Car.find(query);
      const allCars    = await Car.countDocuments({ group: g._id });
      const members    = await User.countDocuments({ group: g._id, role:'partner', status:'active' });
      const activeInvAgg = await Investment.aggregate([
        { $match: { group: g._id, status:'active' } },
        { $group: { _id:null, total:{ $sum:'$amount' } } },
      ]);

      const grossProfit   = soldCars.reduce((s,c)=>(s+(c.sale?.soldPrice||0)-c.totalCost),0);
      const commission    = soldCars.reduce((s,c)=>s+Math.round((c.sale?.soldPrice||0)*c.commissionPct/100),0);
      const distributable = grossProfit - commission;

      return {
        groupId: g._id, group: g.name, series: g.series,
        partners: members,
        carsSold: soldCars.length, carsAvail: allCars - soldCars.length,
        invested: activeInvAgg[0]?.total || 0,
        profit: grossProfit, commission, distributable,
      };
    }));

    const totals = rows.reduce((s,r) => ({
      partners: s.partners+r.partners, carsSold: s.carsSold+r.carsSold,
      carsAvail: s.carsAvail+r.carsAvail, invested: s.invested+r.invested,
      profit: s.profit+r.profit, commission: s.commission+r.commission,
      distributable: s.distributable+r.distributable,
    }), { partners:0,carsSold:0,carsAvail:0,invested:0,profit:0,commission:0,distributable:0 });

    res.json({ success:true, count:rows.length, rows, totals });
  } catch (err) { next(err); }
};

// ── GET /api/reports/user-wise ────────────────────
// 9.5 — Partner-wise investment & profit summary
const getUserWiseReport = async (req, res, next) => {
  try {
    const partners = await User.find({ role:'partner', status:'active' })
      .populate('group','name series').sort({ 'group':1 });

    const rows = await Promise.all(partners.map(async p => {
      const [activeInv, returnedInv, profitRecs, txns] = await Promise.all([
        Investment.find({ user:p._id, status:'active' }),
        Investment.find({ user:p._id, status:'returned' }),
        Profit.find({ user:p._id }),
        Transaction.find({ user:p._id }),
      ]);
      const deposited      = txns.filter(t=>t.type==='credit').reduce((s,t)=>s+t.amount,0);
      const withdrawn      = txns.filter(t=>t.type==='debit').reduce((s,t)=>s+t.amount,0);
      const profitCredited = txns.filter(t=>t.type==='profit_credit').reduce((s,t)=>s+t.amount,0);
      const activeInvAmt   = activeInv.reduce((s,i)=>s+i.amount,0);
      const profitEarned   = profitRecs.reduce((s,pr)=>s+pr.profitAmount,0);
      const profitPending  = profitRecs.filter(pr=>pr.status==='pending').reduce((s,pr)=>s+pr.profitAmount,0);
      const available      = deposited + profitCredited - activeInvAmt - withdrawn;
      return {
        userId: p.userId, name: p.name, group: p.group?.name, mobile: p.mobile,
        deposited, activeInvestments: activeInvAmt,
        availableBalance: Math.max(0,available),
        profitEarned, profitCredited, profitPending,
        carsActive: activeInv.length, carsSold: returnedInv.length,
      };
    }));

    const totals = rows.reduce((s,r) => ({
      deposited: s.deposited+r.deposited,
      activeInvestments: s.activeInvestments+r.activeInvestments,
      availableBalance: s.availableBalance+r.availableBalance,
      profitEarned: s.profitEarned+r.profitEarned,
      profitCredited: s.profitCredited+r.profitCredited,
      profitPending: s.profitPending+r.profitPending,
      carsActive: s.carsActive+r.carsActive, carsSold: s.carsSold+r.carsSold,
    }), { deposited:0,activeInvestments:0,availableBalance:0,profitEarned:0,profitCredited:0,profitPending:0,carsActive:0,carsSold:0 });

    res.json({ success:true, count:rows.length, rows, totals });
  } catch (err) { next(err); }
};

// ── GET /api/reports/car-wise ─────────────────────
// 9.6 — All cars with financial summary
const getCarWiseReport = async (req, res, next) => {
  try {
    const soldDateFilter = buildDateFilter(req.query);
    const query = {};
    if (req.query.group) query.group = req.query.group;
    if (Object.keys(soldDateFilter).length) {
      // for car-wise: sold cars filtered by sold date; unsold always shown
      // handled in post-processing
    }

    const cars = await Car.find(query).populate('group','name series').sort({ createdAt:-1 });

    const rows = cars.map(c => {
      const isSold = c.investmentStatus === 'sold';
      const gross   = isSold ? (c.sale?.soldPrice||0) - c.totalCost : null;
      const comm    = isSold ? Math.round((c.sale?.soldPrice||0) * c.commissionPct / 100) : null;
      const dist    = isSold ? gross - comm : null;

      // Filter sold cars by date
      if (isSold && Object.keys(soldDateFilter).length) {
        const sd = c.sale?.soldDate;
        if (!sd) return null;
        if (soldDateFilter.$gte && sd < soldDateFilter.$gte) return null;
        if (soldDateFilter.$lt  && sd >= soldDateFilter.$lt)  return null;
        if (soldDateFilter.$lte && sd > soldDateFilter.$lte)  return null;
      }

      return {
        carId: c.carId, make: c.make, model: c.model, year: c.year,
        group: c.group?.name,
        purchasePrice: c.purchasePrice, serviceCharges: c.serviceCharges, totalCost: c.totalCost,
        soldPrice:     c.sale?.soldPrice || null,
        grossProfit:   gross, commission: comm, distributable: dist,
        ageDays:       carAgeDays(c.purchaseDate, c.sale?.soldDate),
        status:        c.investmentStatus,
        soldDate:      c.sale?.soldDate ? formatIST(c.sale.soldDate) : null,
      };
    }).filter(Boolean);

    res.json({ success:true, count:rows.length, rows });
  } catch (err) { next(err); }
};

// ── GET /api/reports/month-wise ───────────────────
// 9.7 — Monthly summary of car sales
const getMonthWiseReport = async (req, res, next) => {
  try {
    const soldDateFilter = buildDateFilter(req.query);
    const matchQuery = { investmentStatus:'sold' };
    if (Object.keys(soldDateFilter).length) matchQuery['sale.soldDate'] = soldDateFilter;

    const monthly = await Car.aggregate([
      { $match: matchQuery },
      { $group: {
        _id:      { year:{ $year:'$sale.soldDate' }, month:{ $month:'$sale.soldDate' } },
        carsSold: { $sum:1 },
        revenue:  { $sum:'$sale.soldPrice' },
        totalCost:{ $sum:'$totalCost' },
        cars:     { $push:{ carId:'$carId', soldPrice:'$sale.soldPrice', totalCost:'$totalCost', commissionPct:'$commissionPct' } },
      }},
      { $sort: { '_id.year':-1, '_id.month':-1 } },
    ]);

    const MONTHS = ['','Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const rows = monthly.map(m => {
      const grossProfit   = m.revenue - m.totalCost;
      const commission    = m.cars.reduce((s,c)=>s+Math.round((c.soldPrice||0)*c.commissionPct/100),0);
      const distributable = grossProfit - commission;
      return {
        month:       `${MONTHS[m._id.month]} ${m._id.year}`,
        year:        m._id.year, monthNum: m._id.month,
        carsSold:    m.carsSold,
        revenue:     m.revenue,
        grossProfit, commission, distributable,
        profitCredited: 0, profitPending: distributable, // simplified
      };
    });

    const totals = rows.reduce((s,r) => ({
      carsSold: s.carsSold+r.carsSold, revenue: s.revenue+r.revenue,
      grossProfit: s.grossProfit+r.grossProfit, commission: s.commission+r.commission,
      distributable: s.distributable+r.distributable,
    }), { carsSold:0,revenue:0,grossProfit:0,commission:0,distributable:0 });

    res.json({ success:true, count:rows.length, rows, totals });
  } catch (err) { next(err); }
};

// ── GET /api/reports/month-cars ───────────────────
// 9.8 — Cars sold in a specific month (drill-down)
const getMonthCarsReport = async (req, res, next) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ success:false, message:'Year and month required.' });
    const y = Number(year), m = Number(month);
    const cars = await Car.find({
      investmentStatus:'sold',
      'sale.soldDate': { $gte: new Date(y,m-1,1), $lt: new Date(y,m,1) },
    }).populate('group','name').sort({ 'sale.soldDate':1 });

    const rows = cars.map(c => {
      const gross       = (c.sale?.soldPrice||0) - c.totalCost;
      const commission  = Math.round((c.sale?.soldPrice||0) * c.commissionPct / 100);
      const distributable = gross - commission;
      return {
        carId: c.carId, make: c.make, model: c.model, year: c.year,
        group: c.group?.name,
        soldPrice: c.sale?.soldPrice, grossProfit: gross, commission, distributable,
        soldDate: c.sale?.soldDate ? formatIST(c.sale.soldDate) : null,
      };
    });
    res.json({ success:true, count:rows.length, rows, month:`${year}-${month}` });
  } catch (err) { next(err); }
};

// ── GET /api/reports/month-partners ──────────────
// 9.9 — Partner profits in a specific month
const getMonthPartnersReport = async (req, res, next) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ success:false, message:'Year and month required.' });
    const y = Number(year), m = Number(month);
    const profits = await Profit.find({
      status:'credited',
      creditedAt: { $gte: new Date(y,m-1,1), $lt: new Date(y,m,1) },
    }).populate('user','userId name mobile group').populate('car','carId make model');

    // Group by partner
    const byPartner = {};
    profits.forEach(p => {
      const uid = p.user?._id.toString();
      if (!byPartner[uid]) byPartner[uid] = { user: p.user, profits:[], total:0, cars:[] };
      byPartner[uid].profits.push(p);
      byPartner[uid].total += p.profitAmount;
      byPartner[uid].cars.push(p.car?.carId);
    });

    const rows = Object.values(byPartner).map(r => ({
      userId:   r.user?.userId,
      name:     r.user?.name,
      mobile:   r.user?.mobile,
      carsPaid: r.cars.length,
      profitAmount: r.total,
      distributable: r.total, profitCredited: r.total, profitPending: 0,
      payDate: profits.find(p=>p.user?._id.toString()===r.user?._id.toString())?.creditedAt
        ? formatIST(profits.find(p=>p.user?._id.toString()===r.user?._id.toString()).creditedAt)
        : null,
    }));

    res.json({ success:true, count:rows.length, rows, month:`${year}-${month}` });
  } catch (err) { next(err); }
};

// ── GET /api/reports/month-groups ─────────────────
// 9.10 — Group profits in a specific month
const getMonthGroupsReport = async (req, res, next) => {
  try {
    const { year, month } = req.query;
    if (!year || !month) return res.status(400).json({ success:false, message:'Year and month required.' });
    const y = Number(year), m = Number(month);
    const cars = await Car.find({
      investmentStatus:'sold',
      'sale.soldDate': { $gte: new Date(y,m-1,1), $lt: new Date(y,m,1) },
    }).populate('group','name series');

    const byGroup = {};
    cars.forEach(c => {
      const gid = c.group?._id.toString();
      if (!byGroup[gid]) byGroup[gid] = { group:c.group?.name, series:c.group?.series, cars:[], investment:0, profit:0, commission:0 };
      const gross = (c.sale?.soldPrice||0) - c.totalCost;
      const comm  = Math.round((c.sale?.soldPrice||0)*c.commissionPct/100);
      byGroup[gid].cars.push(c.carId);
      byGroup[gid].profit     += gross;
      byGroup[gid].commission += comm;
      byGroup[gid].investment += c.totalCost;
    });

    const rows = Object.values(byGroup).map(r => ({
      group: r.group, series: r.series,
      carsSold: r.cars.length,
      investment: r.investment,
      profit: r.profit, commission: r.commission,
      distributable: r.profit - r.commission,
    }));

    res.json({ success:true, count:rows.length, rows, month:`${year}-${month}` });
  } catch (err) { next(err); }
};

// ── GET /api/reports/overview ─────────────────────
// 9.1 — Platform overview stats
const getOverview = async (req, res, next) => {
  try {
    const soldDateFilter = buildDateFilter(req.query);
    const soldQ = { investmentStatus:'sold' };
    if (Object.keys(soldDateFilter).length) soldQ['sale.soldDate'] = soldDateFilter;

    const [soldCars, availCars, totalPartners, totalGroups, profitStats, depositStats] = await Promise.all([
      Car.find(soldQ),
      Car.find({ investmentStatus:{ $ne:'sold' } }),
      User.countDocuments({ role:'partner', status:'active' }),
      Group.countDocuments({ status:'open' }),
      Profit.aggregate([
        { $group: { _id:'$status', total:{ $sum:'$profitAmount' }, count:{ $sum:1 } } },
      ]),
      Transaction.aggregate([
        { $match:{ type:'credit' } },
        { $group:{ _id:null, total:{ $sum:'$amount' } } },
      ]),
    ]);

    const totalRevenue    = soldCars.reduce((s,c)=>s+(c.sale?.soldPrice||0),0);
    const totalGross      = soldCars.reduce((s,c)=>s+(c.sale?.soldPrice||0)-c.totalCost,0);
    const totalCommission = soldCars.reduce((s,c)=>s+Math.round((c.sale?.soldPrice||0)*c.commissionPct/100),0);
    const totalDist       = totalGross - totalCommission;
    const credited        = profitStats.find(p=>p._id==='credited');
    const pending         = profitStats.find(p=>p._id==='pending');

    res.json({
      success:true,
      overview: {
        totalPartners, totalGroups,
        cars: { sold:soldCars.length, available:availCars.length },
        revenue:       totalRevenue,
        grossProfit:   totalGross,
        commission:    totalCommission,
        distributable: totalDist,
        profitCredited:  credited?.total||0,
        profitPending:   pending?.total||0,
        totalDeposited:  depositStats[0]?.total||0,
      },
    });
  } catch (err) { next(err); }
};

module.exports = {
  getOverview, getSoldCarsReport, getAvailableCarsReport,
  getGroupWiseReport, getUserWiseReport, getCarWiseReport,
  getMonthWiseReport, getMonthCarsReport, getMonthPartnersReport,
  getMonthGroupsReport,
};
