const User     = require('../models/User');
const Group    = require('../models/Group');
const { formatIST } = require('../utils/ist');

// ── helpers ───────────────────────────────────────
const safeUser = (u) => ({
  _id: u._id, userId: u.userId, name: u.name,
  mobile: u.mobile, email: u.email, role: u.role,
  group: u.group, status: u.status,
  bank: u.bank, kyc: u.kyc,
  notifications: u.notifications,
  joinedAt: formatIST(u.joinedAt),
  createdAt: formatIST(u.createdAt),
});

// ── GET /api/users ────────────────────────────────
// SA, AD: all users  |  AC: partners only
const getUsers = async (req, res, next) => {
  try {
    const { role, group, status, search, page = 1, limit = 50 } = req.query;

    const query = {};
    // AC can only see partners
    if (req.user.role === 'accountant') query.role = 'partner';
    else if (role) query.role = role;

    if (group)  query.group  = group;
    if (status) query.status = status;
    if (search) {
      query.$or = [
        { name:   { $regex: search, $options: 'i' } },
        { mobile: { $regex: search, $options: 'i' } },
        { userId: { $regex: search, $options: 'i' } },
      ];
    }

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await User.countDocuments(query);
    const users = await User.find(query)
      .populate('group', 'name series cap status')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({
      success: true,
      count: users.length,
      total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      users: users.map(safeUser),
    });
  } catch (err) { next(err); }
};

// ── GET /api/users/:id ────────────────────────────
const getUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id)
      .populate('group', 'name series cap status');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    // Partner can only view themselves
    if (req.user.role === 'partner' && req.user._id.toString() !== req.params.id) {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }
    res.json({ success: true, user: safeUser(user) });
  } catch (err) { next(err); }
};

// ── POST /api/users ────────────────────────────────
// SA, AD only
const createUser = async (req, res, next) => {
  try {
    const { name, mobile, email, role, group, password } = req.body;
    if (!name || !mobile || !role || !password) {
      return res.status(400).json({ success: false, message: 'Name, mobile, role and password are required.' });
    }
    if (!/^\d{10}$/.test(mobile)) {
      return res.status(400).json({ success: false, message: 'Mobile must be 10 digits.' });
    }
    if (role === 'partner' && !group) {
      return res.status(400).json({ success: false, message: 'Group is required for partners.' });
    }

    const user = await User.create({
      name, mobile, email, role,
      group: group || null,
      password,
      createdBy: req.user._id,
    });

    // Update group member count
    if (group) {
      await Group.findByIdAndUpdate(group, { $inc: { 'stats.totalMembers': 1 } });
    }

    res.status(201).json({ success: true, message: `${role} created successfully.`, user: safeUser(user) });
  } catch (err) { next(err); }
};

// ── PUT /api/users/:id ────────────────────────────
// SA, AD: can update role, group, status
// Partner: can only update own bank + notifications (handled in /me routes)
const updateUser = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const { name, email, mobile, role, group, status, disabledNote } = req.body;

    // Only SA can change roles
    if (role && role !== user.role && req.user.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Only Super Admin can change user roles.' });
    }

    if (name)   user.name   = name;
    if (email)  user.email  = email;
    if (mobile) {
      if (!/^\d{10}$/.test(mobile)) return res.status(400).json({ success: false, message: 'Mobile must be 10 digits.' });
      user.mobile = mobile;
    }
    if (role)  user.role  = role;
    if (group !== undefined) user.group = group || null;

    // Status change
    if (status && status !== user.status) {
      user.status = status;
      if (status === 'disabled') {
        user.disabledAt   = new Date();
        user.disabledNote = disabledNote || '';
      } else {
        user.disabledAt   = null;
        user.disabledNote = '';
      }
    }

    await user.save();
    res.json({ success: true, message: 'User updated.', user: safeUser(user) });
  } catch (err) { next(err); }
};

