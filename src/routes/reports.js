const express = require('express');
const router  = express.Router();
const {
  getOverview, getSoldCarsReport, getAvailableCarsReport,
  getGroupWiseReport, getUserWiseReport, getCarWiseReport,
  getMonthWiseReport, getMonthCarsReport, getMonthPartnersReport,
  getMonthGroupsReport,
} = require('../controllers/reportController');
const { protect, isACorAbove } = require('../middleware/auth');

router.use(protect, isACorAbove);

router.get('/overview',        getOverview);
router.get('/sold-cars',       getSoldCarsReport);
router.get('/available-cars',  getAvailableCarsReport);
router.get('/group-wise',      getGroupWiseReport);
router.get('/user-wise',       getUserWiseReport);
router.get('/car-wise',        getCarWiseReport);
router.get('/month-wise',      getMonthWiseReport);
router.get('/month-cars',      getMonthCarsReport);
router.get('/month-partners',  getMonthPartnersReport);
router.get('/month-groups',    getMonthGroupsReport);

module.exports = router;
