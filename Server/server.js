require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

// Database Connection
mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Connected to MongoDB'))
    .catch(err => console.error('MongoDB connection error:', err));

// Routes
app.get('/', (req, res) => {
    res.send('Server is running');
});

const booksRouter = require('./routes/books');
const entriesRouter = require('./routes/entries');
const usersRouter = require('./routes/users');
const businessesRouter = require('./routes/businesses'); // NEW
const notificationsRouter = require('./routes/notifications'); // NEW
const trashRouter = require('./routes/trash'); // NEW

app.use('/api/books', booksRouter);
app.use('/api/entries', entriesRouter);
app.use('/api/users', usersRouter);
app.use('/api/businesses', businessesRouter); // NEW
app.use('/api/notifications', notificationsRouter); // NEW
app.use('/api/trash', trashRouter); // NEW

// Start Server
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
