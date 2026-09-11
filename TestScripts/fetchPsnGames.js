require('dotenv').config();
const psn = require('psn-api');

async function getPsnGames() {
  try {
    console.log('1. Authenticating with PlayStation Network...');
    const accessCode = await psn.exchangeNpssoForCode(process.env.NPSSO_TOKEN);
    const authorization = await psn.exchangeCodeForAccessToken(accessCode);

    console.log('2. Fetching your PlayStation game library...');
    
    // getUserTitles and the "me" shortcut to fetch  games
    const trophyTitlesResponse = await psn.getUserTitles(authorization, "me");

    console.log('Success! Here is the raw data for your most recent PlayStation game:');
    
    // Print the very first game in the array, inspect its structure
    // target trophyTitlesResponse.trophyTitles to see the list
    console.log(JSON.stringify(trophyTitlesResponse.trophyTitles[0], null, 2));

  } catch (error) {
    console.error('An error occurred:', error.message);
  }
}

getPsnGames();