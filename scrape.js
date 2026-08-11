const { chromium } = require('playwright');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const CONSENT_LABELS = ['Tümünü kabul et', 'Accept all', 'Hepsini kabul et', 'Alle akzeptieren'];
const MORE_LABELS = ['Daha fazla uçuş göster', 'Show more flights', 'Diğer uçuşları göster'];

function buildUrl({ from, to, date }, currency) {
  const q = `Flights to ${to} from ${from} on ${date} oneway`;
  return 'https://www.google.com/travel/flights?q=' + encodeURIComponent(q) +
    `&curr=${currency}&hl=tr&gl=TR`;
}

// A result row renders as newline-joined chunks, e.g.
// "13:45 | – | 06:20+1 | Havayolu | 12 sa. 35 dk. | XXX–YYY | 1 aktarma | ... | ₺14.492"
function parseRow(text) {
  // Google her uçuşu iki farklı düzende basıyor; ikincisinde saatler yapışık
  // geliyor ("01:2501:25, 7 Eyl Pzt"). Önce onu tekile indiriyoruz.
  const t = text.replace(/\s+/g, ' ').replace(/(\d{1,2}:\d{2})\1/g, '$1').trim();

  const price = t.match(/₺\s?([\d.]+)/);
  if (!price) return null; // "Fiyat yok" satırları
  const priceTRY = parseInt(price[1].replace(/\./g, ''), 10);
  if (!Number.isFinite(priceTRY) || priceTRY <= 0) return null;

  // Önce "13:45 – 06:20+1" düzeni; tutmazsa satırdaki ilk iki saat damgası.
  let depTime = null, arrTime = null, plusDays = 0, afterArrival = '';
  const strict = t.match(/(\d{1,2}:\d{2})(\+\d)?\s*(?:–|-|—)\s*(\d{1,2}:\d{2})(\+\d)?/);
  if (strict) {
    depTime = strict[1];
    arrTime = strict[3];
    plusDays = strict[4] ? parseInt(strict[4], 10) : 0;
    afterArrival = t.slice(strict.index + strict[0].length);
  } else {
    const clock = [...t.matchAll(/(?<![\d:])(\d{1,2}:\d{2})(\+\d)?(?![\d:])/g)];
    if (clock.length >= 2) {
      depTime = clock[0][1];
      arrTime = clock[1][1];
      plusDays = clock[1][2] ? parseInt(clock[1][2], 10) : 0;
      afterArrival = t.slice(clock[1].index + clock[1][0].length);
    }
  }
  if (depTime) depTime = depTime.padStart(5, '0');
  if (arrTime) arrTime = arrTime.padStart(5, '0');

  const dur = t.match(/(\d+)\s*sa\.?\s*(?:(\d+)\s*dk\.?)?/);
  const durationMin = dur ? parseInt(dur[1], 10) * 60 + (dur[2] ? parseInt(dur[2], 10) : 0) : null;

  let stops = null;
  if (/Aktarmasız|Nonstop/i.test(t)) stops = 0;
  else {
    const m = t.match(/(\d+)\s*aktarma/i) || t.match(/(\d+)\s*stop/i);
    if (m) stops = parseInt(m[1], 10);
  }

  // Havayolu, varış saati ile uçuş süresi arasında. Araya "7 Eyl Pzt" gibi
  // tarih etiketi girebiliyor, onu kırpıyoruz.
  let airline = null;
  const a = afterArrival.match(/^(.*?)\d+\s*sa\./s);
  if (a) {
    airline = a[1]
      .replace(/^[\s,]*\d{1,2}\s+\S+\s+\S{3}\b/, '')  // ", 7 Eyl Pzt"
      .replace(/^[\s,–-]+/, '')
      .replace(/^Operated by\s*/i, '')
      .trim()
      .slice(0, 60);
  }

  // Rota "XXX–YYY" düz gelirse oradan. Yapışık düzende havalimanı koduna tam adı
  // bitişik yazılıyor ("SAWİstanbul Sabiha Gökçen…"), o zaman büyük harfle devam
  // eden ilk iki üç-harfli kodu alıyoruz.
  const route = t.match(/\b([A-Z]{3})\s*(?:–|-|—)\s*([A-Z]{3})\b/);
  const glued = route ? [] : [...t.matchAll(/\b([A-Z]{3})(?=[A-ZÇĞİÖŞÜ])/g)].map(m => m[1]);
  const origin = route ? route[1] : glued[0] || null;
  const dest = route ? route[2] : glued[1] || null;

  return {
    priceTRY, depTime, arrTime, plusDays, durationMin, stops, origin, dest,
    airline: airline || 'Bilinmiyor',
    raw: t.slice(0, 200),
  };
}

