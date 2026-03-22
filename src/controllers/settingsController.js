const Settings    = require('../models/Settings');
const SettingsLog = require('../models/SettingsLog');
const Group       = require('../models/Group');
const User        = require('../models/User');
const { formatIST } = require('../utils/ist');

// ── GET /api/settings ─────────────────────────────
const getSettings = async (req, res, next) => {
  try {
    const settings = await Settings.getSingleton();
    res.json({ success: true, settings });
  } catch (err) { next(err); }
};

// ── PUT /api/settings ─────────────────────────────
// SA + AD can edit; AC view only
const updateSettings = async (req, res, next) => {
  try {
    const settings = await Settings.getSingleton();
    const changes  = [];
    const ip       = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';

    // Allowed fields + validation ranges
    const rules = {
      platformName:           { min: null, max: null, label: 'Platform Name' },
      defaultCommissionPct:   { min: 1.5,  max: 10,   label: 'Default Commission %' },
      depositReturnWindowDays:{ min: 30,   max: 365,  label: 'Deposit Return Window' },
      profitCreditDeadlineHrs:{ min: 12,   max: 72,   label: 'Profit Credit Deadline' },
      maxInvestorsPerCar:     { min: 2,    max: 10,   label: 'Max Investors Per Car' },
      currency:               { min: null, max: null, label: 'Currency Symbol' },
      logoHeader:             { min: null, max: null, label: 'Header Logo' },
      logoPdf:                { min: null, max: null, label: 'PDF Logo' },
      logoEmail:              { min: null, max: null, label: 'Email Logo' },
      // Notification settings
      waEnabled:              { min: null, max: null, label: 'WhatsApp Enabled' },
      emailEnabled:           { min: null, max: null, label: 'Email Enabled' },
      waApiKey:               { min: null, max: null, label: 'WA API Key' },
      smtpHost:               { min: null, max: null, label: 'SMTP Host' },
      smtpPort:               { min: null, max: null, label: 'SMTP Port' },
      smtpUser:               { min: null, max: null, label: 'SMTP User' },
    };

    for (const [key, rule] of Object.entries(rules)) {
      if (req.body[key] === undefined) continue;
      const newVal = req.body[key];

      // Range validation for numbers
      if (rule.min !== null && Number(newVal) < rule.min) {
        return res.status(400).json({ success: false, message: `${rule.label} minimum is ${rule.min}.` });
      }
      if (rule.max !== null && Number(newVal) > rule.max) {
        return res.status(400).json({ success: false, message: `${rule.label} maximum is ${rule.max}.` });
      }

      const oldVal = settings[key];
      if (String(oldVal) !== String(newVal)) {
        changes.push({ key, label: rule.label, oldVal: String(oldVal ?? ''), newVal: String(newVal) });
        settings[key] = newVal;
      }
    }

    if (changes.length === 0) {
      return res.json({ success: true, message: 'No changes detected.', settings });
    }

    await settings.save();

    // Log all changes to audit trail
    const logEntries = changes.map(c => ({
      settingName: c.label,
      oldValue:    c.oldVal,
      newValue:    c.newVal,
      changedBy:   req.user._id,
      changedAt:   new Date(),
      ipAddress:   ip,
    }));
    await SettingsLog.insertMany(logEntries);

    res.json({
      success:  true,
      message:  `${changes.length} setting(s) updated.`,
      changes:  changes.map(c => ({ setting: c.label, from: c.oldVal, to: c.newVal })),
      settings,
    });
  } catch (err) { next(err); }
};

// ── GET /api/settings/audit ───────────────────────
const getAuditLog = async (req, res, next) => {
  try {
    const { page = 1, limit = 50 } = req.query;
    const skip  = (Number(page) - 1) * Number(limit);
    const total = await SettingsLog.countDocuments();
    const logs  = await SettingsLog.find()
      .populate('changedBy', 'userId name role')
      .sort({ changedAt: -1 })
      .skip(skip).limit(Number(limit));

    res.json({
      success: true,
      count: logs.length, total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      logs: logs.map(l => ({
        _id:         l._id,
        settingName: l.settingName,
        oldValue:    l.oldValue,
        newValue:    l.newValue,
        changedBy:   l.changedBy ? { userId: l.changedBy.userId, name: l.changedBy.name } : null,
        changedAt:   formatIST(l.changedAt),
        ipAddress:   l.ipAddress,
      })),
    });
  } catch (err) { next(err); }
};

