const express = require('express');
const router  = express.Router();
const { getGroups, getGroup, createGroup, updateGroup, getGroupStats } = require('../controllers/groupController');
const { protect, isAdmin, isACorAbove } = require('../middleware/auth');

router.use(protect);

router.get('/stats', isACorAbove, getGroupStats);
router.get('/',      isACorAbove, getGroups);
router.post('/',     isAdmin,     createGroup);
router.get('/:id',   isACorAbove, getGroup);
router.put('/:id',   isAdmin,     updateGroup);

module.exports = router;
