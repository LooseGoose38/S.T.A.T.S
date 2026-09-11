require('dotenv').config();
const axios = require('axios');

async function getGameAchievements(){
    try{
        console.log('Fetching most recent game ID...');

        //get recent game list
        const listResponse = await axios.get('https://xbl.io/api/v2/achievements', {
            headers: {
                'X-Authorization': process.env.OPENXBL_API_KEY,
                'Accept': 'application/json',
                'Accept-Language': 'en-US'
            }
        });

        //grab title where achievements is greater than zero
        const titles = listResponse.data.content.titles;
        const realGame = titles.find(game => game.achievement.totalAchievements > 0 && !game.devices.includes('Xbox360'));

        if(!realGame){
            console.log('Could not find any games with achievements in your recent history.')
            return;
        }

        //extract ID of most recent game
        const targetTitleId = realGame.titleId;
        console.log(`Targeting Title: ${realGame.name} (ID: ${targetTitleId})`);

        console.log('Fetching all achievements for the specific game...');

        //hit title-specific endpoint using ID
        const detailsResponse = await axios.get(`https://xbl.io/api/v2/achievements/title/${targetTitleId}`,{
            headers: {
        'X-Authorization': process.env.OPENXBL_API_KEY,
        'Accept': 'application/json',
        'Accept-Language': 'en-US'
    }
});

const allAchievements = detailsResponse.data.content.achievements;

console.log(`Success! Found ${allAchievements.length} total achievements for ${realGame.name}.`);

//print first achievement to see structure
console.log(JSON.stringify(allAchievements[0], null, 2));

} catch (error) {
    console.error('An error occurred', error.response ? error.response.data : error.message);
}
}

getGameAchievements();