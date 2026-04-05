const cheerio = require('cheerio');
const fs = require('fs');

const BASE_URL = 'https://fmic.pl/uklad-chlodzenia/intercoolery';
const MAX_PAGES = Number.parseInt(process.env.MAX_PAGES || '0', 10); // 0 = bez limitu

async function main() {
  let page = 1;
  let allProducts = [];

  console.log('Zaczynam pobieranie list produktów...');

  // 1. Pobieranie produktów ze wszystkich stron (pętla leci aż wywali błąd lub nie znajdzie produktów)
  while (true) {
    if (MAX_PAGES > 0 && page > MAX_PAGES) {
      console.log(`Osiągnięto limit stron MAX_PAGES=${MAX_PAGES}.`);
      break;
    }

    const url = page === 1 ? BASE_URL : `${BASE_URL}?p=${page}`;
    console.log(`Pobieram stronę ${page}...`);

    try {
      const res = await fetch(url);
      if (!res.ok) break; // Koniec paginacji (np. błąd 404)
      
      const html = await res.text();
      const $ = cheerio.load(html);
      let foundOnPage = false;

      // Szukamy danych w JSON-LD (najprostsze podejście)
      $('script[type="application/ld+json"]').each((_, el) => {
        try {
          const data = JSON.parse($(el).html());
          
          if (data['@type'] === 'WebPage' && data.mainEntity?.itemListElement) {
            data.mainEntity.itemListElement.forEach(item => {
              if (item.name && item.offers?.price) {
                // Linki czasem są względne, naprawiamy to
                const prodUrl = item.offers.url.startsWith('http') 
                  ? item.offers.url 
                  : `https://fmic.pl${item.offers.url}`;

                allProducts.push({
                  name: item.name,
                  price: parseFloat(item.offers.price),
                  url: prodUrl
                });
                foundOnPage = true;
              }
            });
          }
        } catch (e) {
          // Ignorujemy błędy parsowania JSON-a
        }
      });

      if (!foundOnPage) break; // Jeśli nie dodaliśmy żadnych produktów, to koniec stron
      page++;
    } catch (e) {
      console.log('Błąd sieci:', e.message);
      break;
    }
  }

  // Szybkie usuwanie duplikatów po URL-u (studencki trik z Mapą)
  allProducts = [...new Map(allProducts.map(item => [item.url, item])).values()];
  console.log(`Znaleziono ${allProducts.length} unikalnych produktów. Zbieram wymiary...`);

  let results = [];

  // 2. Wchodzenie w każdy produkt i szukanie wymiarów (zwykła pętla for, zero async pooli)
  for (let i = 0; i < allProducts.length; i++) {
    const prod = allProducts[i];
    console.log(`Analiza [${i + 1}/${allProducts.length}]: ${prod.name}`);

    try {
      const res = await fetch(prod.url);
      const html = await res.text();

      // Prosty regex - szuka formatu "550x180x65 mm"
      const cleanHtml = html.replace(/&nbsp;/g, ' ').replace(/×/g, 'x');
      const regex = /(\d{2,4})\s*x\s*(\d{2,4})\s*x\s*(\d{2,4})\s*mm/i;
      
      const match = cleanHtml.match(regex);

      if (match) {
        const a = parseInt(match[1]);
        const b = parseInt(match[2]);
        const c = parseInt(match[3]);

        // Ignorujemy głupoty typu 1x1x1 mm
        if (a > 20 && b > 20 && c > 20) {
          const pojemnoscCm3 = (a * b * c) / 1000;
          const cenaZaCm3 = prod.price / pojemnoscCm3;

          results.push({
            ...prod,
            wymiary: `${a}x${b}x${c} mm`,
            pojemnoscCm3: pojemnoscCm3,
            cenaZaCm3: cenaZaCm3
          });
        }
      }
    } catch (e) {
      console.log(`  Błąd pobierania: ${prod.url}`);
    }
  }

  // 3. Sortowanie (od najtańszego za cm3) i zapis do pliku
  results.sort((a, b) => a.cenaZaCm3 - b.cenaZaCm3);

  // --- ZMIANY: Utworzenie folderu i zapis ---
  if (!fs.existsSync('output')) {
    fs.mkdirSync('output');
  }

  fs.writeFileSync('output/wyniki.json', JSON.stringify(results, null, 2));
  console.log('\n--- WYNIKI (zapisano do output/wyniki.json) ---');
  // ------------------------------------------

  results.forEach((r, idx) => {
    console.log(`${idx + 1}. ${r.name}`);
    console.log(`   Cena: ${r.price} PLN`);
    console.log(`   Rdzeń: ${r.wymiary} (${r.pojemnoscCm3.toFixed(2)} cm3)`);
    console.log(`   Opłacalność: ${r.cenaZaCm3.toFixed(4)} PLN/cm3`);
    console.log(`   Link: ${r.url}\n`);
  });
}

main();