require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

const app = express();

// --- UPDATED CORS CONFIGURATION ---
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'DELETE', 'UPDATE', 'PUT', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

const MASTER_ADMIN = "chahat.rathi1@gmail.com";

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
    name: String, 
    price: Number, 
    image: String, 
    sizes: { type: [String], default: ["S", "M", "L", "XL"] }
}));

const User = mongoose.model('User', new mongoose.Schema({
    fullName: String, 
    email: { type: String, unique: true, lowercase: true }, 
    password: String, 
    role: String
}));

const Order = mongoose.model('Order', new mongoose.Schema({
    userEmail: String, 
    items: Array, 
    total: Number, 
    date: { type: Date, default: Date.now }
}));

const Query = mongoose.model('Query', new mongoose.Schema({
    name: String, 
    email: String, 
    message: String, 
    date: { type: Date, default: Date.now }
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

// 4. Contact/Query Submission
app.post('/api/contact', async (req, res) => {
    try {
        const { name, email, message } = req.body;
        const newQuery = new Query({ name, email, message });
        await newQuery.save();
        res.status(201).json({ message: "Sent" });
    } catch (e) { res.status(500).json({ error: "Failed" }); }
});

// 5. Admin: Dashboard stats (Revenue + Queries)
app.get('/api/admin/stats', async (req, res) => {
    try {
        const queries = await Query.find().sort({ date: -1 });
        const orders = await Order.find();
        const totalRevenue = orders.reduce((sum, o) => sum + o.total, 0);
        res.json({ queries, totalRevenue, orderCount: orders.length });
    } catch (e) { res.status(500).json({ error: "Fetch failed" }); }
});

// 6. Admin: Product Upload with Cloudinary
app.post('/api/admin/products', upload.single('image'), async (req, res) => {
    try {
        const { name, price } = req.body;
        const newProduct = new Product({ name, price, image: req.file ? req.file.path : "" });
        await newProduct.save();
        res.status(201).json(newProduct);
    } catch (e) { res.status(500).json({ error: "Upload Failed" }); }
});

// 7. Admin: Delete Product (Added for your Inventory management)
app.delete('/api/admin/products/:id', async (req, res) => {
    try {
        await Product.findByIdAndDelete(req.params.id);
        res.json({ message: "Product deleted" });
    } catch (e) { res.status(500).json({ error: "Delete failed" }); }
});

// 8. Orders: Get History for Invoices
app.get('/api/orders/:email', async (req, res) => {
    try {
        const orders = await Order.find({ userEmail: req.params.email.toLowerCase() }).sort({ date: -1 });
        res.json(orders);
    } catch (e) { res.status(500).json({ error: "Fetch failed" }); }
});

// 9. Payments: Stripe Route with mandatory India compliance
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

        await new Order({ userEmail: userEmail.toLowerCase(), items, total: totalAmount }).save();
        res.json({ id: session.id });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => console.log(`🚀 ELITE API Live on ${PORT}`));
