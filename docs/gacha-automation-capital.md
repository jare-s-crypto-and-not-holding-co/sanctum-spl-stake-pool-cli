# Gacha Automation — Capital Requirements

What it costs to automate the EV-farming bot for the Collector Crypt and
Phygitals gacha machines. Numbers come from the live, unauthenticated APIs and
are reproducible with `tools/gacha_ev_scanner.py` (snapshot: 2026-06-07).

Background: per-pull rarity is **not** predictable (server-side committed seed —
see `gacha-rarity-analysis.md`). The only durable edge is **machine selection**:
the platforms publish remaining stock per rarity tier, so when cheap tiers drain
and high-value items remain, the odds-weighted EV of a pull rises above the ask.

## The catch that sets the budget

The reported edge (`EV/price`) is computed on the **fixed odds**, and every
realized card must be liquidated through **buyback at 85–93%**. The buyback
haircut (7–15%) usually **exceeds** the 2–5% edge. So:

- **Buying out every +EV machine is negative-ROI** — about **−5%** across ~$2.2M
  of turnover. Throwing millions at it *loses* money.
- Edge survives the haircut on **only ~6 machines** at this snapshot.

| | machines | capital (buy-out) | exp. profit | ROI |
|---|---|---|---|---|
| Buy out **everything** | 26 | ~$2.18M | −$110k | **−5.1%** |
| Buy out **all gross +EV** | 23 | ~$2.16M | −$104k | **−4.8%** |
| Buy out **net +EV (post-haircut)** | 6 | ~$178k | +$10.2k | **+5.7%** |

The 6 that clear the haircut (net edge): `pikachu_50` +22.2%, `gachopia_50`
+7.4%, `onepiece_50` +6.1%, `baseball_100` +4.5%, `basketball_100` +3.1%,
`comic_50` +1.2%. Three machines are active traps (grails already pulled):
`charizard_50` −59%, `mew_250` −54%, `gengar_50` −48%.

## What you actually need

You do **not** need the $178k buy-out figure, because buyback recycles 85–93% of
capital back within minutes — you cycle a smaller float, you don't park the full
pool cost. Budget = fixed infra + a recycling trading bankroll sized for the
lumpy epic-tier (1%-odds, $20k–$50k) variance.

### Fixed infra (monthly)
| item | cost |
|---|---|
| RPC (Helius dev → business as poll rate scales) | $50–500 / mo |
| Host (Railway, the bot is a small Node service) | $5–20 / mo |
| Solana gas + per-asset rent (~0.0001 SOL + fees, thousands of pulls) | ~$10–50 one-off |
| **Total** | **~$100/mo to start, ~$600/mo at scale** |

### Trading bankroll (the real number)
| tier | capital | what it buys |
|---|---|---|
| **Minimum viable** | **$5k–15k** | Acts on signals. Bot caps 5 packs/signal; worst case 5×$1000 = $5k. With buyback recycling, holds ~2–4 concurrent positions. |
| **Recommended** | **$25k–50k** | Skims the high-edge machines as signals recycle; survives grail variance without owning whole pools. The sweet spot. |
| **Full current skim** | **~$50k working** (not $178k) | Captures all 6 net-+EV machines via recycled float; only need the full $178k if grabbing 100% instantly ahead of competitors. |
| **Don't** | >$200k | Exhausts the +EV inventory and tips into the −5% bulk. More capital = worse returns here. |

## Bottom line

**~$100/mo of infra + a ~$25k–$50k recycling bankroll** automates the whole
thing properly; you can boot it at ~$10k. The opportunity is **capacity-limited,
not capital-limited** — only ~$178k of genuinely +EV inventory exists right now,
returning ~$10k (~5.7%) per full cycle, and that edge decays as you (and others)
drain it. Scale beyond the +EV machines and you pay the house the buyback spread.

Re-run `python3 tools/gacha_ev_scanner.py` for the current snapshot; edges move
as pools drain and refill.
