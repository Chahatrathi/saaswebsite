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

// 1. SIGNUP: Sends Branded Verification Email
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
                    <p>Welcome to the community, ${fullName}.</p>
                    <p>Please verify your email to start shopping:</p>
                    <a href="${verifyLink}" style="background:#00ff88; color:#000; padding:15px 30px; text-decoration:none; font-weight:bold; display:inline-block; margin-top:20px;">VERIFY EMAIL</a>
                </div>`
        };

        transporter.sendMail(mailOptions);
        res.status(201).json({ message: "Verification email sent! Check your inbox." });
    } catch (e) { res.status(400).json({ error: "Signup Failed - Email might already exist" }); }
});

// 2. RESEND VERIFICATION
app.post('/api/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) return res.status(404).json({ error: "User not found" });
        if (user.isVerified) return res.status(400).json({ error: "Already verified" });

        const verifyLink = `${req.headers.origin}/verify?email=${email.toLowerCase()}`;
        await transporter.sendMail({
            from: `"ELITE STORE" <${process.env.EMAIL_USER}>`,
            to: email.toLowerCase(),
            subject: 'Verify your ELITE Account',
            html: `<p>New verification link:</p><a href="${verifyLink}">VERIFY EMAIL</a>`
        });
        res.json({ message: "New link sent!" });
    } catch (e) { res.status(500).json({ error: "Failed to resend" }); }
});

// 3. LOGIN
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

// 4. ADMIN & PRODUCTS
app.get('/api/products', async (req, res) => {
    const products = await Product.find();
    res.json(products);
});

app.post('/api/admin/products', upload.single('image'), async (req, res) => {
    const newProduct = new Product({ name: req.body.name, price: req.body.price, image: req.file.path });
    await newProduct.save();
    res.status(201).json(newProduct);
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

// 5. PAYMENTS: Sends Branded Order Confirmation
app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const { items, userEmail } = req.body;
        const totalAmount = items.reduce((sum, i) => sum + (i.price * (i.quantity || 1)), 0);
        
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

        await new Order({ userEmail: userEmail.toLowerCase(), items, total: totalAmount }).save();

        const orderSummary = items.map(i => `- ${i.name}`).join('<br>');
        const mailOptions = {
            from: `"ELITE STORE" <${process.env.EMAIL_USER}>`,
            to: userEmail,
            subject: 'Order Confirmed - ELITE Gear',
            html: `
                <div style="font-family:Arial; padding:20px; border:1px solid #eee;">
                    <h2 style="color:#00ff88;">Thank you for your purchase!</h2>
                    <p>Your order is being processed and will be shipped soon.</p>
                    <hr>
                    <p><b>Items:</b><br>${orderSummary}</p>
                    <p><b>Total Amount:</b> ₹${totalAmount}</p>
                    <hr>
                    <p>Stay Elite.</p>
                </div>`
        };
        transporter.sendMail(mailOptions);

        res.json({ id: session.id });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 ELITE Live on ${PORT}`));
