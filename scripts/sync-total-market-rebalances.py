#!/usr/bin/env python3
"""
Sync Nifty Total Market semi-annual rebalance events from NSE Press Releases.
Usage:
  python3 scripts/sync-total-market-rebalances.py
  npm run sync:rebalances
"""

import urllib.request
import json
import re
import io
import os
import sys
from datetime import datetime

try:
    import pdfplumber
except ImportError:
    print("❌ Error: pdfplumber is required. Run: pip install pdfplumber")
    sys.exit(1)

REBALANCES_FILE = "src/lib/data/total-market-rebalances.json"
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
    "Referer": "https://www.nseindia.com/resources/exchange-communication-press-releases",
    "Accept": "*/*"
}

def load_existing():
    if os.path.exists(REBALANCES_FILE):
        with open(REBALANCES_FILE, "r") as f:
            return json.load(f)
    return []

def save_rebalances(rebalances):
    rebalances.sort(key=lambda x: x["effectiveDate"])
    with open(REBALANCES_FILE, "w") as f:
        json.dump(rebalances, f, indent=2)
    print(f"💾 Updated {REBALANCES_FILE} with {len(rebalances)} total rebalances.")

def fetch_press_releases(from_date, to_date):
    url = f"https://www.nseindia.com/api/press-release-cms20?fromDate={from_date}&toDate={to_date}"
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"⚠️ Failed to fetch press releases ({from_date} to {to_date}): {e}")
        return []

def parse_pdf_rebalances(pdf_url):
    req = urllib.request.Request(pdf_url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = resp.read()

    with pdfplumber.open(io.BytesIO(data)) as pdf:
        all_lines = []
        for p in pdf.pages:
            t = p.extract_text() or ""
            all_lines.extend(t.split("\n"))

        in_tm = False
        mode = None
        excluded = []
        included = []

        for line in all_lines:
            line_str = line.strip()
            if re.search(r"(?:[a-z]|\d+)\)\s*Nifty Total Market", line_str, re.IGNORECASE):
                in_tm = True
                continue
            if in_tm and re.match(r"^(?:[a-z]|\d+)\)\s*Nifty", line_str, re.IGNORECASE):
                break
            if in_tm:
                if "following companies are being excluded" in line_str.lower():
                    mode = "excluded"
                    continue
                elif "following companies are being included" in line_str.lower():
                    mode = "included"
                    continue

                m = re.match(r"^\d+\s+(.+?)\s+([A-Z0-9&\-_]+)\*?$", line_str)
                if m:
                    sym = m.group(2).rstrip("*").strip().upper()
                    if sym not in ["SYMBOL", "NSE", "ISIN"]:
                        if mode == "excluded":
                            excluded.append(sym)
                        elif mode == "included":
                            included.append(sym)

        return sorted(list(set(excluded))), sorted(list(set(included)))

def main():
    existing = load_existing()
    known_dates = {r["effectiveDate"]: r for r in existing}
    latest_eff = max(known_dates.keys()) if known_dates else "2024-01-01"
    print(f"📊 Latest recorded rebalance: {latest_eff}")

    now = datetime.now()
    # Check current year and next year around rebalance announcement months (Feb, Aug)
    years = [now.year, now.year + 1] if now.month >= 8 else [now.year - 1, now.year]
    windows = []
    for y in sorted(list(set(years))):
        windows.append((f"01-02-{y}", f"28-02-{y}"))
        windows.append((f"01-08-{y}", f"31-08-{y}"))

    found_new = False
    for from_d, to_d in windows:
        prs = fetch_press_releases(from_d, to_d)
        for pr in prs:
            body = pr.get("content", {}).get("body", "")
            if "replacements in indices" in body.lower() and "w.e.f." in body.lower():
                pdf_url = pr.get("content", {}).get("field_file_attachement", {}).get("url")
                circ_date = pr.get("content", {}).get("field_date", "")
                
                # Extract effective date from body
                eff_match = re.search(r"w\.e\.f\.\s+([A-Za-z]+)\s+(\d{1,2}),\s+(\d{4})", body, re.IGNORECASE)
                if not eff_match:
                    continue
                month_str, day_str, year_str = eff_match.groups()
                try:
                    eff_dt = datetime.strptime(f"{month_str} {day_str} {year_str}", "%B %d %Y")
                    eff_iso = eff_dt.strftime("%Y-%m-%d")
                except Exception:
                    continue

                if eff_iso in known_dates:
                    continue

                print(f"🔍 Found new semi-annual rebalance: {eff_iso} (Circular date: {circ_date})")
                print(f"   Downloading PDF: {pdf_url}")
                excluded, included = parse_pdf_rebalances(pdf_url)
                if not excluded and not included:
                    print(f"   ⚠️ Nifty Total Market not found or unchanged in {pdf_url}")
                    continue

                print(f"   Extracted {len(excluded)} exclusions and {len(included)} inclusions.")
                entry = {
                    "effectiveDate": eff_iso,
                    "circularDate": circ_date,
                    "url": pdf_url,
                    "excluded": excluded,
                    "included": included
                }
                existing.append(entry)
                known_dates[eff_iso] = entry
                found_new = True

    if found_new:
        save_rebalances(existing)
        print("✅ New rebalances saved! Remember to run 'npm run recompute' to update portfolio history.")
    else:
        print("✅ All Nifty Total Market rebalance circulars are up to date.")

if __name__ == "__main__":
    main()
