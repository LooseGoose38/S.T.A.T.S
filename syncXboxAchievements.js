require('dotenv').config();

const axios = require('axios');
const mongoose = require('mongoose');

const Game = require('./models/Game');
const Achievement = require('./models/Achievement');

const API_BASE = 'https://xbl.io/api/v2';

const OPENXBL_HEADERS = {
    'X-Authorization': process.env.OPENXBL_API_KEY,
    'Accept': 'application/json',
    'Accept-Language': 'en-US'
};

const PLACEHOLDER_IMAGE = 'https://via.placeholder.com/150';

/**
 * Get the continuation token regardless of where OpenXBL
 * places the paging information in the response.
 */
function getContinuationToken(data) {
    return (
        data?.pagingInfo?.continuationToken ??
        data?.content?.pagingInfo?.continuationToken ??
        data?.paging?.continuationToken ??
        data?.continuationToken ??
        null
    );
}

/**
 * Get titles from the OpenXBL response.
 */
function getTitles(data) {
    if (Array.isArray(data?.titles)) {
        return data.titles;
    }

    if (Array.isArray(data?.content?.titles)) {
        return data.content.titles;
    }

    if (Array.isArray(data?.titleHistory)) {
        return data.titleHistory;
    }

    if (Array.isArray(data?.content?.titleHistory)) {
        return data.content.titleHistory;
    }

    return [];
}

/**
 * Fetch the user's ENTIRE Xbox title history using
 * continuationToken pagination.
 */
async function fetchAllTitleHistory(xuid) {
    const allTitles = [];

    let continuationToken = null;
    let page = 1;

    do {
        const params = {};

        if (continuationToken) {
            params.continuationToken = continuationToken;
        }

        console.log(
            `Fetching Xbox title history page ${page}` +
            (continuationToken ? '...' : '...')
        );

        try {
            const response = await axios.get(
                `${API_BASE}/player/titleHistory/${xuid}`,
                {
                    headers: OPENXBL_HEADERS,
                    params,
                    timeout: 30000
                }
            );

            const data = response.data;

            const titles = getTitles(data);

            console.log(
                `Page ${page}: received ${titles.length} games`
            );

            allTitles.push(...titles);

            const nextToken = getContinuationToken(data);

            console.log(
                `Page ${page}: continuation token ` +
                `${nextToken ? 'FOUND' : 'NOT FOUND'}`
            );

            // Protect against an API bug causing an infinite loop.
            if (
                nextToken &&
                nextToken === continuationToken
            ) {
                console.warn(
                    'OpenXBL returned the same continuation token twice. Stopping pagination.'
                );
                break;
            }

            continuationToken = nextToken;
            page++;

        } catch (error) {
            console.error(
                `Failed to fetch title history page ${page}:`,
                error.response?.data || error.message
            );

            break;
        }

    } while (continuationToken);

    /**
     * De-duplicate games by titleId.
     */
    const uniqueTitles = Array.from(
        new Map(
            allTitles
                .filter(game => game?.titleId)
                .map(game => [
                    String(game.titleId),
                    game
                ])
        ).values()
    );

    console.log(
        `Finished pagination: ${uniqueTitles.length} unique games found.`
    );

    return uniqueTitles;
}

/**
 * Convert an Xbox timestamp into a JavaScript Date.
 *
 * Xbox 360 offline unlocks can contain:
 *
 *   0001-01-01...
 *   2002-...
 *
 * Those mean the achievement is unlocked, but the real
 * unlock date is unavailable.
 */
function parseUnlockDate(timestamp) {
    if (!timestamp || typeof timestamp !== 'string') {
        return null;
    }

    /**
     * Known Xbox placeholder dates.
     */
    if (
        timestamp.startsWith('0001-01-01') ||
        timestamp.startsWith('2002-')
    ) {
        return null;
    }

    const date = new Date(timestamp);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    /**
     * Extra protection against ancient invalid dates.
     */
    if (date.getUTCFullYear() <= 2002) {
        return null;
    }

    return date;
}

/**
 * Determine whether an achievement is unlocked.
 *
 * IMPORTANT:
 * This is intentionally separate from unlockDate.
 *
 * An offline Xbox 360 unlock can be:
 *
 *   isUnlocked: true
 *   unlockDate: null
 */
