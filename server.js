require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const psn = require('psn-api');


//import blueprints
const Game = require('./models/Game');
const Achievement = require('./models/Achievement');

const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors()); // lets web browser fetch data
app.use(express.json()); // tells server to use JSON

app.use(express.static(path.join(__dirname, 'frontend')));

//connect to MongoDB
mongoose.connect(process.env.MONGO_URI)
.then (() => console.log('connected to MongoDB Atlas'))
.catch (err => console.error('database error:', err));

//backend bouncer(JWT Middleware)
function verifyToken(req, res, next){
    //look for the token in the request headers
    const authHeader = req.header('Authorization');
    if(!authHeader) return res.status(401).json({ message: 'Access Denied. No token provided' });

    try{
        //strip away "bearer " text
        const token = authHeader.replace('Bearer ', '');

        //decrypt the token using secret key
        const verified = jwt.verify(token, process.env.JWT_SECRET);

        //attach the decrypted user info to the request object
        req.user = verified;

        //let the user pass through the actual route
        next();

    } catch (err) {
        res.status(400).json({ message: 'Invalid token.' });
    }
}

//API EndPoints
//game library endpoint
//pinging this URL returns all games, sorted by last time played
app.get('/api/games', verifyToken, async (req, res) =>{
    try{
        const games = await Game.find({ userId: req.user.userId }).sort({ lastPlayed: -1 });
        res.json(games);
    } catch (error){
        res.status(500).json({ error: 'failed to fetch games' });
    }
});

//unified achievement feed endpoint
//pinging the URL retruns 50 most recent unlocked achievements
app.get('/api/feed',verifyToken, async (req, res) => {
    try{
        const feed = await Achievement.find({ isUnlocked: true, userId: req.user.userId })
        .sort({ unlockDate: -1 })
        .limit(50)

        res.json(feed);
    } catch (error){
        res.status(500).json({ error: 'failed to fetch feed'});
    }
});

app.get('/api/games/:id', verifyToken, async (req, res) => {
    try{
        const game = await Game.findOne({ _id: req.params.id, userId: req.user.userId });
        res.json(game);

        if (!game) {
            return res.status(404).json({ error: 'Game not found or access denied.' });
        }

    res.json(game);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch game details'});
    }
});

app.get('/api/games/:id/achievements', verifyToken, async (req, res) => {
    try{
        const achievements = await Achievement.find({ gameId: req.params.id, userId: req.user.userId })
        .sort({ isUnlocked: -1, unlockDate: -1 });

        res.json(achievements);
    } catch (error){
        res.status(500).json({ error: 'failed to fetch achievements'});
    }
})

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./models/User');

//registration endpoint
app.post('/api/auth/register', async (req, res) => {
    try{

    const { username, password, psnId } = req.body;

    //check if the username has been taken
    let existingUser = await User.findOne({ username });
    if(existingUser){
        return res.status(400).json({ message: 'Username is already taken'});
    }


    //hash the password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = new User({
        username: username,
        password: hashedPassword,
        psnId: psnId
    });

    await newUser.save();
    res.status(201).json({ message: 'User registered successfully'})
} catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ message: 'Server error during registration.' });
}
});

