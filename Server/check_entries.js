require('dotenv').config();
const mongoose = require('mongoose');
const Entry = require('./models/Entry');

async function check() {
    await mongoose.connect(process.env.MONGODB_URI);
    const count = await Entry.countDocuments();
    console.log(`\n\n=== VERIFICATION ===`);
    console.log(`Total entries in DB: ${count}`);
    const latest = await Entry.find().sort({ date: -1, _id: -1 }).limit(1).populate('createdBy');
    if (latest.length > 0) {
        console.log(`Latest entry: ${latest[0].amount} on ${latest[0].date} by ${latest[0].createdBy.email}. Remark: ${latest[0].remark}`);
    }
    console.log(`====================\n\n`);
    mongoose.disconnect();
}
check();
