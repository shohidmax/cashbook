const admin = require('../firebaseAdmin');

const verifyToken = async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Unauthorized: No token provided' });
    }

    const token = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        req.user = decodedToken; // { uid, email, exp, ... }
        next();
    } catch (error) {
        console.error("Auth Middleware Error:", error.message);
        return res.status(403).json({ message: 'Unauthorized: Invalid token' });
    }
};

module.exports = verifyToken;
