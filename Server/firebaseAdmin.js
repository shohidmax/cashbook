const admin = require('firebase-admin');
const dotenv = require('dotenv');

dotenv.config();

// Check if service account is provided via environment variable
// For development, we might not have a service account JSON yet.
// We can use a placeholder or check if FIREBASE_SERVICE_ACCOUNT_PATH is set.

let serviceAccount;
try {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_PATH) {
        serviceAccount = require(process.env.FIREBASE_SERVICE_ACCOUNT_PATH);
    } else if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    }
} catch (error) {
    console.warn("Firebase Admin: Could not load service account credentials.", error.message);
}

if (!admin.apps.length) {
    if (serviceAccount) {
        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });
    } else {
        // Fallback or warning - Application Default Credentials might work if deployed to GCP
        // For local dev without creds, auth verification might fail or we need a mock.
        console.warn("Firebase Admin initialized without explicit credentials. Auth verification might fail if not in GCP environment.");
        admin.initializeApp({ projectId: "cashbook-6453a" });
    }
}

module.exports = admin;
