import { exchangeNpssoForAccessCode } from "psn-api";
import { exchangeRefreshTokenForAuthTokens } from "psn-api";
import { exchangeAccessCodeForAuthTokens } from "psn-api";
import { getUserTitles } from "psn-api";

const accessCode = await exchangeNpssoForAccessCode("Dli1nxAB5sWsfS22MFO8rrgdYpn1EcAkAhgtXvtWnp7RdYJtNc9HVluTnCjSRGzf");

console.log(accessCode);

const authorization = await exchangeAccessCodeForAuthTokens(accessCode);

const userTitlesResponse = await getUserTitles(
  { accessToken: authorization.accessToken },
  "me"
);

console.log(userTitlesResponse);