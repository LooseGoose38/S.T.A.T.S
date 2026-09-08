require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const psn = require('psn-api');
const jwt = require('jsonwebtoken');
const { scrapeTrophyGuide } = require('./utils/scraper');
const { findGameGuideUrl } = require('./utils/guideFinder');


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
        

        if (!game) {
            return res.status(404).json({ error: 'Game not found or access denied.' });
        }

        return res.json(game);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch game details'});
    }
});

app.get('/api/games/:id/achievements', verifyToken, async (req, res) => {
    try{
        const achievements = await Achievement.find({ gameId: req.params.id, userId: req.user.userId })
        .sort({ isUnlocked: -1, unlockDate: -1 });

        return res.json(achievements);
    } catch (error){
        res.status(500).json({ error: 'failed to fetch achievements'});
    }
})

const bcrypt = require('bcryptjs');
const User = require('./models/User');
const { verify } = require('crypto');

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
            
                const userTrophies = userTrophiesResponse.trophies || [];
                const titleTrophies = titleTrophiesResponse.trophies || [];

                const bulkOps = userTrophies.map(userTrophy => {
                    const titleTrophy = titleTrophies.trophies.find(t => t.trophyId === userTrophy.trophyId);
                    if(!titleTrophy) return null;

                    return {
                        updateOne: {
                            // Find the exact trophy
                            filter: { 
                                userId: targetUserId, 
                                gameId: gameDoc._id, 
                                achievementName: titleTrophy.trophyName || 'Hidden Trophy' 
                            },
                            // Only update these specific fields, leaving guideHtml safely untouched!
                            update: {
                                $set: {
                                    gameTitle: gameDoc.title,
                                    description: titleTrophy.trophyDetail || 'Keep playing to reveal this trophy.',
                                    iconUrl: titleTrophy.trophyIconUrl || '',
                                    isUnlocked: userTrophy.earned,
                                    unlockDate: userTrophy.earned && userTrophy.earnedDateTime ? new Date(userTrophy.earnedDateTime) : null,
                                    weight: {
                                        type: 'Trophy',
                                        value: titleTrophy.trophyType.charAt(0).toUpperCase() + titleTrophy.trophyType.slice(1),
                                        isRare: titleTrophy.trophyEarnedRate ? Number(titleTrophy.trophyEarnedRate) < 10.0 : false
                                    }
                                }
                            },
                            // If it doesn't exist at all, insert it
                            upsert: true
                        }
                    };
                }).filter(op => op !== null);

                if (bulkOps.length > 0) {
                    await Achievement.bulkWrite(bulkOps);
                }
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

