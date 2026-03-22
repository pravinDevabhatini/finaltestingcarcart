const express = require('express');
const router  = express.Router();
const {
  getInvestments, assignInvestment, autoDistribute,
  removeInvestment, getRequests, submitRequest,
  reviewRequest, getInvestmentStats,
} = require('../controllers/investmentController');
const { protect, isAdmin, isACorAbove } = require('../middleware/auth');

router.use(protect);

// Stats
router.get('/stats',   isAdmin, getInvestmentStats);

// Partner self-invest requests
router.get ('/requests',      getRequests);
router.post('/requests',      submitRequest);
router.put ('/requests/:id',  isAdmin, reviewRequest);

// Admin investment management
router.get ('/',    isACorAbove, getInvestments);
router.post('/',    isAdmin,     assignInvestment);
router.post('/auto-distribute', isAdmin, autoDistribute);
router.delete('/:id', isAdmin,  removeInvestment);

module.exports = router;
