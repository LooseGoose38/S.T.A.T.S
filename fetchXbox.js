require('dotenv').config();
const axios = require('axios');
const mongoose = require('mongoose');

//import my game blueprint
const Game = require('./models/Game');

async function syncXboxGames(){
    try{
        //connect to the database
        console.log('Connecting to database...');
        await mongoose.connect(process.env.MONGO_URI);

        //fetch data from OpenXBL
        console.log('Fetching recent Xbox data...');
        const response = await axios.get('https://xbl.io/api/v2/achievements', {
            headers: {
                'X-Authorization': process.env.OPENXBL_API_KEY,
                'Accept': 'application/json',
                'Accept-Language': 'en-US'
            }
        });

        //Grab the most recent title
        const rawData = response.data.content.titles[0];

        //find box art URL by searching the images array
        const boxArtImage = rawData.images.find(img => img.type === 'BoxArt' || img.type === 'Poster');

        //map the raw JSON to database schema
        const newGame = new Game({
            externalGameId: rawData.titleId,
            title: rawData.name,
            platform: rawData.devices[0] || 'Xbox',
            ecosystem: 'Xbox',
            boxArtUrl: boxArtImage ? boxArtImage.url : '',
            progress: {
                unlockedCount: rawData.achievement.currentAchievements,
                totalCount: rawData.achievement.totalAchievements,
                completionPercentage: rawData.achievement.progressPercentage
            },
            lastPlayed: rawData.titleHistory.lastTimePlayed
        });

        //save to MongoDB
        await newGame.save();
        console.log(`Successfully saved "${newGame.title}" to your database`);

    } catch (error) {
        console.error('an error occurred', error.message);
    } finally {
        //disconnect 
        await mongoose.disconnect();
        console.log('Disconnected from database');
    }
}

syncXboxGames();