const mongoose = require('mongoose');

// ── M-10 Notification Template Schema ────────────
const templateSchema = new mongoose.Schema({

  name: { type: String, required: true, unique: true },
  type: {
    type: String,
    enum: ['deposit','investment','car_update','profit_generated','profit_credited','custom'],
    required: true,
  },
  active: { type: Boolean, default: true },

  // WhatsApp version
  waMessage: { type: String, default: '' },

  // Email version
  emailSubject: { type: String, default: '' },
  emailBody:    { type: String, default: '' },

  // Available variables for this template
  variables: [{ type: String }],

}, { timestamps: true });

// ── M-10 Notification Log Schema ─────────────────
const notificationLogSchema = new mongoose.Schema({

  sentBy:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  channel:  { type: String, enum: ['whatsapp','email','both'], required: true },
  template: { type: mongoose.Schema.Types.ObjectId, ref: 'NotificationTemplate', default: null },

  recipientType: { type: String, enum: ['all','group','individual'], required: true },
  recipientGroup:{ type: mongoose.Schema.Types.ObjectId, ref: 'Group', default: null },
  recipients:    [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  recipientCount:{ type: Number, default: 0 },

  messagePreview: { type: String, default: '' },
  emailSubject:   { type: String, default: '' },

  // Status per channel
  waStatus:    { type: String, enum: ['sent','delivered','read','failed',null], default: null },
  emailStatus: { type: String, enum: ['sent','opened','bounced','failed',null], default: null },

  status: {
    type: String,
    enum: ['sent','failed','partial','pending'],
    default: 'pending',
  },

  sentAt: { type: Date, default: Date.now },

}, { timestamps: false });

const NotificationTemplate = mongoose.model('NotificationTemplate', templateSchema);
const NotificationLog = mongoose.model('NotificationLog', notificationLogSchema);

module.exports = { NotificationTemplate, NotificationLog };
