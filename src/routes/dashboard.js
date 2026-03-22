const express = require('express');
const router  = express.Router();
const { getAdminDashboard, getPartnerDashboard } = require('../controllers/dashboardController');
const { protect, isACorAbove, isPartner } = require('../middleware/auth');

router.use(protect);

router.get('/admin',   isACorAbove,  getAdminDashboard);
router.get('/partner', isPartner,    getPartnerDashboard);

module.exports = router;
