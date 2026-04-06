const { chromium } = require('playwright');
const { isDryRun } = require('./app-options');
const { getRuntimeProfile } = require('./runtime-config');
const { getRandomUA, randomDelay, pickRandom, humanType, smoothScroll, simulateReading, log } = require('./utils');

const runtime = getRuntimeProfile();

async function searchAndClick(site, keyword) {
  const { userAgent, viewport } = getRandomUA();

  log('search', `Searching for "${keyword}" targeting ${site.name}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent,
    viewport,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
  });

  const page = await context.newPage();

  try {
    // Go to Google
    await page.goto('https://www.google.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(1500, 3000);

    // Handle cookie consent if present
    try {
      const acceptBtn = await page.$('button:has-text("Accept all"), button:has-text("全部接受"), button:has-text("同意")');
      if (acceptBtn) {
        await acceptBtn.click();
        await randomDelay(1000, 2000);
      }
    } catch (e) {
      // No consent dialog
    }

    // Type search query
    const searchInput = 'textarea[name="q"], input[name="q"]';
    await page.waitForSelector(searchInput, { timeout: 10000 });
    await humanType(page, searchInput, keyword);
    await randomDelay(500, 1500);

    // Press Enter
    await page.keyboard.press('Enter');
    await page.waitForLoadState('domcontentloaded');
    await randomDelay(2000, 4000);

    // Search through result pages (up to 3 pages)
    let found = false;
    for (let pageNum = 0; pageNum < 3 && !found; pageNum++) {
      log('search', `Scanning results page ${pageNum + 1}`);

      // Scroll through results naturally
      await smoothScroll(page);
      await randomDelay(1000, 3000);

      // Look for our site in results
      const targetDomain = new URL(site.baseUrl).hostname;
      const resultLinks = await page.$$('a');

      for (const link of resultLinks) {
        const href = await link.getAttribute('href').catch(() => null);
        if (href && href.includes(targetDomain)) {
          log('search', `Found ${site.name} in results! Clicking...`);

          await link.click();
          await page.waitForLoadState('domcontentloaded').catch(() => {});
          await randomDelay(3000, 5000);

          // Simulate reading the page
          const readingTime = Math.floor(Math.random() * (runtime.searchReadingMaxMs - runtime.searchReadingMinMs + 1)) + runtime.searchReadingMinMs;
          await simulateReading(page, readingTime);

          found = true;
          break;
        }
      }

      if (!found && pageNum < 2) {
        // Try to go to next page
        try {
          const nextBtn = await page.$('a#pnnext, a[aria-label="Next"], a:has-text("下一頁")');
          if (nextBtn) {
            await nextBtn.click();
            await page.waitForLoadState('domcontentloaded');
            await randomDelay(2000, 4000);
          } else {
            log('search', 'No more result pages');
            break;
          }
        } catch (e) {
          log('search', 'Could not navigate to next page');
          break;
        }
      }
    }

    if (!found) {
      log('search', `${site.name} not found in results for "${keyword}"`);
    }
  } catch (error) {
    log('search', `Error during search: ${error.message}`);
  } finally {
    await browser.close();
  }
}

async function runSearches(sites) {
  const dryRun = isDryRun();
  log('search', `Starting Google search simulations${dryRun ? ' (dry-run)' : ''}`);

  if (dryRun) {
    for (const site of sites) {
      log('search', `${site.name}: dry-run keywords => ${site.keywords.join(', ')}`);
    }
    log('search', 'Dry-run completed');
    return;
  }

  for (const site of sites) {
    // Pick 1-2 random keywords per site per run
    const keywords = pickRandom(site.keywords, Math.floor(Math.random() * 2) + 1);

    for (const keyword of keywords) {
      await searchAndClick(site, keyword);
      // Long gap between searches to avoid rate limiting
      await randomDelay(runtime.searchGapMinMs, runtime.searchGapMaxMs);
    }
  }

  log('search', 'All Google searches completed');
}

module.exports = { runSearches };
