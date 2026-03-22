const mongoose = require('mongoose');

// ── M-07 Partner Self-Invest Request Schema ──────
const investmentRequestSchema = new mongoose.Schema({

  user:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  car:    { type: mongoose.Schema.Types.ObjectId, ref: 'Car',  required: true },
  group:  { type: mongoose.Schema.Types.ObjectId, ref: 'Group',required: true },

  requestedAmount: { type: Number, required: true },
  notes:           { type: String, default: '' },

  // pending → approved / rejected / expired
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected', 'expired'],
    default: 'pending',
  },

  // 5-hour expiry window (M-07 section 7.5)
  expiresAt:  { type: Date, required: true },

  reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt: { type: Date, default: null },

}, { timestamps: true });

// ── Auto-expire pending requests ──────────────────
investmentRequestSchema.pre('findOne', async function() {
  await mongoose.model('InvestmentRequest').updateMany(
    { status: 'pending', expiresAt: { $lt: new Date() } },
    { status: 'expired' }
  );
});

module.exports = mongoose.model('InvestmentRequest', investmentRequestSchema);
