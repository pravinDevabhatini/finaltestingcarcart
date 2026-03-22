const mongoose = require('mongoose');

// ── M-08 Profit Distribution Schema ─────────────
const profitSchema = new mongoose.Schema({

  // Auto-generated: PRF001...
  profitId: { type: String, unique: true },

  car:        { type: mongoose.Schema.Types.ObjectId, ref: 'Car',        required: true },
  investment: { type: mongoose.Schema.Types.ObjectId, ref: 'Investment', required: true },
  user:       { type: mongoose.Schema.Types.ObjectId, ref: 'User',       required: true },
  group:      { type: mongoose.Schema.Types.ObjectId, ref: 'Group',      required: true },

  // Investment details snapshot
  investmentAmount: { type: Number, required: true },
  sharePct:         { type: Number, required: true }, // (investmentAmount / totalInvested) * 100

  // Car financials snapshot (at time of sale)
  purchasePrice:   { type: Number, required: true },
  serviceCharges:  { type: Number, required: true },
  totalCost:       { type: Number, required: true },
  soldPrice:       { type: Number, required: true },
  grossProfit:     { type: Number, required: true },
  commissionPct:   { type: Number, required: true },
  commissionAmt:   { type: Number, required: true }, // soldPrice × commissionPct%
  distributable:   { type: Number, required: true }, // grossProfit - commissionAmt
  profitAmount:    { type: Number, required: true }, // sharePct * distributable

  saleDate: { type: Date, required: true },

  // 24-calendar-hour deadline (M-08 section 8.4)
  creditDeadline: { type: Date, required: true }, // saleDate + 24hrs

  // pending → credited
  status: {
    type: String,
    enum: ['pending', 'credited'],
    default: 'pending',
  },

  proof:      { type: String, default: null },
  notes:      { type: String, default: '' },
  creditedAt: { type: Date, default: null },
  creditedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },

  // Lock — credited records cannot be modified (M-08 section 8.8)
  locked: { type: Boolean, default: false },

}, { timestamps: true });

// ── Auto-generate profitId ────────────────────────
profitSchema.pre('save', async function(next) {
  if (!this.isNew) return next();
  const count = await mongoose.model('Profit').countDocuments();
  this.profitId = `PRF${String(count + 1).padStart(4, '0')}`;
  next();
});

// ── Lock on credit ────────────────────────────────
profitSchema.pre('save', function(next) {
  if (this.isModified('status') && this.status === 'credited') {
    this.locked = true;
    this.creditedAt = new Date();
  }
  next();
});

module.exports = mongoose.model('Profit', profitSchema);
