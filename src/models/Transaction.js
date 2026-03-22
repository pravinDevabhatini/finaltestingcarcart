const mongoose = require('mongoose');

// ── M-06 Deposits & Wallet Schema ────────────────
const transactionSchema = new mongoose.Schema({

  // Auto-generated: TXN001, TXN002...
  txnId: { type: String, unique: true },

  user:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group' },

  // CREDIT / DEBIT / PROFIT_CREDIT
  type: {
    type: String,
    enum: ['credit', 'debit', 'profit_credit'],
    required: true,
  },

  amount: { type: Number, required: true }, // always positive

  // Payment details
  mode: {
    type: String,
    enum: ['cash', 'neft', 'imps', 'upi', 'bank_transfer'],
    required: true,
  },
  referenceNo: { type: String, default: '' },
  notes:       { type: String, default: '' },

  // Proof file
  proof: { type: String, default: null },

  // Balance snapshot after this transaction
  balanceAfter: { type: Number },

  // Timestamp (always IST — M-13 engine 13.1)
  date: { type: Date, default: Date.now },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

}, { timestamps: true });

// ── Auto-generate txnId ───────────────────────────
transactionSchema.pre('save', async function(next) {
  if (!this.isNew) return next();
  const count = await mongoose.model('Transaction').countDocuments();
  this.txnId = `TXN${String(count + 1).padStart(4, '0')}`;
  next();
});

module.exports = mongoose.model('Transaction', transactionSchema);
