require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');
const nodemailer = require('nodemailer');

const app = express();

// --- CORS CONFIGURATION ---
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'UPDATE', 'PUT', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const MASTER_ADMIN = "chahat.rathi1@gmail.com";

// --- NODEMAILER CONFIG ---
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, 
        pass: process.env.EMAIL_PASS 
    }
});

// --- CLOUDINARY CONFIG ---
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: { 
        folder: 'elite_products', 
        allowed_formats: ['jpg', 'png', 'jpeg'] 
    },
});
const upload = multer({ storage: storage });

// --- DATABASE ---
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('✅ ELITE DB Connected'))
    .catch(err => console.error('❌ DB Error:', err));

// --- MODELS ---
const Product = mongoose.model('Product', new mongoose.Schema({
    name: String, price: Number, image: String, 
    sizes: { type: [String], default: ["S", "M", "L", "XL"] }
}));

const User = mongoose.model('User', new mongoose.Schema({
    fullName: String, 
    email: { type: String, unique: true, lowercase: true }, 
    password: String, 
    role: String,
    isVerified: { type: Boolean, default: false } // Verified Field
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    userEmail: String, items: Array, total: Number, date: { type: Date, default: Date.now }
}));

const Query = mongoose.model('Query', new mongoose.Schema({
    name: String, email: String, message: String, date: { type: Date, default: Date.now }
}));

// --- ROUTES ---

app.get('/api/status', (req, res) => res.json({ status: "online" }));

// 1. Signup with Verification Email
app.post('/api/signup', async (req, res) => {
    try {
        const { fullName, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const role = (email.toLowerCase() === MASTER_ADMIN) ? 'admin' : 'customer';
        
        const user = new User({ fullName, email: email.toLowerCase(), password: hashedPassword, role });
        await user.save();

        const verifyLink = `${req.headers.origin}/verify?email=${email.toLowerCase()}`;
        const mailOptions = {
            from: `ELITE STORE <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Verify your ELITE Account',
            html: `<h2>Welcome to ELITE, ${fullName}!</h2>
                   <p>Please click the link below to verify your email and start shopping:</p>
                   <a href="${verifyLink}" style="padding:10px 20px; background:#00ff88; color:#000; text-decoration:none; font-weight:bold; display:inline-block;">VERIFY EMAIL</a>`
        };

        transporter.sendMail(mailOptions);
        res.status(201).json({ message: "Verification email sent! Check your inbox." });
    } catch (e) { res.status(400).json({ error: "Signup Failed" }); }
});

// 2. Email Verification Endpoint
app.post('/api/verify-email', async (req, res) => {
    try {
        await User.findOneAndUpdate({ email: req.body.email }, { isVerified: true });
        res.json({ message: "Account Verified Successfully!" });
    } catch (e) { res.status(500).json({ error: "Verification Failed" }); }
});

// 3. Login (Blocked if not verified)
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase() });
        if (user && await bcrypt.compare(password, user.password)) {
            if (!user.isVerified) return res.status(401).json({ error: "Please verify your email first!" });
            res.json({ user: { name: user.fullName, email: user.email, role: user.role } });
        } else { res.status(401).json({ error: "Invalid Credentials" }); }
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// 4. Products & Admin Routes
app.get('/api/products', async (req, res) => {
    const products = await Product.find();
    res.json(products);
});

app.post('/api/admin/products', upload.single('image'), async (req, res) => {
    const { name, price } = req.body;
    const newProduct = new Product({ name, price, image: req.file ? req.file.path : "" });
    await newProduct.save();
    res.status(201).json(newProduct);
});

app.delete('/api/admin/products/:id', async (req, res) => {
    await Product.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
});

app.get('/api/admin/stats', async (req, res) => {
    const queries = await Query.find().sort({ date: -1 });
    const orders = await Order.find();
    const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
    res.json({ queries, totalRevenue, orderCount: orders.length });
});

app.delete('/api/admin/queries/:id', async (req, res) => {
    await Query.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
});

// 5. Contact & Payments
app.post('/api/contact', async (req, res) => {
    const { name, email, message } = req.body;
    await new Query({ name, email, message }).save();
    res.status(201).json({ message: "Sent" });
});

app.post('/api/create-checkout-session', async (req, res) => {
    const { items, userEmail } = req.body;
    const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items: items.map(i => ({
            price_data: { currency: 'inr', product_data: { name: i.name }, unit_amount: i.price * 100 },
            quantity: i.quantity || 1,
        })),
        mode: 'payment',
        customer_email: userEmail,
        success_url: `${req.headers.origin}/?payment=success`,
        cancel_url: `${req.headers.origin}/?payment=cancel`,
    });
    res.json({ id: session.id });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 ELITE API Live on ${PORT}`));
