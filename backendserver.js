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
        pass: process.env.EMAIL_PASS // 16-character App Password
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
    params: { folder: 'elite_products', allowed_formats: ['jpg', 'png', 'jpeg'] },
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

// 1. SIGNUP: Sends Verification Email (User can still login)
app.post('/api/signup', async (req, res) => {
    try {
        const { fullName, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const role = (email.toLowerCase() === MASTER_ADMIN) ? 'admin' : 'customer';
        
        const user = new User({ fullName, email: email.toLowerCase(), password: hashedPassword, role, isVerified: false });
        await user.save();

        const verifyLink = `${req.headers.origin}/verify?email=${email.toLowerCase()}`;
        
        const mailOptions = {
            from: `"ELITE STORE" <${process.env.EMAIL_USER}>`,
            to: email.toLowerCase(),
            subject: 'Verify your ELITE Account',
            html: `
                <div style="background:#000; color:#fff; padding:40px; font-family:Arial; text-align:center; border:1px solid #00ff88;">
                    <h1 style="letter-spacing:10px;">ELITE</h1>
                    <p>Welcome, ${fullName}.</p>
                    <p>Please verify your email to complete your profile:</p>
                    <a href="${verifyLink}" style="background:#00ff88; color:#000; padding:15px 30px; text-decoration:none; font-weight:bold; display:inline-block; margin-top:20px; border-radius:5px;">VERIFY EMAIL</a>
                </div>`
        };

        transporter.sendMail(mailOptions, (err) => { if(err) console.log("Mail Error:", err); });
        
        res.status(201).json({ 
            message: "Account created! Verification email sent.",
            user: { name: user.fullName, email: user.email, role: user.role } 
        });
    } catch (e) { res.status(400).json({ error: "Signup Failed - User exists" }); }
});

// 2. LOGIN: Direct Access (No verification block)
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase() });
        if (user && await bcrypt.compare(password, user.password)) {
            res.json({ user: { name: user.fullName, email: user.email, role: user.role } });
        } else { res.status(401).json({ error: "Invalid Credentials" }); }
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// 3. VERIFY ENDPOINT
app.post('/api/verify-email', async (req, res) => {
    try {
        await User.findOneAndUpdate({ email: req.body.email }, { isVerified: true });
        res.json({ message: "Verification successful!" });
    } catch (e) { res.status(500).json({ error: "Failed" }); }
});

// 4. STORE & ADMIN
app.get('/api/products', async (req, res) => {
    const products = await Product.find();
    res.json(products);
});

app.post('/api/admin/products', upload.single('image'), async (req, res) => {
    try {
        const newProduct = new Product({ name: req.body.name, price: req.body.price, image: req.file.path });
        await newProduct.save();
        res.status(201).json(newProduct);
    } catch (e) { res.status(500).json({ error: "Upload error" }); }
});

app.get('/api/admin/stats', async (req, res) => {
    const queries = await Query.find().sort({ date: -1 });
    const orders = await Order.find();
    const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
    res.json({ queries, totalRevenue });
});

app.delete('/api/admin/queries/:id', async (req, res) => {
    await Query.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
});

app.post('/api/contact', async (req, res) => {
    const { name, email, message } = req.body;
    await new Query({ name, email, message }).save();
    res.status(201).json({ message: "Sent" });
});

// 5. PAYMENTS & ORDER CONFIRMATION
app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const { items, userEmail } = req.body;
        const total = items.reduce((s, i) => s + (i.price * (i.quantity || 1)), 0);
        
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: items.map(i => ({
                price_data: { currency: 'inr', product_data: { name: i.name }, unit_amount: i.price * 100 },
                quantity: 1,
            })),
            mode: 'payment',
            customer_email: userEmail,
            success_url: `${req.headers.origin}/?payment=success`,
            cancel_url: `${req.headers.origin}/?payment=cancel`,
        });

        await new Order({ userEmail: userEmail.toLowerCase(), items, total }).save();

        const mailOptions = {
            from: `"ELITE STORE" <${process.env.EMAIL_USER}>`,
            to: userEmail,
            subject: 'Order Confirmed - ELITE Gear',
            html: `<h2>Thanks for shopping!</h2><p>Your order for ₹${total} is confirmed.</p>`
        };
        transporter.sendMail(mailOptions);

        res.json({ id: session.id });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 ELITE API Live on ${PORT}`));
