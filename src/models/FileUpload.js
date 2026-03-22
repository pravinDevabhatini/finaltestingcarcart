const mongoose = require('mongoose');

// ── M-13 File Upload Management Schema ───────────
const fileUploadSchema = new mongoose.Schema({

  fileId: { type: String, unique: true },

  filename:  { type: String, required: true },
  mimetype:  { type: String, required: true },
  size:      { type: Number, required: true }, // bytes
  path:      { type: String, required: true }, // server path

  type: {
    type: String,
    enum: ['photo','bill','proof','kyc','logo'],
    required: true,
  },

  // Linkage — what record is this file attached to?
  linkedTo: {
    type: String,
    enum: ['car','partner','transaction','settings',null],
    default: null,
  },
  linkedId: {
    type: mongoose.Schema.Types.ObjectId,
    default: null,
  },

  // Orphan = not linked to any record
  isOrphan: { type: Boolean, default: false },

  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  uploadedAt: { type: Date, default: Date.now },

}, { timestamps: false });

// ── Auto-generate fileId ──────────────────────────
fileUploadSchema.pre('save', async function(next) {
  if (!this.isNew) return next();
  const count = await mongoose.model('FileUpload').countDocuments();
  this.fileId = `F${String(count + 1).padStart(4, '0')}`;
  next();
});

module.exports = mongoose.model('FileUpload', fileUploadSchema);