// ── GET /api/settings/groups ──────────────────────
const getGroups = async (req, res, next) => {
  try {
    const { status, series } = req.query;
    const query = {};
    if (status) query.status = status;
    if (series) query.series = series;
    const groups = await Group.find(query).sort({ series: 1, name: 1 });
    // Enrich with member count
    const enriched = await Promise.all(groups.map(async g => {
      const members = await User.countDocuments({ group: g._id, role: 'partner', status: 'active' });
      return { ...g.toObject(), memberCount: members };
    }));
    res.json({ success: true, count: enriched.length, groups: enriched });
  } catch (err) { next(err); }
};

// ── POST /api/settings/groups ─────────────────────
const createGroup = async (req, res, next) => {
  try {
    const { name, series, cap, status } = req.body;
    if (!name || !series || !cap) {
      return res.status(400).json({ success: false, message: 'Name, series and cap are required.' });
    }
    const exists = await Group.findOne({ name: name.trim().toUpperCase() });
    if (exists) return res.status(400).json({ success: false, message: `Group ${name} already exists.` });

    const group = await Group.create({
      name:   name.trim().toUpperCase(),
      series, cap: Number(cap),
      status: status || 'open',
      createdBy: req.user._id,
    });

    // Log to settings audit
    await SettingsLog.create({
      settingName: 'Group Added',
      oldValue:    '—',
      newValue:    `${group.name} (${group.series}-series, ₹${group.cap.toLocaleString('en-IN')})`,
      changedBy:   req.user._id,
      changedAt:   new Date(),
      ipAddress:   req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
    });

    res.status(201).json({ success: true, message: `Group ${group.name} created.`, group });
  } catch (err) { next(err); }
};

// ── PUT /api/settings/groups/:id ──────────────────
const updateGroup = async (req, res, next) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ success: false, message: 'Group not found.' });

    const { name, series, cap, status } = req.body;

    // Cannot deactivate group with active members
    if (status && status !== 'open' && group.status === 'open') {
      const activeMembers = await User.countDocuments({ group: group._id, role: 'partner', status: 'active' });
      if (activeMembers > 0) {
        return res.status(400).json({
          success: false,
          message: `Cannot close group. ${activeMembers} active partner(s) still assigned.`,
        });
      }
    }

    const oldSnapshot = `${group.name}/${group.series}/${group.cap}/${group.status}`;
    if (name)   group.name   = name.trim().toUpperCase();
    if (series) group.series = series;
    if (cap)    group.cap    = Number(cap);
    if (status) group.status = status;
    await group.save();

    await SettingsLog.create({
      settingName: `Group ${group.name} Updated`,
      oldValue:    oldSnapshot,
      newValue:    `${group.name}/${group.series}/${group.cap}/${group.status}`,
      changedBy:   req.user._id,
      changedAt:   new Date(),
      ipAddress:   req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
    });

    res.json({ success: true, message: 'Group updated.', group });
  } catch (err) { next(err); }
};

// ── POST /api/settings/logo ───────────────────────
const uploadLogo = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });
    const { logoType } = req.body; // logoHeader | logoPdf | logoEmail
    const allowed = ['logoHeader','logoPdf','logoEmail'];
    if (!allowed.includes(logoType)) {
      return res.status(400).json({ success: false, message: 'logoType must be logoHeader, logoPdf or logoEmail.' });
    }

    const settings = await Settings.getSingleton();
    const oldVal   = settings[logoType] || '—';
    settings[logoType] = req.file.filename;
    await settings.save();

    await SettingsLog.create({
      settingName: `Logo Updated: ${logoType}`,
      oldValue:    oldVal,
      newValue:    req.file.filename,
      changedBy:   req.user._id,
      changedAt:   new Date(),
      ipAddress:   req.headers['x-forwarded-for'] || req.socket.remoteAddress || '',
    });

    res.json({ success: true, message: `${logoType} uploaded.`, filename: req.file.filename });
  } catch (err) { next(err); }
};

module.exports = { getSettings, updateSettings, getAuditLog, getGroups, createGroup, updateGroup, uploadLogo };
