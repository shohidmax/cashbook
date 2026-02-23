const express = require('express');
const router = express.Router();
const Notification = require('../models/Notification');
const verifyToken = require('../middleware/auth');
const User = require('../models/User');

// Middleware to get mongo user from firebase token
const getMongoUser = async (req, res, next) => {
    try {
        const user = await User.findOne({ firebaseUid: req.user.uid });
        if (!user) return res.status(404).json({ message: "User not found" });
        req.mongoUser = user;
        next();
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
};

// GET /api/notifications - Get current user's notifications
router.get('/', verifyToken, getMongoUser, async (req, res) => {
    try {
        const notifications = await Notification.find({ user: req.mongoUser._id })
            .populate('sender', 'name email photoURL') // Populate sender info
            .populate('business', 'name')
            .sort({ created_at: -1 })
            .limit(50); // Get top 50

        res.json(notifications);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// PUT /api/notifications/:id/read - Mark single as read
router.put('/:id/read', verifyToken, getMongoUser, async (req, res) => {
    try {
        const notification = await Notification.findOne({ _id: req.params.id, user: req.mongoUser._id });
        if (!notification) return res.status(404).json({ message: "Notification not found" });

        notification.isRead = true;
        await notification.save();
        res.json(notification);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// PUT /api/notifications/read-all - Mark all as read
router.put('/read-all', verifyToken, getMongoUser, async (req, res) => {
    try {
        await Notification.updateMany({ user: req.mongoUser._id, isRead: false }, { isRead: true });
        res.json({ message: "All notifications marked as read." });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
