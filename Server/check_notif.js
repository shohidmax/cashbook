require('dotenv').config();
const mongoose = require('mongoose');
const Notification = require('./models/Notification');

async function check() {
    await mongoose.connect(process.env.MONGODB_URI);
    const count = await Notification.countDocuments();
    console.log(`\n\n=== VERIFICATION ===`);
    console.log(`Total notifications in DB: ${count}`);
    const latest = await Notification.find().sort({ created_at: -1 }).limit(1).populate('user').populate('sender');
    if (latest.length > 0) {
        console.log(`Latest notification: User ${latest[0].user.email} received from ${latest[0].sender.email} - "${latest[0].message}"`);
        console.log(`Unread? ${!latest[0].isRead}`);
    }
    console.log(`====================\n\n`);
    mongoose.disconnect();
}
check();
