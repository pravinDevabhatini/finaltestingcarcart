require('dotenv').config();
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
dns.setDefaultResultOrder('ipv4first');
const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const morgan     = require('morgan');
const rateLimit  = require('express-rate-limit');
const path       = require('path');

const connectDB      = require('./config/db');
const errorHandler   = require('./middleware/errorHandler');

// ── Route imports ─────────────────────────────────
const authRoutes         = require('./routes/auth');
const userRoutes         = require('./routes/users');
const groupRoutes        = require('./routes/groups');
const carRoutes          = require('./routes/cars');
const investmentRoutes   = require('./routes/investments');
const transactionRoutes  = require('./routes/transactions');
const profitRoutes       = require('./routes/profits');
const reportRoutes       = require('./routes/reports');
const notificationRoutes = require('./routes/notifications');
const settingsRoutes     = require('./routes/settings');
const systemRoutes       = require('./routes/system');
const dashboardRoutes    = require('./routes/dashboard');

// ── Connect Database ──────────────────────────────
connectDB();

const app = express();

// ── Security Middleware ───────────────────────────
app.use(helmet());
app.use(cors({ origin: process.env.FRONTEND_URL, credentials: true }));

// ── Rate Limiting ─────────────────────────────────
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20,
  message: { success: false, message: 'Too many login attempts. Try again in 15 minutes.' },
}));

// ── Request Parsing ───────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Logging ───────────────────────────────────────
if (process.env.NODE_ENV === 'development') app.use(morgan('dev'));

// ── Static Files (uploads) ────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ── API Routes ────────────────────────────────────
app.use('/api/auth',          authRoutes);
app.use('/api/users',         userRoutes);
app.use('/api/groups',        groupRoutes);
app.use('/api/cars',          carRoutes);
app.use('/api/investments',   investmentRoutes);
app.use('/api/transactions',  transactionRoutes);
app.use('/api/profits',       profitRoutes);
app.use('/api/reports',       reportRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/settings',      settingsRoutes);
app.use('/api/system',        systemRoutes);
app.use('/api/dashboard',  dashboardRoutes);
app.use('/api/partner',    require('./routes/partner'));

// ── Health Check ──────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    message: 'Car Cart Partners API is running',
    timestamp: new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    environment: process.env.NODE_ENV,
  });
});

// ── 404 Handler ───────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found.` });
});

// ── Global Error Handler ──────────────────────────
app.use(errorHandler);

// ── Start Server ──────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚗 Car Cart Partners API running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV}`);
  console.log(`   Timezone: Asia/Kolkata (IST)`);
});

module.exports = app;
