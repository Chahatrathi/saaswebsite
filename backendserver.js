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
    fullName: String, email: { type: String, unique: true, lowercase: true }, 
    password: String, role: String
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    userEmail: String, items: Array, total: Number, date: { type: Date, default: Date.now }
}));

const Query = mongoose.model('Query', new mongoose.Schema({
    name: String, email: String, message: String, date: { type: Date, default: Date.now }
}));

// --- ROUTES ---

app.get('/api/status', (req, res) => res.json({ status: "online" }));

// 1. Get All Products
app.get('/api/products', async (req, res) => {
    try {
        const products = await Product.find();
        res.json(products);
    } catch (e) { res.status(500).json({ error: "Could not fetch products" }); }
});

// 2. Auth: Signup
app.post('/api/signup', async (req, res) => {
    try {
        const { fullName, email, password } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const role = (email.toLowerCase() === MASTER_ADMIN) ? 'admin' : 'customer';
        const user = new User({ fullName, email: email.toLowerCase(), password: hashedPassword, role });
        await user.save();
        res.status(201).json({ user: { name: user.fullName, email: user.email, role: user.role } });
    } catch (e) { res.status(400).json({ error: "Signup Failed" }); }
});

// 3. Auth: Login
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email: email.toLowerCase() });
        if (user && await bcrypt.compare(password, user.password)) {
            res.json({ user: { name: user.fullName, email: user.email, role: user.role } });
        } else { res.status(401).json({ error: "Invalid Credentials" }); }
    } catch (e) { res.status(500).json({ error: "Server Error" }); }
});

// 4. Contact Route with Email Notification
app.post('/api/contact', async (req, res) => {
    try {
        const { name, email, message } = req.body;
        const newQuery = new Query({ name, email, message });
        await newQuery.save();

        const mailOptions = {
            from: process.env.EMAIL_USER,
            to: MASTER_ADMIN,
            subject: `🔥 NEW ELITE QUERY: ${name}`,
            text: `New customer query:\n\nName: ${name}\nEmail: ${email}\nMessage: ${message}`
        };

        transporter.sendMail(mailOptions, (error, info) => {
            if (error) console.log("Admin Email Error:", error);
        });

        res.status(201).json({ message: "Sent" });
    } catch (e) { res.status(500).json({ error: "Failed" }); }
});

// 5. Admin: Dashboard stats
app.get('/api/admin/stats', async (req, res) => {
    try {
        const queries = await Query.find().sort({ date: -1 });
        const orders = await Order.find();
        const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
        res.json({ queries, totalRevenue, orderCount: orders.length });
    } catch (e) { res.status(500).json({ error: "Fetch failed" }); }
});

// 6. Admin: Product Upload
app.post('/api/admin/products', upload.single('image'), async (req, res) => {
    try {
        const { name, price } = req.body;
        const newProduct = new Product({ name, price, image: req.file ? req.file.path : "" });
        await newProduct.save();
        res.status(201).json(newProduct);
    } catch (e) { res.status(500).json({ error: "Upload Failed" }); }
});

// 7. Admin: Delete Product
app.delete('/api/admin/products/:id', async (req, res) => {
    try {
        await Product.findByIdAndDelete(req.params.id);
        res.json({ message: "Product deleted" });
    } catch (e) { res.status(500).json({ error: "Delete failed" }); }
});

// 8. Admin: Delete Query
app.delete('/api/admin/queries/:id', async (req, res) => {
    try {
        await Query.findByIdAndDelete(req.params.id);
        res.json({ message: "Query deleted" });
    } catch (e) { res.status(500).json({ error: "Delete failed" }); }
});

// 9. Orders: Get History
app.get('/api/orders/:email', async (req, res) => {
    try {
        const orders = await Order.find({ userEmail: req.params.email.toLowerCase() }).sort({ date: -1 });
        res.json(orders);
    } catch (e) { res.status(500).json({ error: "Fetch failed" }); }
});

// 10. Payments: Stripe Route with Confirmation Email
app.post('/api/create-checkout-session', async (req, res) => {
    try {
        const { items, userEmail } = req.body;
        const totalAmount = items.reduce((sum, i) => sum + (i.price * i.quantity), 0);
        
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            billing_address_collection: 'required', 
            shipping_address_collection: { allowed_countries: ['IN'] },
            line_items: items.map(i => ({
                price_data: { 
                    currency: 'inr', 
                    product_data: { name: `${i.name} (${i.size})` }, 
                    unit_amount: i.price * 100 
                },
                quantity: i.quantity || 1,
            })),
            mode: 'payment',
            customer_email: userEmail,
            success_url: `${req.headers.origin}/?payment=success`,
            cancel_url: `${req.headers.origin}/?payment=cancel`,
        });

        const newOrder = new Order({ userEmail: userEmail.toLowerCase(), items, total: totalAmount });
        await newOrder.save();

        const itemDetails = items.map(i => `- ${i.name} (${i.size}) x${i.quantity || 1}`).join('\n');
        
        const customerMailOptions = {
            from: `ELITE STORE <${process.env.EMAIL_USER}>`,
            to: userEmail,
            subject: `Order Confirmed! Your ELITE Gear is on the way 📦`,
            text: `Hi! \n\nThank you for shopping with ELITE. Your order has been successfully placed.\n\nSummary:\n${itemDetails}\n\nTotal Paid: ₹${totalAmount}\n\nStay Elite,\nChahat Rathi`
        };

        transporter.sendMail(customerMailOptions, (error, info) => {
            if (error) console.log("Confirmation Email Error:", error);
        });

        res.json({ id: session.id });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 ELITE API Live on ${PORT}`));