function isAchievementUnlocked(ach) {
    return (
        ach?.progressState === 'Achieved' ||
        ach?.progression?.achievementState === 'Achieved' ||
        ach?.unlocked === true ||
        ach?.unlockedOnline === true ||
        ach?.unlockedOffline === true ||
        Boolean(ach?.progression?.timeUnlocked) ||
        Boolean(ach?.timeUnlocked)
    );
}

/**
 * Convert image URLs to something safe for an HTTPS frontend.
 *
 * HTTPS URLs:
 *   Use directly.
 *
 * HTTP URLs:
 *   Send through wsrv.nl.
 *
 * Anything else:
 *   Use placeholder.
 */
function proxyImageUrl(originalUrl) {
    if (
        !originalUrl ||
        typeof originalUrl !== 'string'
    ) {
        return PLACEHOLDER_IMAGE;
    }

    /**
     * Already HTTPS.
     */
    if (originalUrl.startsWith('https://')) {
        return originalUrl;
    }

    /**
     * Legacy Xbox 360 HTTP image.
     */
    if (originalUrl.startsWith('http://')) {
        return (
            'https://wsrv.nl/?url=' +
            encodeURIComponent(originalUrl) +
            '&output=webp&maxage=1y'
        );
    }

    return PLACEHOLDER_IMAGE;
}

/**
 * Extract achievements from OpenXBL response.
 */
function extractAchievements(data) {
    if (Array.isArray(data?.achievements)) {
        return data.achievements;
    }

    if (Array.isArray(data?.content?.achievements)) {
        return data.content.achievements;
    }

    return [];
}

/**
 * Fetch achievements for one game.
 */
async function fetchGameAchievements(
    xuid,
    titleId,
    expectedTotal = 0
) {
    const endpoints = [
        `${API_BASE}/achievements/player/${xuid}/title/${titleId}`,
        `${API_BASE}/achievements/title/${titleId}`,
        `${API_BASE}/achievements/x360/${xuid}/title/${titleId}`
    ];

    let bestAchievements = [];

    for (const endpoint of endpoints) {
        try {
            const response = await axios.get(
                endpoint,
                {
                    headers: OPENXBL_HEADERS,
                    timeout: 30000
                }
            );

            const achievements =
                extractAchievements(response.data);

            console.log(
                `Achievement endpoint returned ${achievements.length}/${expectedTotal}: ${endpoint}`
            );

            if (
                achievements.length >
                bestAchievements.length
            ) {
                bestAchievements = achievements;
            }

            /**
             * Perfect match — no reason to try
             * another endpoint.
             */
            if (
                expectedTotal > 0 &&
                achievements.length >= expectedTotal
            ) {
                return achievements;
            }

        } catch (error) {
            console.warn(
                `Achievement request failed: ${endpoint}`
            );

            console.warn(
                error.response?.data || error.message
            );
        }
    }

    /**
     * Return whichever endpoint gave us the most
     * achievements.
     */
    return bestAchievements;
}

const expectedTotal = Number(
    targetGameRaw?.achievement?.totalAchievements ?? 0
);

const rawAchievements =
    await fetchGameAchievements(
        xuid,
        targetGameRaw.titleId,
        expectedTotal
    );

/**
 * Main synchronization function.
 */