// secure singe game sync route
app.post('/api/sync/game', verifyToken, async (req, res) => {
    try{
        const { externalGameId } = req.body;
        const targetUserId = req.user.userId;
        const targetPsnId = req.user.psnId;

        console.log(`Starting targeted PSN sync for Game ID: ${externalGameId}...`);

        //authenticate with PSN
        const accessCode = await psn.exchangeNpssoForAccessCode(process.env.NPSSO_TOKEN);
        const authorization = await psn.exchangeAccessCodeForAuthTokens(accessCode);

        console.log('PSN Authentication Successful');

        const profileResponse = await psn.getProfileFromUserName(authorization, targetPsnId);
        const targetAccountId = profileResponse.profile ? profileResponse.profile.accountId : profileResponse.accountId;

        //fetch the library, but only process the request game
        const trophyTitlesResponse = await psn.getUserTitles(authorization, targetAccountId);
        const targetGameRaw = trophyTitlesResponse.trophyTitles.find(g => g.npCommunicationId === externalGameId);

        if(!targetGameRaw){
            return res.status(404).json({ error: 'Game not found on your PSN profile'});
        }
        
        //update the game document progress
        const totalTrophies = targetGameRaw.definedTrophies.bronze + targetGameRaw.definedTrophies.silver + targetGameRaw.definedTrophies.gold + targetGameRaw.definedTrophies.platinum;
        const unlockedTrophies = targetGameRaw.earnedTrophies.bronze + targetGameRaw.earnedTrophies.silver + targetGameRaw.earnedTrophies.gold + targetGameRaw.earnedTrophies.platinum;

        const gameDoc = await Game.findOneAndUpdate(
            { externalGameId: targetGameRaw.npCommunicationId, userId: targetUserId },
            {
                progress: {
                    unlockedCount: unlockedTrophies,
                    totalCount: totalTrophies,
                    completionPercentage: targetGameRaw.progress
                },
                lastPlayed: targetGameRaw.lastUpdatedDateTime
            },
            { returnDocument: 'after' }
        );

        console.log('Game progress updated in MongoDB');

        //fetch and update only this game's trophies
        const userTrophiesResponse = await psn.getUserTrophiesEarnedForTitle(
            authorization, targetAccountId, targetGameRaw.npCommunicationId, "all", { npServiceName: targetGameRaw.npServiceName }
        );
        
        const titleTrophiesResponse = await psn.getTitleTrophies(
            authorization, targetGameRaw.npCommunicationId, "all", { npServiceName: targetGameRaw.npServiceName}
        );

        console.log('Trophy lists fetched from Sony');

        const userTrophies = userTrophiesResponse.trophies || [];
        const titleTrophies = titleTrophiesResponse.trophies || [];

        const bulkOps = userTrophies.map(userTrophy => {
            const titleTrophy = titleTrophies.find(t => t.trophyId === userTrophy.trophyId);
            if(!titleTrophy) return null;

            return {
                updateOne: {
                    filter: { 
                        userId: targetUserId, 
                        gameId: gameDoc._id, 
                        achievementName: titleTrophy.trophyName || 'Hidden Trophy' 
                    },
                    update: {
                        $set: {
                            gameTitle: gameDoc.title,
                            description: titleTrophy.trophyDetail || 'Keep playing to reveal this trophy.',
                            iconUrl: titleTrophy.trophyIconUrl || '',
                            isUnlocked: userTrophy.earned,
                            unlockDate: userTrophy.earned && userTrophy.earnedDateTime ? new Date(userTrophy.earnedDateTime) : null,
                            weight: {
                                type: 'Trophy',
                                value: titleTrophy.trophyType.charAt(0).toUpperCase() + titleTrophy.trophyType.slice(1),
                                isRare: titleTrophy.trophyEarnedRate ? Number(titleTrophy.trophyEarnedRate) < 10.0 : false
                            }
                        }
                    },
                    upsert: true
                }
            };
        }).filter(op => op !== null);

        if(bulkOps.length > 0){
            await Achievement.bulkWrite(bulkOps);
            console.log(`Updated ${bulkOps.length} trophies in MongoDB!`);
        } else {
            console.log('No new trophies to update.');
        }

        res.json({ success: true, message: 'Game synced successfully!' });
    }catch (error) {
        console.error('Targeted sync error:', error);
        res.status(500).json({ error: 'Failed to sync specific game.'})

    }
});

// Secure guide scraping route (WITH CACHING)
app.post('/api/guide', verifyToken, async (req, res) => {
    try {
        const { trophyName, gameId, friendId } = req.body;
        const targetUserId = friendId || req.user.userId;

        console.log(`Frontend requested guide for: ${trophyName} using Game ID: ${gameId}`);

        if(friendId){
            const currentUser = await User.findById(req.user.userId);
            if(!currentUser.friends.some(id => id.toString() === friendId)){
                return res.status(403).json({ error: 'Not friends with this user.'})
            }
        }

        // 1. Find the specific achievement in the database
        const achievement = await Achievement.findOne({ 
            achievementName: trophyName, 
            gameId: gameId,
            userId: targetUserId 
        });

        if (!achievement) {
            return res.status(404).json({ error: 'Achievement not found.' });
        }

        // 2. CHECK CACHE: If we already scraped this, serve it instantly!
        if (achievement.guideHtml && achievement.guideHtml !== '') {
            console.log(`⚡ Serving cached guide from MongoDB for: ${trophyName}`);
            return res.json({ guide: achievement.guideHtml });
        }

        // 3. CACHE MISS: Find the URL and launch the bot
        const game = await Game.findOne({ _id: achievement.gameId, userId: targetUserId});

        if(game && (!game.guideUrl || game.guideUrl === '')) {
            console.log(`No guide URL found for ${game.title}. Launching cloud resolver...`);
            
            const foundUrl = await findGameGuideUrl(game.title);

            if(foundUrl){
                console.log(`Cloud bot successfully mapped: ${foundUrl}`);
                game.guideUrl = foundUrl;
                await game.save();
            }
        }

        if(!game || !game.guideUrl){
            return res.json({ guide: '<p style="color: #ef4444;">No guide available for this game yet.</p>' });
        }

        console.log(`Scraping guide for the first time...`);
        const guideHtml = await scrapeTrophyGuide(game.guideUrl, trophyName);
        
        // 4. SAVE TO MONGODB: Cache the result so we never have to scrape this trophy again
        achievement.guideHtml = guideHtml;
        await achievement.save();
        
        return res.json({ guide: guideHtml });
    } catch (error) {
        console.error('Guide API error:', error);
        return res.status(500).json({ error: 'Failed to fetch guide data.' });
    }
});