// Aynı uçuşun iki DOM kopyasını teke indir; bilgisi daha eksiksiz olanı tut.
function dedupe(flights) {
  const byKey = new Map();
  for (const f of flights) {
    const key = [f.priceTRY, f.durationMin, f.stops, f.depTime, f.arrTime].join('|');
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, f); continue; }
    const score = x => (x.airline !== 'Bilinmiyor' ? 2 : 0) + (x.origin ? 1 : 0) + (x.plusDays ? 1 : 0);
    if (score(f) > score(prev)) byKey.set(key, f);
  }
  return [...byKey.values()];
}

async function dismissConsent(page) {
  for (const label of CONSENT_LABELS) {
    const b = page.getByRole('button', { name: label, exact: false });
    if (await b.count().catch(() => 0)) {
      await b.first().click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(1500);
      return;
    }
  }
}

async function expandAll(page) {
  for (let i = 0; i < 3; i++) {
    let clicked = false;
    for (const label of MORE_LABELS) {
      const b = page.getByRole('button', { name: label, exact: false });
      if (await b.count().catch(() => 0)) {
        await b.first().click({ timeout: 5000 }).catch(() => {});
        clicked = true;
        await page.waitForTimeout(2500);
        break;
      }
    }
    if (!clicked) break;
  }
}

/**
 * Tek bir aramayı çeker. Geçici ağ hatalarında (uyku/wifi değişimi/DNS)
 * artan bekleme ile tekrar dener — yoksa tek hıçkırık koca bir kontrol
 * penceresini kaybettiriyor.
 */
async function scrapeSearch(browser, search, currency, attempts = 3) {
  let last = null;
  for (let i = 1; i <= attempts; i++) {
    const res = await scrapeOnce(browser, search, currency);
    if (!res.error) return i > 1 ? { ...res, recoveredAfter: i } : res;
    last = res.error;
    if (i < attempts) await new Promise(r => setTimeout(r, i * 8000));
  }
  return { flights: [], error: `${attempts} denemede başarısız — ${last}` };
}

async function scrapeOnce(browser, search, currency) {
  const ctx = await browser.newContext({
    locale: 'tr-TR',
    timezoneId: 'Europe/Istanbul',
    userAgent: UA,
    viewport: { width: 1440, height: 1000 },
  });
  const page = await ctx.newPage();

  try {
    await page.goto(buildUrl(search, currency), { waitUntil: 'domcontentloaded', timeout: 60000 });
    await dismissConsent(page);

    await page.waitForSelector('li.pIav2d', { timeout: 45000 });
    await page.waitForTimeout(2500);
    await expandAll(page);

    const texts = await page.$$eval('li.pIav2d', els => els.map(e => e.innerText));
    const flights = [];
    for (const txt of texts) {
      const f = parseRow(txt);
      if (f) flights.push({ ...f, search: search.label, date: search.date });
    }
    return { flights: dedupe(flights), error: null };
  } catch (e) {
    return { flights: [], error: e.message.split('\n')[0] };
  } finally {
    await ctx.close().catch(() => {});
  }
}

async function launchBrowser(headless) {
  return chromium.launch({
    headless,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
}

module.exports = { launchBrowser, scrapeSearch, parseRow, dedupe, buildUrl };
