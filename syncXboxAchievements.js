require('dotenv').config();
const axios = require('axios');
const mongoose = require('mongoose');

// Import both blueprints
const Game = require('./models/Game');
const Achievement = require('./models/Achievement');

async function syncGameAndAchievements(){
    try{
        console.log('connecting to database...');
        await mongoose.connect(process.env.MONGO_URI);

        //fetch the recent games list from OpenXBL
        const listResponse = await axios.get('https://xbl.io/api/v2/achievements',{
            headers: { 'X-Authorization': process.env.OPENXBL_API_KEY, 'Accept': 'application/json', 'Accept-Language': 'en-US' }
    });

    // find first real game
    const titles = listResponse.data.content.titles;
    const targetGameRaw = titles.find(game => game.achievement.totalAchievements > 0 && !game.devices.includes('Xbox360'));

    if (!targetGameRaw) return console.log('No valid game found.');
    console.log(`Processing game: ${targetGameRaw.name}`);

    //find game in database, or create if does not exists
    let gameDoc = await Game.findOne({ externalGameId: targetGameRaw.titleId });

    if(!gameDoc){
        const boxArtIamge = targetGameRaw.images.find(img => img.type === 'BoxArt' || img.type === 'Poster');
        gameDoc = new Game ({
            externalGameId: targetGameRaw.titleId,
            title: targetGameRaw.name,
            platform: targetGameRaw.devices[0] || 'Xbox',
            ecosystem: 'Xbox',
            boxArtUrl: boxArtIamge ? boxArtIamge.url : '',
            progress:{
                unlockedCount: targetGameRaw.achievement.currentAchievements,
                totalCount: targetGameRaw.achievement.totalAchievements,
                completionPercentage: targetGameRaw.achievement.progressPercentage
            },
            lastPlayed: targetGameRaw.titleHistory.lastTimePlayed
        });

        await gameDoc.save();
        console.log('Saved new game to database.');
    }

    console.log('fetching achievement list');
    const detailsResponse = await axios.get(`https://xbl.io/api/v2/achievements/title/${targetGameRaw.titleId}`,{
        headers: { 'X-Authorization': process.env.OPENXBL_API_KEY, 'Accept': 'application/json', 'Accept-Language': 'en-US' }
    });

    
    const responseData = detailsResponse.data;
    let rawAchievements = [];

    // Check all the different places OpenXBL might hide the array
    if (responseData.achievements) {
        rawAchievements = responseData.achievements;
    } else if (responseData.content && responseData.content.achievements) {
        rawAchievements = responseData.content.achievements;
    } else if (Array.isArray(responseData)) {
        rawAchievements = responseData;
    }

    // Safety check to ensure data before running .map()
    if (!rawAchievements || rawAchievements.length === 0) {
        console.log('No achievements found in the payload! Here is what OpenXBL sent back:');
        console.log(JSON.stringify(responseData, null, 2));
      return; // Stop the script safely
    }

    //delete any old achievements for this game
    await Achievement.deleteMany({ gameId: gameDoc._id });

    //loop through raw data and translate to blueprint
    const achievementsToSave = rawAchievements.map(ach => {
        
        const isUnlocked = ach.progressState === 'Achieved';

        return{
            gameId: gameDoc._id,
            gameTitle: gameDoc.title,
            achievementName: ach.name,

            //show locked description
            description: isUnlocked ? ach.description : ach.lockedDescription,
            iconUrl: ach.mediaAssets && ach.mediaAssets[0] ? ach.mediaAssets[0].url : '',
            isUnlocked: isUnlocked,
            // Only set a date if it's unlocked AND the date isn't the 0001-01-01 placeholder
            unlockDate: isUnlocked && ach.progression.timeUnlocked !== '0001-01-01T00:00:00.0000000Z' ? new Date(ach.progression.timeUnlocked) : null,

            weight: { 
                type: ach.rewards[0] ? ach.rewards[0].type : 'Gamerscore',
                value: ach.rewards[0] ? ach.rewards[0].value : '0',
                isRare: ach.rarity ? ach.rarity.currentCategory === 'Rare' : false
            }
        };
    });

    //bulk insert translated array
    await Achievement.insertMany(achievementsToSave);
    console.log(`Success! Inserted ${achievementsToSave.length} achievements into the database.`);

    } catch (error) {
        console.error('An error occured: ', error.message);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from database');
    }
}

syncGameAndAchievements();