const express = require('express');
const router  = express.Router();
const {
  getSettings, updateSettings, getAuditLog,
  getGroups, createGroup, updateGroup, uploadLogo,
} = require('../controllers/settingsController');
const { protect, isAdmin, isACorAbove, isSA } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.use(protect);

// Platform settings (SA + AD edit; AC view only)
router.get('/',     isACorAbove, getSettings);
router.put('/',     isAdmin,     updateSettings);

// Audit log (SA + AD)
router.get('/audit', isAdmin, getAuditLog);

// Groups management (same as M-04 but routed through settings for M-11)
router.get ('/groups',      isACorAbove, getGroups);
router.post('/groups',      isAdmin,     createGroup);
router.put ('/groups/:id',  isAdmin,     updateGroup);

// Logo upload (SA only)
router.post('/logo', isSA, (req, res, next) => {
  req.uploadType = 'logo'; next();
}, upload.single('logo'), uploadLogo);

module.exports = router;
