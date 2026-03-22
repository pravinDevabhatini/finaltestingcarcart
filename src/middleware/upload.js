const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

// ── M-13 Engine 13.2: File Upload Manager ────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Organise by type
    const typeMap = {
      'car-photo':   'cars',
      'car-bill':    'cars',
      'deposit-proof': 'transactions',
      'kyc':         'kyc',
      'logo':        'settings',
    };
    const folder = typeMap[req.uploadType] || 'misc';
    const dir = path.join(process.env.UPLOAD_PATH || './uploads', folder);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase();
    const name = `${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`;
    cb(null, name);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = /jpeg|jpg|png|pdf/;
  const ext = path.extname(file.originalname).toLowerCase().slice(1);
  if (allowed.test(ext)) return cb(null, true);
  cb(new Error('Only JPG, PNG and PDF files are allowed.'), false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: parseInt(process.env.MAX_FILE_SIZE) || 5 * 1024 * 1024 },
});

module.exports = upload;
