const cheerio = require('cheerio'); 
const fs = require('fs'); 

const BASE_URL = 'https://fmic.pl/uklad-chlodzenia/intercoolery'; 
const MAX_PAGES = Number.parseInt(process.env.MAX_PAGES || '0', 10); //0 oznacza brak limitu

async function main() { 
  let page = 1; 
  let allProducts = []; 

  console.log('pobieranie listy produktów'); 

  while (true) { 
    if (MAX_PAGES > 0 && page > MAX_PAGES) { //do limitu
      console.log(`Osiągnięto limit stron MAX_PAGES=${MAX_PAGES}.`); 
      break; 
    }

    const url = page === 1 ? BASE_URL : `${BASE_URL}?p=${page}`; // Strona 1 ma inny URL niz kolejne - nie pokazuje numeru
    console.log(`Pobieram stronę ${page}...`); 

    try { 
      const res = await fetch(url); // Wysyla zapytanie HTTP GET
      if (!res.ok) break; // Jesli status HTTP nie ok - koniec
      
      const html = await res.text(); // Odczytuje odpowiedz jako tekst HTML
      const $ = cheerio.load(html); // Laduje HTML do Cheerio
      let foundOnPage = false; 

      // produktu sa zapisane w plikach JSON-LD w tagach <script type="application/ld+json"> 
      $('script[type="application/ld+json"]').each((_, el) => { // Iteracja po wszystkich blokach JSON-LD
        try { 
          const data = JSON.parse($(el).html()); 
          
          if (data['@type'] === 'WebPage' && data.mainEntity?.itemListElement) { 
            data.mainEntity.itemListElement.forEach(item => { // Iteracja po pozycjach listy produktow
              if (item.name && item.offers?.price) { // Bierzemy tylko rekordy z nazwa i cena ?- czy nie jest pusty
                // dopelenienie do pelnego url
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
        } catch (e) { // Jesli JSON-LD jest niepoprawny, pomijamy ten blok
        }
      });

      if (!foundOnPage) break;
      page++; 
    } catch (e) { // Blad fetch dla strony listy
      console.log('Błąd sieci:', e.message); 
      break; 
    }
  }

  // Usuwanie duplikatow 
  allProducts = [...new Map(allProducts.map(item => [item.url, item])).values()];
  console.log(`Znaleziono ${allProducts.length} unikalnych produktów. Zbieranie wymiarow`); 

  let results = []; 

  for (let i = 0; i < allProducts.length; i++) { 
    const prod = allProducts[i]; 
    console.log(`Analiza [${i + 1}/${allProducts.length}]: ${prod.name}`); 

    try { 
      const res = await fetch(prod.url); 
      const html = await res.text(); 

      // Normalizacja tresci i regex do formatu rdzenia 
      const cleanHtml = html.replace(/&nbsp;/g, ' ').replace(/×/g, 'x'); //usuwanie spacji
      const regex = /(\d{2,4})\s*x\s*(\d{2,4})\s*x\s*(\d{2,4})\s*mm/i; // Trzy wymiary w mm
      
      const match = cleanHtml.match(regex);

      if (match) { 
        const a = parseInt(match[1]); 
        const b = parseInt(match[2]); 
        const c = parseInt(match[3]); 

        // filtrowanie bledow
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

  results.sort((a, b) => a.cenaZaCm3 - b.cenaZaCm3);

  if (!fs.existsSync('output')) { 
    fs.mkdirSync('output'); 
  }

  fs.writeFileSync('output/wyniki.json', JSON.stringify(results, null, 2));
  console.log('\n--- WYNIKI (zapisano do output/wyniki.json) ---'); 

  results.forEach((r, idx) => { 
    console.log(`${idx + 1}. ${r.name}`); 
    console.log(`   Cena: ${r.price} PLN`); 
    console.log(`   Rdzeń: ${r.wymiary} (${r.pojemnoscCm3.toFixed(2)} cm3)`);
    console.log(`   Opłacalność: ${r.cenaZaCm3.toFixed(4)} PLN/cm3`); 
    console.log(`   Link: ${r.url}\n`); 
  });
}

main(); 