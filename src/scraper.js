const cheerio = require('cheerio');
const fs = require('node:fs/promises');
const path = require('node:path');

const BASE_CATEGORY_URL = 'https://fmic.pl/uklad-chlodzenia/intercoolery';
const REQUEST_DELAY_MS = 150;
const MAX_PAGES = Number.parseInt(process.env.MAX_PAGES || '0', 10); // 0 = all pages
const CONCURRENCY = Number.parseInt(process.env.CONCURRENCY || '6', 10);
const RETRIES = Number.parseInt(process.env.RETRIES || '4', 10);
const RETRY_BASE_DELAY_MS = Number.parseInt(process.env.RETRY_BASE_DELAY_MS || '800', 10);
const NO_NEW_PAGES_TO_STOP = Number.parseInt(process.env.NO_NEW_PAGES_TO_STOP || '2', 10);
const HARD_PAGE_CAP = Number.parseInt(process.env.HARD_PAGE_CAP || '500', 10);
const OUTPUT_FILE = process.env.OUTPUT_FILE || 'output/intercooler-value-ranking.json';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url) {
  let lastError = null;

  for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; IntercoolerScraper/1.0)',
          'Accept-Language': 'pl-PL,pl;q=0.9,en;q=0.8'
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} for ${url}`);
      }

      return response.text();
    } catch (error) {
      lastError = error;

      if (attempt >= RETRIES) {
        break;
      }

      const delayMs = RETRY_BASE_DELAY_MS * (2 ** attempt);
      process.stdout.write(
        `  Retry ${attempt + 1}/${RETRIES} for ${url} in ${delayMs}ms (${error.message})\n`
      );
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function normalizeUrl(url) {
  if (!url) {
    return null;
  }

  if (url.startsWith('http')) {
    return url;
  }

  return new URL(url, 'https://fmic.pl').toString();
}

function parseJsonLdBlocks(html) {
  const $ = cheerio.load(html);
  const blocks = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      blocks.push(parsed);
    } catch {
      // Ignore malformed JSON-LD chunks.
    }
  });

  return blocks;
}

function extractProductsFromCategory(html) {
  const blocks = parseJsonLdBlocks(html);

  const allBlocks = [];
  for (const block of blocks) {
    if (Array.isArray(block)) {
      allBlocks.push(...block);
    } else {
      allBlocks.push(block);
    }
  }

  const offerCatalog = allBlocks.find(
    (b) => b && (b['@type'] === 'WebPage') && b.mainEntity && b.mainEntity['@type'] === 'OfferCatalog'
  );

  if (!offerCatalog || !offerCatalog.mainEntity || !Array.isArray(offerCatalog.mainEntity.itemListElement)) {
    return [];
  }

  return offerCatalog.mainEntity.itemListElement
    .map((item) => {
      const offer = item.offers || {};
      const rawPrice = offer.price;
      const price = Number.parseFloat(String(rawPrice));
      const url = normalizeUrl(offer.url);

      if (!item.name || Number.isNaN(price) || !url) {
        return null;
      }

      return {
        name: item.name.trim(),
        price,
        url
      };
    })
    .filter(Boolean);
}

function extractMaxPageFromCategory(html) {
  const $ = cheerio.load(html);
  let maxPage = 1;

  $('a[href*="?p="]').each((_, el) => {
    const href = $(el).attr('href') || '';
    const match = href.match(/[?&]p=(\d+)/i);
    if (!match) {
      return;
    }

    const pageNumber = Number.parseInt(match[1], 10);
    if (!Number.isNaN(pageNumber) && pageNumber > maxPage) {
      maxPage = pageNumber;
    }
  });

  return maxPage;
}

function uniqueByUrl(products) {
  const seen = new Set();
  const result = [];

  for (const product of products) {
    if (seen.has(product.url)) {
      continue;
    }
    seen.add(product.url);
    result.push(product);
  }

  return result;
}

function findDimensionCandidates(text) {
  if (!text) {
    return [];
  }

  const normalized = text
    .replace(/&nbsp;/gi, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/×/g, 'x');

  const regex = /(\d{2,4})\s*[x]\s*(\d{2,4})\s*[x]\s*(\d{2,4})\s*mm/gi;
  const candidates = [];
  let match;

  while ((match = regex.exec(normalized)) !== null) {
    const a = Number.parseInt(match[1], 10);
    const b = Number.parseInt(match[2], 10);
    const c = Number.parseInt(match[3], 10);

    if (Number.isNaN(a) || Number.isNaN(b) || Number.isNaN(c)) {
      continue;
    }

    // Filter clearly unrealistic dimension triples.
    if (a < 40 || b < 40 || c < 20) {
      continue;
    }

    const start = Math.max(0, match.index - 80);
    const end = Math.min(normalized.length, regex.lastIndex + 80);
    const context = normalized.slice(start, end).toLowerCase();

    let score = 0;
    if (/(rdzen|rdzeń|core)/.test(context)) {
      score += 5;
    }
    if (/(wymiar|wymiary)/.test(context)) {
      score += 2;
    }

    candidates.push({
      dims: [a, b, c],
      score,
      index: match.index
    });
  }

  return candidates;
}

function pickBestDimensions(candidates) {
  if (!candidates.length) {
    return null;
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    return left.index - right.index;
  });

  return candidates[0].dims;
}

function extractCoreDimensions(html) {
  const $ = cheerio.load(html);

  const haystacks = [];

  const title = $('title').text();
  if (title) {
    haystacks.push(title);
  }

  const ogDescription = $('meta[property="og:description"]').attr('content');
  if (ogDescription) {
    haystacks.push(ogDescription);
  }

  const bodyText = $('body').text();
  if (bodyText) {
    haystacks.push(bodyText);
  }

  for (const block of parseJsonLdBlocks(html)) {
    try {
      haystacks.push(JSON.stringify(block));
    } catch {
      // Ignore non-serializable data.
    }
  }

  const allCandidates = [];
  for (const text of haystacks) {
    allCandidates.push(...findDimensionCandidates(text));
  }

  return pickBestDimensions(allCandidates);
}

async function scrapeCategoryProducts() {
  let page = 1;
  const products = [];
  const seenUrls = new Set();
  let pagesWithoutNewProducts = 0;
  let detectedMaxPages = null;

  while (true) {
    if (page > HARD_PAGE_CAP) {
      process.stdout.write(`Reached hard page cap (${HARD_PAGE_CAP}), stopping pagination.\n`);
      break;
    }

    if (MAX_PAGES > 0 && page > MAX_PAGES) {
      break;
    }

    const pageUrl = page === 1 ? BASE_CATEGORY_URL : `${BASE_CATEGORY_URL}?p=${page}`;
    process.stdout.write(`Fetching list page ${page}: ${pageUrl}\n`);

    let html;
    try {
      html = await fetchHtml(pageUrl);
    } catch (error) {
      process.stdout.write(`Stopped at page ${page} (${error.message})\n`);
      break;
    }

    const pageProducts = extractProductsFromCategory(html);

    if (page === 1) {
      detectedMaxPages = extractMaxPageFromCategory(html);
      process.stdout.write(`Detected max category page from pagination: ${detectedMaxPages}\n`);
    }

    if (!pageProducts.length) {
      process.stdout.write(`No products on page ${page}, stopping pagination.\n`);
      break;
    }

    let newProductsOnPage = 0;
    for (const product of pageProducts) {
      if (seenUrls.has(product.url)) {
        continue;
      }

      seenUrls.add(product.url);
      products.push(product);
      newProductsOnPage += 1;
    }

    if (newProductsOnPage === 0) {
      pagesWithoutNewProducts += 1;
      process.stdout.write(
        `No new products on page ${page} (${pagesWithoutNewProducts}/${NO_NEW_PAGES_TO_STOP}).\n`
      );
    } else {
      pagesWithoutNewProducts = 0;
    }

    if (pagesWithoutNewProducts >= NO_NEW_PAGES_TO_STOP) {
      process.stdout.write(
        `Stopping pagination after ${NO_NEW_PAGES_TO_STOP} consecutive pages without new products.\n`
      );
      break;
    }

    if (detectedMaxPages !== null && page >= detectedMaxPages) {
      process.stdout.write(`Reached detected last page (${detectedMaxPages}), stopping pagination.\n`);
      break;
    }

    page += 1;
    await sleep(REQUEST_DELAY_MS);
  }

  return {
    products,
    detectedMaxPages
  };
}

async function runPool(items, worker, concurrency) {
  const results = new Array(items.length);
  let cursor = 0;

  async function runner() {
    while (true) {
      const index = cursor;
      cursor += 1;

      if (index >= items.length) {
        return;
      }

      results[index] = await worker(items[index], index);
      await sleep(REQUEST_DELAY_MS);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => runner());
  await Promise.all(workers);

  return results;
}

function formatCurrency(value) {
  return `${value.toFixed(2)} PLN`;
}

function formatResultRow(item, rank) {
  const dims = `${item.dimensionsMm[0]}x${item.dimensionsMm[1]}x${item.dimensionsMm[2]} mm`;
  return [
    `${String(rank).padStart(3, ' ')}. ${item.name}`,
    `     price: ${formatCurrency(item.price)}`,
    `     core:  ${dims} (${item.volumeCm3.toFixed(2)} cm^3)`,
    `     unit:  ${item.unitPrice.toFixed(6)} PLN/cm^3`,
    `     url:   ${item.url}`
  ].join('\n');
}

async function saveResultsJson(payload) {
  const targetPath = path.resolve(process.cwd(), OUTPUT_FILE);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return targetPath;
}

async function main() {
  const { products, detectedMaxPages } = await scrapeCategoryProducts();
  process.stdout.write(`Collected ${products.length} unique products from category pages.\n`);

  if (!products.length) {
    process.stdout.write('No products found.\n');
    return;
  }

  const enriched = await runPool(
    products,
    async (product, index) => {
      process.stdout.write(`Analyzing product ${index + 1}/${products.length}: ${product.name}\n`);

      try {
        const html = await fetchHtml(product.url);
        const dims = extractCoreDimensions(html);

        if (!dims) {
          return null;
        }

        const volumeCm3 = (dims[0] * dims[1] * dims[2]) / 1000;
        if (volumeCm3 <= 0) {
          return null;
        }

        const unitPrice = product.price / volumeCm3;

        return {
          ...product,
          dimensionsMm: dims,
          volumeCm3,
          unitPrice
        };
      } catch (error) {
        process.stdout.write(`  Skipped (${error.message})\n`);
        return null;
      }
    },
    CONCURRENCY
  );

  const ranked = enriched
    .filter(Boolean)
    .sort((left, right) => left.unitPrice - right.unitPrice);

  const payload = {
    generatedAt: new Date().toISOString(),
    sourceUrl: BASE_CATEGORY_URL,
    settings: {
      maxPages: MAX_PAGES,
      concurrency: CONCURRENCY,
      requestDelayMs: REQUEST_DELAY_MS,
      retries: RETRIES,
      retryBaseDelayMs: RETRY_BASE_DELAY_MS,
      noNewPagesToStop: NO_NEW_PAGES_TO_STOP,
      hardPageCap: HARD_PAGE_CAP,
      detectedMaxPages
    },
    totals: {
      categoryProducts: products.length,
      rankedProducts: ranked.length
    },
    ranked
  };

  const outputPath = await saveResultsJson(payload);
  process.stdout.write(`Saved JSON results to: ${outputPath}\n`);

  process.stdout.write('\n=== Intercooler value ranking (lower PLN/cm^3 is better) ===\n\n');

  if (!ranked.length) {
    process.stdout.write('No products with detected 3D core dimensions were found.\n');
    return;
  }

  ranked.forEach((item, idx) => {
    process.stdout.write(`${formatResultRow(item, idx + 1)}\n\n`);
  });

  process.stdout.write(`Products with computed unit value: ${ranked.length}/${products.length}\n`);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
