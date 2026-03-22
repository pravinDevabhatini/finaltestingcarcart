const Car        = require('../models/Car');
const Investment = require('../models/Investment');
const Profit     = require('../models/Profit');
const Settings   = require('../models/Settings');
const Group      = require('../models/Group');
const { carAgeDays, formatIST, addHours } = require('../utils/ist');
const { calculateCarProfit, calculateInvestorProfit, calculateSharePct } = require('../utils/profitEngine');

// ── helpers ───────────────────────────────────────
const safeCar = (c, role) => {
  const base = {
    _id: c._id, carId: c.carId,
    make: c.make, model: c.model, year: c.year,
    variant: c.variant, fuel: c.fuel, transmission: c.transmission,
    color: c.color, odometer: c.odometer, regNo: c.regNo, notes: c.notes,
    group: c.group,
    purchasePrice: c.purchasePrice, serviceCharges: c.serviceCharges,
    totalCost: c.totalCost,
    purchaseDate: c.purchaseDate,
    investmentStatus: c.investmentStatus,
    totalInvested: c.totalInvested,
    photos: c.photos || [],
    ageDays: carAgeDays(c.purchaseDate, c.sale?.soldDate),
    createdAt: formatIST(c.createdAt),
  };

  // Commission % — hidden from partners (M-05 business rule)
  if (role !== 'partner') {
    base.commissionPct = c.commissionPct;
    base.dealer        = c.dealer;
    base.documents     = c.documents;
    base.profit        = c.profit;
  }

  // Sale details
  if (c.investmentStatus === 'sold') {
    base.sale = {
      soldPrice:  c.sale?.soldPrice,
      soldDate:   c.sale?.soldDate,
      soldBy:     c.sale?.soldBy,
    };
    // Buyer contact — hidden from partners
    if (role !== 'partner') {
      base.sale.buyerName    = c.sale?.buyerName;
      base.sale.buyerContact = c.sale?.buyerContact;
      base.sale.buyerNotes   = c.sale?.buyerNotes;
    }
  }
  return base;
};

// ── GET /api/cars ─────────────────────────────────
const getCars = async (req, res, next) => {
  try {
    const { status, group, search, page = 1, limit = 50 } = req.query;
    const query = {};

    if (status) query.investmentStatus = status;
    if (group)  query.group = group;
    if (search) {
      query.$or = [
        { carId: { $regex: search, $options: 'i' } },
        { make:  { $regex: search, $options: 'i' } },
        { model: { $regex: search, $options: 'i' } },
      ];
    }

    const skip  = (Number(page) - 1) * Number(limit);
    const total = await Car.countDocuments(query);
    const cars  = await Car.find(query)
      .populate('group', 'name series cap')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit));

    res.json({
      success: true,
      count: cars.length, total,
      page: Number(page),
      pages: Math.ceil(total / Number(limit)),
      cars: cars.map(c => safeCar(c, req.user.role)),
    });
  } catch (err) { next(err); }
};

// ── GET /api/cars/:id ─────────────────────────────
const getCar = async (req, res, next) => {
  try {
    const car = await Car.findById(req.params.id)
      .populate('group', 'name series cap status')
      .populate('sale.soldBy', 'name userId');
    if (!car) return res.status(404).json({ success: false, message: 'Car not found.' });

    // Get investors for this car
    const investments = await Investment.find({ car: car._id })
      .populate('user', 'userId name mobile group');

    res.json({
      success: true,
      car: safeCar(car, req.user.role),
      investments: req.user.role !== 'partner' ? investments : [],
    });
  } catch (err) { next(err); }
};

