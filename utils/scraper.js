// --- utils/scraper.js ---
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

// Activate the stealth plugin to hide our bot signature from Cloudflare
puppeteer.use(StealthPlugin());

// --- Simple in-memory cache ---
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const guideCache = new Map(); // key -> { html, expiresAt }

function getCacheKey(targetUrl, targetTrophy) {
    return `${targetUrl}::${targetTrophy}`;
}

function getFromCache(key) {
    const entry = guideCache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
        guideCache.delete(key); 
        return null;
    }

    return entry.html;
}

function setCache(key, html) {
    guideCache.set(key, {
        html,
        expiresAt: Date.now() + CACHE_TTL_MS,
    });
}

function clearGuideCache() {
    guideCache.clear();
}

async function scrapeTrophyGuide(targetUrl, targetTrophy) {
    const cacheKey = getCacheKey(targetUrl, targetTrophy);

    const cached = getFromCache(cacheKey);
    if (cached) {
        console.log(`Cache hit for: ${targetTrophy} — skipping browser launch.`);
        return cached;
    }

    console.log(`Cache miss. Launching stealth browser for: ${targetTrophy}...`);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36');

    try {
        console.log(`Navigating to: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 60000 });

        const result = await page.evaluate((trophyName) => {
            
            function slugify(str) {
                return str
                    .toLowerCase()
                    .normalize('NFKD')                      
                    .replace(/[\u2018\u2019\u201B']/g, '')   
                    .replace(/[^a-z0-9]+/g, '-')             
                    .replace(/^-+|-+$/g, '')                 
                    .replace(/-+/g, '-');                    
            }

            const targetSlug = slugify(trophyName);

            const allAnchoredEls = Array.from(document.querySelectorAll('[id]'))
                .filter(el => /^\d+-/.test(el.id));

            const availableSlugs = allAnchoredEls.map(el => el.id);

            let container = allAnchoredEls.find(el => {
                const idSlug = el.id.replace(/^\d+-/, '');
                return idSlug === targetSlug;
            });

            if (!container) {
                container = allAnchoredEls.find(el => {
                    const idSlug = el.id.replace(/^\d+-/, '');
                    return idSlug.includes(targetSlug) || targetSlug.includes(idSlug);
                });
            }

            const debugInfo = {
                found: !!container,
                searchedFor: trophyName,
                targetSlug,
                matchedId: container ? container.id : null,
                totalAnchorsFound: allAnchoredEls.length,
                availableSlugs,
            };

            if (!container) {
                return {
                    html: '<p style="color: #ef4444;">Guide details coming soon or not found on page.</p>',
                    debug: debugInfo,
                };
            }

            let targetContent = container.querySelector('.fr-view');
            
            if (!targetContent) {
                targetContent = container.cloneNode(true);
                targetContent.querySelectorAll(
                    '.sidebar, .side-panel, nav, table.roadmap, .breadcrumb, .comments, .comment-section, .section-tags'
                ).forEach(el => el.remove());
            }

            // --- DOM CLEANUP SCRIPT ---
            
            // Fix 1: Swap tiny thumbnails for full-resolution images
            const images = targetContent.querySelectorAll('img');
            images.forEach(img => {
                const parentLink = img.closest('a');
                if (parentLink && parentLink.href && parentLink.href.match(/\.(jpeg|jpg|gif|png)$/i)) {
                    img.src = parentLink.href; 
                }
                img.removeAttribute('width');
                img.removeAttribute('height');
            });

            // Fix 2: Nuke the "Loading..." YouTube fallback links
            const links = targetContent.querySelectorAll('a');
            links.forEach(a => {
                if (a.innerText.trim().toLowerCase() === 'loading...') {
                    a.remove();
                }
            });

            // Fix 3: Convert lazy-loaded YouTube divs into playable iframes
            const lazyYTs = targetContent.querySelectorAll('.lazyYT');
            lazyYTs.forEach(yt => {
                const videoId = yt.getAttribute('data-youtube-id');
                if (videoId) {
                    const iframe = document.createElement('iframe');
                    iframe.src = `https://www.youtube.com/embed/${videoId}`;
                    iframe.setAttribute('allowfullscreen', 'true');
                    iframe.setAttribute('frameborder', '0');
                    yt.parentNode.replaceChild(iframe, yt);
                }
            });

            // Fix 4: Convert relative image paths (like PSNProfiles' inline trophy icons) into absolute URLs
            const allImages = targetContent.querySelectorAll('img');
            allImages.forEach(img => {
                const src = img.getAttribute('src');
                if (src && src.startsWith('/')) {
                    img.src = `https://psnprofiles.com${src}`;
                }
            });

            // --------------------------

            return { html: targetContent.innerHTML, debug: debugInfo };

        }, targetTrophy);

        if (!result.debug.found) {
            console.log('Scrape debug (no match):', result.debug);
        } else {
            console.log(`Matched: ${result.debug.matchedId}`);
        }

        setCache(cacheKey, result.html);
        return result.html;

    } catch (error) {
        console.error('\nScraping failed:', error.message);
        return '<p style="color: #ef4444;">Error loading guide.</p>';
    } finally {
        console.log('Closing browser...');
        await browser.close();
    }
}

module.exports = { scrapeTrophyGuide, clearGuideCache };