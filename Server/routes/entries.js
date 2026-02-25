const express = require('express');
const router = express.Router();
const Entry = require('../models/Entry');
const Book = require('../models/Book');
const Business = require('../models/Business');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const Trash = require('../models/Trash');
const Notification = require('../models/Notification');
const verifyToken = require('../middleware/auth');
const crypto = require('crypto');

const multer = require('multer');
const path = require('path');

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, path.join(__dirname, '../public/uploads/'));
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + Math.round(Math.random() * 1E9) + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Upload a receipt image (Must be BEFORE verifyToken if we use a different token approach, or at least before /:id)
router.post('/upload', verifyToken, upload.single('receipt'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ message: 'No file uploaded' });
        }
        // Build the URL depending on how the server is hosted. For now, we'll return the relative path.
        // It's better to return a full URL if possible, but the client can prefix it if needed.
        const receiptUrl = `/uploads/${req.file.filename}`;
        res.json({ receiptUrl });
    } catch (err) {
        console.error("Error uploading receipt:", err);
        res.status(500).json({ message: 'Upload failed' });
    }
});

// Apply verifyToken middleware to all routes below this line
router.use(verifyToken);

// Helper to send notifications to business members
const notifyMembers = async (business, senderId, message, bookId = null) => {
    try {
        // ... (existing notifyMembers logic)
        const ownerId = business.owner._id ? business.owner._id.toString() : business.owner.toString();
        const memberIds = business.members.map(m => m.user._id ? m.user._id.toString() : m.user.toString());

        const allUsersToNotify = new Set([ownerId, ...memberIds]);
        allUsersToNotify.delete(senderId.toString()); // Don't notify the actor

        const notifications = [];
        for (const userId of allUsersToNotify) {
            notifications.push({
                user: userId,
                sender: senderId,
                business: business._id,
                book: bookId,
                message
            });
        }

        if (notifications.length > 0) {
            await Notification.insertMany(notifications);
        }
    } catch (e) {
        console.error("Failed to send notifications:", e);
    }
};

// Helper to log activity
const logActivity = async (businessId, userId, action, details, bookId = null, entryId = null) => {
    try {
        await ActivityLog.create({
            business: businessId,
            book: bookId,
            entry: entryId,
            user: userId,
            action,
            details
        });
    } catch (e) {
        console.error("Failed to log activity:", e);
    }
};

const checkBusinessPermission = (business, userId, allowedRoles = []) => {
    const ownerId = business.owner._id ? business.owner._id.toString() : business.owner.toString();
    if (ownerId === userId) return true;

    const member = business.members.find(m => {
        const mUserId = m.user._id ? m.user._id.toString() : m.user.toString();
        return mUserId === userId;
    });
    if (!member) return false;
    if (allowedRoles.length === 0) return true;
    return allowedRoles.includes(member.role);
};

// Create an entry
router.post('/', async (req, res) => {
    try {
        const bookId = req.body.book;
        const book = await Book.findById(bookId);
        if (!book) return res.status(404).json({ message: 'Book not found' });

        const business = await Business.findById(book.business);
        if (!business) return res.status(404).json({ message: 'Associated business not found' });

        const user = await User.findOne({ firebaseUid: req.user.uid });
        if (!user) return res.status(401).json({ message: 'User not found' });

        const requesterId = user._id.toString();

        if (!checkBusinessPermission(business, requesterId, ['admin', 'editor', 'member'])) {
            return res.status(403).json({ message: 'Not authorized to add entries' });
        }

        // Generate a 14-digit numeric transaction ID
        const generateTxId = () => {
            const min = 10000000000000n; // 14 digits min
            const max = 99999999999999n; // 14 digits max
            // Generate 8 random bytes, convert to integer, scale it modulo the range, and add min
            const randomBuffer = crypto.randomBytes(8);
            const randomInt = BigInt(`0x${randomBuffer.toString('hex')}`);
            const txidBigInt = (randomInt % (max - min + 1n)) + min;
            return txidBigInt.toString();
        };

        const entry = new Entry({
            book: req.body.book,
            txid: generateTxId(),
            amount: req.body.amount,
            type: req.body.type,
            category: req.body.category,
            remark: req.body.remark,
            mode: req.body.mode,
            date: req.body.date,
            receiptUrl: req.body.receiptUrl,
            createdBy: user._id
        });

        const newEntry = await entry.save();

        if (entry.type === 'IN') {
            book.balance += entry.amount;
        } else {
            book.balance -= entry.amount;
        }
        await book.save();

        await logActivity(
            business._id,
            user._id,
            'CREATED_ENTRY',
            `Added ${entry.type === 'IN' ? 'Income' : 'Expense'} of ${entry.amount} in ${book.name} (${entry.remark || 'No remark'})`,
            book._id,
            newEntry._id
        );

        await notifyMembers(business, user._id, `Added a new ${entry.type === 'IN' ? 'Income' : 'Expense'} of ৳${entry.amount} in ${book.name}`, book._id);

        res.status(201).json(newEntry);
    } catch (err) {
        console.error("Error saving entry:", err);
        res.status(400).json({ message: err.message });
    }
});

