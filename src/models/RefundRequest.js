const mongoose = require('mongoose');

// ── M-06 Deposit Refund Request Schema ───────────
const refundRequestSchema = new mongoose.Schema({

  user:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  reason: { type: String, required: true },
  notes:  { type: String, default: '' },

  // Bank snapshot at time of request (auto-filled from profile)
  bankSnapshot: {
    bankName:  String,
    accountNo: String,
    ifsc:      String,
  },

  // pending → approved → completed / rejected
  status: {
    type: String,
    enum: ['pending', 'approved', 'completed', 'rejected'],
    default: 'pending',
  },

  proof:       { type: String, default: null },
  processNote: { type: String, default: '' },

  processedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  processedAt: { type: Date, default: null },

}, { timestamps: true });

module.exports = mongoose.model('RefundRequest', refundRequestSchema);
