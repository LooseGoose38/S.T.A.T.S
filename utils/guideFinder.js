const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

//normalizers from your original script
function normalizeForCompare(str) {
    return String(str || ''.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[®™©]/g, '').replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' '));
}

function normalizeForGameIdentity(str) {
    return normalizeForCompare(str)
        .replace(/\bplaystation\b/g, '').replace(/\bps[345]\b/g, '')
        .replace(/\bvita\b/g, '').replace(/\bpsvita\b/g, '')
        .replace(/\bedition\b/g, '').replace(/\bremastered\b/g, '')
        .replace(/\bremaster\b/g, '').replace(/\bdefinitive\b/g, '')
        .replace(/\bgoty\b/g, '').replace(/\bgame\b/g, '').replace(/\s+/g, ' ').trim();
}

function similarityScore(target, candidateName) {
    const targetIdentity = normalizeForGameIdentity(target);
    const candidateIdentity = normalizeForGameIdentity(candidateName);
    
    if (targetIdentity && candidateIdentity && targetIdentity === candidateIdentity) return 100;
    
    let score = 0;
    const targetWords = targetIdentity.split(' ').filter(w => w.length >= 2);
    const candidateWords = new Set(candidateIdentity.split(' ').filter(w => w.length >= 2));
    
    if (targetWords.length === 0) return 0;
    
    targetWords.forEach((word, index) => {
        if (candidateWords.has(word)) score += index === 0 ? 5 : 3;
    });

    if (normalizeForCompare(candidateName).includes(normalizeForCompare(target))) score += 20;
    return score;
}

// 🚨 NEW: The Automated Cloud Chooser (No terminal prompts!)
function autoChooseCandidate(gameTitle, candidates) {
    const targetNormalized = normalizeForCompare(gameTitle);
    
    // 1. Check for exact match
    const exactMatches = candidates.filter(c => normalizeForCompare(c.name) === targetNormalized);
    if (exactMatches.length > 0) return exactMatches[0];

    // 2. Fallback: Sort by similarity score and pick the absolute best one
    const scored = candidates.map(c => ({
        ...c,
        score: similarityScore(gameTitle, c.name)
    })).sort((a, b) => b.score - a.score);

    // Only return if the score is somewhat decent to prevent bad matches
    if (scored.length > 0 && scored[0].score > 5) {
        return scored[0];
    }
    
    return null;
}

async function findGameGuideUrl(gameTitle) {
    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        const searchUrl = `https://psnprofiles.com/search/games?q=${encodeURIComponent(gameTitle)}`;
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

        const candidates = await page.evaluate(() => {
            return Array.from(document.querySelectorAll('a.title[href*="/trophies/"]'))
                .map(a => ({ name: a.innerText.trim(), href: a.href }))
                .filter(r => r.name.length > 0);
        });

        if (candidates.length === 0) {
            await browser.close();
            return null;
        }

        const bestMatch = autoChooseCandidate(gameTitle, candidates);
        if (!bestMatch) {
            await browser.close();
            return null;
        }

        // Navigate to the chosen game page to find the actual guide link
        await page.goto(bestMatch.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        const guideUrl = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="/guide/"]'));
            return links.length > 0 ? links[0].href : null;
        });

        await browser.close();
        return guideUrl;

    } catch (err) {
        console.error(`Auto-resolver failed for ${gameTitle}:`, err);
        await browser.close();
        return null;
    }
}

module.exports = { findGameGuideUrl };