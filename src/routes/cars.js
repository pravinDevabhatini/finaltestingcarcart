const express = require('express');
const router  = express.Router();
const {
  getCars, getCar, createCar, updateCar,
  markSold, updateSaleDetails,
  uploadPhotos, deletePhoto, uploadDocument,
  getCarStats,
} = require('../controllers/carController');
const { protect, isAdmin, isACorAbove } = require('../middleware/auth');
const upload = require('../middleware/upload');

router.use(protect);

// Stats
router.get('/stats', isAdmin, getCarStats);

// CRUD
router.get ('/',    isACorAbove, getCars);
router.post('/',    isAdmin,     createCar);
router.get ('/:id', isACorAbove, getCar);
router.put ('/:id', isAdmin,     updateCar);

// Sale
router.post('/:id/mark-sold',   isAdmin, markSold);
router.put ('/:id/sale',        isAdmin, updateSaleDetails);

// Photos — max 5
router.post('/:id/photos', isAdmin, (req, res, next) => {
  req.uploadType = 'car-photo'; next();
}, upload.array('photos', 5), uploadPhotos);
router.delete('/:id/photos/:filename', isAdmin, deletePhoto);

// Documents
router.post('/:id/documents', isAdmin, (req, res, next) => {
  req.uploadType = 'car-bill'; next();
}, upload.single('file'), uploadDocument);

module.exports = router;
