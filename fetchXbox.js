require('dotenv').config();
const axios = require('axios');

async function getXboxAchievements(){
    try{
        console.log('fetching recent Xbox achievements...');

        const response = await axios.get('https://xbl.io/api/v2/achievements', {
            headers: {
                'X-Authorization': process.env.OPENXBL_API_KEY,
                'Accept': 'application/json',
                'Accept-Language': 'en-US'
            }
        });
        const mostRecentGame = response.data.content.titles[0];

        console.log('Success! detailed structured: ');
        console.log(JSON.stringify(mostRecentGame, null, 2));

    } catch (error) {
        console.error('Error fetching data from OpenXBL:', error.response ? error.response.data : error.message);
    }
}

getXboxAchievements();