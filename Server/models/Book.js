const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema({
    name: { type: String, required: true },
    business: { type: mongoose.Schema.Types.ObjectId, ref: 'Business', required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    members: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        role: {
            type: String,
            enum: ['admin', 'editor', 'member'],
            default: 'member'
        }
    }],
    balance: { type: Number, default: 0 },
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Book', bookSchema);
