const mongoose = require('mongoose');

// ── M-07 Investment Assignment Schema ────────────
const investmentSchema = new mongoose.Schema({

  car:    { type: mongoose.Schema.Types.ObjectId, ref: 'Car',  required: true },
  user:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  group:  { type: mongoose.Schema.Types.ObjectId, ref: 'Group',required: true },

  amount: { type: Number, required: true },
  date:   { type: Date, default: Date.now },

  // active → returned (on car sold, M-07 section 7.8)
  status: {
    type: String,
    enum: ['active', 'returned'],
    default: 'active',
  },

  returnedAt: { type: Date, default: null },
  createdBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

}, { timestamps: true });

// ── Ensure max 5 investors per car (reads from Settings) ──
investmentSchema.pre('save', async function(next) {
  if (!this.isNew) return next();
  const Settings = mongoose.model('Settings');
  const settings = await Settings.findOne();
  const maxInv = settings?.maxInvestorsPerCar || 5;
  const count = await mongoose.model('Investment').countDocuments({
    car: this.car, status: 'active'
  });
  if (count >= maxInv) {
    return next(new Error(`Maximum ${maxInv} investors allowed per car.`));
  }
  next();
});

module.exports = mongoose.model('Investment', investmentSchema);
