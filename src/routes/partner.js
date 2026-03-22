const express = require('express');
const router  = express.Router();
const {
  getPartnerDashboard, getPartnerInvestments, getPartnerProfits,
  getPartnerTransactions, requestRefund, getRefundRequests,
  getProfile, updateBank, updateNotifications, uploadKYC,
} = require('../controllers/partnerController');
const { protect, isPartner } = require('../middleware/auth');
const upload = require('../middleware/upload');

// All routes: partner only
router.use(protect, isPartner);

router.get ('/dashboard',     getPartnerDashboard);
router.get ('/investments',   getPartnerInvestments);
router.get ('/profits',       getPartnerProfits);
router.get ('/transactions',  getPartnerTransactions);
router.get ('/refund-requests',  getRefundRequests);
router.post('/refund-request',   requestRefund);
router.get ('/profile',          getProfile);
router.put ('/bank',             updateBank);
router.put ('/notifications',    updateNotifications);
router.post('/kyc', (req,res,next)=>{ req.uploadType='kyc'; next(); }, upload.single('file'), uploadKYC);

module.exports = router;