// ── PUT /api/users/:id/kyc ────────────────────────
// Admin verifies KYC — SA, AD only
const verifyKYC = async (req, res, next) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    const { aadhaarStatus, panStatus } = req.body;
    if (aadhaarStatus) user.kyc.aadhaar.status = aadhaarStatus;
    if (panStatus)     user.kyc.pan.status     = panStatus;

    // Overall KYC status
    const a = user.kyc.aadhaar.status;
    const p = user.kyc.pan.status;
    if (a === 'verified' && p === 'verified') user.kyc.status = 'verified';
    else if (a === 'pending' && p === 'pending') user.kyc.status = 'pending';
    else user.kyc.status = 'uploaded';

    user.kyc.verifiedBy = req.user._id;
    user.kyc.verifiedAt = new Date();
    await user.save();

    res.json({ success: true, message: 'KYC status updated.', kyc: user.kyc });
  } catch (err) { next(err); }
};

// ── PUT /api/users/me/bank ────────────────────────
// Partner updates own bank details
const updateMyBank = async (req, res, next) => {
  try {
    const { bankName, accountNo, ifsc, branch } = req.body;
    if (!bankName || !accountNo || !ifsc) {
      return res.status(400).json({ success: false, message: 'Bank name, account number and IFSC are required.' });
    }
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { bank: { bankName, accountNo, ifsc, branch: branch || '' } },
      { new: true }
    );
    res.json({ success: true, message: 'Bank details updated.', bank: user.bank });
  } catch (err) { next(err); }
};

// ── PUT /api/users/me/notifications ───────────────
// Partner updates own notification preferences
const updateMyNotifications = async (req, res, next) => {
  try {
    const { whatsapp, email } = req.body;
    const user = await User.findByIdAndUpdate(
      req.user._id,
      { notifications: { whatsapp: !!whatsapp, email: !!email } },
      { new: true }
    );
    res.json({ success: true, message: 'Preferences saved.', notifications: user.notifications });
  } catch (err) { next(err); }
};

// ── POST /api/users/me/kyc ────────────────────────
// Partner uploads KYC doc — file handled by multer middleware
const uploadMyKYC = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });
    const { docType } = req.body; // 'aadhaar' | 'pan'
    if (!['aadhaar','pan'].includes(docType)) {
      return res.status(400).json({ success: false, message: 'docType must be aadhaar or pan.' });
    }
    const user = await User.findById(req.user._id);
    user.kyc[docType] = { file: req.file.filename, status: 'uploaded' };
    if (user.kyc.status === 'pending') user.kyc.status = 'uploaded';
    await user.save();
    res.json({ success: true, message: `${docType} uploaded. Awaiting Admin verification.`, kyc: user.kyc });
  } catch (err) { next(err); }
};

// ── PUT /api/users/:id/reset-password ─────────────
// SA, AD only
const resetPassword = async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters.' });
    }
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    user.password = newPassword;
    await user.save();
    res.json({ success: true, message: 'Password reset successfully.' });
  } catch (err) { next(err); }
};

// ── GET /api/users/stats ──────────────────────────
const getUserStats = async (req, res, next) => {
  try {
    const [total, partners, admins, accountants, active, disabled, kycVerified] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ role: 'partner' }),
      User.countDocuments({ role: { $in: ['superadmin','admin'] } }),
      User.countDocuments({ role: 'accountant' }),
      User.countDocuments({ status: 'active' }),
      User.countDocuments({ status: 'disabled' }),
      User.countDocuments({ 'kyc.status': 'verified' }),
    ]);
    res.json({ success: true, stats: { total, partners, admins, accountants, active, disabled, kycVerified } });
  } catch (err) { next(err); }
};

module.exports = {
  getUsers, getUser, createUser, updateUser,
  verifyKYC, updateMyBank, updateMyNotifications,
  uploadMyKYC, resetPassword, getUserStats,
};