// Delete an entry
router.delete('/:id', async (req, res) => {
    try {
        const user = await User.findOne({ firebaseUid: req.user.uid });
        const requesterId = user._id.toString();

        const entry = await Entry.findById(req.params.id);
        if (!entry) return res.status(404).json({ message: 'Entry not found' });

        const book = await Book.findById(entry.book);
        let business = null;
        if (book) {
            business = await Business.findById(book.business);

            const isCreator = entry.createdBy && entry.createdBy.toString() === requesterId;
            const isAdmin = business && checkBusinessPermission(business, requesterId, ['admin']);

            if (!isCreator && !isAdmin) {
                return res.status(403).json({ message: 'Only the creator or an admin can delete this entry' });
            }

            // Update balance before deleting
            if (entry.type === 'IN') {
                book.balance -= entry.amount;
            } else {
                book.balance += entry.amount;
            }
            await book.save();
        }

        await logActivity(
            business._id,
            user._id,
            'DELETED_ENTRY',
            `Deleted ${entry.type === 'IN' ? 'Income' : 'Expense'} of ${entry.amount} from ${book.name}`,
            book._id,
            entry._id
        );

        await notifyMembers(business, user._id, `Deleted a ${entry.type === 'IN' ? 'Income' : 'Expense'} of ৳${entry.amount} in ${book.name}`, book._id);

        // Move to Trash
        await Trash.create({
            collectionType: 'Entry',
            originalId: entry._id,
            data: entry.toObject(),
            deletedBy: user._id
        });

        await entry.deleteOne();
        res.json({ message: 'Entry moved to trash' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Update an entry
router.put('/:id', async (req, res) => {
    try {
        const user = await User.findOne({ firebaseUid: req.user.uid });
        const requesterId = user._id.toString();

        const entry = await Entry.findById(req.params.id);
        if (!entry) return res.status(404).json({ message: 'Entry not found' });

        const book = await Book.findById(entry.book);
        let business = null;

        if (book) {
            business = await Business.findById(book.business);

            const isCreator = entry.createdBy && entry.createdBy.toString() === requesterId;
            const isAdmin = business && checkBusinessPermission(business, requesterId, ['admin']);

            if (!isCreator && !isAdmin) {
                return res.status(403).json({ message: 'Only the creator or an admin can update this entry' });
            }
        }

        // Revert old balance
        if (book) {
            if (entry.type === 'IN') {
                book.balance -= entry.amount;
            } else {
                book.balance += entry.amount;
            }
        }

        const oldAmount = entry.amount;

        // Update fields
        if (req.body.amount) entry.amount = req.body.amount;
        if (req.body.type) entry.type = req.body.type;
        if (req.body.category) entry.category = req.body.category;
        if (req.body.remark) entry.remark = req.body.remark;
        if (req.body.mode) entry.mode = req.body.mode;
        if (req.body.date) entry.date = req.body.date;
        entry.updatedBy = user._id;

        const updatedEntry = await entry.save();

        // Apply new balance
        if (book) {
            if (updatedEntry.type === 'IN') {
                book.balance += updatedEntry.amount;
            } else {
                book.balance -= updatedEntry.amount;
            }
            await book.save();
        }

        await logActivity(
            business._id,
            user._id,
            'UPDATED_ENTRY',
            `Updated entry from ${oldAmount} to ${updatedEntry.amount} in ${book.name}`,
            book._id,
            updatedEntry._id
        );

        if (business) {
            await notifyMembers(business, user._id, `Updated an entry to ৳${updatedEntry.amount} in ${book.name}`, book._id);
        }

        res.json(updatedEntry);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

module.exports = router;
