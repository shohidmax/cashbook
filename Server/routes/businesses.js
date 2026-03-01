const express = require('express');
const router = express.Router();
const Business = require('../models/Business');
const Book = require('../models/Book');
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

// Helper to check permissions
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

// Get all businesses for a user
router.get('/', async (req, res) => {
    try {
        const user = await User.findOne({ firebaseUid: req.user.uid });
        if (!user) return res.status(404).json({ message: "User not found" });

        const userId = user._id;

        const businesses = await Business.find({
            $or: [
                { owner: userId },
                { 'members.user': userId }
            ]
        }).populate('owner', 'name email photoURL firebaseUid');
        res.json(businesses);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Get a single business and its books
router.get('/:id', async (req, res) => {
    try {
        const user = await User.findOne({ firebaseUid: req.user.uid });
        if (!user) return res.status(401).json({ message: 'User not found in system' });
        const userId = user._id.toString();

        const business = await Business.findById(req.params.id)
            .populate('owner', 'name email photoURL firebaseUid')
            .populate('members.user', 'name email photoURL firebaseUid');

        if (!business) return res.status(404).json({ message: 'Business not found' });
        if (!checkBusinessPermission(business, userId)) {
            return res.status(403).json({ message: 'Not authorized to view this business' });
        }

        const allBooks = await Book.find({ business: req.params.id }).sort({ created_at: -1 });

        // Filter books based on permissions (Business Admin/Owner gets all, else check book members)
        const isBizAdminOrOwner = checkBusinessPermission(business, userId, ['admin']);
        let books = allBooks;

        if (!isBizAdminOrOwner) {
            books = allBooks.filter(book => {
                return book.members && book.members.some(m => {
                    const mUserId = m.user._id ? m.user._id.toString() : m.user.toString();
                    return mUserId === userId;
                });
            });
        }

        res.json({
            ...business.toObject(),
            books
        });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Create a business
router.post('/', async (req, res) => {
    try {
        const user = await User.findOne({ firebaseUid: req.user.uid });
        if (!user) return res.status(401).json({ message: 'User not found in system' });

        const { name, address, businessCategory, phone, description, image } = req.body;

        const business = new Business({
            name,
            address,
            businessCategory,
            phone,
            description,
            image,
            owner: user._id
        });

        const newBusiness = await business.save();

        // Auto-create a default 'Cash Book' when a business is created
        const defaultBook = new Book({
            name: 'Cash Book',
            business: newBusiness._id,
            createdBy: user._id
        });
        await defaultBook.save();

        await logActivity(newBusiness._id, user._id, 'CREATED_BUSINESS', `Created business: ${newBusiness.name}`);

        res.status(201).json(newBusiness);
    } catch (err) {
        res.status(400).json({ message: err.message });
    }
});

// Add Member to Business
router.post('/:id/members', async (req, res) => {
    const { email, role } = req.body;
    try {
        const business = await Business.findById(req.params.id);
        if (!business) return res.status(404).json({ message: 'Business not found' });

        const requester = await User.findOne({ firebaseUid: req.user.uid });
        if (!requester) return res.status(401).json({ message: 'Requester not found' });
        const requesterId = requester._id.toString();

        if (!checkBusinessPermission(business, requesterId, ['admin'])) {
            const ownerId = business.owner._id ? business.owner._id.toString() : business.owner.toString();
            if (ownerId !== requesterId) {
                return res.status(403).json({ message: 'Not authorized to add members' });
            }
        }

        const userToAdd = await User.findOne({ email });
        if (!userToAdd) return res.status(404).json({ message: 'User not found with that email' });

        const userToAddIdStr = userToAdd._id.toString();
        const ownerIdStr = business.owner._id ? business.owner._id.toString() : business.owner.toString();

        if (business.members.some(m => {
            const mUserId = m.user._id ? m.user._id.toString() : m.user.toString();
            return mUserId === userToAddIdStr;
        }) || ownerIdStr === userToAddIdStr) {
            return res.status(400).json({ message: 'User is already a member or owner' });
        }

        business.members.push({ user: userToAdd._id, role });
        await business.save();

        await logActivity(business._id, requester._id, 'ADDED_MEMBER', `Added ${email} as ${role}`);

        const updatedBusiness = await Business.findById(req.params.id)
            .populate('owner', 'name email photoURL firebaseUid')
            .populate('members.user', 'name email photoURL firebaseUid');
        res.json(updatedBusiness);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Remove Member or Leave Business
router.delete('/:id/members/:memberId', async (req, res) => {
    try {
        const business = await Business.findById(req.params.id);
        if (!business) return res.status(404).json({ message: 'Business not found' });

        const requester = await User.findOne({ firebaseUid: req.user.uid });
        if (!requester) return res.status(401).json({ message: 'Requester not found' });
        const requesterId = requester._id.toString();

        const memberIdToRemove = req.params.memberId;

        // Check if requester is Owner or Admin
        const isOwner = (business.owner._id ? business.owner._id.toString() : business.owner.toString()) === requesterId;
        const isAdmin = checkBusinessPermission(business, requesterId, ['admin']);

        // Members can remove themselves (leave)
        const isSelf = requesterId === memberIdToRemove;

        if (!isOwner && !isAdmin && !isSelf) {
            return res.status(403).json({ message: 'Not authorized to remove members' });
        }

        // Prevent removing the owner
        const ownerIdStr = business.owner._id ? business.owner._id.toString() : business.owner.toString();
        if (ownerIdStr === memberIdToRemove) {
            return res.status(400).json({ message: 'Cannot remove the owner. The owner must transfer ownership or delete the business.' });
        }

        const memberIndex = business.members.findIndex(m => {
            const mUserId = m.user._id ? m.user._id.toString() : m.user.toString();
            return mUserId === memberIdToRemove.toString();
        });

        console.log("Removing member:", memberIdToRemove, "Index found:", memberIndex);

        if (memberIndex === -1) {
            return res.status(404).json({ message: 'Member not found in business' });
        }

        const subdocId = business.members[memberIndex]._id;
        business.members.pull({ _id: subdocId });
        business.markModified('members');

        await business.save();
        console.log("Member removed and saved successfully!");
        await logActivity(business._id, requester._id, 'REMOVED_MEMBER', `Removed member with ID ${memberIdToRemove}`);

        res.json({ message: 'Member removed successfully' });
    } catch (err) {
        console.error("Error in delete member:", err);
        res.status(500).json({ message: err.message });
    }
});

// Update Member Role
router.put('/:id/members/:memberId', async (req, res) => {
    try {
        const { role } = req.body;
        if (!role) return res.status(400).json({ message: 'Role is required' });

        const business = await Business.findById(req.params.id);
        if (!business) return res.status(404).json({ message: 'Business not found' });

        const requester = await User.findOne({ firebaseUid: req.user.uid });
        if (!requester) return res.status(401).json({ message: 'Requester not found' });
        const requesterId = requester._id.toString();

        const memberIdToUpdate = req.params.memberId;

        // Check if requester is Owner or Admin
        const isOwner = (business.owner._id ? business.owner._id.toString() : business.owner.toString()) === requesterId;
        const isAdmin = checkBusinessPermission(business, requesterId, ['admin']);

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ message: 'Not authorized to update member roles' });
        }

        // Prevent changing owner's role
        const ownerIdStr = business.owner._id ? business.owner._id.toString() : business.owner.toString();
        if (ownerIdStr === memberIdToUpdate) {
            return res.status(400).json({ message: 'Cannot update the owner\'s role.' });
        }

        // Find the member to update
        const memberIndex = business.members.findIndex(m => {
            const mUserId = m.user._id ? m.user._id.toString() : m.user.toString();
            return mUserId === memberIdToUpdate;
        });

        if (memberIndex === -1) {
            return res.status(404).json({ message: 'Member not found in business' });
        }

        const oldRole = business.members[memberIndex].role;
        business.members[memberIndex].role = role;

        await business.save();
        await logActivity(business._id, requester._id, 'UPDATED_MEMBER_ROLE', `Updated member role from ${oldRole} to ${role}`);

        res.json({ message: 'Member role updated successfully', members: business.members });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Member voluntarily leaves the business
router.delete('/:id/leave', async (req, res) => {
    try {
        const requester = await User.findOne({ firebaseUid: req.user.uid });
        if (!requester) return res.status(401).json({ message: 'Requester not found' });
        const requesterId = requester._id.toString();

        const business = await Business.findById(req.params.id);
        if (!business) return res.status(404).json({ message: 'Business not found' });

        const ownerId = business.owner._id ? business.owner._id.toString() : business.owner.toString();
        if (ownerId === requesterId) {
            return res.status(400).json({ message: 'Owner cannot leave the business. You must delete it instead.' });
        }

        const isMember = business.members.some(m => {
            const mUserId = m.user._id ? m.user._id.toString() : m.user.toString();
            return mUserId === requesterId;
        });

        if (!isMember) {
            return res.status(400).json({ message: 'You are not a member of this business.' });
        }

        // Remove the member
        business.members = business.members.filter(m => {
            const mUserId = m.user._id ? m.user._id.toString() : m.user.toString();
            return mUserId !== requesterId;
        });

        await business.save();
        await logActivity(business._id, requester._id, 'LEFT_BUSINESS', `${requester.name || requester.email} left the business.`);

        res.json({ message: 'Successfully left the business.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Transfer Business Ownership
router.post('/:id/transfer-ownership', async (req, res) => {
    try {
        const { newOwnerEmail } = req.body;
        if (!newOwnerEmail) {
            return res.status(400).json({ message: 'New owner email is required' });
        }

        const requester = await User.findOne({ firebaseUid: req.user.uid });
        if (!requester) return res.status(401).json({ message: 'Requester not found' });
        const requesterId = requester._id.toString();

        const business = await Business.findById(req.params.id);
        if (!business) return res.status(404).json({ message: 'Business not found' });

        // Only the actual Owner can transfer ownership
        const ownerId = business.owner._id ? business.owner._id.toString() : business.owner.toString();
        if (ownerId !== requesterId) {
            return res.status(403).json({ message: 'Only the current owner can transfer ownership' });
        }

        const newOwner = await User.findOne({ email: newOwnerEmail });
        if (!newOwner) {
            return res.status(404).json({ message: 'User not found with that email' });
        }

        const newOwnerIdStr = newOwner._id.toString();
        if (newOwnerIdStr === requesterId) {
            return res.status(400).json({ message: 'You are already the owner of this business' });
        }

        // If new owner is already a member, remove them from the members array
        business.members = business.members.filter(m => {
            const mUserId = m.user._id ? m.user._id.toString() : m.user.toString();
            return mUserId !== newOwnerIdStr;
        });

        // Add old owner to members array as an admin
        business.members.push({ user: requester._id, role: 'admin' });

        // Transfer ownership
        business.owner = newOwner._id;

        await business.save();
        await logActivity(business._id, requester._id, 'TRANSFERRED_OWNERSHIP', `Transferred ownership to ${newOwner.email}`);

        res.json({ message: 'Ownership transferred successfully' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Update a business
router.put('/:id', async (req, res) => {
    try {
        const { name, address, businessCategory, phone, description, image } = req.body;
        if (!name) return res.status(400).json({ message: 'Name is required' });

        const requester = await User.findOne({ firebaseUid: req.user.uid });
        if (!requester) return res.status(401).json({ message: 'Requester not found' });
        const requesterId = requester._id.toString();

        const business = await Business.findById(req.params.id);
        if (!business) return res.status(404).json({ message: 'Business not found' });

        if (!checkBusinessPermission(business, requesterId, ['admin'])) {
            return res.status(403).json({ message: 'Not authorized to update this business' });
        }

        const oldName = business.name;

        business.name = name;
        if (address !== undefined) business.address = address;
        if (businessCategory !== undefined) business.businessCategory = businessCategory;
        if (phone !== undefined) business.phone = phone;
        if (description !== undefined) business.description = description;
        if (image !== undefined) business.image = image;

        await business.save();

        await logActivity(business._id, requester._id, 'UPDATED_BUSINESS', `Updated business details for "${name}"`);

        res.json(business);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Delete a business globally
router.delete('/:id', async (req, res) => {
    try {
        const requester = await User.findOne({ firebaseUid: req.user.uid });
        const requesterId = requester._id.toString();

        const business = await Business.findById(req.params.id);
        if (!business) return res.status(404).json({ message: 'Business not found' });

        const ownerId = business.owner._id ? business.owner._id.toString() : business.owner.toString();
        if (ownerId !== requesterId) {
            return res.status(403).json({ message: 'Only the top-level owner can delete the business' });
        }

        // 1. Find all associated data
        const books = await Book.find({ business: business._id });
        const bookIds = books.map(b => b._id);
        const Entry = require('../models/Entry');
        const entries = await Entry.find({ book: { $in: bookIds } });
        const activityLogs = await ActivityLog.find({ business: business._id });

        // 2. Backup to Trash
        const trashBackups = [];

        for (const entry of entries) {
            trashBackups.push({ collectionType: 'Entry', originalId: entry._id, data: entry.toObject(), deletedBy: requester._id });
        }
        for (const book of books) {
            trashBackups.push({ collectionType: 'Book', originalId: book._id, data: book.toObject(), deletedBy: requester._id });
        }
        for (const log of activityLogs) {
            trashBackups.push({ collectionType: 'ActivityLog', originalId: log._id, data: log.toObject(), deletedBy: requester._id });
        }
        trashBackups.push({ collectionType: 'Business', originalId: business._id, data: business.toObject(), deletedBy: requester._id });

        if (trashBackups.length > 0) {
            await Trash.insertMany(trashBackups);
        }

        // 3. Delete from actual collections
        await Entry.deleteMany({ book: { $in: bookIds } });
        await Book.deleteMany({ business: business._id });
        await ActivityLog.deleteMany({ business: business._id });
        await business.deleteOne();

        res.json({ message: 'Business and all associated data moved to trash.' });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Get Activity Log for a Business
router.get('/:id/activity', async (req, res) => {
    try {
        const user = await User.findOne({ firebaseUid: req.user.uid });
        const userId = user._id.toString();

        const business = await Business.findById(req.params.id);
        if (!business) return res.status(404).json({ message: 'Business not found' });

        if (!checkBusinessPermission(business, userId)) {
            return res.status(403).json({ message: 'Not authorized to view activity' });
        }

        const logs = await ActivityLog.find({ business: business._id })
            .populate('user', 'name email')
            .populate('book', 'name')
            .sort({ created_at: -1 })
            .limit(100);

        res.json(logs);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Add a category to a business
router.post('/:id/categories', async (req, res) => {
    const { name, type } = req.body;
    if (!name) return res.status(400).json({ message: 'Category name is required' });

    try {
        const business = await Business.findById(req.params.id);
        if (!business) return res.status(404).json({ message: 'Business not found' });

        const requester = await User.findOne({ firebaseUid: req.user.uid });
        if (!requester) return res.status(401).json({ message: 'Requester not found' });

        if (!checkBusinessPermission(business, requester._id.toString(), ['admin', 'editor', 'member'])) {
            return res.status(403).json({ message: 'Not authorized to add categories' });
        }

        // Check if category already exists
        const exists = business.categories.find(c => c.name.toLowerCase() === name.toLowerCase());
        if (exists) return res.status(400).json({ message: 'Category already exists' });

        business.categories.push({ name, type: type || 'BOTH' });
        await business.save();

        await logActivity(business._id, requester._id, 'ADDED_CATEGORY', `Added category: ${name}`);

        res.json(business.categories);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Delete a category from a business
router.delete('/:id/categories/:categoryId', async (req, res) => {
    try {
        const business = await Business.findById(req.params.id);
        if (!business) return res.status(404).json({ message: 'Business not found' });

        const requester = await User.findOne({ firebaseUid: req.user.uid });
        if (!requester) return res.status(401).json({ message: 'Requester not found' });

        if (!checkBusinessPermission(business, requester._id.toString(), ['admin', 'editor'])) {
            return res.status(403).json({ message: 'Not authorized to delete categories' });
        }

        const category = business.categories.id(req.params.categoryId);
        if (!category) return res.status(404).json({ message: 'Category not found' });

        const catName = category.name;
        business.categories.pull({ _id: req.params.categoryId });
        await business.save();

        await logActivity(business._id, requester._id, 'DELETED_CATEGORY', `Deleted category: ${catName}`);

        res.json({ message: 'Category deleted', categories: business.categories });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Add a payment mode to a business
router.post('/:id/payment-modes', async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ message: 'Payment mode name is required' });

    try {
        const business = await Business.findById(req.params.id);
        if (!business) return res.status(404).json({ message: 'Business not found' });

        const requester = await User.findOne({ firebaseUid: req.user.uid });
        if (!requester) return res.status(401).json({ message: 'Requester not found' });

        if (!checkBusinessPermission(business, requester._id.toString(), ['admin', 'editor'])) {
            return res.status(403).json({ message: 'Not authorized to add payment modes' });
        }

        if (business.paymentModes && business.paymentModes.includes(name)) {
            return res.status(400).json({ message: 'Payment mode already exists' });
        }

        business.paymentModes.push(name);
        await business.save();

        res.json(business.paymentModes);
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

// Delete a payment mode from a business
router.delete('/:id/payment-modes/:mode', async (req, res) => {
    try {
        const business = await Business.findById(req.params.id);
        if (!business) return res.status(404).json({ message: 'Business not found' });

        const requester = await User.findOne({ firebaseUid: req.user.uid });
        if (!requester) return res.status(401).json({ message: 'Requester not found' });

        if (!checkBusinessPermission(business, requester._id.toString(), ['admin', 'editor'])) {
            return res.status(403).json({ message: 'Not authorized to delete payment modes' });
        }

        const modeToDelete = decodeURIComponent(req.params.mode);

        const index = business.paymentModes.findIndex(m => m === modeToDelete);
        if (index === -1) {
            return res.status(404).json({ message: 'Payment mode not found' });
        }

        business.paymentModes.splice(index, 1);
        await business.save();

        await logActivity(business._id, requester._id, 'DELETED_PAYMENT_MODE', `Deleted payment mode: ${modeToDelete}`);

        res.json({ message: 'Payment mode deleted', paymentModes: business.paymentModes });
    } catch (err) {
        res.status(500).json({ message: err.message });
    }
});

module.exports = router;
