// --- scripts/populateGuideUrls.js (or utils/populateGuideUrls.js) ---
// One-time utility: finds PSNProfiles guide URLs for games missing one.
// Auto-matches when there's a single exact name match, or when multiple
// exact-name matches can be disambiguated by platform. Otherwise asks
// for manual confirmation. Saves automatically after a match is selected.
//
// Run with: node populateGuideUrls.js
// .env path is resolved relative to this file's own location.

require('dotenv').config({
    path: require('path').resolve(__dirname, '../.env')
});

const mongoose = require('mongoose');
const readline = require('readline');
const fs = require('fs');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const Game = require('../models/Game');

puppeteer.use(StealthPlugin());

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

// -----------------------------------------------------------------------------
// SEARCH CONFIGURATION
// -----------------------------------------------------------------------------

// Words that describe platform/edition rather than the game itself.
// These are stripped from the SEARCH QUERY, but NOT from the comparison title.
const NOISE_WORDS = new Set([
    'playstation',
    'ps3',
    'ps4',
    'ps5',
    'vita',
    'psvita',
    'edition',
    'resynced',
    'remake',
    'definitive',
    'goty',
    'game',
    'of',
    'the',
    'year',
    'complete',
    'directors',
    "director's",
    'cut',
    'hd',
    'collection',
]);

// Some games have PSNProfiles trophy pages that are difficult to discover
// through the site's search endpoint. These are direct fallback pages.
//
// Format:
//   "normalized title|normalized platform": trophy page URL
//
// The Resident Evil 2 PS5 list is a known example.
const TROPHY_PAGE_OVERRIDES = {
    'resident evil 2|PS5':
        'https://psnprofiles.com/trophies/16679-resident-evil-2',
};

// Alternative search terms for games whose official/display title may not
// be indexed consistently by PSNProfiles.
//
// These are ONLY additional search queries. They do not affect comparison.
const SEARCH_ALIASES = {
    'resident evil 2': ['re2', 'resident evil 2 remake'],
    'resident evil 3': ['re3', 'resident evil 3 remake'],
    'resident evil 4': ['re4', 'resident evil 4 remake'],
    'resident evil 7 biohazard': ['re7', 'resident evil 7'],
};

// -----------------------------------------------------------------------------
// NORMALIZATION / MATCHING
// -----------------------------------------------------------------------------

