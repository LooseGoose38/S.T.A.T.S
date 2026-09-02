// import { exchangeNpssoForAccessCode } from "psn-api";
// import { exchangeRefreshTokenForAuthTokens } from "psn-api";
// import { exchangeAccessCodeForAuthTokens } from "psn-api";
// import { getUserTitles } from "psn-api";

require('dotenv').config();
const psn = require('psn-api');

async function testPsnAuth(){
  try{
    console.log('authenticating with Playstation Network...');

    const accessCode = await psn.exchangeNpssoForAccessCode(process.env.NPSSO_TOKEN);

    const authorization = await psn.exchangeAccessCodeForAuthTokens(accessCode);

    const profileResponse = await psn.getProfileFromUserName(authorization, "me");

    console.log('Success! Connected to PlayStation Network.');

    console.log(JSON.stringify(profileResponse, null, 2));
    


    } catch (error) {
    console.error('PSN Auth Error:', error.message);
  }
}

testPsnAuth();