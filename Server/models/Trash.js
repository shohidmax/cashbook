const mongoose = require('mongoose');

const trashSchema = new mongoose.Schema({
    collectionType: {
        type: String,
        required: true,
        enum: ['Business', 'Book', 'Entry', 'ActivityLog']
    },
    originalId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true
    },
    data: {
        type: mongoose.Schema.Types.Mixed,
        required: true
    },
    deletedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    deletedAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Trash', trashSchema);
