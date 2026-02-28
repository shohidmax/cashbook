const express = require('express');
const router = express.Router();
const Trash = require('../models/Trash');
const Book = require('../models/Book');
const Business = require('../models/Business');
const Entry = require('../models/Entry');
const ActivityLog = require('../models/ActivityLog');
const User = require('../models/User');
const verifyToken = require('../middleware/auth');

// Middleware to verify token for all trash routes
router.use(verifyToken);

// 1. Get all trash items for the logged-in user (Businesses and Books)
router.get('/', async (req, res) => {
    try {
        const user = await User.findOne({ firebaseUid: req.user.uid });
        if (!user) return res.status(404).json({ message: 'User not found' });

        // Retrieve specifically top-level deletable objects (Business, Book) deleted by this user.
        // We don't want to show individual entries directly in the trash UI list, as they are restored when their parent Book is restored.
        // However, if the future scope entails deleting individual entries and restoring them, we could easily extend this.
        const trashItems = await Trash.find({
            deletedBy: user._id,
            collectionType: { $in: ['Business', 'Book'] }
        }).sort({ deletedAt: -1 });

        res.json(trashItems);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// 2. Restore a trash item and all its children
router.post('/:id/restore', async (req, res) => {
    try {
        const user = await User.findOne({ firebaseUid: req.user.uid });
        if (!user) return res.status(404).json({ message: 'User not found' });

        const trashItem = await Trash.findById(req.params.id);
        if (!trashItem) return res.status(404).json({ message: 'Item not found in trash.' });

        if (trashItem.deletedBy.toString() !== user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized to restore this item.' });
        }

        // --- RESTORE LOGIC ---

        if (trashItem.collectionType === 'Business') {
            // Restore the business itself
            await Business.create(trashItem.data);

            // Find and restore all Books associated with this Business from the Trash
            const childBooks = await Trash.find({ collectionType: 'Book', 'data.business': trashItem.originalId });
            for (const b of childBooks) {
                await Book.create(b.data);
                await Trash.findByIdAndDelete(b._id); // Clear book from trash
            }

            // Find and restore all Entries belonging to the Books we just restored
            // Or directly search entries by their book id reference since we know they were linked
            const childBookIds = childBooks.map(b => b.originalId);
            const childEntries = await Trash.find({ collectionType: 'Entry', 'data.book': { $in: childBookIds } });
            for (const e of childEntries) {
                await Entry.create(e.data);
                await Trash.findByIdAndDelete(e._id); // Clear entry from trash
            }

            // Restore ActivityLogs
            const childLogs = await Trash.find({ collectionType: 'ActivityLog', 'data.business': trashItem.originalId });
            for (const log of childLogs) {
                await ActivityLog.create(log.data);
                await Trash.findByIdAndDelete(log._id); // Clear log from trash
            }
        }
        else if (trashItem.collectionType === 'Book') {
            // First, ensure the parent Business wasn't ALSO deleted. If the parent business is in the trash too, 
            // the user must restore the Business first to prevent orphaned records.
            const parentBusiness = await Business.findById(trashItem.data.business);
            if (!parentBusiness) {
                return res.status(400).json({ message: 'Cannot restore this book because its parent Business was deleted. Restore the Business first.' });
            }

            // Restore the book
            await Book.create(trashItem.data);

            // Restore all Entries associated with this Book
            const childEntries = await Trash.find({ collectionType: 'Entry', 'data.book': trashItem.originalId });
            for (const e of childEntries) {
                await Entry.create(e.data);
                await Trash.findByIdAndDelete(e._id);
            }
        } else {
            return res.status(400).json({ message: 'Restoring this entity type directly is not currently supported.' });
        }

        // Finally, delete the root trash item we just restored
        await Trash.findByIdAndDelete(trashItem._id);

        res.json({ message: `${trashItem.collectionType} and associated data restored successfully.` });

    } catch (err) {
        console.error("Error during restore:", err);
        res.status(500).json({ message: err.message });
    }
});

// 3. Permanently Delete an item and its children from Trash
router.delete('/:id', async (req, res) => {
    try {
        const user = await User.findOne({ firebaseUid: req.user.uid });
        if (!user) return res.status(404).json({ message: 'User not found' });

        const trashItem = await Trash.findById(req.params.id);
        if (!trashItem) return res.status(404).json({ message: 'Item not found in trash.' });

        if (trashItem.deletedBy.toString() !== user._id.toString()) {
            return res.status(403).json({ message: 'Not authorized to delete this item.' });
        }

        // --- PERMANENT DELETION LOGIC (Cascade) ---

        if (trashItem.collectionType === 'Business') {
            // Find child Books in trash
            const childBooks = await Trash.find({ collectionType: 'Book', 'data.business': trashItem.originalId });
            const childBookIds = childBooks.map(b => b.originalId);

            // Delete child Entries from trash
            await Trash.deleteMany({ collectionType: 'Entry', 'data.book': { $in: childBookIds } });
            // Delete child ActivityLogs from trash
            await Trash.deleteMany({ collectionType: 'ActivityLog', 'data.business': trashItem.originalId });
            // Delete child Books from trash
            await Trash.deleteMany({ _id: { $in: childBooks.map(b => b._id) } });

        } else if (trashItem.collectionType === 'Book') {
            // Delete child Entries from trash
            await Trash.deleteMany({ collectionType: 'Entry', 'data.book': trashItem.originalId });
        }

        // Delete the root item from trash
        await Trash.findByIdAndDelete(trashItem._id);

        res.json({ message: `Permanently deleted ${trashItem.collectionType} from trash.` });

    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
