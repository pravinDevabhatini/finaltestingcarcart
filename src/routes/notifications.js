const express = require('express');
const router  = express.Router();
const {
  getTemplates, createTemplate, updateTemplate,
  sendNotification, getLogs, resendNotification,
  getNotifSettings, updateNotifSettings, getOptInSummary,
} = require('../controllers/notificationController');
const { protect, isAdmin, isACorAbove, isSA } = require('../middleware/auth');

router.use(protect, isACorAbove);

// Templates (SA + AD edit, AC view only)
router.get ('/templates',      getTemplates);
router.post('/templates',      isAdmin, createTemplate);
router.put ('/templates/:id',  isAdmin, updateTemplate);

// Send
router.post('/send', sendNotification);

// Logs
router.get ('/logs',             getLogs);
router.post('/logs/:id/resend',  sendNotification); // uses same handler context

// Settings (SA only to write)
router.get('/settings',         getNotifSettings);
router.put('/settings',  isSA,  updateNotifSettings);

// Opt-in summary
router.get('/opt-in-summary', getOptInSummary);

module.exports = router;
