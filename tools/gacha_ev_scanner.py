#!/usr/bin/env python3
"""
Gacha EV / capital scanner for Collector Crypt + Phygitals.

Per-pull rarity is NOT predictable (server-side committed seed; see
docs/gacha-rarity-analysis.md). The only durable edge is *machine selection*:
both platforms publish, live and unauthenticated, the remaining pool per rarity
tier. When the cheap tiers drain but high-value items remain, the odds-weighted
EV of a pull rises above the ask. This tool ranks machines by that edge and
sizes the capital required to farm it.

Sources (no auth):
  - Collector Crypt: https://gacha.collectorcrypt.com/api/machines
        -> per machine: odds, tierRanges (USD value bands), stock (remaining/tier), ev
  - Bot aggregator:  https://cc-gacha-monitor-leagehub.up.railway.app/api/status
        -> consolidated catalog (both platforms) + epicInventory (real grail $) + autobuy config

Usage:  python3 tools/gacha_ev_scanner.py [--json]
"""
import json, sys, urllib.request

CC_API  = "https://gacha.collectorcrypt.com/api/machines"
BOT_API = "https://cc-gacha-monitor-leagehub.up.railway.app/api/status"

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "gacha-ev-scanner/1.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)

def cc_rows(machines):
    """One row per in-stock Collector Crypt machine with gross and post-buyback edge."""
    rows = []
    for m in machines:
        stock = m.get("stock") or {}
        rem = sum(stock.values())
        if rem == 0:
            continue
        price, ev = m["price"], m["ev"]
        bb = m["instantBuyback"] / 100.0
        rows.append({
            "code": m["code"], "price": price, "remaining": rem, "ev": ev,
            "buyback": bb,
            "edge_gross": ev / price - 1.0,        # keep grails at full market value
            "edge_net":  ev * bb / price - 1.0,    # liquidate everything at buyback
            "clear_cost": price * rem,             # buy the whole remaining pool
        })
    return sorted(rows, key=lambda r: -r["edge_net"])

def capital_model(rows):
    """Capital tiers to automate the farm (Collector Crypt side)."""
    net = [r for r in rows if r["edge_net"] > 0]
    clear_net = sum(r["clear_cost"] for r in net)
    profit_net = sum(r["clear_cost"] * r["edge_net"] for r in net)
    top_price = max((r["price"] for r in rows), default=0)
    return {
        "net_positive_machines": len(net),
        "buyout_all_net_capital": clear_net,
        "buyout_all_net_profit": profit_net,
        "buyout_all_net_roi": (profit_net / clear_net) if clear_net else 0.0,
        # recycling bankroll: buyback returns ~85-93% within minutes, so you do not
        # need the full buy-out capital at once — only peak un-liquidated inventory
        # plus a variance buffer for the lumpy epic-tier grails.
        "min_viable_autobuyer": 5 * top_price,          # bot caps 5 packs/signal
        "recommended_bankroll_low": 25_000,
        "recommended_bankroll_high": 50_000,
        "note": "Buying out *all* +EV (incl. sub-haircut) machines is NEGATIVE ROI; "
                "millions in turnover loses money. Edge lives only above the buyback haircut.",
    }

def main():
    as_json = "--json" in sys.argv
    cc = get(CC_API)["machines"]
    rows = cc_rows(cc)
    cap = capital_model(rows)
    try:
        bot = get(BOT_API)
        ph = [c for c in bot.get("catalog", [])
              if c["platform"] == "phygitals" and c.get("inStock") and c.get("ev", 0) > 0]
    except Exception:
        ph = []

    if as_json:
        print(json.dumps({"collector_crypt": rows, "phygitals_in_stock": ph,
                          "capital": cap}, indent=2))
        return

    print("== Collector Crypt — ranked by post-buyback (net) edge ==")
    print(f"{'machine':16}{'$ask':>6}{'remain':>8}{'EV/pull':>9}{'gross':>8}{'net':>8}{'clear$':>11}")
    for r in rows:
        print(f"{r['code']:16}{r['price']:>6}{r['remaining']:>8}{r['ev']:>9,.0f}"
              f"{r['edge_gross']*100:>7.1f}%{r['edge_net']*100:>7.1f}%{r['clear_cost']:>11,.0f}")

    print("\n== Capital to automate ==")
    print(f"  machines net-+EV after buyback haircut : {cap['net_positive_machines']}")
    print(f"  buy-out-all-net capital                : ${cap['buyout_all_net_capital']:,.0f}")
    print(f"  buy-out-all-net expected profit        : ${cap['buyout_all_net_profit']:,.0f} "
          f"({cap['buyout_all_net_roi']*100:.1f}% ROI)")
    print(f"  minimum viable auto-buyer (5x top ask) : ${cap['min_viable_autobuyer']:,.0f}")
    print(f"  recommended recycling bankroll         : "
          f"${cap['recommended_bankroll_low']:,}–${cap['recommended_bankroll_high']:,}")
    print(f"  NOTE: {cap['note']}")

    if ph:
        edges = [c["ev"] / c["price"] - 1 for c in ph]
        print(f"\n== Phygitals — {len(ph)} in-stock +EV packs "
              f"(pool depth not exposed; size by signal) ==")
        print(f"  ask ${min(c['price'] for c in ph)}–${max(c['price'] for c in ph)}  "
              f"mean edge {sum(edges)/len(edges)*100:.1f}%  "
              f"one-of-each ${sum(c['price'] for c in ph):,.0f}")

if __name__ == "__main__":
    main()
