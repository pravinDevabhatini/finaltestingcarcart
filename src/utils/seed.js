require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const dns = require('dns');
dns.setServers(['8.8.8.8', '8.8.4.4']);
dns.setDefaultResultOrder('ipv4first');

const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const seed = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI, { family: 4, serverSelectionTimeoutMS: 10000 });
    console.log('✅ MongoDB connected:', mongoose.connection.host);
  } catch(e) {
    console.error('❌ MongoDB connection failed:', e.message);
    process.exit(1);
  }

  console.log('🌱 Seeding database...');

  // Drop entire database first
  await mongoose.connection.db.dropDatabase();
  console.log('  ✓ Database cleared');

  // Load models AFTER connection
  const User     = require('../models/User');
  const Group    = require('../models/Group');
  const Car      = require('../models/Car');
  const Settings = require('../models/Settings');
  const { NotificationTemplate } = require('../models/Notification');

  // 1. Settings
  await Settings.create({
    _id: 'platform_settings',
    platformName: 'Car Cart Partners',
    defaultCommissionPct: 2.5,
    depositReturnWindowDays: 90,
    profitCreditDeadlineHrs: 24,
    maxInvestorsPerCar: 5,
  });
  console.log('  ✓ Settings');

  // 2. Groups
  const [T1, T2, F1, CR1] = await Group.insertMany([
    { name:'T1',  series:'T',  cap:1000000  },
    { name:'T2',  series:'T',  cap:1000000  },
    { name:'F1',  series:'F',  cap:5000000  },
    { name:'CR1', series:'CR', cap:10000000 },
  ]);
  console.log('  ✓ Groups (T1, T2, F1, CR1)');

  // 3. Hash passwords
  const hStaff   = await bcrypt.hash('admin@123',   12);
  const hPartner = await bcrypt.hash('partner@123', 12);

  // 4. Staff — use insertMany to bypass pre-save userId hook
  await User.collection.insertMany([
    { userId:'SA001', name:'Super Admin', mobile:'9000000001', email:'sa@carcart.in',    password:hStaff,   role:'superadmin', status:'active', joinedAt:new Date(), notifications:{whatsapp:true,email:true}, kyc:{status:'verified'}, bank:{} },
    { userId:'AD001', name:'Admin',       mobile:'9000000002', email:'admin@carcart.in', password:hStaff,   role:'admin',      status:'active', joinedAt:new Date(), notifications:{whatsapp:true,email:true}, kyc:{status:'verified'}, bank:{} },
    { userId:'AC001', name:'Accountant',  mobile:'9000000003', email:'ac@carcart.in',    password:hStaff,   role:'accountant', status:'active', joinedAt:new Date(), notifications:{whatsapp:true,email:true}, kyc:{status:'verified'}, bank:{} },
  ]);
  console.log('  ✓ Staff (SA001, AD001, AC001) — password: admin@123');

  // 5. Partners — use insertMany to bypass pre-save userId hook
  await User.collection.insertMany([
    { userId:'CCP001', name:'Rajesh Kumar',  mobile:'9876543210', email:'rajesh@email.com',   password:hPartner, role:'partner', status:'active', group:T1._id,  joinedAt:new Date(), notifications:{whatsapp:true,email:true}, kyc:{status:'verified',aadhaar:{status:'verified'},pan:{status:'verified'}}, bank:{bankName:'SBI',  accountNo:'1234567890', ifsc:'SBIN0001234', branch:'Hyderabad Main'} },
    { userId:'CCP002', name:'Priya Sharma',  mobile:'9876543211', email:'priya@email.com',    password:hPartner, role:'partner', status:'active', group:T1._id,  joinedAt:new Date(), notifications:{whatsapp:true,email:true}, kyc:{status:'verified',aadhaar:{status:'verified'},pan:{status:'verified'}}, bank:{bankName:'HDFC', accountNo:'2345678901', ifsc:'HDFC0001234', branch:'Banjara Hills'} },
    { userId:'CCP003', name:'Venkat Reddy',  mobile:'9876543212', email:'venkat@email.com',   password:hPartner, role:'partner', status:'active', group:T1._id,  joinedAt:new Date(), notifications:{whatsapp:true,email:true}, kyc:{status:'verified',aadhaar:{status:'verified'},pan:{status:'verified'}}, bank:{bankName:'ICICI',accountNo:'3456789012', ifsc:'ICIC0001234', branch:'Jubilee Hills'} },
    { userId:'CCP004', name:'Sunita Rao',    mobile:'9876543213', email:'sunita@email.com',   password:hPartner, role:'partner', status:'active', group:F1._id,  joinedAt:new Date(), notifications:{whatsapp:true,email:true}, kyc:{status:'verified',aadhaar:{status:'verified'},pan:{status:'verified'}}, bank:{bankName:'Axis', accountNo:'4567890123', ifsc:'UTIB0001234', branch:'Madhapur'} },
    { userId:'CCP005', name:'Anil Mehta',    mobile:'9876543214', email:'anil@email.com',     password:hPartner, role:'partner', status:'active', group:F1._id,  joinedAt:new Date(), notifications:{whatsapp:true,email:true}, kyc:{status:'verified',aadhaar:{status:'verified'},pan:{status:'verified'}}, bank:{bankName:'SBI',  accountNo:'5678901234', ifsc:'SBIN0005678', branch:'Gachibowli'} },
    { userId:'CCP006', name:'Deepika Nair',  mobile:'9876543215', email:'deepika@email.com',  password:hPartner, role:'partner', status:'active', group:CR1._id, joinedAt:new Date(), notifications:{whatsapp:true,email:true}, kyc:{status:'verified',aadhaar:{status:'verified'},pan:{status:'verified'}}, bank:{bankName:'HDFC', accountNo:'6789012345', ifsc:'HDFC0005678', branch:'Hitech City'} },
    { userId:'CCP007', name:'Meena Iyer',    mobile:'9876543216', email:'meena@email.com',    password:hPartner, role:'partner', status:'active', group:CR1._id, joinedAt:new Date(), notifications:{whatsapp:true,email:true}, kyc:{status:'verified',aadhaar:{status:'verified'},pan:{status:'verified'}}, bank:{bankName:'ICICI',accountNo:'7890123456', ifsc:'ICIC0005678', branch:'Kondapur'} },
    { userId:'CCP008', name:'Arjun Singh',   mobile:'9876543217', email:'arjun@email.com',    password:hPartner, role:'partner', status:'active', group:T2._id,  joinedAt:new Date(), notifications:{whatsapp:true,email:true}, kyc:{status:'verified',aadhaar:{status:'verified'},pan:{status:'verified'}}, bank:{bankName:'Kotak',accountNo:'8901234567', ifsc:'KKBK0001234', branch:'Kukatpally'} },
  ]);
  console.log('  ✓ Partners (CCP001–CCP008) — password: partner@123');

  // 6. Cars
  const adUser = await User.findOne({ userId:'AD001' });
  await Car.collection.insertMany([
    { carId:'CCR0001', make:'Toyota',  model:'Fortuner', year:'2022', fuel:'Diesel',  transmission:'Automatic', group:F1._id,  purchasePrice:3200000, serviceCharges:80000,  totalCost:3280000, commissionPct:2.5, purchaseDate:new Date('2024-01-10'), dealer:{name:'Fortune Motors',    contact:'9100000001', location:'Hyderabad'}, investmentStatus:'sold',                totalInvested:0,       sale:{soldPrice:4800000, soldDate:new Date('2024-04-15'), soldBy:adUser._id}, profit:{grossProfit:1520000,commission:120000,distributable:1400000} },
    { carId:'CCR0002', make:'Honda',   model:'City',     year:'2021', fuel:'Petrol',  transmission:'CVT',       group:T1._id,  purchasePrice:980000,  serviceCharges:45000,  totalCost:1025000, commissionPct:2.5, purchaseDate:new Date('2024-02-05'), dealer:{name:'Honda Hyderabad',   contact:'9100000002', location:'Hyderabad'}, investmentStatus:'sold',                totalInvested:0,       sale:{soldPrice:1350000, soldDate:new Date('2024-03-20'), soldBy:adUser._id}, profit:{grossProfit:325000, commission:33750, distributable:291250} },
    { carId:'CCR0003', make:'Maruti',  model:'Ertiga',   year:'2023', fuel:'Petrol',  transmission:'Manual',    group:T1._id,  purchasePrice:1150000, serviceCharges:35000,  totalCost:1185000, commissionPct:2.5, purchaseDate:new Date('2024-03-10'), dealer:{name:'Maruti Arena',      contact:'9100000003', location:'Hyderabad'}, investmentStatus:'fully_invested',      totalInvested:1185000, sale:{} },
    { carId:'CCR0004', make:'BMW',     model:'X5',       year:'2023', fuel:'Diesel',  transmission:'Automatic', group:CR1._id, purchasePrice:8500000, serviceCharges:250000, totalCost:8750000, commissionPct:2.5, purchaseDate:new Date('2024-05-02'), dealer:{name:'BMW Hyderabad',     contact:'9100000004', location:'Hyderabad'}, investmentStatus:'partially_invested',  totalInvested:3000000, sale:{} },
    { carId:'CCR0005', make:'Hyundai', model:'Creta',    year:'2022', fuel:'Petrol',  transmission:'Automatic', group:T1._id,  purchasePrice:1400000, serviceCharges:60000,  totalCost:1460000, commissionPct:2.5, purchaseDate:new Date('2024-03-15'), dealer:{name:'Hyundai Showroom',  contact:'9100000005', location:'Hyderabad'}, investmentStatus:'sold',                totalInvested:0,       sale:{soldPrice:1850000, soldDate:new Date('2024-05-22'), soldBy:adUser._id}, profit:{grossProfit:390000, commission:46250, distributable:343750} },
    { carId:'CCR0006', make:'Kia',     model:'Seltos',   year:'2023', fuel:'Petrol',  transmission:'DCT',       group:T2._id,  purchasePrice:1600000, serviceCharges:55000,  totalCost:1655000, commissionPct:2.5, purchaseDate:new Date('2024-06-05'), dealer:{name:'Kia Motors',        contact:'9100000006', location:'Hyderabad'}, investmentStatus:'open',                totalInvested:0,       sale:{} },
  ]);
  console.log('  ✓ Cars (CCR0001–CCR0006)');

  // 7. Notification Templates
  await NotificationTemplate.insertMany([
    { name:'Deposit Confirmation',   type:'deposit',          active:true, waMessage:'Hello {{partner_name}},\n\nDeposit of ₹{{deposit_amount}} received on {{date}}.\nBalance: ₹{{available_balance}}.\n\nCar Cart Partners', emailSubject:'Deposit Confirmed', emailBody:'<p>Dear {{partner_name}}, deposit of ₹{{deposit_amount}} received.</p>', variables:['{{partner_name}}','{{deposit_amount}}','{{date}}','{{available_balance}}'] },
    { name:'Profit Credited',        type:'profit_credited',  active:true, waMessage:'Hello {{partner_name}},\n\nProfit ₹{{profit_amount}} credited on {{credited_date}}.\n\nCar Cart Partners', emailSubject:'Profit Credited', emailBody:'<p>Profit of ₹{{profit_amount}} credited.</p>', variables:['{{partner_name}}','{{profit_amount}}','{{credited_date}}'] },
    { name:'Investment Confirmation',type:'investment',       active:true, waMessage:'Hello {{partner_name}},\n\nInvestment ₹{{deposit_amount}} in {{car_name}} confirmed.\n\nCar Cart Partners', emailSubject:'Investment Confirmed', emailBody:'<p>Investment confirmed.</p>', variables:['{{partner_name}}','{{deposit_amount}}','{{car_name}}','{{date}}'] },
    { name:'Car Update',             type:'car_update',       active:true, waMessage:'Car {{car_id}} status: {{status}}.\n\nCar Cart Partners', emailSubject:'Car Update', emailBody:'<p>Car update.</p>', variables:['{{car_id}}','{{car_model}}','{{status}}'] },
    { name:'Profit Generated',       type:'profit_generated', active:true, waMessage:'Profit ₹{{profit_amount}} from {{car_name}} calculated.\n\nCar Cart Partners', emailSubject:'Profit Generated', emailBody:'<p>Profit generated.</p>', variables:['{{partner_name}}','{{car_name}}','{{profit_amount}}','{{sold_date}}'] },
    { name:'Custom Broadcast',       type:'custom',           active:true, waMessage:'', emailSubject:'', emailBody:'', variables:['{{partner_name}}','{{date}}'] },
  ]);
  console.log('  ✓ Notification Templates (6)');

  console.log('\n✅ Seed complete!');
  console.log('   Staff login:   mobile + admin@123');
  console.log('   Partner login: mobile + partner@123');
  process.exit(0);
};

seed().catch(err => { console.error('❌ Seed failed:', err.message); process.exit(1); });