app.post('/api/auth/login', async (req, res) => {
    try{
        const { username, password } = req.body;

        //find user in the database
        const user = await User.findOne({ username });
        if(!user) { 
            return res.status(400).json({ message: 'Invalid username or password.' });
        }

        //compare the typed password against saved encrypted password
        const isMatch = await bcrypt.compare(password, user.password);
        if(!isMatch) {
            return res.status(400).json({ message: 'Invalid username or password'});
        }

        //generate the JWT 
        const token = jwt.sign(
            { userId: user._id, psnId: user.psnId },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        //send the token back to the frontend
        res.json({
            message: 'Login successful',
            token: token,
            username: user.username
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ message: 'Server error during login.' });
    }
});

async function syncPlayStationData(targetUserId, targetPsnId){
    try{
        console.log(`Authenticating with PlayStation Network for ${targetPsnId}...`);

        //authinticate using your server's master NPPSO token
        const accessCode = await psn.exchangeNpssoForAccessCode(process.env.NPSSO_TOKEN);
        const authorization = await psn.exchangeAccessCodeForAuthTokens(accessCode);

    
        // --- 🚨 NEW METHOD: Get profile directly without using public search ---
        console.log(`Looking up Account ID for ${targetPsnId}...`);
        
        // This bypasses the search engine and pulls the ID straight from the profile
        const profileResponse = await psn.getProfileFromUserName(authorization, targetPsnId);
        
        // Depending on the exact version of psn-api, it might be nested, so we check both
        const targetAccountId = profileResponse.profile ? profileResponse.profile.accountId : profileResponse.accountId;

        if (!targetAccountId) {
            throw new Error(`Could not retrieve Account ID for PSN ID: ${targetPsnId}`);
        }

        console.log(`Successfully found Account ID: ${targetAccountId}`);
        // ----------------------------------------------------------------------
        
        console.log(`Fetching full PlayStation library for account: ${targetAccountId}`);

        const trophyTitlesResponse = await psn.getUserTitles(authorization, targetAccountId);
        const allGames = trophyTitlesResponse.trophyTitles;

        if(!allGames || allGames.length === 0) throw new Error('No Playstation games found for this user');
        console.log(`Found ${allGames.length} games! Starting batch sync...`);

        for(const targetGameRaw of allGames) {
            try{
            const totalTrophies = targetGameRaw.definedTrophies.bronze + targetGameRaw.definedTrophies.silver + targetGameRaw.definedTrophies.gold + targetGameRaw.definedTrophies.platinum;
            const unlockedTrophies = targetGameRaw.earnedTrophies.bronze + targetGameRaw.earnedTrophies.silver + targetGameRaw.earnedTrophies.gold + targetGameRaw.earnedTrophies.platinum;

            const updateData = {
                userId: targetUserId, 
                    title: targetGameRaw.trophyTitleName,
                    platform: targetGameRaw.trophyTitlePlatform || 'PlayStation',
                    ecosystem: 'PlayStation',
                    boxArtUrl: targetGameRaw.trophyTitleIconUrl || '',
                    progress: {
                        unlockedCount: unlockedTrophies,
                        totalCount: totalTrophies,
                        completionPercentage: targetGameRaw.progress
                    },
                    lastPlayed: targetGameRaw.lastUpdatedDateTime
                };

                //added userid to the find query so games don't overlap between users
                const gameDoc = await Game.findOneAndUpdate(
                    { externalGameId: targetGameRaw.npCommunicationId, userId: targetUserId },
                    updateData,
                    { returnDocument: 'after', upsert: true }
                );

                //fetch user-specific trophies using their numeric account id
                const userTrophiesResponse = await psn.getUserTrophiesEarnedForTitle(
                    authorization, targetAccountId, targetGameRaw.npCommunicationId, "all", { npServiceName: targetGameRaw.npServiceName }
                );

                const titleTrophiesResponse = await psn.getTitleTrophies(
                    authorization, targetGameRaw.npCommunicationId, "all", { npServiceName: targetGameRaw.npServiceName }
                );

                //delete old achievements only for the specific user
                await Achievement.deleteMany({ gameId: gameDoc._id, userId: targetUserId });

                const achievementsToSave = userTrophiesResponse.trophies.map(userTrophy => {
                    const titleTrophy = titleTrophiesResponse.trophies.find(t => t.trophyId === userTrophy.trophyId);
                    if(!titleTrophy) return null;

                    return {
                        userId: targetUserId, // 🚨 Tag the achievement with the user
                        gameId: gameDoc._id,
                        gameTitle: gameDoc.title,
                        achievementName: titleTrophy.trophyName || 'Hidden Trophy',
                        description: titleTrophy.trophyDetail || 'Keep playing to reveal this trophy.',
                        iconUrl: titleTrophy.trophyIconUrl || '',
                        isUnlocked: userTrophy.earned,
                        unlockDate: userTrophy.earned && userTrophy.earnedDateTime ? new Date(userTrophy.earnedDateTime) : null,
                        weight: {
                            type: 'Trophy',
                            value: titleTrophy.trophyType.charAt(0).toUpperCase() + titleTrophy.trophyType.slice(1),
                            isRare: titleTrophy.trophyEarnedRate ? Number(titleTrophy.trophyEarnedRate) < 10.0 : false
                        }
                    };
                }).filter(ach => ach !== null);

                await Achievement.insertMany(achievementsToSave);
                console.log(`Synced trophies for ${gameDoc.title}`);

                await new Promise(resolve => setTimeout(resolve, 800));
                

            }  catch (gameError){
                console.error(`Skipping ${targetGameRaw.trophyTitleName} due to error:`, gameError.message);
            }
        }
    } catch (error){
        console.error('A critical error occurred during the PSN sync:', error.message);
        throw error;
    }
}


//secure psn sync route
app.post('/api/sync/psn', verifyToken, async (req, res) => {
    try{
        //pull form decrypted token
        const targetUserId = req.user.userId;
        const targetPsnId = req.user.psnId;

        console.log(`Starting PSN sync for User: ${targetUserId} | PSN: ${targetPsnId}`);

        await syncPlayStationData(targetUserId, targetPsnId);
        
        res.json({ message: `Successfully synced trophies for ${targetPsnId}!` });
    } catch (error) {
        console.error('Sync error', error);
        res.status(500).json({ error: 'Failed to sync Playstation data. '})
    }
});


//start server
app.listen(PORT, () => {
    console.log(`Server is live and listening on http://localhost:${PORT}`);
});