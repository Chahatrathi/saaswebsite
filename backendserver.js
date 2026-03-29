const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();

// 1. IMPROVED CORS: Allows your Vercel frontend to talk to this server
app.use(cors()); 
app.use(express.json());

// 2. DATABASE CONNECTION
// Make sure to add your MongoDB Atlas string in Render's Environment Variables
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/elite_brand';

mongoose.connect(MONGO_URI)
    .then(() => console.log('✅ Cloud Database Connected'))
    .catch(err => console.error('❌ MongoDB Error:', err));

const User = mongoose.model('User', new mongoose.Schema({
    fullName: String,
    email: { type: String, unique: true, required: true },
    password: { type: String, required: true },
    role: { type: String, enum: ['customer', 'admin'], default: 'customer' }
}));

// --- ROUTES ---

// 3. ROOT ROUTE: Fixes the "Cannot GET /" error on Render
app.get('/', (req, res) => {
    res.status(200).send('🚀 ELITE API is live and running.');
});

// Status check for your frontend dot
app.get('/api/status', (req, res) => res.json({ status: "online" }));

app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const user = await User.findOne({ email });
        if (user && await bcrypt.compare(password, user.password)) {
            res.json({ user: { name: user.fullName, email: user.email, role: user.role } });
        } else { 
            res.status(401).json({ error: "Invalid Credentials" }); 
        }
    } catch (err) {
        res.status(500).json({ error: "Server Error" });
    }
});

app.post('/api/signup', async (req, res) => {
    try {
        const { fullName, email, password, role } = req.body;
        // Check if user exists first for cleaner error handling
        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).json({ error: "User already exists" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ fullName, email, password: hashedPassword, role });
        await user.save();
        res.status(201).json({ user: { name: user.fullName, role: user.role } });
    } catch (err) { 
        res.status(400).json({ error: "Registration failed" }); 
    }
});

// 4. PORT BINDING: Required for Render
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ELITE Server Live on Port ${PORT}`);
});