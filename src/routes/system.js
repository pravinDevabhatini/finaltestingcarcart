const express = require('express');
const router  = express.Router();
const {
  getSystemHealth, testEngine, getFileManager,
  testBalance, getInvestmentLog, getEngineDocs,
} = require('../controllers/systemController');
const { protect, isAdmin, isSA } = require('../middleware/auth');

router.use(protect, isAdmin);

router.get ('/health',              getSystemHealth);
router.post('/engines/:id/test',    isSA, testEngine);
router.get ('/files',               getFileManager);
router.get ('/balance-test',        testBalance);
router.get ('/investment-log',      getInvestmentLog);
router.get ('/docs',                getEngineDocs);

module.exports = router;