async function syncGameAndAchievements() {
    try {
        // ---------------------------------------------------------
        // CONNECT TO MONGODB
        // ---------------------------------------------------------

        console.log('Connecting to database...');

        await mongoose.connect(
            process.env.MONGO_URI
        );

        // ---------------------------------------------------------
        // GET XUID
        // ---------------------------------------------------------

        console.log(
            'Fetching your Xbox account XUID...'
        );

        const accountResponse = await axios.get(
            `${API_BASE}/account`,
            {
                headers: OPENXBL_HEADERS,
                timeout: 30000
            }
        );

        const xuid =
            accountResponse.data?.content?.profileUsers?.[0]?.id ??
            accountResponse.data?.profileUsers?.[0]?.id;

        if (!xuid) {
            throw new Error(
                'Could not find XUID in OpenXBL account response.'
            );
        }

        console.log(
            `Successfully found XUID: ${xuid}`
        );

        // ---------------------------------------------------------
        // GET ENTIRE GAME LIBRARY
        // ---------------------------------------------------------

        console.log(
            'Fetching your full lifetime Xbox game history...'
        );

        const allTitles =
            await fetchAllTitleHistory(xuid);

        /**
         * Only keep titles with achievements.
         */
        const validGames = allTitles.filter(
            game => game && game.titleId
        );

        if (validGames.length === 0) {
            console.log(
                'No valid Xbox games found.'
            );

            return;
        }

        console.log(
        `Found ${validGames.length} total games! Starting sync...`
        );

        // ---------------------------------------------------------
        // PROCESS EACH GAME
        // ---------------------------------------------------------

        for (const targetGameRaw of validGames) {
            try {
                console.log(
                    `\n--- Processing game: ${targetGameRaw.name} ---`
                );

                // -------------------------------------------------
                // FETCH ACHIEVEMENTS
                // -------------------------------------------------

                const rawAchievements =
                    await fetchGameAchievements(
                        xuid,
                        targetGameRaw.titleId
                    );

                if (
                    !rawAchievements ||
                    rawAchievements.length === 0
                ) {
                    console.log(
                        'No achievements found for this game, skipping.'
                    );

                    continue;
                }

                // -------------------------------------------------
                // CONVERT ACHIEVEMENTS FOR MONGODB
                // -------------------------------------------------

                const achievementsToSave =
                    rawAchievements.map(ach => {

                        /**
                         * FIRST determine whether it is unlocked.
                         *
                         * This must happen independently of the date.
                         */
                        const unlocked =
                            isAchievementUnlocked(ach);

                        /**
                         * Get timestamp from whichever property
                         * OpenXBL supplied.
                         */
                        const rawTimestamp =
                            ach?.progression?.timeUnlocked ??
                            ach?.timeUnlocked ??
                            null;

                        /**
                         * Parse only if achievement is unlocked.
                         *
                         * 2002 / 0001 timestamps become null.
                         */
                        const unlockTime =
                            unlocked
                                ? parseUnlockDate(
                                    rawTimestamp
                                )
                                : null;

                        // -----------------------------------------
                        // ACHIEVEMENT ICON
                        // -----------------------------------------

                        let icon =
                            PLACEHOLDER_IMAGE;

                        if (
                            Array.isArray(
                                ach?.mediaAssets
                            ) &&
                            ach.mediaAssets.length > 0 &&
                            ach.mediaAssets[0]?.url
                        ) {
                            icon =
                                ach.mediaAssets[0].url;

                        } else if (
                            ach?.imageUnlocked
                        ) {
                            icon =
                                ach.imageUnlocked;
                        }

                        /**
                         * Convert HTTP legacy images to HTTPS.
                         */
                        icon =
                            proxyImageUrl(icon);

                        // -----------------------------------------
                        // DESCRIPTION
                        // -----------------------------------------

                        const desc =
                            unlocked
                                ? (
                                    ach?.description ||
                                    ach?.lockedDescription ||
                                    'Secret Achievement'
                                )
                                : (
                                    ach?.lockedDescription ||
                                    ach?.description ||
                                    'Secret Achievement'
                                );

                        // -----------------------------------------
                        // REWARD
                        // -----------------------------------------

                        let rewardType =
                            'Gamerscore';

                        let rewardValue =
                            '0';

                        if (
                            Array.isArray(
                                ach?.rewards
                            ) &&
                            ach.rewards.length > 0
                        ) {
                            rewardType =
                                ach.rewards[0]?.type ||
                                'Gamerscore';

                            rewardValue =
                                String(
                                    ach.rewards[0]?.value ??
                                    '0'
                                );

                        } else if (
                            ach?.gamerscore !== undefined
                        ) {
                            rewardValue =
                                String(
                                    ach.gamerscore
                                );
                        }

                        // -----------------------------------------
                        // FINAL MONGOOSE OBJECT
                        // -----------------------------------------

                        return {
                            gameTitle:
                                targetGameRaw.name,

                            achievementName:
                                ach?.name ||
                                'Unknown Achievement',

                            description:
                                desc,

                            iconUrl:
                                icon,

                            /**
                             * TRUE even for offline Xbox 360
                             * achievements with no valid date.
                             */
                            isUnlocked:
                                unlocked,

                            /**
                             * Real date when available.
                             *
                             * null for:
                             *   - 2002 timestamps
                             *   - 0001 timestamps
                             *   - invalid timestamps
                             *   - locked achievements
                             */
                            unlockDate:
                                unlocked
                                    ? unlockTime
                                    : null,

                            weight: {
                                type:
                                    rewardType,

                                value:
                                    rewardValue,

                                isRare:
                                    ach?.rarity
                                        ?.currentCategory ===
                                    'Rare'
                            }
                        };
                    });

                // -------------------------------------------------
                // GAME PROGRESS
                // -------------------------------------------------

                const actualUnlockedCount = Number(
    targetGameRaw?.achievement?.currentAchievements ?? 0
);

const actualTotalCount = Number(
    targetGameRaw?.achievement?.totalAchievements ?? 0
);

const actualPercentage = Number(
    targetGameRaw?.achievement?.progressPercentage ?? 0
);

                // -------------------------------------------------
                // BOX ART
                // -------------------------------------------------

                let boxArtUrl = '';

                if (
                    targetGameRaw?.displayImage
                ) {
                    boxArtUrl =
                        targetGameRaw.displayImage;

                } else if (
                    Array.isArray(
                        targetGameRaw?.images
                    )
                ) {
                    const art =
                        targetGameRaw.images.find(
                            img =>
                                img?.type === 'BoxArt' ||
                                img?.type === 'Poster'
                        );

                    if (art?.url) {
                        boxArtUrl =
                            art.url;
                    }
                }

                /**
                 * Make box art HTTPS-safe too.
                 */
                if (boxArtUrl) {
                    boxArtUrl =
                        proxyImageUrl(
                            boxArtUrl
                        );
                }

                // -------------------------------------------------
                // GAME DOCUMENT
                // -------------------------------------------------

                const updateData = {
                    title:
                        targetGameRaw.name,

                    platform:
                        Array.isArray(
                            targetGameRaw?.devices
                        ) &&
                        targetGameRaw.devices.length > 0
                            ? targetGameRaw.devices[0]
                            : 'Xbox',

                    ecosystem:
                        'Xbox',

                    boxArtUrl:
                        boxArtUrl,

                    progress: {
                        unlockedCount:
                            actualUnlockedCount,

                        totalCount:
                            actualTotalCount,

                        completionPercentage:
                            actualPercentage
                    },

                    lastPlayed:
                        targetGameRaw
                            ?.titleHistory
                            ?.lastTimePlayed
                            ? new Date(
                                targetGameRaw
                                    .titleHistory
                                    .lastTimePlayed
                            )
                            : null
                };

                // -------------------------------------------------
                // SAVE GAME
                // -------------------------------------------------

                const gameDoc =
                    await Game.findOneAndUpdate(
                        {
                            externalGameId:
                                targetGameRaw.titleId
                        },

                        updateData,

                        {
                            returnDocument:
                                'after',

                            upsert:
                                true
                        }
                    );

                // -------------------------------------------------
                // REPLACE OLD ACHIEVEMENTS
                // -------------------------------------------------

                await Achievement.deleteMany({
                    gameId:
                        gameDoc._id
                });

                // Attach game ID.
                achievementsToSave.forEach(
                    ach => {
                        ach.gameId =
                            gameDoc._id;
                    }
                );

                // Insert all achievements.
                await Achievement.insertMany(
                    achievementsToSave
                );

                console.log(
                    `Saved ${actualUnlockedCount}/${actualTotalCount} unlocked ` +
                    `and inserted ${achievementsToSave.length} total achievements.`
                );

            } catch (gameError) {

                console.error(
                    `Skipping ${targetGameRaw.name} due to error:`,
                    gameError.message
                );
            }
        }

    } catch (error) {

        console.error(
            'An error occurred:',
            error.response?.data ||
            error.message
        );

    } finally {

        await mongoose.disconnect();

        console.log(
            'Disconnected from database'
        );
    }
}

// -------------------------------------------------------------
// START SYNC
// -------------------------------------------------------------

syncGameAndAchievements();
