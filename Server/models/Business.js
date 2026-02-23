const mongoose = require('mongoose');

const businessSchema = new mongoose.Schema({
    name: { type: String, required: true },
    owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: [{
        user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
        role: {
            type: String,
            enum: ['admin', 'editor', 'member'],
            default: 'member'
        }
    }],
    address: { type: String, default: '' },
    businessCategory: { type: String, default: '' },
    phone: { type: String, default: '' },
    description: { type: String, default: '' },
    image: { type: String, default: '' },
    categories: [{
        name: { type: String, required: true },
        type: { type: String, enum: ['IN', 'OUT', 'BOTH'], default: 'BOTH' }
    }],
    paymentModes: [{ type: String }],
    created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Business', businessSchema);
