## Intercooler Scraper

Node.js scraper for FMIC category:
https://fmic.pl/uklad-chlodzenia/intercoolery

The script calculates "unit value" for products as:

unit price = price / core volume in cm^3

Core volume is calculated from detected dimensions in mm:

volume_cm3 = (A_mm * B_mm * C_mm) / 1000

Products are printed in ascending order of `PLN/cm^3` (lower is better value).

## Requirements

- Node.js 18+ (uses built-in `fetch`)

## Install

```bash
npm install
```

## Run

```bash
npm start
```

This scans all category pages by default.
The scraper reads pagination on the first category page to detect the last page number and stops there.

Optional environment variables:

- `MAX_PAGES` - max number of category pages to scan (`0` = all pages)

Example:

```bash
MAX_PAGES=2 npm start
```

Custom JSON output path example:

## Output

Each ranked item includes:

- product name
- price in PLN
- detected core dimensions in mm
- core volume in cm^3
- computed unit price in PLN/cm^3
- product URL

The full ranked data is also saved to JSON after each run.

## Notes

- Data source is exactly: https://fmic.pl/uklad-chlodzenia/intercoolery
- Some products may be skipped if no 3D dimensions in `mm` can be detected.

### When Cherio does not work
```bash
npm install cheerio@1.0.0-rc.12 --save-exact
```
```
npm ls cheerio undici
```