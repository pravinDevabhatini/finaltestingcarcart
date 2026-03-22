const { verifyToken } = require('../config/jwt');
const User = require('../models/User');

// ── Protect routes — verify JWT ───────────────────
const protect = async (req, res, next) => {
  try {
    let token;
    if (req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.split(' ')[1];
    }
    if (!token) {
      return res.status(401).json({ success: false, message: 'Not authenticated. Please log in.' });
    }
    const decoded = verifyToken(token);
    const user = await User.findById(decoded.id).populate('group');
    if (!user) return res.status(401).json({ success: false, message: 'User no longer exists.' });
    if (user.status === 'disabled') return res.status(403).json({ success: false, message: 'Your account has been disabled. Contact Admin.' });
    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ success: false, message: 'Invalid or expired token.' });
  }
};

// ── Role restriction factory ──────────────────────
const restrictTo = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({ success: false, message: `Access denied. Required roles: ${roles.join(', ')}.` });
  }
  next();
};

// ── Role helpers ──────────────────────────────────
const isAdmin   = restrictTo('superadmin', 'admin');
const isSA      = restrictTo('superadmin');
const isACorAbove = restrictTo('superadmin', 'admin', 'accountant');
const isPartner = restrictTo('partner');

module.exports = { protect, restrictTo, isAdmin, isSA, isACorAbove, isPartner };
