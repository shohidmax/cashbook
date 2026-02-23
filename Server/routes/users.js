const express = require('express');
const router = express.Router();
const User = require('../models/User');

const verifyToken = require('../middleware/auth');
const Book = require('../models/Book');
const Entry = require('../models/Entry');

// Apply auth middleware to all routes except simple mobile login if needed (or protect all)
router.use(verifyToken);

// Sync user from Firebase to MongoDB
router.post('/sync', async (req, res) => {
    const { firebaseUid, email, name, photoURL } = req.body;

    // Ensure the token matches the uid being synced
    if (req.user.uid !== firebaseUid) {
        return res.status(403).json({ message: "Unauthorized sync attempt" });
    }

    try {
        let user = await User.findOne({ firebaseUid });

        if (!user) {
            // Create new user
            user = new User({
                firebaseUid,
                email,
                name,
                photoURL
            });
            await user.save();
        } else {
            // Update existing user info
            user.name = name;
            user.photoURL = photoURL;
            await user.save();
        }

        res.json(user);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Mobile Login (Simple Email Lookup for MVP) - If protected, client needs to send token
// If strict auth is on, this might need adjustment or be replaced by token verification
router.post('/login-mobile', async (req, res) => {
    const { email } = req.body;
    // This route is a bit odd with strict auth if coming from a context without token yet.
    // For now assuming mobile also sends token if we wrap in verifyToken.
    // If not, we should exclude it from middleware.

    try {
        const user = await User.findOne({ email });
        if (!user) return res.status(404).json({ message: 'User not found' });
        res.json(user);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Update User Profile
router.put('/profile', async (req, res) => {
    const { name, phoneNumber, address, socialLink, photoURL } = req.body;

    try {
        const user = await User.findOne({ firebaseUid: req.user.uid });
        if (!user) return res.status(404).json({ message: "User not found" });

        if (name) user.name = name;
        if (phoneNumber !== undefined) user.phoneNumber = phoneNumber;
        if (address !== undefined) user.address = address;
        if (socialLink !== undefined) user.socialLink = socialLink;
        if (photoURL !== undefined) user.photoURL = photoURL;

        await user.save();
        res.json(user);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});


// Delete Account
router.delete('/me', async (req, res) => {
    try {
        const user = await User.findOne({ firebaseUid: req.user.uid });
        if (!user) return res.status(404).json({ message: "User not found" });

        const Business = require('../models/Business');
        const ActivityLog = require('../models/ActivityLog');

        // 1. Delete all businesses owned by user (cascade)
        const businesses = await Business.find({ owner: user._id });
        const businessIds = businesses.map(b => b._id);

        const books = await Book.find({ business: { $in: businessIds } });
        const bookIds = books.map(b => b._id);

        await Entry.deleteMany({ book: { $in: bookIds } });
        await Book.deleteMany({ business: { $in: businessIds } });
        await ActivityLog.deleteMany({ business: { $in: businessIds } });
        await Business.deleteMany({ owner: user._id });

        // 2. Remove user from other businesses they are a member of
        await Business.updateMany(
            { 'members.user': user._id },
            { $pull: { members: { user: user._id } } }
        );

        // 3. Delete user record
        await user.deleteOne();

        res.json({ message: 'Account and all data deleted successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
