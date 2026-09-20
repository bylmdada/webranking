const sites = [
  {
    name: 'changfu',
    baseUrl: 'https://www.changfu.me',
    sitemapUrl: 'https://www.changfu.me/sitemap.xml',
    // Enable only individual JobPosting or supported livestream pages after validation.
    indexingApiPaths: [],
    pages: [
      '/',
      '/about.html',
      '/services.html',
      '/news.html',
      '/courses.html',
      '/jobs.html',
      '/contact.html',
    ],
    keywords: [
      '宜蘭長照',
      '宜蘭長期照護',
      '長照協會 宜蘭',
      '冬山日照中心',
      '失智據點 宜蘭',
      '樂智據點 宜蘭',
      '輔具資源 宜蘭',
      '宜蘭縣長期照護協會',
      '長照服務 冬山',
      '宜蘭社會福祉',
      'changfu.me',
    ],
  },
  {
    name: 'kingkitchen',
    baseUrl: 'https://kingkitchen.changfu.me',
    sitemapUrl: 'https://kingkitchen.changfu.me/sitemap.xml',
    // General business pages are not eligible for Google's Indexing API.
    indexingApiPaths: [],
    pages: [
      '/',
      '/about',
      '/services',
      '/services/kitchen',
      '/services/ventilation',
      '/services/hvac',
      '/services/drainage',
      '/process',
      '/projects',
      '/projects/suao-lungteh-industrial-kitchen',
      '/projects/jiaoxi-mu-en-hotel-central-kitchen',
      '/projects/yuanshan-ba-jia-restaurant-ventilation',
      '/projects/wujie-kindergarten-school-kitchen',
      '/projects/yilan-hutong-yakiniku-ventilation',
      '/projects/wujie-lai-lai-steak-ventilation',
      '/contact',
    ],
    keywords: [
      '宜蘭廚房設備',
      '商業廚房工程',
      '排煙工程 宜蘭',
      '不鏽鋼廚房設備',
      '皇廚企業社',
      '蘇澳廚房設備',
      '油水分離槽',
      '商業廚房設備安裝',
      '宜蘭排煙系統',
      '廚房冷氣風管 宜蘭',
      'kingkitchen.changfu.me',
    ],
  },
];

function getSites(extraUrls = require('../targets.json')) {
  const { toAbsoluteUrl } = require('./url-resolver');
  if (!Array.isArray(extraUrls)) throw new Error('targets.json must contain a URL array');
  const result = sites.map((site) => ({ ...site, pages: [...site.pages] }));
  for (const value of extraUrls) {
    if (typeof value !== 'string') throw new Error('Target URL must be a string');
    const url = new URL(value);
    const normalized = toAbsoluteUrl(url.origin, value);
    let site = result.find((entry) => new URL(entry.baseUrl).origin === url.origin);
    if (!site) {
      site = { name: url.host, baseUrl: url.origin, sitemapUrl: `${url.origin}/sitemap.xml`, pages: [], keywords: [], indexingApiPaths: [] };
      result.push(site);
    }
    site.pages.push(new URL(normalized).pathname + new URL(normalized).search);
    site.pages = [...new Set(site.pages)];
  }
  return result;
}

module.exports = { sites, getSites };
