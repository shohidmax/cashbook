const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // The recipient
    sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // The user who triggered the notification
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business' }, // Optional context
    book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book' }, // Optional context
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notification', notificationSchema);
