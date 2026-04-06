const { chromium } = require('playwright');
const { isDryRun } = require('./app-options');
const { getRuntimeProfile } = require('./runtime-config');
const { getRandomUA, randomDelay, pickRandom, smoothScroll, simulateReading, log } = require('./utils');

const runtime = getRuntimeProfile();

async function visitSite(site) {
  const { userAgent, viewport } = getRandomUA();
  const pagesToVisit = pickRandom(site.pages, Math.floor(Math.random() * 3) + 1);

  log('visit', `Starting visit to ${site.name} (${pagesToVisit.length} pages)`, { userAgent: userAgent.slice(0, 60) + '...' });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent,
    viewport,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
  });

  const page = await context.newPage();

  try {
    for (const pagePath of pagesToVisit) {
      const url = `${site.baseUrl}${pagePath}`;
      log('visit', `Navigating to ${url}`);

      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await randomDelay(2000, 4000);

      // Simulate reading the page
      const readingTime = Math.floor(Math.random() * (runtime.visitReadingMaxMs - runtime.visitReadingMinMs + 1)) + runtime.visitReadingMinMs;
      await simulateReading(page, readingTime);

      // Try clicking an internal link
      if (Math.random() < 0.5) {
        try {
          const links = await page.$$eval(
            `a[href^="/"], a[href^="${site.baseUrl}"]`,
            (els) => els.map((el) => el.getAttribute('href')).filter(Boolean)
          );
          if (links.length > 0) {
            const randomLink = links[Math.floor(Math.random() * links.length)];
            log('visit', `Clicking internal link: ${randomLink}`);
            await page.click(`a[href="${randomLink}"]`);
            await randomDelay(3000, 8000);
            await smoothScroll(page);
          }
        } catch (e) {
          log('visit', `Could not click internal link: ${e.message}`);
        }
      }

      // Wait between pages
      await randomDelay(2000, 5000);
    }

    log('visit', `Completed visit to ${site.name}`);
  } catch (error) {
    log('visit', `Error visiting ${site.name}: ${error.message}`);
  } finally {
    await browser.close();
  }
}

async function runVisits(sites) {
  const dryRun = isDryRun();
  log('visit', `Starting direct visits for ${sites.length} sites${dryRun ? ' (dry-run)' : ''}`);

  if (dryRun) {
    for (const site of sites) {
      log('visit', `${site.name}: dry-run pages => ${site.pages.join(', ')}`);
    }
    log('visit', 'Dry-run completed');
    return;
  }

  for (const site of sites) {
    await visitSite(site);
    // Gap between sites
    await randomDelay(runtime.siteGapMinMs, runtime.siteGapMaxMs);
  }

  log('visit', 'All direct visits completed');
}

module.exports = { runVisits };
