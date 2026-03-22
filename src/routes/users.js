const express = require('express');
const router  = express.Router();
const {
  getUsers, getUser, createUser, updateUser,
  verifyKYC, updateMyBank, updateMyNotifications,
  uploadMyKYC, resetPassword, getUserStats,
} = require('../controllers/userController');
const { protect, isAdmin, isACorAbove } = require('../middleware/auth');
const upload = require('../middleware/upload');

// All routes require login
router.use(protect);

// Stats
router.get('/stats', isAdmin, getUserStats);

// Partner self-service (own profile only)
router.put('/me/bank',          updateMyBank);
router.put('/me/notifications', updateMyNotifications);
router.post('/me/kyc', (req, res, next) => {
  req.uploadType = 'kyc';
  next();
}, upload.single('file'), uploadMyKYC);

// Admin routes
router.get('/',    isACorAbove, getUsers);
router.post('/',   isAdmin,     createUser);
router.get('/:id', isACorAbove, getUser);
router.put('/:id', isAdmin,     updateUser);
router.put('/:id/kyc',            isAdmin, verifyKYC);
router.put('/:id/reset-password', isAdmin, resetPassword);

module.exports = router;
