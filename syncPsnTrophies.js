require('dotenv').config();
const psn = require('psn-api');
const mongoose = require('mongoose');

const Game = require('./models/Game');
const Achievement = require('./models/Achievement');

async function syncPsnGameAndTrophies(){
    try{
        console.log('connecting to database...');
        await mongoose.connect(process.env.MONGO_URI);

        console.log('authenticating with playstation network...');
        const accessCode = await psn.exchangeNpssoForAccessCode(process.env.NPSSO_TOKEN);
        const authorization = await psn.exchangeAccessCodeForAuthTokens(accessCode);

        console.log('fetching recent games...')
        const trophyTitlesResponse = await psn.getUserTitles(authorization, "me");
        const targetGameRaw = trophyTitlesResponse.trophyTitles[0];

        if(!targetGameRaw) return console.log('No PlayStation games found.');
        console.log(`Processing game: ${targetGameRaw.trophyTitleName}`);

        //calculate total and unlocked counts
        const totalTrophies = targetGameRaw.definedTrophies.bronze + targetGameRaw.definedTrophies.silver + targetGameRaw.definedTrophies.gold + targetGameRaw.definedTrophies.platinum;
        const unlockedTrophies = targetGameRaw.earnedTrophies.bronze + targetGameRaw.earnedTrophies.silver + targetGameRaw.earnedTrophies.gold + targetGameRaw.earnedTrophies.platinum;

        const updateData = {
                externalGameId: targetGameRaw.npCommunicationId,
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
            
            const gameDoc = await Game.findOneAndUpdate(
                { externalGameId: targetGameRaw.npCommunicationId },
                updateData,
                { new: true, upsert: true }
            );
        console.log('Game data synced/updated');

        console.log('fetching trophy scorecard...');
        const userTrophiesResponse = await psn.getUserTrophiesEarnedForTitle(
            authorization, "me", targetGameRaw.npCommunicationId, "all", { npServiceName: targetGameRaw.npServiceName }
        );

        console.log('fetching global trophy dictionary');
        const titleTrophiesResponse = await psn.getTitleTrophies(
            authorization, targetGameRaw.npCommunicationId, "all", { npServiceName: targetGameRaw.npServiceName }
        );
        
        //delete old achievement to prevent dupes
        await Achievement.deleteMany({gameId: gameDoc._id });

        //merge the lists
        const achievementsToSave = userTrophiesResponse.trophies.map(userTrophy => {

            const titleTrophy = titleTrophiesResponse.trophies.find(t => t.trophyId === userTrophy.trophyId);

            return{
                gameId: gameDoc._id,
                gameTitle: gameDoc.title,
                achievementName: titleTrophy.trophyName || 'Hidden Trophy',
                description: titleTrophy.trophyDetail || 'Keep playing to reveal this trophy.',
                iconUrl: titleTrophy.trophyIconUrl || '',
                isUnlocked: userTrophy.earned,

                unlockDate: userTrophy.earned && userTrophy.earnedDateTime ? new Date(userTrophy.earnedDateTime) : null,

                weight:{
                    type: 'Trophy',
                    value: titleTrophy.trophyType.charAt(0).toUpperCase() + titleTrophy.trophyType.slice(1),
                    isRare: Number(titleTrophy.trophyEarnedRate) < 10.0
                }
            };
        });

        await Achievement.insertMany(achievementsToSave);
        console.log(`Success! Inserted ${achievementsToSave.length} PlayStation trophies into the database.`);

    } catch (error) {
    console.error('An error occurred:', error.message);
    } finally {
    await mongoose.disconnect();
    console.log('Disconnected from database.');
    }
}

syncPsnGameAndTrophies();