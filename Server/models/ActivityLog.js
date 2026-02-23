const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema({
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book' }, // Optional, if book-specific
    entry: { type: mongoose.Schema.Types.ObjectId, ref: 'Entry' }, // Optional
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true }, // e.g., 'CREATED_ENTRY', 'UPDATED_ENTRY', 'DELETED_ENTRY', 'ADDED_MEMBER'
    details: { type: String, required: true }, // e.g., 'Added entry of ৳500 for Rent'
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('ActivityLog', activityLogSchema);
