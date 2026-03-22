const express = require('express');
const router  = express.Router();
const { login, getMe, logout, changePassword } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

// Public
router.post('/login',  login);

// Protected
router.get ('/me',              protect, getMe);
router.post('/logout',          protect, logout);
router.post('/change-password', protect, changePassword);

module.exports = router;
