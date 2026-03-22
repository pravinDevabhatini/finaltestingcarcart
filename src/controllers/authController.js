const User       = require('../models/User');
const { signToken } = require('../config/jwt');
const { formatIST } = require('../utils/ist');

// ── POST /api/auth/login ──────────────────────────
// Login with 10-digit mobile OR userId (SA001 etc.)
const login = async (req, res, next) => {
  try {
    const { mobile, userId, password } = req.body;

    if (!password) {
      return res.status(400).json({ success: false, message: 'Password is required.' });
    }
    if (!mobile && !userId) {
      return res.status(400).json({ success: false, message: 'Mobile number or User ID is required.' });
    }

    // Find by mobile (10 digits) or userId
    const query = mobile ? { mobile: mobile.trim() } : { userId: userId.trim().toUpperCase() };
    const user = await User.findOne(query).select('+password').populate('group', 'name series cap status');

    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }
    if (user.status === 'disabled') {
      return res.status(403).json({ success: false, message: 'Your account is disabled. Contact Admin.' });
    }

    const passwordMatch = await user.comparePassword(password);
    if (!passwordMatch) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    const token = signToken(user._id);

    // Build safe user object
    const userData = {
      _id:      user._id,
      userId:   user.userId,
      name:     user.name,
      mobile:   user.mobile,
      email:    user.email,
      role:     user.role,
      group:    user.group,
      status:   user.status,
      kyc:      user.kyc,
      notifications: user.notifications,
      joinedAt: formatIST(user.joinedAt),
    };

    res.status(200).json({
      success: true,
      message: `Welcome back, ${user.name}`,
      token,
      user: userData,
    });
  } catch (err) {
    next(err);
  }
};

// ── GET /api/auth/me ──────────────────────────────
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id).populate('group', 'name series cap status');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.json({ success: true, user });
  } catch (err) {
    next(err);
  }
};

// ── POST /api/auth/logout ─────────────────────────
// JWT is stateless — client discards token
// This endpoint exists for audit logging
const logout = async (req, res) => {
  res.json({ success: true, message: 'Logged out successfully.' });
};

// ── POST /api/auth/change-password ───────────────
const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Both current and new password are required.' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ success: false, message: 'New password must be at least 6 characters.' });
    }

    const user = await User.findById(req.user._id).select('+password');
    const match = await user.comparePassword(currentPassword);
    if (!match) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    user.password = newPassword; // pre-save hook hashes it
    await user.save();

    res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    next(err);
  }
};

module.exports = { login, getMe, logout, changePassword };
