const mongoose = require('mongoose');

// ── M-11 Platform Settings Schema ────────────────
const settingsSchema = new mongoose.Schema({

  // Singleton — only one settings doc ever exists
  _id: { type: String, default: 'platform_settings' },

  // Branding (M-11)
  platformName: { type: String, default: 'Car Cart Partners' },
  currency:     { type: String, default: '₹' },
  timezone:     { type: String, default: 'Asia/Kolkata' },
  dateFormat:   { type: String, default: 'DD MMM YYYY' },
  logoHeader:   { type: String, default: null },
  logoPdf:      { type: String, default: null },
  logoEmail:    { type: String, default: null },

  // Financial Rules (M-11)
  defaultCommissionPct:   { type: Number, default: 2.5, min: 1.5, max: 10 },
  depositReturnWindowDays:{ type: Number, default: 90,  min: 30, max: 365 },
  profitCreditDeadlineHrs:{ type: Number, default: 24,  min: 12, max: 72 },

  // Investment Rules (M-11 / M-13)
  maxInvestorsPerCar: { type: Number, default: 5, min: 2, max: 10 },

}, { timestamps: true });

// ── Singleton helper ──────────────────────────────
settingsSchema.statics.getSingleton = async function() {
  let settings = await this.findById('platform_settings');
  if (!settings) {
    settings = await this.create({ _id: 'platform_settings' });
  }
  return settings;
};

module.exports = mongoose.model('Settings', settingsSchema);
