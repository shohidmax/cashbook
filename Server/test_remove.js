const axios = require('axios');
(async () => {
    try {
        const email = 's@gmail.com';
        const password = 'password123';
        const FIREBASE_API_KEY = 'AIzaSyDxcyqLwrp6otOC0e2M6Vyh8XWAcdLFBbU';

        console.log('Logging in to Firebase...');
        const res = await axios.post(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${FIREBASE_API_KEY}`, {
            email, password, returnSecureToken: true
        });
        const token = res.data.idToken;

        console.log('Fetching businesses...');
        const bizRes = await axios.get('http://localhost:5000/api/businesses', {
            headers: { Authorization: `Bearer ${token}` }
        });
        const businesses = bizRes.data;
        if (businesses.length === 0) { console.log('No businesses found for this user.'); return; }

        const b = businesses[0];
        console.log(`Found Business: ${b.name}`);

        if (!b.members || b.members.length === 0) {
            console.log('No members found in this business to remove. Attempting to add a test member first...');

            try {
                const addRes = await axios.post(`http://localhost:5000/api/businesses/${b._id}/members`, {
                    email: 'testmember@gmail.com',
                    role: 'member'
                }, { headers: { Authorization: `Bearer ${token}` } });
                console.log('Added Test Member:', addRes.data.members[addRes.data.members.length - 1]);
                b.members = addRes.data.members;
            } catch (addErr) {
                if (addErr.response) console.error('Failed adding test member:', addErr.response.data);
                else console.error('Failed adding test member:', addErr.message);
                return;
            }
        }

        const memberToRemove = b.members[0].user._id ? b.members[0].user._id : b.members[0].user;
        console.log(`Attempting to remove member ID: ${memberToRemove}`);

        const rmRes = await axios.delete(`http://localhost:5000/api/businesses/${b._id}/members/${memberToRemove}`, {
            headers: { Authorization: `Bearer ${token}` }
        });

        console.log('Success! API Response:', rmRes.data);

    } catch (e) {
        if (e.response) console.error('Error Response:', e.response.status, e.response.data);
        else console.error('Error:', e.message);
    }
})();
