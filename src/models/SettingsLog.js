const mongoose = require('mongoose');

// ── M-11 Settings Audit Log Schema ───────────────
const settingsLogSchema = new mongoose.Schema({

  settingName: { type: String, required: true },
  oldValue:    { type: String, required: true },
  newValue:    { type: String, required: true },
  changedBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  changedAt:   { type: Date, default: Date.now },
  ipAddress:   { type: String, default: '' },

}, { timestamps: false });

module.exports = mongoose.model('SettingsLog', settingsLogSchema);
