const mongoose = require('mongoose');

// ── M-05 Car Inventory Schema ────────────────────
const carSchema = new mongoose.Schema({

  // Auto ID: CCR0001, CCR0002...
  carId: { type: String, unique: true },

  // Basic Info
  make:         { type: String, required: true, trim: true },
  model:        { type: String, required: true, trim: true },
  year:         { type: String, required: true },
  variant:      { type: String, default: '' },
  fuel:         { type: String, enum: ['Petrol','Diesel','Hybrid','Electric','CNG','Other'], required: true },
  transmission: { type: String, enum: ['Manual','Automatic','CVT','AMT','Other'], required: true },
  color:        { type: String, default: '' },
  odometer:     { type: String, default: '' },
  regNo:        { type: String, default: '' },
  notes:        { type: String, default: '' },

  // Group
  group: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },

  // Purchase Details
  purchasePrice:    { type: Number, required: true },
  serviceCharges:   { type: Number, default: 0 },
  totalCost:        { type: Number }, // auto: purchasePrice + serviceCharges
  commissionPct:    { type: Number, default: 2.5 }, // from M-11 settings at time of creation
  purchaseDate:     { type: Date, required: true },

  // Dealer (M-05 section 5)
  dealer: {
    name:     { type: String, required: true },
    contact:  { type: String, required: true },
    location: { type: String, default: '' },
    visibleToPartners: { type: Boolean, default: false },
  },

  // Investment Status
  investmentStatus: {
    type: String,
    enum: ['open', 'partially_invested', 'fully_invested', 'sold'],
    default: 'open',
  },
  totalInvested: { type: Number, default: 0 },

  // Photos — max 5 (M-05 section 5.5)
  photos: [{ type: String }], // file paths

  // Documents (M-05 sections 5.6, 5.7)
  documents: {
    purchaseBill: { type: String, default: null },
    serviceBill:  { type: String, default: null },
    insurance:    { type: String, default: null },
    rc:           { type: String, default: null },
    inspection:   { type: String, default: null },
  },

  // Sale Details (M-05 section 5.8)
  sale: {
    soldPrice:   { type: Number, default: null },
    soldDate:    { type: Date,   default: null },
    buyerName:   { type: String, default: '' },
    buyerContact:{ type: String, default: '' },
    buyerNotes:  { type: String, default: '' },
    buyerVisibleToPartners: { type: Boolean, default: false },
    soldBy:      { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },

  // Computed Profit (populated after sale)
  profit: {
    grossProfit:    { type: Number, default: 0 },
    commission:     { type: Number, default: 0 },
    distributable:  { type: Number, default: 0 },
  },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

}, { timestamps: true });

// ── Auto-generate carId ───────────────────────────
carSchema.pre('save', async function(next) {
  if (!this.isNew) return next();
  const count = await mongoose.model('Car').countDocuments();
  this.carId = `CCR${String(count + 1).padStart(4, '0')}`;
  next();
});

// ── Auto-calculate totalCost ──────────────────────
carSchema.pre('save', function(next) {
  this.totalCost = (this.purchasePrice || 0) + (this.serviceCharges || 0);
  next();
});

// ── Car age virtual (days) ────────────────────────
carSchema.virtual('ageDays').get(function() {
  const end = this.sale?.soldDate || new Date();
  const start = this.purchaseDate;
  if (!start) return 0;
  return Math.max(0, Math.floor((end - start) / 86400000));
});

carSchema.set('toJSON', { virtuals: true });
carSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('Car', carSchema);
