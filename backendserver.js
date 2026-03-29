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
    isVerified: { type: Boolean, default: false }
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    userEmail: String, items: Array, total: Number, date: { type: Date, default: Date.now }
}));

const Query = mongoose.model('Query', new mongoose.Schema({
    name: String, email: String, message: String, date: { type: Date, default: Date.now }
}));

// --- ROUTES ---

app.get('/api/status', (req, res) => res.json({ status: "online" }));

// 1. Signup with Verification
app.post('/api/signup', async (req, res) => {
    try {
        const { fullName, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const role = (email.toLowerCase() === MASTER_ADMIN) ? 'admin' : 'customer';
        
        const user = new User({ fullName, email: email.toLowerCase(), password: hashedPassword, role });
        await user.save();

        const verifyLink = `${req.headers.origin}/verify?email=${email.toLowerCase()}`;
        await transporter.sendMail({
            from: `ELITE STORE <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Verify your ELITE Account',
            html: `<div style="font-family:Arial; text-align:center; padding:20px;">
                    <h2>Welcome to ELITE!</h2>
                    <p>Click the button below to verify your email:</p>
                    <a href="${verifyLink}" style="padding:10px 20px; background:#00ff88; color:#000; text-decoration:none; font-weight:bold; border-radius:5px;">VERIFY NOW</a>
                   </div>`
        });
        res.status(201).json({ message: "Verification email sent!" });
    } catch (e) { res.status(400).json({ error: "Signup Failed" }); }
});

// 2. Resend Verification
app.post('/api/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) return res.status(404).json({ error: "User not found" });
        if (user.isVerified) return res.status(400).json({ error: "Already verified" });

        const verifyLink = `${req.headers.origin}/verify?email=${email.toLowerCase()}`;
        await transporter.sendMail({
            from: `ELITE STORE <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Verify your ELITE Account',
            html: `<p>New verification link:</p><a href="${verifyLink}">VERIFY EMAIL</a>`
        });
        res.json({ message: "New link sent!" });
    } catch (e) { res.status(500).json({ error: "Failed to resend" }); }
});

// 3. Login & Verification Link Check
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

app.post('/api/verify-email', async (req, res) => {
    try {
        await User.findOneAndUpdate({ email: req.body.email }, { isVerified: true });
        res.json({ message: "Account Verified Successfully!" });
    } catch (e) { res.status(500).json({ error: "Verification Failed" }); }
});

// 4. Products & Admin Management
app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find();
        res.json(products);
    } catch (e) { res.status(500).json({ error: "Fetch failed" }); }
});

app.post('/api/admin/products', upload.single('image'), async (req, res) => {
    try {
        const newProduct = new Product({ 
            name: req.body.name, 
            price: req.body.price, 
            image: req.file.path 
        });
        await newProduct.save();
        res.status(201).json(newProduct);
    } catch (e) { res.status(500).json({ error: "Upload Failed" }); }
});

app.get('/api/admin/stats', async (req, res) => {
    try {
        const queries = await Query.find().sort({ date: -1 });
        const orders = await Order.find();
        const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
        res.json({ queries, totalRevenue });
    } catch (e) { res.status(500).json({ error: "Stats failed" }); }
});

app.delete('/api/admin/queries/:id', async (req, res) => {
    try {
        await Query.findByIdAndDelete(req.params.id);
        res.json({ message: "Deleted" });
    } catch (e) { res.status(500).json({ error: "Delete failed" }); }
});

// 5. Contact & Payments
app.post('/api/contact', async (req, res) => {
    try {
        const { name, email, message } = req.body;
        const newQuery = new Query({ name, email, message });
        await newQuery.save();

        // Optional Admin Alert
        await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: MASTER_ADMIN,
            subject: `🔥 NEW QUERY: ${name}`,
            text: `Message: ${message}\nFrom: ${email}`
        });

        res.status(201).json({ message: "Sent" });
    } catch (e) { res.status(500).json({ error: "Failed" }); }
});

app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const { items, userEmail } = req.body;
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: items.map(i => ({
                price_data: { 
                    currency: 'inr', 
                    product_data: { name: i.name }, 
                    unit_amount: i.price * 100 
                },
                quantity: i.quantity || 1,
            })),
            mode: 'payment',
            customer_email: userEmail,
            success_url: `${req.headers.origin}/?payment=success`,
            cancel_url: `${req.headers.origin}/?payment=cancel`,
        });

        // Save order as pending/initiate
        await new Order({ userEmail: userEmail.toLowerCase(), items, total: items.reduce((s,i)=>s+i.price, 0) }).save();

        res.json({ id: session.id });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 ELITE Live on ${PORT}`));
