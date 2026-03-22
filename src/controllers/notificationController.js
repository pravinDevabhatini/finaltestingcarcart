const { NotificationTemplate, NotificationLog } = require('../models/Notification');
const User     = require('../models/User');
const Settings = require('../models/Settings');
const { formatIST } = require('../utils/ist');

// ── variable substitution ─────────────────────────
const fillVars = (text, vars = {}) => {
  if (!text) return '';
  return Object.entries(vars).reduce((t, [k, v]) =>
    t.replace(new RegExp(k.replace(/[{}]/g, '\\$&'), 'g'), v ?? ''), text);
};

// ── recipient resolver ────────────────────────────
const resolveRecipients = async (recipientType, groupId, partnerId, channel) => {
  let query = { role: 'partner', status: 'active' };
  if (recipientType === 'group' && groupId) query.group = groupId;
  if (recipientType === 'individual' && partnerId) query._id = partnerId;

  const allRecipients = await User.find(query).populate('group', 'name');

  const optedIn = allRecipients.filter(p => {
    if (channel === 'whatsapp') return p.notifications?.whatsapp !== false;
    if (channel === 'email')    return p.notifications?.email    !== false;
    if (channel === 'both')     return p.notifications?.whatsapp !== false || p.notifications?.email !== false;
    return true;
  });
  const optedOut = allRecipients.filter(p => !optedIn.includes(p));
  return { all: allRecipients, optedIn, optedOut };
};

// ── GET /api/notifications/templates ─────────────
const getTemplates = async (req, res, next) => {
  try {
    const templates = await NotificationTemplate.find().sort({ type: 1 });
    res.json({ success: true, count: templates.length, templates });
  } catch (err) { next(err); }
};

// ── POST /api/notifications/templates ────────────
const createTemplate = async (req, res, next) => {
  try {
    const { name, type, waMessage, emailSubject, emailBody, variables } = req.body;
    if (!name || !type) return res.status(400).json({ success: false, message: 'Name and type are required.' });
    const tmpl = await NotificationTemplate.create({ name, type, waMessage, emailSubject, emailBody, variables });
    res.status(201).json({ success: true, message: 'Template created.', template: tmpl });
  } catch (err) { next(err); }
};

// ── PUT /api/notifications/templates/:id ─────────
const updateTemplate = async (req, res, next) => {
  try {
    const tmpl = await NotificationTemplate.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!tmpl) return res.status(404).json({ success: false, message: 'Template not found.' });
    res.json({ success: true, message: 'Template updated.', template: tmpl });
  } catch (err) { next(err); }
};

// ── POST /api/notifications/send ─────────────────
// Unified send — WA, Email, or Both
const sendNotification = async (req, res, next) => {
  try {
    const {
      channel,         // 'whatsapp' | 'email' | 'both'
      recipientType,   // 'all' | 'group' | 'individual'
      groupId,
      partnerId,
      templateId,
      customMessage,   // for custom WA message
      emailSubject,
      emailBody,
      templateVars,    // object of { '{{var}}': 'value' }
    } = req.body;

    if (!channel || !recipientType) {
      return res.status(400).json({ success: false, message: 'Channel and recipientType required.' });
    }

    // Check channels are enabled
    const settings = await Settings.getSingleton();
    if ((channel === 'whatsapp' || channel === 'both') && !settings.waEnabled) {
      return res.status(400).json({ success: false, message: 'WhatsApp channel is disabled in Settings.' });
    }
    if ((channel === 'email' || channel === 'both') && !settings.emailEnabled) {
      return res.status(400).json({ success: false, message: 'Email channel is disabled in Settings.' });
    }

    // Resolve recipients
    const { all, optedIn, optedOut } = await resolveRecipients(recipientType, groupId, partnerId, channel);
    if (all.length === 0) {
      return res.status(400).json({ success: false, message: 'No recipients found.' });
    }

    // Get template if provided
    const template = templateId ? await NotificationTemplate.findById(templateId) : null;
    if (templateId && !template) {
      return res.status(404).json({ success: false, message: 'Template not found.' });
    }
    if (template && !template.active) {
      return res.status(400).json({ success: false, message: 'Template is inactive.' });
    }

    // Build message preview (first recipient)
    const samplePartner = optedIn[0] || all[0];
    const defaultVars   = {
      '{{partner_name}}':      samplePartner?.name || 'Partner',
      '{{date}}':              formatIST(new Date()),
      '{{deposit_amount}}':    '0',
      '{{available_balance}}': '0',
      '{{car_name}}':          'N/A',
      '{{profit_amount}}':     '0',
      '{{sold_date}}':         '—',
      '{{credited_date}}':     '—',
      '{{car_id}}':            'N/A',
      '{{car_model}}':         'N/A',
      '{{status}}':            'N/A',
      ...templateVars,
    };

    const waText      = template ? fillVars(template.waMessage, defaultVars) : (customMessage || '');
    const emailSubj   = template ? fillVars(template.emailSubject, defaultVars) : (emailSubject || '');
    const emailBodyFn = template ? fillVars(template.emailBody, defaultVars) : (emailBody || '');
    const preview     = (waText || emailBodyFn).slice(0, 120);

    // ── Simulate send (production: call WA API + SMTP here) ───────────
    // WhatsApp API send (placeholder — replace with Meta WA Business API)
    let waStatus    = null;
    let emailStatus = null;

    if (channel === 'whatsapp' || channel === 'both') {
      // Production: await sendWhatsApp(optedIn, waText);
      waStatus = 'sent'; // placeholder
    }
    if (channel === 'email' || channel === 'both') {
      // Production: await sendEmail(optedIn, emailSubj, emailBodyFn);
      emailStatus = 'sent'; // placeholder
    }

    const overallStatus = waStatus === 'failed' && emailStatus === 'failed' ? 'failed'
      : (waStatus === 'failed' || emailStatus === 'failed') && (waStatus !== null || emailStatus !== null) ? 'partial'
      : 'sent';

    // Create log
    const log = await NotificationLog.create({
      sentBy:        req.user._id,
      channel,
      template:      template?._id || null,
      recipientType,
      recipientGroup:  groupId || null,
      recipients:      optedIn.map(p => p._id),
      recipientCount:  optedIn.length,
      messagePreview:  preview,
      emailSubject:    emailSubj,
      waStatus,
      emailStatus,
      status: overallStatus,
    });

    res.status(201).json({
      success: true,
      message: `Notification sent to ${optedIn.length} partner(s) via ${channel}.`,
      sentCount:    optedIn.length,
      skippedCount: optedOut.length,
      skipped:      optedOut.map(p => ({ name: p.name, reason: 'Opted out' })),
      status:       overallStatus,
      logId:        log._id,
    });
  } catch (err) { next(err); }
};

