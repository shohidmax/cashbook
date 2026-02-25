const mongoose = require('mongoose');

const entrySchema = new mongoose.Schema({
    book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
    amount: { type: Number, required: true },
    type: { type: String, enum: ['IN', 'OUT'], required: true }, // IN = Income, OUT = Expense
    date: { type: Date, default: Date.now },
    remark: { type: String },
    category: { type: String, required: true },
    mode: { type: String, required: true, default: 'Cash' },
    receiptUrl: { type: String, default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    created_at: { type: Date, default: Date.now },
    updated_at: { type: Date, default: Date.now }
});

entrySchema.pre('save', function () {
    this.updated_at = Date.now();
});

module.exports = mongoose.model('Entry', entrySchema);
