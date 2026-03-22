const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');

const app = express();
// CORS is now open so your public website can talk to your public server
app.use(cors()); 
app.use(express.json());

// Replace the local URL with an Environment Variable for the Cloud Database
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

app.get('/api/status', (req, res) => res.json({ status: "online" }));

app.post('/api/login', async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (user && await bcrypt.compare(password, user.password)) {
        res.json({ user: { name: user.fullName, email: user.email, role: user.role } });
    } else { res.status(401).json({ error: "Invalid Credentials" }); }
});

app.post('/api/signup', async (req, res) => {
    try {
        const { fullName, email, password, role } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = new User({ fullName, email, password: hashedPassword, role });
        await user.save();
        res.status(201).json({ user: { name: user.fullName, role: user.role } });
    } catch (err) { res.status(400).json({ error: "User exists" }); }
});

// Use PORT from environment variable (Required for Render/Heroku)
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 ELITE Server Live on Port ${PORT}`);
});