// ── GET /api/notifications/logs ───────────────────
const getLogs = async (req, res, next) => {
  try {
    const { channel, status, page = 1, limit = 50 } = req.query;
    const query = {};
    if (channel) query.channel = channel;
    if (status)  query.status  = status;

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await NotificationLog.countDocuments(query);
    const logs  = await NotificationLog.find(query)
      .populate('sentBy',   'userId name')
      .populate('template', 'name type')
      .sort({ sentAt: -1 })
      .skip(skip).limit(Number(limit));

    res.json({ success: true, count: logs.length, total, logs });
  } catch (err) { next(err); }
};

// ── POST /api/notifications/logs/:id/resend ───────
const resendNotification = async (req, res, next) => {
  try {
    const log = await NotificationLog.findById(req.params.id);
    if (!log) return res.status(404).json({ success: false, message: 'Log not found.' });
    if (!['failed','partial'].includes(log.status)) {
      return res.status(400).json({ success: false, message: 'Only failed or partial notifications can be resent.' });
    }

    // Update status — no duplicate log
    log.status     = 'sent';
    log.waStatus   = log.waStatus    === 'failed' ? 'sent' : log.waStatus;
    log.emailStatus= log.emailStatus === 'failed' ? 'sent' : log.emailStatus;
    log.sentAt     = new Date();
    await log.save();

    res.json({ success: true, message: 'Notification resent. Log updated.', log });
  } catch (err) { next(err); }
};

// ── GET /api/notifications/settings ──────────────
const getNotifSettings = async (req, res, next) => {
  try {
    const settings = await Settings.getSingleton();
    res.json({
      success: true,
      settings: {
        waEnabled:         settings.waEnabled         ?? true,
        emailEnabled:      settings.emailEnabled      ?? true,
        autoDeposit:       settings.autoDeposit       ?? true,
        autoInvestment:    settings.autoInvestment    ?? true,
        autoCarSold:       settings.autoCarSold       ?? true,
        autoProfitCredited:settings.autoProfitCredited ?? true,
        waApiKey:          settings.waApiKey          || '',
        smtpHost:          settings.smtpHost          || '',
        smtpPort:          settings.smtpPort          || 587,
        smtpUser:          settings.smtpUser          || '',
      },
    });
  } catch (err) { next(err); }
};

// ── PUT /api/notifications/settings ──────────────
const updateNotifSettings = async (req, res, next) => {
  try {
    const allowed = ['waEnabled','emailEnabled','autoDeposit','autoInvestment','autoCarSold','autoProfitCredited','waApiKey','smtpHost','smtpPort','smtpUser','smtpPass'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });
    await Settings.findByIdAndUpdate('platform_settings', updates);
    res.json({ success: true, message: 'Notification settings updated.' });
  } catch (err) { next(err); }
};

// ── GET /api/notifications/opt-in-summary ─────────
const getOptInSummary = async (req, res, next) => {
  try {
    const partners = await User.find({ role:'partner', status:'active' })
      .select('userId name notifications').sort({ name: 1 });
    const waOptIn    = partners.filter(p => p.notifications?.whatsapp !== false).length;
    const emailOptIn = partners.filter(p => p.notifications?.email    !== false).length;
    res.json({
      success: true,
      summary: { total: partners.length, waOptIn, emailOptIn, waOptOut: partners.length-waOptIn, emailOptOut: partners.length-emailOptIn },
      partners: partners.map(p => ({
        _id: p._id, userId: p.userId, name: p.name,
        waOptIn:    p.notifications?.whatsapp !== false,
        emailOptIn: p.notifications?.email    !== false,
      })),
    });
  } catch (err) { next(err); }
};

module.exports = {
  getTemplates, createTemplate, updateTemplate,
  sendNotification, getLogs, resendNotification,
  getNotifSettings, updateNotifSettings, getOptInSummary,
};
