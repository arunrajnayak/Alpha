# Market Data Reference

> Prefer the **v3** classes. `MarketQuoteV3Api` and `HistoryV3Api` methods take **no
> `api_version`**. The v2 `MarketQuoteApi`/`HistoryApi` exist but use a different
> interval scheme. All signatures verified against the SDK.

```python
import os, upstox_client

configuration = upstox_client.Configuration()
configuration.access_token = os.environ["UPSTOX_ACCESS_TOKEN"]
client = upstox_client.ApiClient(configuration)
```

---

## Live quotes — `MarketQuoteV3Api`

```python
mq = upstox_client.MarketQuoteV3Api(client)

# LTP — pass instrument_key (comma-separate for many)
ltp = mq.get_ltp(instrument_key="NSE_EQ|INE002A01018,NSE_INDEX|Nifty 50")
print(ltp.data)   # dict keyed by instrument; each has .last_price, .cp, .volume, .ltq

# OHLC — interval is positional: I1, I5, I15, I30, 1d, 1w, 1M (intraday "I"+minutes, or day/week/month)
ohlc = mq.get_market_quote_ohlc(interval="1d", instrument_key="NSE_EQ|INE002A01018")

# Option greeks (LTP + iv/delta/gamma/theta/vega/oi)
greeks = mq.get_market_quote_option_greek(instrument_key="NSE_FO|43885")
```

### Full market quote (OHLC + depth + CAS + circuit) — v3 `GET /v3/market-quote/quotes`

V3 provides full market quote snapshots with OHLC, 5-level depth, circuit limits, 52W range, Pre-Open IEP, and live Closing Auction Session (CAS) for up to 500 instruments:

```python
# REST endpoint: GET https://api.upstox.com/v3/market-quote/quotes?instrument_key=NSE_EQ|INE002A01018
# Upstox SDK / REST client returns .ohlc, .depth, .last_price, .volume, .lower_circuit_limit, .upper_circuit_limit, .cas_eligible
```

---

## Historical candles — `HistoryV3Api`

`get_historical_candle_data(instrument_key, unit, interval, to_date, from_date=...)`

- `unit` ∈ `minutes`, `hours`, `days`, `weeks`, `months`
- `interval` is an **int as a string/number** valid for the unit:
  - `minutes`: 1–300 · `hours`: 1–5 · `days`/`weeks`/`months`: 1
- dates are `YYYY-MM-DD`. `from_date` is optional (omit for the max default look-back).

```python
hist = upstox_client.HistoryV3Api(client)

# 5-minute candles for a date range
resp = hist.get_historical_candle_data(
    "NSE_EQ|INE002A01018", "minutes", "5", "2025-01-10", "2025-01-06"
)

# Daily candles
resp = hist.get_historical_candle_data(
    "NSE_EQ|INE002A01018", "days", "1", "2025-01-31", "2025-01-01"
)

for candle in resp.data.candles:
    ts, o, h, l, c, vol, oi = candle    # [timestamp, open, high, low, close, volume, oi]
    print(ts, o, h, l, c, vol)
```

### Intraday (today) — `get_intra_day_candle_data(instrument_key, unit, interval)`

```python
resp = hist.get_intra_day_candle_data("NSE_EQ|INE002A01018", "minutes", "1")
```

---

## Market status, timings & holidays — `MarketHolidaysAndTimingsApi`

> Class is `MarketHolidaysAndTimingsApi` (not `MarketInformationApi`).

```python
mkt = upstox_client.MarketHolidaysAndTimingsApi(client)

mkt.get_market_status(exchange="NSE")     # OPEN / CLOSED / PRE_OPEN ...
mkt.get_exchange_timings(_date="2025-01-15")
mkt.get_holidays()                         # all holidays
mkt.get_holiday(_date="2025-01-26")        # holiday(s) on a date
```
