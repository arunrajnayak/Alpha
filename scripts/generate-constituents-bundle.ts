import fs from 'fs';
import path from 'path';

// Known working archive URLs on archives.nseindia.com
const ARCHIVE_MAP: Record<string, string> = {
  'NIFTY 50': 'https://archives.nseindia.com/content/indices/ind_nifty50list.csv',
  'NIFTY Next 50': 'https://archives.nseindia.com/content/indices/ind_niftynext50list.csv',
  'NIFTY Midcap 100': 'https://archives.nseindia.com/content/indices/ind_niftymidcap100list.csv',
  'NIFTY Midcap 150': 'https://archives.nseindia.com/content/indices/ind_niftymidcap150list.csv',
  'NIFTY Smallcap 250': 'https://archives.nseindia.com/content/indices/ind_niftysmallcap250list.csv',
  'NIFTY Microcap 250': 'https://archives.nseindia.com/content/indices/ind_niftymicrocap250_list.csv',
  'NIFTY 500': 'https://archives.nseindia.com/content/indices/ind_nifty500list.csv',
  'NIFTY Total Market': 'https://archives.nseindia.com/content/indices/ind_niftytotalmarket_list.csv',
  'NIFTY 200 Momentum 30': 'https://archives.nseindia.com/content/indices/ind_nifty200Momentum30_list.csv',
  'NIFTY Midcap150 Momentum 50': 'https://archives.nseindia.com/content/indices/ind_niftymidcap150momentum50_list.csv',
  'NIFTY500 Momentum 50': 'https://archives.nseindia.com/content/indices/ind_nifty500Momentum50_list.csv',
  'NIFTY Bank': 'https://archives.nseindia.com/content/indices/ind_niftybanklist.csv',
  'NIFTY Financial Services': 'https://archives.nseindia.com/content/indices/ind_niftyfinancelist.csv',
  'NIFTY Private Bank': 'https://archives.nseindia.com/content/indices/ind_nifty_privatebanklist.csv',
  'NIFTY PSU Bank': 'https://archives.nseindia.com/content/indices/ind_niftypsubanklist.csv',
  'NIFTY IT': 'https://archives.nseindia.com/content/indices/ind_niftyitlist.csv',
  'NIFTY Auto': 'https://archives.nseindia.com/content/indices/ind_niftyautolist.csv',
  'NIFTY FMCG': 'https://archives.nseindia.com/content/indices/ind_niftyfmcglist.csv',
  'NIFTY Pharma': 'https://archives.nseindia.com/content/indices/ind_niftypharmalist.csv',
  'NIFTY Healthcare': 'https://archives.nseindia.com/content/indices/ind_niftyhealthcarelist.csv',
  'NIFTY Metal': 'https://archives.nseindia.com/content/indices/ind_niftymetallist.csv',
  'NIFTY Energy': 'https://archives.nseindia.com/content/indices/ind_niftyenergylist.csv',
  'NIFTY Oil & Gas': 'https://archives.nseindia.com/content/indices/ind_niftyoilgaslist.csv',
  'NIFTY Realty': 'https://archives.nseindia.com/content/indices/ind_niftyrealtylist.csv',
  'NIFTY Media': 'https://archives.nseindia.com/content/indices/ind_niftymedialist.csv',
  'NIFTY Consumer Durables': 'https://archives.nseindia.com/content/indices/ind_niftyconsumerdurableslist.csv',
  'NIFTY Infrastructure': 'https://archives.nseindia.com/content/indices/ind_niftyinfralist.csv',
  'NIFTY Commodities': 'https://archives.nseindia.com/content/indices/ind_niftycommoditieslist.csv',
  'NIFTY CPSE': 'https://archives.nseindia.com/content/indices/ind_niftycpselist.csv',
};

// Hand-curated thematic indices matching official NSE index constituents
const THEMATIC_CURATED: Record<string, string[]> = {
  'NIFTY Telecom': [
    'BHARTIARTL', 'TATACOMM', 'INDUSTOWER', 'IDEA', 'TEJASNET', 'ROUTE', 'HFCL', 'RAILTEL', 'ITI', 'TATAELXSI'
  ],
  'NIFTY Railways PSU': [
    'IRCTC', 'IRFC', 'RVNL', 'RITES', 'RAILTEL', 'CONCOR', 'TITAGARH', 'TEXRAIL', 'JWL'
  ],
  'NIFTY Chemicals': [
    'PIDILITIND', 'SRF', 'GUJGASLTD', 'DEEPAKNTR', 'TATACHEM', 'AARTIIND', 'ATUL', 'FLUOROCHEM',
    'NAVINFLUOR', 'VINATIORGA', 'CLEAN', 'SUMICHEM', 'FINEORG', 'ALKYLAMINE', 'BALAMINES'
  ],
  'NIFTY Capital Mkt': [
    'BSE', 'MCX', 'CDSL', 'CAMS', 'ANGELONE', 'KFINTECH', 'MOTILALOFS', 'ISEC', 'GEOJITFSL', '5PAISA'
  ],
  'NIFTY Ind Tourism': [
    'INDHOTEL', 'EIHOTEL', 'LEMONTREE', 'CHALET', 'DEVYANI', 'SAPPHIRE', 'JUBLFOOD', 'WESTLIFE',
    'BLS', 'THOMASCOOK', 'EASEMYTRIP', 'IRCTC', 'MAHINDCIE'
  ],
  'NIFTY Ind Defence': [
    'BEL', 'HAL', 'MAZDOCK', 'BDL', 'COCHINSHIP', 'PARAS', 'DATAPATTNS', 'MTARTECH', 'ASTRAZEN', 'ZEN', 'SOLARINDS'
  ]
};

async function main() {
  const result: Record<string, { symbols: string[]; weights: Record<string, number> }> = {};

  for (const [name, url] of Object.entries(ARCHIVE_MAP)) {
    try {
      const resp = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(5000) });
      if (!resp.ok) {
        console.warn(`Failed ${name}: ${resp.status}`);
        continue;
      }
      const text = await resp.text();
      const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
      const symbols: string[] = [];
      const weights: Record<string, number> = {};

      for (let i = 1; i < lines.length; i++) {
        const parts = lines[i].split(',');
        const sym = parts[2]?.trim()?.toUpperCase();
        if (sym && /^[A-Z0-9&-]+$/.test(sym) && !symbols.includes(sym)) {
          symbols.push(sym);
        }
      }

      result[name] = { symbols, weights };
      console.log(`✅ ${name}: ${symbols.length} symbols`);
    } catch (e) {
      console.error(`❌ ${name}:`, e);
    }
  }

  for (const [name, syms] of Object.entries(THEMATIC_CURATED)) {
    result[name] = { symbols: syms, weights: {} };
    console.log(`✅ ${name} (curated): ${syms.length} symbols`);
  }

  const outPath = path.join(process.cwd(), 'src', 'lib', 'data', 'index-constituents.json');
  fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf-8');
  console.log(`Saved ${Object.keys(result).length} indices to ${outPath}`);
}

main().catch(console.error);
