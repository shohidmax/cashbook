const express = require('express');
const router = express.Router();
const Book = require('../models/Book');
const Business = require('../models/Business');
const User = require('../models/User');
const ActivityLog = require('../models/ActivityLog');
const Trash = require('../models/Trash');
const verifyToken = require('../middleware/auth');

router.use(verifyToken);

// Helper to log activity
const logActivity = async (businessId, userId, action, details, bookId = null) => {
    try {
        await ActivityLog.create({
            business: businessId,
            book: bookId,
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

// Helper to check book-level permissions
const checkBookPermission = (business, book, userId, allowedRoles = []) => {
    // Business Owner and Business Admin always have full access to all books
    const ownerId = business.owner._id ? business.owner._id.toString() : business.owner.toString();
    if (ownerId === userId) return true;

    const bizMember = business.members.find(m => {
        const mUserId = m.user._id ? m.user._id.toString() : m.user.toString();
        return mUserId === userId;
    });

    if (bizMember && bizMember.role === 'admin') {
        return true;
    }

    // Checking Book-level members
    const bookMember = book.members.find(m => {
        const mUserId = m.user._id ? m.user._id.toString() : m.user.toString();
        return mUserId === userId;
    });

    if (!bookMember) return false;
    if (allowedRoles.length === 0) return true;
    return allowedRoles.includes(bookMember.role);
};

// Create a book inside a business
router.post('/', async (req, res) => {
    try {
        const { name, businessId } = req.body;

        const business = await Business.findById(businessId);
        if (!business) return res.status(404).json({ message: 'Business not found' });

        const user = await User.findOne({ firebaseUid: req.user.uid });
        const userId = user._id.toString();

        if (!checkBusinessPermission(business, userId, ['admin'])) {
            return res.status(403).json({ message: 'Not authorized to create books in this business' });
        }

        const book = new Book({
            name,
            business: businessId,
            createdBy: user._id
        });

        const newBook = await book.save();

        await logActivity(businessId, user._id, 'CREATED_BOOK', `Created book: ${name}`, newBook._id);

        res.status(201).json(newBook);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Get a single book and its entries (with search, filter, pagination)
router.get('/:id', async (req, res) => {
    try {
        const user = await User.findOne({ firebaseUid: req.user.uid });
        if (!user) return res.status(401).json({ message: 'User not found' });

        const book = await Book.findById(req.params.id)
            .populate('createdBy', 'name email')
            .populate('members.user', 'firebaseUid name email');

        if (!book) return res.status(404).json({ message: 'Book not found' });

        const business = await Business.findById(book.business)
            .populate('owner', 'firebaseUid name email')
            .populate('members.user', 'firebaseUid name email');

        if (!checkBookPermission(business, book, user._id.toString())) {
            return res.status(403).json({ message: 'Not authorized to view this book' });
        }

        // Pagination setup
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Build query for entries
        let query = { book: req.params.id };

        // Search by remark or category
        if (req.query.search) {
            query.$or = [
                { remark: { $regex: req.query.search, $options: 'i' } },
                { category: { $regex: req.query.search, $options: 'i' } }
            ];
        }

        // Filter by type (IN/OUT)
        if (req.query.type) {
            query.type = req.query.type;
        }

        // Filter by category
        if (req.query.category) {
            query.category = req.query.category;
        }

        // Filter by date range
        if (req.query.startDate || req.query.endDate) {
            query.date = {};
            if (req.query.startDate) {
                query.date.$gte = new Date(req.query.startDate);
            }
            if (req.query.endDate) {
                const end = new Date(req.query.endDate);
                end.setHours(23, 59, 59, 999);
                query.date.$lte = end;
            }
        }

        // ... previous stats logic
        const Entry = require('../models/Entry');
        // Get total count for pagination stats
        const totalElements = await Entry.countDocuments(query);
        const totalPages = Math.ceil(totalElements / limit);

        // Fetch entries with pagination
        const entries = await Entry.find(query)
            .sort({ date: -1, created_at: -1 })
            .skip(skip)
            .limit(limit)
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name');

        res.json({
            ...book.toObject(),
            entries,
            business: business.toObject(),
            pagination: {
                currentPage: page,
                totalPages,
                totalElements,
                limit
            }
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Get monthly report for a book
router.get('/:id/report', async (req, res) => {
    try {
        const user = await User.findOne({ firebaseUid: req.user.uid });
        if (!user) return res.status(401).json({ message: 'User not found' });

        const book = await Book.findById(req.params.id);
        if (!book) return res.status(404).json({ message: 'Book not found' });

        const business = await Business.findById(book.business);
        if (!checkBookPermission(business, book, user._id.toString())) {
            return res.status(403).json({ message: 'Not authorized to view this book' });
        }

        const year = parseInt(req.query.year) || new Date().getFullYear();
        const startDate = new Date(`${year}-01-01T00:00:00.000Z`);
        const endDate = new Date(`${year}-12-31T23:59:59.999Z`);

        const Entry = require('../models/Entry');

        const report = await Entry.aggregate([
            {
                $match: {
                    book: book._id,
                    date: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: { $month: "$date" },
                    totalIn: {
                        $sum: { $cond: [{ $eq: ["$type", "IN"] }, "$amount", 0] }
                    },
                    totalOut: {
                        $sum: { $cond: [{ $eq: ["$type", "OUT"] }, "$amount", 0] }
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $sort: { _id: 1 }
            }
        ]);

        res.json({ report });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Add Member to Book
router.post('/:id/members', async (req, res) => {
    const { email, role } = req.body;
    try {
        const book = await Book.findById(req.params.id);
        if (!book) return res.status(404).json({ message: 'Book not found' });

        const business = await Business.findById(book.business);
        if (!business) return res.status(404).json({ message: 'Business not found' });

        const requester = await User.findOne({ firebaseUid: req.user.uid });
        if (!requester) return res.status(401).json({ message: 'Requester not found' });
        const requesterId = requester._id.toString();

        // Only Business Admins/Owners or Book Admins can add members to a book
        const isBizAdminOrOwner = checkBusinessPermission(business, requesterId, ['admin']);
        const isBookAdmin = checkBookPermission(business, book, requesterId, ['admin']);

        if (!isBizAdminOrOwner && !isBookAdmin) {
            return res.status(403).json({ message: 'Not authorized to add members to this book' });
        }

        const userToAdd = await User.findOne({ email });
        if (!userToAdd) return res.status(404).json({ message: 'User not found with that email' });

        const userToAddIdStr = userToAdd._id.toString();

        // Prevent adding if they are already in the book
        if (book.members.some(m => {
            const mUserId = m.user._id ? m.user._id.toString() : m.user.toString();
            return mUserId === userToAddIdStr;
        })) {
            return res.status(400).json({ message: 'User is already a member of this book' });
        }

        book.members.push({ user: userToAdd._id, role });
        await book.save();

        await logActivity(business._id, requester._id, 'ADDED_BOOK_MEMBER', `Added ${email} to ${book.name} as ${role}`, book._id);

        const updatedBook = await Book.findById(req.params.id)
            .populate('createdBy', 'name email')
            .populate('members.user', 'name email photoURL firebaseUid');

        res.json(updatedBook);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Remove Member from Book
router.delete('/:id/members/:memberId', async (req, res) => {
    try {
        const book = await Book.findById(req.params.id);
        if (!book) return res.status(404).json({ message: 'Book not found' });

        const business = await Business.findById(book.business);
        if (!business) return res.status(404).json({ message: 'Business not found' });

        const requester = await User.findOne({ firebaseUid: req.user.uid });
        if (!requester) return res.status(401).json({ message: 'Requester not found' });
        const requesterId = requester._id.toString();

        const memberIdToRemove = req.params.memberId;

        const isBizAdminOrOwner = checkBusinessPermission(business, requesterId, ['admin']);
        const isBookAdmin = checkBookPermission(business, book, requesterId, ['admin']);
        const isSelf = requesterId === memberIdToRemove;

        if (!isBizAdminOrOwner && !isBookAdmin && !isSelf) {
            return res.status(403).json({ message: 'Not authorized to remove members from this book' });
        }

        const memberIndex = book.members.findIndex(m => {
            const mUserId = m.user._id ? m.user._id.toString() : m.user.toString();
            return mUserId === memberIdToRemove.toString();
        });

        console.log("Removing book member:", memberIdToRemove, "Index found:", memberIndex);

        if (memberIndex === -1) {
            return res.status(404).json({ message: 'Member not found in book' });
        }

        const subdocId = book.members[memberIndex]._id;
        book.members.pull({ _id: subdocId });
        book.markModified('members');

        await book.save();
        console.log("Book member removed and saved successfully!");
        await logActivity(business._id, requester._id, 'REMOVED_BOOK_MEMBER', `Removed member from ${book.name}`, book._id);

        res.json({ message: 'Member removed from book successfully' });
    } catch (err) {
        console.error("Error in delete book member:", err);
        res.status(500).json({ message: err.message });
    }
});

// Update a book
router.put('/:id', async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ message: 'Name is required' });

        const user = await User.findOne({ firebaseUid: req.user.uid });
        if (!user) return res.status(401).json({ message: 'User not found' });
        const userId = user._id.toString();

        const book = await Book.findById(req.params.id);
        if (!book) return res.status(404).json({ message: 'Book not found' });

        const business = await Business.findById(book.business);
        if (!business) return res.status(404).json({ message: 'Business not found' });

        const isBizAdminOrOwner = checkBusinessPermission(business, userId, ['admin']);
        const isBookAdmin = checkBookPermission(business, book, userId, ['admin']);

        if (!isBizAdminOrOwner && !isBookAdmin) {
            return res.status(403).json({ message: 'Not authorized to rename this book' });
        }

        const oldName = book.name;
        book.name = name;
        await book.save();

        await logActivity(business._id, user._id, 'RENAMED_BOOK', `Renamed book from "${oldName}" to "${name}"`, book._id);

        res.json(book);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Delete a book
router.delete('/:id', async (req, res) => {
    try {
        const user = await User.findOne({ firebaseUid: req.user.uid });
        const userId = user._id.toString();

        const book = await Book.findById(req.params.id);
        if (!book) return res.status(404).json({ message: 'Book not found' });

        const business = await Business.findById(book.business);

        const isBizAdminOrOwner = checkBusinessPermission(business, userId, ['admin']);
        const isBookAdmin = checkBookPermission(business, book, userId, ['admin']);

        if (!isBizAdminOrOwner && !isBookAdmin) {
            return res.status(403).json({ message: 'Not authorized to delete this book' });
        }

        const Entry = require('../models/Entry');
        const entriesToDelete = await Entry.find({ book: req.params.id });

        // Save entries to trash
        for (const entry of entriesToDelete) {
            await Trash.create({
                collectionType: 'Entry',
                originalId: entry._id,
                data: entry.toObject(),
                deletedBy: user._id
            });
        }

        // Save book to trash
        await Trash.create({
            collectionType: 'Book',
            originalId: book._id,
            data: book.toObject(),
            deletedBy: user._id
        });

        await Entry.deleteMany({ book: req.params.id });

        await logActivity(business._id, user._id, 'DELETED_BOOK', `Deleted book: ${book.name}`);
        await book.deleteOne();

        res.json({ message: 'Book and its entries moved to trash' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