// ── POST /api/cars ────────────────────────────────
const createCar = async (req, res, next) => {
  try {
    const {
      make, model, year, variant, fuel, transmission,
      color, odometer, regNo, notes,
      group, purchasePrice, serviceCharges,
      purchaseDate, commissionPct,
      dealerName, dealerContact, dealerLocation,
    } = req.body;

    if (!make || !model || !year || !fuel || !transmission || !group || !purchasePrice || !purchaseDate || !dealerName || !dealerContact) {
      return res.status(400).json({ success: false, message: 'Required fields missing.' });
    }

    // Read commission from settings if not provided
    const settings  = await Settings.getSingleton();
    const commPct   = commissionPct != null ? Number(commissionPct) : settings.defaultCommissionPct;

    const car = await Car.create({
      make, model, year, variant: variant || '', fuel, transmission,
      color: color || '', odometer: odometer || '', regNo: regNo || '', notes: notes || '',
      group, purchasePrice: Number(purchasePrice),
      serviceCharges: Number(serviceCharges || 0),
      commissionPct: commPct,
      purchaseDate: new Date(purchaseDate),
      dealer: { name: dealerName, contact: dealerContact, location: dealerLocation || '' },
      createdBy: req.user._id,
    });

    await car.populate('group', 'name series cap');
    res.status(201).json({ success: true, message: 'Car added successfully.', car: safeCar(car, req.user.role) });
  } catch (err) { next(err); }
};

// ── PUT /api/cars/:id ─────────────────────────────
const updateCar = async (req, res, next) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) return res.status(404).json({ success: false, message: 'Car not found.' });
    if (car.investmentStatus === 'sold') {
      return res.status(400).json({ success: false, message: 'Sold cars cannot be edited via this endpoint. Use /mark-sold to update sale details.' });
    }

    const allowed = ['make','model','year','variant','fuel','transmission','color','odometer','regNo','notes','group','purchasePrice','serviceCharges','purchaseDate','commissionPct'];
    allowed.forEach(f => { if (req.body[f] !== undefined) car[f] = req.body[f]; });

    // Update dealer if provided
    if (req.body.dealerName)    car.dealer.name     = req.body.dealerName;
    if (req.body.dealerContact) car.dealer.contact  = req.body.dealerContact;
    if (req.body.dealerLocation)car.dealer.location = req.body.dealerLocation;

    await car.save();
    await car.populate('group', 'name series cap');
    res.json({ success: true, message: 'Car updated.', car: safeCar(car, req.user.role) });
  } catch (err) { next(err); }
};

// ── POST /api/cars/:id/mark-sold ──────────────────
// M-05 section 5.8 — triggers profit engine (M-13 E04) + investment return (M-13 E07)
const markSold = async (req, res, next) => {
  try {
    const car = await Car.findById(req.params.id).populate('group');
    if (!car) return res.status(404).json({ success: false, message: 'Car not found.' });
    if (car.investmentStatus === 'sold') {
      return res.status(400).json({ success: false, message: 'Car is already marked as sold.' });
    }

    const { soldPrice, soldDate, buyerName, buyerContact, buyerNotes } = req.body;
    if (!soldPrice || !soldDate) {
      return res.status(400).json({ success: false, message: 'Sold price and sold date are required.' });
    }
    if (Number(soldPrice) <= 0) {
      return res.status(400).json({ success: false, message: 'Sold price must be positive.' });
    }

    const saleDate = new Date(soldDate);

    // ── 1. Update car sale details ─────────────────
    car.sale = {
      soldPrice: Number(soldPrice),
      soldDate:  saleDate,
      buyerName: buyerName || '',
      buyerContact: buyerContact || '',
      buyerNotes: buyerNotes || '',
      soldBy: req.user._id,
    };
    car.investmentStatus = 'sold';

    // ── 2. Calculate profit (M-13 Engine 13.4) ─────
    const { grossProfit, commission, distributable } = calculateCarProfit({
      purchasePrice: car.purchasePrice,
      serviceCharges: car.serviceCharges,
      commissionPct: car.commissionPct,
      sale: { soldPrice: Number(soldPrice) },
    });
    car.profit = { grossProfit, commission, distributable };
    await car.save();

    // ── 3. Get all active investments ─────────────
    const investments = await Investment.find({ car: car._id, status: 'active' });
    const totalInvested = investments.reduce((s, i) => s + i.amount, 0);

    const settings = await Settings.getSingleton();
    const creditDeadline = addHours(saleDate, settings.profitCreditDeadlineHrs);

    // ── 4. Create profit records + return investments (M-13 E07) ─
    await Promise.all(investments.map(async (inv) => {
      const sharePct     = calculateSharePct(inv.amount, totalInvested);
      const profitAmount = calculateInvestorProfit(inv.amount, totalInvested, distributable);

      await Profit.create({
        car: car._id, investment: inv._id,
        user: inv.user, group: inv.group,
        investmentAmount: inv.amount,
        sharePct,
        purchasePrice: car.purchasePrice, serviceCharges: car.serviceCharges,
        totalCost: car.totalCost, soldPrice: Number(soldPrice),
        grossProfit, commissionPct: car.commissionPct,
        commissionAmt: commission, distributable,
        profitAmount,
        saleDate,
        creditDeadline,
        status: 'pending',
      });

      // Return investment — no credit transaction, balance recalculates (M-13 E07)
      inv.status     = 'returned';
      inv.returnedAt = new Date();
      await inv.save();
    }));

    res.json({
      success: true,
      message: `Car ${car.carId} marked as sold. ${investments.length} profit records created. Investments returned.`,
      car: safeCar(car, req.user.role),
      profitSummary: { grossProfit, commission, distributable, investorsCount: investments.length },
    });
  } catch (err) { next(err); }
};

