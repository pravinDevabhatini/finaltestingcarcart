const Group      = require('../models/Group');
const User       = require('../models/User');
const Car        = require('../models/Car');
const Investment = require('../models/Investment');
const { formatIST } = require('../utils/ist');

// ── GET /api/groups ───────────────────────────────
const getGroups = async (req, res, next) => {
  try {
    const { series, status, search } = req.query;
    const query = {};
    if (series) query.series = series;
    if (status) query.status = status;
    if (search) query.name = { $regex: search, $options: 'i' };

    const groups = await Group.find(query).sort({ series: 1, name: 1 });

    // Enrich each group with live counts
    const enriched = await Promise.all(groups.map(async (g) => {
      const [members, carsActive, carsSold, totalInvested] = await Promise.all([
        User.countDocuments({ group: g._id, role: 'partner', status: 'active' }),
        Car.countDocuments({ group: g._id, investmentStatus: { $in: ['open','partially_invested','fully_invested'] } }),
        Car.countDocuments({ group: g._id, investmentStatus: 'sold' }),
        Investment.aggregate([
          { $match: { group: g._id, status: 'active' } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
      ]);
      return {
        _id:          g._id,
        name:         g.name,
        series:       g.series,
        cap:          g.cap,
        status:       g.status,
        members,
        carsActive,
        carsSold,
        totalInvested: totalInvested[0]?.total || 0,
        createdAt:    formatIST(g.createdAt),
      };
    }));

    res.json({ success: true, count: enriched.length, groups: enriched });
  } catch (err) { next(err); }
};

// ── GET /api/groups/:id ───────────────────────────
const getGroup = async (req, res, next) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found.' });

    // Full detail — partners list + cars list
    const [partners, cars] = await Promise.all([
      User.find({ group: group._id, role: 'partner' }).select('userId name mobile status kyc'),
      Car.find({ group: group._id }).select('carId make model year investmentStatus totalCost totalInvested sale.soldDate'),
    ]);

    res.json({
      success: true,
      group: {
        _id: group._id, name: group.name, series: group.series,
        cap: group.cap, status: group.status,
        createdAt: formatIST(group.createdAt),
      },
      partners,
      cars,
    });
  } catch (err) { next(err); }
};

// ── POST /api/groups ──────────────────────────────
const createGroup = async (req, res, next) => {
  try {
    const { name, series, cap } = req.body;
    if (!name || !series || !cap) {
      return res.status(400).json({ success: false, message: 'Name, series and cap are required.' });
    }
    if (!['T','F','CR'].includes(series)) {
      return res.status(400).json({ success: false, message: 'Series must be T, F or CR.' });
    }
    const exists = await Group.findOne({ name: name.toUpperCase().trim() });
    if (exists) return res.status(400).json({ success: false, message: `Group ${name} already exists.` });

    const group = await Group.create({
      name: name.toUpperCase().trim(),
      series, cap: Number(cap),
      createdBy: req.user._id,
    });
    res.status(201).json({ success: true, message: `Group ${group.name} created.`, group });
  } catch (err) { next(err); }
};

// ── PUT /api/groups/:id ───────────────────────────
const updateGroup = async (req, res, next) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found.' });

    const { name, series, cap, status } = req.body;

    // Cannot deactivate group with active members
    if (status && status !== group.status) {
      if (status !== 'open') {
        const activeMembers = await User.countDocuments({ group: group._id, role: 'partner', status: 'active' });
        if (activeMembers > 0) {
          return res.status(400).json({ success: false, message: `Cannot close group — ${activeMembers} active member(s). Reassign first.` });
        }
      }
      group.status = status;
    }

    if (name)   group.name   = name.toUpperCase().trim();
    if (series) group.series = series;
    if (cap)    group.cap    = Number(cap);

    await group.save();
    res.json({ success: true, message: 'Group updated.', group });
  } catch (err) { next(err); }
};

// ── GET /api/groups/stats ─────────────────────────
const getGroupStats = async (req, res, next) => {
  try {
    const groups = await Group.find();
    const stats = await Promise.all(groups.map(async (g) => {
      const [members, cars, investments] = await Promise.all([
        User.countDocuments({ group: g._id, role: 'partner', status: 'active' }),
        Car.countDocuments({ group: g._id }),
        Investment.aggregate([
          { $match: { group: g._id, status: 'active' } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]),
      ]);
      return { groupId: g._id, name: g.name, series: g.series, members, cars, totalInvested: investments[0]?.total || 0 };
    }));
    res.json({ success: true, stats });
  } catch (err) { next(err); }
};

module.exports = { getGroups, getGroup, createGroup, updateGroup, getGroupStats };