//--- Friends API Routes ---

//add a friend by username
app.post('/api/friends/add', verifyToken, async (req, res) => {
    try{
        const { friendUsername } = req.body;

        // find the target user
        const friend = await User.findOne({ username: { $regex: new RegExp(`^${friendUsername}$`, 'i') } });
        if(!friend) return res.status(404).json({ message: 'User not found.' });

        //prevent adding yourself
        if(friend._id.toString() === req.user.userId) {
            return res.status(400).json({ message: "You can't add yourself as a friend"});
        }

        const currentUser = await User.findById(req.user.userId);

        if(!currentUser.friends){
            currentUser.friends = [];
        }

        //check if already friends
        if(currentUser.friends.includes(friend._id)){
            return res.status(400).json({ message: 'You are already friends with this user'});
        }

        //add to array and save
        currentUser.friends.push(friend._id);
        await currentUser.save();

        res.json({ message: `Successfully added ${friend.username}!`});
    } catch (error) {
        console.error('Add friend error:', error);
        res.status(500).json({ error: 'Failed to add friend.' });
    }
});

//get current user's friends list
app.get('/api/friends', verifyToken, async (req, res) => {
    try{
        const user = await User.findById(req.user.userId).populate('friends', 'username psnId');
        res.json(user.friends);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch friends.' });
    }
});

//view a friend's game library
app.get('/api/friends/:friendsId/games', verifyToken, async (req, res) => {
    try{
        //ensure user is actually friends list before showing data
        const currentUser = await User.findById(req.user.userId);

        if(!currentUser.friends.some(id => id.toString() === req.params.friendsId)) {
            return res.status(403).json({ error: 'You are not friends with this user'});
        }

        //fetch games matching the friend's ID
        const games = await Game.find({ userId: req.params.friendsId }).sort({ lastPlayed: -1 });
        res.json(games);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch friend's games."});
    }
});

app.get('/api/friends/:friendsId/games/:gameId', verifyToken, async (req, res) => {
    try{
        const currentUser = await User.findById(req.user.userId);
        if(!currentUser.friends.some(id => id.toString() === req.params.friendsId)) {
            return res.status(403).json({ error: 'You are not friends with this user'});
        }

        const game = await Game.findOne({ _id: req.params.gameId, userId: req.params.friendsId });
        if(!game) return res.status(404).json({ error: 'Game not found.' });

        res.json(game);
    }catch (error) {
        res.status(500).json({ error: "Failed to fetch friend's game details."})
    }
});

app.get('/api/friends/:friendsId/games/:gameId/achievements', verifyToken, async (req, res) => {
    try{
        const currentUser = await User.findById(req.user.userId);
        if(!currentUser.friends.some(id => id.toString() === req.params.friendsId)){
            return res.status(403).json({ error: 'You are not friends with this user'});
        }

        const achievements = await Achievement.find({ gameId: req.params.gameId, userId: req.params.friendsId })
        .sort({ isUnlocked: -1, unlockDate: -1 });

        res.json(achievements);
    } catch (error) {
        res.status(500).json({ error: "Failed to fetch friend's achievements."})
    }
});


//start server
app.listen(PORT, () => {
    console.log(`Server is live and listening on http://localhost:${PORT}`);
});