function buildSearchQuery(title) {
    const words = title
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[®™©]/g, '')
        .replace(/[^a-zA-Z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter(Boolean);

    const filtered = words.filter(
        (w) => !NOISE_WORDS.has(w.toLowerCase())
    );

    return filtered.length > 0 ? filtered.join(' ') : title;
}

// Generate several search queries instead of relying on one query.
//
// Example:
//   "RESIDENT EVIL 2"
// becomes:
//   "RESIDENT EVIL 2"
//   "resident evil 2"
//   "RE2"
//   "resident evil 2 remake"
function buildSearchQueries(title) {
    const queries = [];

    const original = title.trim();
    const cleaned = buildSearchQuery(title).trim();

    if (original) queries.push(original);
    if (cleaned && cleaned.toLowerCase() !== original.toLowerCase()) {
        queries.push(cleaned);
    }

    const normalized = normalizeForCompare(title);

    if (SEARCH_ALIASES[normalized]) {
        queries.push(...SEARCH_ALIASES[normalized]);
    }

    // For numbered games, try the acronym + number.
    // Example: "Resident Evil 2" -> "RE2"
    const significantWords = normalizeForCompare(title)
        .split(' ')
        .filter((w) => w.length >= 3);

    const number = significantWords.find((w) => /^\d+$/.test(w));

    if (number && significantWords.length >= 2) {
        const acronym = significantWords
            .filter((w) => !/^\d+$/.test(w))
            .map((w) => w[0])
            .join('')
            .toUpperCase();

        if (acronym) {
            queries.push(`${acronym}${number}`);
        }
    }

    // Remove duplicate queries while preserving order.
    return [...new Set(
        queries
            .map((q) => q.trim())
            .filter(Boolean)
    )];
}

// Normalize a game name for comparison:
// lowercase, strip accents/diacritics, strip trademark symbols,
// collapse punctuation to spaces.
function normalizeForCompare(str) {
    return String(str || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[®™©]/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim()
        .replace(/\s+/g, ' ');
}

// Normalize platform string for comparison.
//
// Examples:
//   "PlayStation 4" -> "PS4"
//   "PlayStation 5" -> "PS5"
//   "ps5" -> "PS5"
function normalizePlatform(str) {
    if (!str) return '';

    return String(str)
        .toUpperCase()
        .replace(/PLAYSTATION\s*/g, 'PS')
        .replace(/\s+/g, '');
}

// Remove common edition/platform suffixes from a title for a secondary
// comparison. This helps with things like:
//
//   "The Last of Us™ Remastered"
//   "Minecraft: PlayStation®5 Edition"
//   "Avatar: Frontiers of Pandora™"
function normalizeForGameIdentity(str) {
    return normalizeForCompare(str)
        .replace(/\bplaystation\b/g, '')
        .replace(/\bps[345]\b/g, '')
        .replace(/\bvita\b/g, '')
        .replace(/\bpsvita\b/g, '')
        .replace(/\bedition\b/g, '')
        .replace(/\bremastered\b/g, '')
        .replace(/\bremaster\b/g, '')
        .replace(/\bdefinitive\b/g, '')
        .replace(/\bgoty\b/g, '')
        .replace(/\bgame\b/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Compare titles using several signals.
//
// Exact title is handled separately. This function is for ranking candidates
// when there is no exact match.
function similarityScore(target, candidateName) {
    const targetNormalized = normalizeForCompare(target);
    const candidateNormalized = normalizeForCompare(candidateName);

    const targetIdentity = normalizeForGameIdentity(target);
    const candidateIdentity = normalizeForGameIdentity(candidateName);

    // Strong bonus for exact identity after removing edition/platform noise.
    if (
        targetIdentity &&
        candidateIdentity &&
        targetIdentity === candidateIdentity
    ) {
        return 100;
    }

    const targetWords = targetIdentity
        .split(' ')
        .filter((w) => w.length >= 2);

    const candidateWords = new Set(
        candidateIdentity
            .split(' ')
            .filter((w) => w.length >= 2)
    );

    if (targetWords.length === 0) return 0;

    let score = 0;

    targetWords.forEach((word, index) => {
        if (candidateWords.has(word)) {
            // First significant word gets a larger weight, but every
            // significant word matters.
            score += index === 0 ? 5 : 3;
        }
    });

    // Bonus when the candidate contains the entire normalized target.
    if (
        targetNormalized &&
        candidateNormalized.includes(targetNormalized)
    ) {
        score += 20;
    }

    // Bonus when the target contains the candidate.
    if (
        candidateNormalized &&
        targetNormalized.includes(candidateNormalized)
    ) {
        score += 10;
    }

    return score;
}

// -----------------------------------------------------------------------------
// PSNPROFILES SEARCH
// -----------------------------------------------------------------------------

async function searchPsnProfiles(page, title) {
    const searchQueries = buildSearchQueries(title);

    console.log(
        `  Searching PSNProfiles with: ${searchQueries.join(' | ')}`
    );

    const allCandidates = [];

    for (const searchQuery of searchQueries) {
        const searchUrl =
            `https://psnprofiles.com/search/games?q=${encodeURIComponent(searchQuery)}`;

        try {
            await page.goto(searchUrl, {
                waitUntil: 'domcontentloaded',
                timeout: 30000
            });
        } catch (err) {
            console.log(
                `  Search navigation failed for "${searchQuery}": ${err.message}`
            );
            continue;
        }

        const foundResults = await page
            .waitForSelector(
                'a.title[href*="/trophies/"]',
                { timeout: 15000 }
            )
            .then(() => true)
            .catch(() => false);

        if (!foundResults) {
            continue;
        }

        const candidates = await page.evaluate(() => {
            const titleLinks = Array.from(
                document.querySelectorAll(
                    'a.title[href*="/trophies/"]'
                )
            );

            return titleLinks
                .map((a) => {
                    let row =
                        a.closest('.list-row, .game, tr, li') ||
                        a.parentElement?.parentElement ||
                        a.parentElement;

                    let platformText = null;

                    if (row) {
                        const badge = Array.from(
                            row.querySelectorAll('span, div')
                        ).find((el) =>
                            /^(PS3|PS4|PS5|VITA|PSVITA|PSVR|PSVR2|PSP|PS2)$/i.test(
                                el.innerText.trim()
                            )
                        );

                        platformText = badge
                            ? badge.innerText.trim().toUpperCase()
                            : null;
                    }

                    return {
                        name: a.innerText.trim(),
                        href: a.href,
                        platform: platformText,
                    };
                })
                .filter((r) => r.name.length > 0);
        });

        allCandidates.push(...candidates);

        // If we found an exact title during this search, there's no reason
        // to continue searching aliases.
        const targetNormalized = normalizeForCompare(title);

        const exactFound = candidates.some(
            (c) =>
                normalizeForCompare(c.name) === targetNormalized
        );

        if (exactFound) {
            break;
        }
    }

    // Deduplicate candidates by URL.
    const seen = new Set();

    return allCandidates.filter((candidate) => {
        if (seen.has(candidate.href)) {
            return false;
        }

        seen.add(candidate.href);
        return true;
    });
}

// -----------------------------------------------------------------------------
// DIRECT TROPHY PAGE FALLBACK
// -----------------------------------------------------------------------------

function getTrophyPageOverride(title, platform) {
    const key =
        `${normalizeForCompare(title)}|${normalizePlatform(platform)}`;

    return TROPHY_PAGE_OVERRIDES[key] || null;
}

// Try to find a trophy page directly when the PSNProfiles search endpoint
// doesn't return the correct game.
async function findDirectTrophyPage(page, title, platform) {
    const override = getTrophyPageOverride(title, platform);

    if (!override) {
        return null;
    }

    console.log(
        `  Using direct PSNProfiles fallback for ${title} (${platform}):`
    );
    console.log(`  ${override}`);

    try {
        await page.goto(override, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });

        // Verify that this is actually a trophy page before returning it.
        const pageInfo = await page.evaluate(() => {
            const heading =
                document.querySelector('h1')?.innerText?.trim() || '';

            const bodyText =
                document.body?.innerText?.slice(0, 5000) || '';

            return {
                heading,
                bodyText,
                url: window.location.href
            };
        });

        if (
            pageInfo.url.includes('/trophies/') &&
            (
                pageInfo.heading.length > 0 ||
                pageInfo.bodyText.toLowerCase().includes('resident evil 2')
            )
        ) {
            return override;
        }
    } catch (err) {
        console.log(
            `  Direct trophy-page fallback failed: ${err.message}`
        );
    }

    return null;
}

// -----------------------------------------------------------------------------
// GUIDE LINK EXTRACTION
// -----------------------------------------------------------------------------

async function findGuideLinkOnGamePage(page, gamePageUrl) {
    try {
        await page.goto(gamePageUrl, {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
    } catch (err) {
        console.log(
            `  Failed to open trophy page: ${err.message}`
        );
        return null;
    }

    const guideUrl = await page.evaluate(() => {
        const links = Array.from(
            document.querySelectorAll('a[href*="/guide/"]')
        );

        if (links.length === 0) {
            return null;
        }

        // Prefer the first guide link, which is normally the main guide.
        return links[0].href;
    });

    return guideUrl;
}

// -----------------------------------------------------------------------------
// MANUAL CANDIDATE SELECTION
// -----------------------------------------------------------------------------

async function chooseCandidate(game, candidates) {
    const targetNormalized = normalizeForCompare(game.title);
    const dbPlatform = normalizePlatform(game.platform);

    // -------------------------------------------------------------------------
    // 1. Exact name matches
    // -------------------------------------------------------------------------

    const exactMatches = candidates.filter(
        (candidate) =>
            normalizeForCompare(candidate.name) === targetNormalized
    );

    // Single exact match = automatic.
    if (exactMatches.length === 1) {
        const picked = exactMatches[0];

        console.log(
            `  Auto-matched: ${picked.name} — ${picked.href}`
        );

        return picked;
    }

    // Multiple exact matches = use platform.
    if (exactMatches.length > 1) {
        const platformMatches = dbPlatform
            ? exactMatches.filter(
                (candidate) =>
                    normalizePlatform(candidate.platform) === dbPlatform
            )
            : [];

        if (platformMatches.length === 1) {
            const picked = platformMatches[0];

            console.log(
                `  Auto-matched by platform (${game.platform}): ` +
                `${picked.name} — ${picked.href}`
            );

            return picked;
        }

        if (dbPlatform && platformMatches.length === 0) {
            console.log(
                `  Platform "${game.platform}" didn't match any ` +
                `candidate's badge — please confirm manually:`
            );
        } else if (platformMatches.length > 1) {
            console.log(
                `  Multiple candidates share platform ` +
                `"${game.platform}" — please confirm manually:`
            );
        } else {
            console.log(
                `  Multiple exact-name matches found ` +
                `(${exactMatches.length}) — please confirm manually:`
            );
        }

        exactMatches.forEach((candidate, index) => {
            console.log(
                `    [${index}] ${candidate.name} ` +
                `[${candidate.platform || 'unknown platform'}] ` +
                `(${candidate.href})`
            );
        });

        console.log('    [s] Skip this game');

        const choice = await ask(
            '  Pick a candidate number (or s to skip): '
        );

        if (choice.trim().toLowerCase() === 's') {
            return null;
        }

        const picked = exactMatches[parseInt(choice, 10)];

        if (!picked) {
            console.log('  Invalid choice, skipping.');
            return null;
        }

        return picked;
    }

    // -------------------------------------------------------------------------
    // 2. No exact name match
    // -------------------------------------------------------------------------

    console.log(
        '  No exact name match — calculating better candidate scores:'
    );

    const scored = candidates
        .map((candidate) => ({
            ...candidate,
            score: similarityScore(game.title, candidate.name)
        }))
        .sort((a, b) => b.score - a.score);

    // If the best candidate is an identity match after removing edition
    // noise, auto-select it.
    const identityMatches = scored.filter(
        (candidate) =>
            normalizeForGameIdentity(candidate.name) ===
            normalizeForGameIdentity(game.title)
    );

    if (identityMatches.length === 1) {
        const picked = identityMatches[0];

        // If the platform also matches, this is very safe.
        if (
            !dbPlatform ||
            !picked.platform ||
            normalizePlatform(picked.platform) === dbPlatform
        ) {
            console.log(
                `  Auto-matched by normalized title: ` +
                `${picked.name} — ${picked.href}`
            );

            return picked;
        }
    }

    const topCandidates = scored.slice(0, 8);

    topCandidates.forEach((candidate, index) => {
        console.log(
            `    [${index}] ${candidate.name} ` +
            `[${candidate.platform || 'unknown platform'}] ` +
            `(score: ${candidate.score})`
        );
    });

    console.log('    [s] Skip this game');

    const choice = await ask(
        '  Pick a candidate number (or s to skip): '
    );

    if (choice.trim().toLowerCase() === 's') {
        return null;
    }

    const picked = topCandidates[parseInt(choice, 10)];

    if (!picked) {
        console.log('  Invalid choice, skipping.');
        return null;
    }

    return picked;
}

// -----------------------------------------------------------------------------
// MAIN
// -----------------------------------------------------------------------------

async function main() {
    if (!process.env.MONGO_URI) {
        console.error(
            'MONGO_URI is not set. Check that your .env file exists ' +
            'at the project root and contains it.'
        );

        process.exit(1);
    }

    await mongoose.connect(process.env.MONGO_URI);

    console.log('Connected to MongoDB.');

    const gamesNeedingUrl = await Game.find({
        $or: [
            { guideUrl: { $exists: false } },
            { guideUrl: null },
            { guideUrl: '' }
        ]
    });

    console.log(
        `Found ${gamesNeedingUrl.length} games missing a guideUrl.\n`
    );

    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ]
    });

    const page = await browser.newPage();

    await page.setViewport({
        width: 1920,
        height: 1080
    });

    await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/115.0.0.0 Safari/537.36'
    );

    for (const game of gamesNeedingUrl) {
        console.log(
            `\n=== ${game.title} ` +
            `(platform: ${game.platform || 'unknown'}) ===`
        );

        try {
            // -----------------------------------------------------------------
            // Search PSNProfiles
            // -----------------------------------------------------------------

            let candidates = await searchPsnProfiles(
                page,
                game.title
            );

            // -----------------------------------------------------------------
            // Direct fallback for known hard-to-find trophy pages
            // -----------------------------------------------------------------

            if (candidates.length === 0) {
                const directTrophyPage =
                    await findDirectTrophyPage(
                        page,
                        game.title,
                        game.platform
                    );

                if (directTrophyPage) {
                    const guideUrl =
                        await findGuideLinkOnGamePage(
                            page,
                            directTrophyPage
                        );

                    if (!guideUrl) {
                        console.log(
                            '  No guide link found on direct trophy page. Skipping.'
                        );

                        continue;
                    }

                    await Game.updateOne(
                        { _id: game._id },
                        { $set: { guideUrl } }
                    );

                    console.log(
                        `  Saved: ${guideUrl}`
                    );

                    continue;
                }

                const safeName =
                    game.title.replace(/[^a-z0-9]+/gi, '_');

                await page
                    .screenshot({
                        path: `debug-search-${safeName}.png`,
                        fullPage: true
                    })
                    .catch(() => {});

                const html =
                    await page.content().catch(() => '');

                fs.writeFileSync(
                    `debug-search-${safeName}.html`,
                    html
                );

                console.log(
                    `  No search results found — saved ` +
                    `debug-search-${safeName}.png and .html for inspection.`
                );

                console.log(
                    '  No search results found. Skipping.'
                );

                continue;
            }

            // -----------------------------------------------------------------
            // Choose candidate
            // -----------------------------------------------------------------

            const picked = await chooseCandidate(
                game,
                candidates
            );

            if (!picked) {
                continue;
            }

            // -----------------------------------------------------------------
            // Find guide
            // -----------------------------------------------------------------

            const guideUrl =
                await findGuideLinkOnGamePage(
                    page,
                    picked.href
                );

            if (!guideUrl) {
                console.log(
                    '  No guide link found on that game page. Skipping.'
                );

                continue;
            }

            // -----------------------------------------------------------------
            // Save automatically
            // -----------------------------------------------------------------

            await Game.updateOne(
                { _id: game._id },
                { $set: { guideUrl } }
            );

            console.log(
                `  Saved: ${guideUrl}`
            );

        } catch (err) {
            console.error(
                `  Error processing ${game.title}:`,
                err.message
            );
        }
    }

    await browser.close();
    rl.close();
    await mongoose.disconnect();

    console.log('\nDone.');
}

main();