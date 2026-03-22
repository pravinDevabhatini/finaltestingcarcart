const express = require('express');
const router  = express.Router();
const {
  getTransactions, addDeposit, getWallet,
  addWithdrawal, getRefunds, requestRefund,
  processRefund, getDepositSummary,
} = require('../controllers/transactionController');
const { protect, isAdmin, isACorAbove } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.use(protect);

// Summary
router.get('/summary', isACorAbove, getDepositSummary);

// Transactions list
router.get('/', getTransactions);

// Deposits (AC + AD + SA)
router.post('/deposit', isACorAbove, (req, res, next) => {
  req.uploadType = 'deposit-proof'; next();
}, upload.single('proof'), addDeposit);

// Withdrawal (AD + SA)
router.post('/withdraw', isAdmin, (req, res, next) => {
  req.uploadType = 'deposit-proof'; next();
}, upload.single('proof'), addWithdrawal);

// Wallet
router.get('/wallet/:userId', getWallet);

// Refunds
router.get('/refunds',        getRefunds);
router.post('/refunds',       requestRefund);
router.put('/refunds/:id',    isACorAbove, processRefund);

module.exports = router;
