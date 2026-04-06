const USER_AGENTS = [
  // Chrome on Windows
  { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', viewport: { width: 1920, height: 1080 } },
  { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', viewport: { width: 1536, height: 864 } },
  { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36', viewport: { width: 1366, height: 768 } },
  // Edge on Windows (Chromium)
  { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0', viewport: { width: 1920, height: 1080 } },
  // Chrome on macOS
  { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', viewport: { width: 1440, height: 900 } },
  { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36', viewport: { width: 1680, height: 1050 } },
  // Edge on macOS (Chromium)
  { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0', viewport: { width: 1512, height: 982 } },
  // Chrome on Android (mobile)
  { ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', viewport: { width: 412, height: 915 } },
  { ua: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36', viewport: { width: 360, height: 780 } },
  // Chrome on Android tablets
  { ua: 'Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36', viewport: { width: 1280, height: 800 } },
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomDelay(minMs, maxMs) {
  return new Promise((resolve) => setTimeout(resolve, randomInt(minMs, maxMs)));
}

function getRandomUA() {
  const profile = USER_AGENTS[randomInt(0, USER_AGENTS.length - 1)];
  // Add slight viewport variation
  return {
    userAgent: profile.ua,
    viewport: {
      width: profile.viewport.width + randomInt(-20, 20),
      height: profile.viewport.height + randomInt(-20, 20),
    },
  };
}

function pickRandom(arr, count = 1) {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, arr.length));
}

async function smoothScroll(page) {
  const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
  const viewportHeight = await page.evaluate(() => window.innerHeight);
  let currentPos = 0;

  while (currentPos < scrollHeight - viewportHeight) {
    const scrollAmount = randomInt(100, 400);
    currentPos += scrollAmount;
    await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), currentPos);
    await randomDelay(800, 2500);

    // Occasionally scroll back up a bit
    if (Math.random() < 0.15) {
      const backAmount = randomInt(50, 150);
      currentPos = Math.max(0, currentPos - backAmount);
      await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), currentPos);
      await randomDelay(500, 1500);
    }
  }
}

async function randomMouseMove(page) {
  const viewport = page.viewportSize();
  if (!viewport) return;
  const moves = randomInt(2, 5);
  for (let i = 0; i < moves; i++) {
    const x = randomInt(50, viewport.width - 50);
    const y = randomInt(50, viewport.height - 50);
    await page.mouse.move(x, y, { steps: randomInt(5, 15) });
    await randomDelay(200, 800);
  }
}

async function humanType(page, selector, text) {
  await page.click(selector);
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomInt(50, 200) });
    // Occasional longer pause (thinking)
    if (Math.random() < 0.05) {
      await randomDelay(300, 800);
    }
  }
}

async function simulateReading(page, durationMs) {
  const start = Date.now();
  while (Date.now() - start < durationMs) {
    await randomMouseMove(page);
    await randomDelay(2000, 5000);
    // Scroll a bit
    const scrollAmount = randomInt(50, 250);
    await page.evaluate((y) => window.scrollBy({ top: y, behavior: 'smooth' }), scrollAmount);
    await randomDelay(1000, 3000);
  }
}

function log(module, message, data) {
  const timestamp = new Date().toISOString();
  const prefix = `[${timestamp}] [${module}]`;
  if (data) {
    console.log(`${prefix} ${message}`, data);
  } else {
    console.log(`${prefix} ${message}`);
  }
}

module.exports = {
  randomInt,
  randomDelay,
  getRandomUA,
  pickRandom,
  smoothScroll,
  randomMouseMove,
  humanType,
  simulateReading,
  log,
};
