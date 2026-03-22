const express = require('express');
const router  = express.Router();
const {
  getProfits, getProfit, creditProfit,
  syncProfits, getProfitSummary, getProfitsByCar,
} = require('../controllers/profitController');
const { protect, isAdmin, isACorAbove } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.use(protect);

router.get('/summary',         isACorAbove, getProfitSummary);
router.post('/sync',           isAdmin,     syncProfits);
router.get('/by-car/:carId',   isACorAbove, getProfitsByCar);
router.get('/',                getProfits);
router.get('/:id',             getProfit);
router.post('/:id/credit', isACorAbove, (req, res, next) => {
  req.uploadType = 'deposit-proof'; next();
}, upload.single('proof'), creditProfit);

module.exports = router;
