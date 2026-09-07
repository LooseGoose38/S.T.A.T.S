// --- utils/scraper.js ---
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

puppeteer.use(StealthPlugin());

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; 
const guideCache = new Map(); 

// Standardize names into slugs so we can cache every trophy flawlessly
function slugify(str) {
    return str
        .toLowerCase()
        .normalize('NFKD')                      
        .replace(/[\u2018\u2019\u201B']/g, '')   
        .replace(/[^a-z0-9]+/g, '-')             
        .replace(/^-+|-+$/g, '')                 
        .replace(/-+/g, '-');                    
}

function getCacheKey(targetUrl, targetTrophy) {
    return `${targetUrl}::${slugify(targetTrophy)}`;
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
        console.log(`RAM Cache hit for: ${targetTrophy} — skipping browser launch.`);
        return cached;
    }

    console.log(`Cache miss. Launching stealth browser for: ${targetTrophy}...`);

    const browser = await puppeteer.launch({
        headless: true,
        args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--no-zygote', 
            '--disable-features=IsolateOrigins,site-per-process' 
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });
    
    // Updated User Agent to Chrome 127 so Cloudflare is less suspicious
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36');

    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const resourceType = req.resourceType();
        const url = req.url();

        if (resourceType === 'media') {
            req.abort();
        } else if (resourceType === 'image') {
            if (url.includes('cdn-cgi') || url.includes('cloudflare')) {
                req.continue(); 
            } else {
                req.abort(); 
            }
        } else {
            req.continue();
        }
    });

    try {
        console.log(`Navigating to: ${targetUrl}`);
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 90000 });

        console.log('Waiting for Cloudflare check and guide rendering...');
        await page.waitForSelector('.fr-view', { timeout: 60000 });

        console.log('Page loaded! Extracting EVERY trophy on the page at once...');

        //Extract and map all trophies in one sweep
        const allTrophiesData = await page.evaluate(() => {
            const results = {};
            
            const allAnchoredEls = Array.from(document.querySelectorAll('[id]')).filter(el => /^\d+-/.test(el.id));

            allAnchoredEls.forEach(container => {
                const slug = container.id.replace(/^\d+-/, '');

                let targetContent = container.querySelector('.fr-view');
                if (!targetContent) {
                    targetContent = container.cloneNode(true);
                    targetContent.querySelectorAll(
                        '.sidebar, .side-panel, nav, table.roadmap, .breadcrumb, .comments, .comment-section, .section-tags'
                    ).forEach(el => el.remove());
                }

                const images = targetContent.querySelectorAll('img');
                images.forEach(img => {
                    const parentLink = img.closest('a');
                    if (parentLink && parentLink.href && parentLink.href.match(/\.(jpeg|jpg|gif|png)$/i)) {
                        img.src = parentLink.href; 
                    }
                    img.removeAttribute('width');
                    img.removeAttribute('height');
                });

                const links = targetContent.querySelectorAll('a');
                links.forEach(a => {
                    if (a.innerText.trim().toLowerCase() === 'loading...') a.remove();
                });

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

                const allImages = targetContent.querySelectorAll('img');
                allImages.forEach(img => {
                    const src = img.getAttribute('src');
                    if (src && src.startsWith('/')) {
                        img.src = `https://psnprofiles.com${src}`;
                    }
                });

                results[slug] = targetContent.innerHTML;
            });

            return results;
        });

        console.log(`Successfully scraped ${Object.keys(allTrophiesData).length} guides! Caching to RAM...`);

        // Save EVERY extracted guide into our Node.js RAM cache
        for (const [slug, html] of Object.entries(allTrophiesData)) {
            setCache(`${targetUrl}::${slug}`, html);
        }

        // Return the specific one the user originally asked for
        const requestedSlug = slugify(targetTrophy);
        let finalHtml = allTrophiesData[requestedSlug];

        if (!finalHtml) {
            const matchedKey = Object.keys(allTrophiesData).find(k => k.includes(requestedSlug) || requestedSlug.includes(k));
            if (matchedKey) finalHtml = allTrophiesData[matchedKey];
        }

        if (!finalHtml) {
            return '<p style="color: #ef4444;">Guide details coming soon or not found on page.</p>';
        }

        return finalHtml;

    } catch (error) {
        console.error('\nScraping failed:', error.message);
        return '<p style="color: #ef4444;">Error loading guide.</p>';
    } finally {
        console.log('Closing browser...');
        await browser.close();
    }
}

module.exports = { scrapeTrophyGuide, clearGuideCache };