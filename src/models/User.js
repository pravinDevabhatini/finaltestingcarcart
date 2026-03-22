const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// ── M-03 User Management Schema ──────────────────
const userSchema = new mongoose.Schema({

  // Identity
  userId: {
    type: String,
    unique: true,
    // Auto-generated: CCP001, CCP002... SA001, AD001, AC001
  },
  name:   { type: String, required: true, trim: true },
  mobile: { type: String, required: true, unique: true, match: /^[0-9]{10}$/ },
  email:  { type: String, trim: true, lowercase: true },
  password: { type: String, required: true, select: false },

  // Role & Group
  role: {
    type: String,
    enum: ['superadmin', 'admin', 'accountant', 'partner'],
    default: 'partner',
  },
  group: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Group',
    default: null, // null for SA/AD/AC
  },

  // Status
  status: {
    type: String,
    enum: ['active', 'disabled'],
    default: 'active',
  },
  disabledAt:   { type: Date, default: null },
  disabledNote: { type: String, default: '' },

  // Bank Details (M-12 editable by partner)
  bank: {
    bankName:  { type: String, default: '' },
    accountNo: { type: String, default: '' },
    ifsc:      { type: String, default: '' },
    branch:    { type: String, default: '' },
  },

  // KYC (M-03 / M-12)
  kyc: {
    aadhaar: { file: String, status: { type: String, enum: ['pending','uploaded','verified'], default: 'pending' } },
    pan:     { file: String, status: { type: String, enum: ['pending','uploaded','verified'], default: 'pending' } },
    status:  { type: String, enum: ['pending','uploaded','verified'], default: 'pending' },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    verifiedAt: Date,
  },

  // Notification Preferences (M-10 / M-12)
  notifications: {
    whatsapp: { type: Boolean, default: true },
    email:    { type: Boolean, default: true },
  },

  // Metadata
  joinedAt:  { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

}, { timestamps: true });

// ── Auto-generate userId before save ─────────────
userSchema.pre('save', async function(next) {
  if (!this.isNew) return next();
  const prefixMap = { superadmin: 'SA', admin: 'AD', accountant: 'AC', partner: 'CCP' };
  const prefix = prefixMap[this.role] || 'CCP';
  const count = await mongoose.model('User').countDocuments({ role: this.role });
  this.userId = `${prefix}${String(count + 1).padStart(3, '0')}`;
  next();
});

// ── Hash password before save ────────────────────
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// ── Compare password method ──────────────────────
userSchema.methods.comparePassword = async function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

// ── Remove password from JSON output ─────────────
userSchema.methods.toJSON = function() {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
