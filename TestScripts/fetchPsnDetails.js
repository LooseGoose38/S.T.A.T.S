require("dotenv").config();
const psn = require("psn-api");

async function getGameTrophies() {
    try {
    console.log("authenticating with playstation network");
    const accessCode = await psn.exchangeNpssoForAccessCode(
        process.env.NPSSO_TOKEN,
    );
    const authorization = await psn.exchangeAccessCodeForAuthTokens(accessCode);

    console.log("fetching recent games to get the ID");
    const trophyTitlesResponse = await psn.getUserTitles(authorization, "me");

    const targetGame = trophyTitlesResponse.trophyTitles[0];
    const npCommunicationId = targetGame.npCommunicationId;

    console.log(`Fetching trophies for: ${targetGame.trophyTitleName}...`);

    const userTrophiesResponse = await psn.getUserTrophiesEarnedForTitle(
        authorization,
        "me",
        npCommunicationId,
        "all",
        { npServiceName: targetGame.npServiceName },
    );

    console.log('global trophy dictionary (metadata)...');
    const titleTrophiesResponse = await psn.getTitleTrophies(
        authorization, 
        npCommunicationId, 
        "all",
        { npServiceName: targetGame.npServiceName }
    );

    const userTrophy = userTrophiesResponse.trophies[0];

    const titleTrophy = titleTrophiesResponse.trophies.find(t => t.trophyId === userTrophy.trophyId);

    const mergedTrophy = { ...titleTrophy, ...userTrophy };

    console.log("complete data structure of single playstation trophy:");
    console.log(JSON.stringify(mergedTrophy, null, 2));
    } catch (error) {
    console.error("An error occured:", error.message);
    }
}

getGameTrophies();