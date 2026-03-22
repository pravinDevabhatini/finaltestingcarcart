const mongoose = require('mongoose');

// ── M-04 Investment Groups Schema ────────────────
const groupSchema = new mongoose.Schema({

  name:   { type: String, required: true, unique: true, trim: true }, // T1, F1, CR1
  series: { type: String, enum: ['T', 'F', 'CR'], required: true },
  cap:    { type: Number, required: true }, // Investment cap in rupees

  status: {
    type: String,
    enum: ['open', 'closed', 'archived'],
    default: 'open',
  },

  // Computed stats (can be calculated from related docs)
  // Stored here for quick dashboard queries
  stats: {
    totalMembers:    { type: Number, default: 0 },
    totalInvested:   { type: Number, default: 0 },
    totalProfit:     { type: Number, default: 0 },
    totalCarsActive: { type: Number, default: 0 },
    totalCarsSold:   { type: Number, default: 0 },
  },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

}, { timestamps: true });

module.exports = mongoose.model('Group', groupSchema);