// ── PUT /api/cars/:id/sale ────────────────────────
// Admin can edit sale details after marking sold (does NOT re-trigger profit engine)
const updateSaleDetails = async (req, res, next) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) return res.status(404).json({ success: false, message: 'Car not found.' });
    if (car.investmentStatus !== 'sold') {
      return res.status(400).json({ success: false, message: 'Car is not sold yet.' });
    }

    const { buyerName, buyerContact, buyerNotes } = req.body;
    if (buyerName)    car.sale.buyerName    = buyerName;
    if (buyerContact) car.sale.buyerContact = buyerContact;
    if (buyerNotes)   car.sale.buyerNotes   = buyerNotes;
    await car.save();

    res.json({ success: true, message: 'Sale details updated.', car: safeCar(car, req.user.role) });
  } catch (err) { next(err); }
};

// ── POST /api/cars/:id/photos ─────────────────────
const uploadPhotos = async (req, res, next) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No photos uploaded.' });
    }
    const car = await Car.findById(req.params.id);
    if (!car) return res.status(404).json({ success: false, message: 'Car not found.' });
    if (car.photos.length + req.files.length > 5) {
      return res.status(400).json({ success: false, message: `Max 5 photos per car. Current: ${car.photos.length}.` });
    }

    const filenames = req.files.map(f => f.filename);
    car.photos.push(...filenames);
    await car.save();

    res.json({ success: true, message: `${req.files.length} photo(s) uploaded.`, photos: car.photos });
  } catch (err) { next(err); }
};

// ── DELETE /api/cars/:id/photos/:filename ─────────
const deletePhoto = async (req, res, next) => {
  try {
    const car = await Car.findById(req.params.id);
    if (!car) return res.status(404).json({ success: false, message: 'Car not found.' });
    car.photos = car.photos.filter(p => p !== req.params.filename);
    await car.save();
    res.json({ success: true, message: 'Photo removed.', photos: car.photos });
  } catch (err) { next(err); }
};

// ── POST /api/cars/:id/documents ──────────────────
const uploadDocument = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' });
    const { docType } = req.body; // purchaseBill|serviceBill|insurance|rc|inspection
    const validDocs = ['purchaseBill','serviceBill','insurance','rc','inspection'];
    if (!validDocs.includes(docType)) {
      return res.status(400).json({ success: false, message: 'Invalid document type.' });
    }

    const car = await Car.findById(req.params.id);
    if (!car) return res.status(404).json({ success: false, message: 'Car not found.' });
    car.documents[docType] = req.file.filename;
    await car.save();

    res.json({ success: true, message: `${docType} uploaded.`, documents: car.documents });
  } catch (err) { next(err); }
};

// ── GET /api/cars/stats ───────────────────────────
const getCarStats = async (req, res, next) => {
  try {
    const [total, open, partial, full, sold] = await Promise.all([
      Car.countDocuments(),
      Car.countDocuments({ investmentStatus: 'open' }),
      Car.countDocuments({ investmentStatus: 'partially_invested' }),
      Car.countDocuments({ investmentStatus: 'fully_invested' }),
      Car.countDocuments({ investmentStatus: 'sold' }),
    ]);
    res.json({ success: true, stats: { total, open, partial, full, sold } });
  } catch (err) { next(err); }
};

module.exports = {
  getCars, getCar, createCar, updateCar,
  markSold, updateSaleDetails,
  uploadPhotos, deletePhoto, uploadDocument,
  getCarStats,
};
