# Gacha Rarity Analysis: Are Rarities Derivable and Minimum Rarities Enforceable?

**Question.** For Solana gacha/claw systems — specifically
[phygitals.com/claw](https://www.phygitals.com/claw) and
[gacha.collectorcrypt.com](https://gacha.collectorcrypt.com) — can a player
*derive* (predict) the rarity of a pull before committing, and can the
operator *enforce* a minimum/expected rarity distribution against a
sophisticated player?

**Reference exploit.** The gist
[09ef242e4715bce5fe4539c497cd5790](https://gist.github.com/staccDOTsol/09ef242e4715bce5fe4539c497cd5790)
documents the Metaplex Candy Machine "rarity sniping" exploit: because Candy
Machine derives the minted index/rarity *deterministically from on-chain state
that is already known at transaction time*, an attacker can (a) predict the
rarity before landing the mint, and (b) atomically abort low-rarity mints —
either with a two-step predict-then-mint flow or a single transaction that does
a check-and-abort CPI, optionally wrapped in a Jito bundle to defeat
introspection defenses. The author reports a collection of exclusively
top-15%/35% NFTs at "100% efficacy."

This document generalizes that result and answers the two questions for the two
target platforms.

---

## TL;DR

| | Derivable by player? | Min-rarity / odds enforceable by house? |
|---|---|---|
| **Fully on-chain deterministic RNG** (Candy Machine model in the gist) | **Yes** | **No** |
| **VRF / commit–reveal with a hidden future seed**, correctly implemented | **No** (at decision time) | **Yes** |
| **Collector Crypt gacha** (claims client-entropy + hidden server-entropy + VRF) | **No, *if* the claimed design holds** — but it is a *centralized* "provably-fair" model: not player-derivable, yet operator-biasable | **Yes against the player; trust shifts to the operator** |
| **Phygitals claw** (mechanism undocumented publicly) | **Unknown — vulnerable if rarity is computed from data the signer can simulate** | **Only if non-derivable + non-abortable** |

The single property that decides both questions:

> **Is the random value that maps to rarity knowable or simulatable at the
> instant the player irrevocably commits funds — and can the player abort/refund
> after learning the outcome?**
>
> - If **yes** → rarities are derivable **and** minimum rarities are **not**
>   enforceable (the player farms only good pulls).
> - If **no** → rarities are not derivable and the distribution is enforceable.

Everything else is implementation detail that either preserves or breaks that
property.

---

## Threat model

- **Adversary:** a player who can read all on-chain state, run
  `simulateTransaction` against any RPC, craft arbitrary transactions and CPIs,
  retry indefinitely, and land bundles via Jito with post-conditions. This is
  the exact capability set the gist assumes.
- **Adversary goal:** raise their *realized* rarity distribution above the
  published odds — i.e., impose their own "minimum rarity" floor by only paying
  for pulls that clear a rarity threshold.
- **House goal:** the published odds (e.g., Collector Crypt's "Elite ≈ 20% big
  win," "Legendary ≈ 25% big win" with 85–90% buyback) must actually hold for
  every player, because the buyback/EV economics depend on most pulls being low
  value. If players can selectively realize only high-value pulls, the house is
  drained — this is the economic harm, not a cosmetic one.

Two distinct meanings of "minimum rarity enforceable" — both are addressed:

1. **Buyer-side floor (a guarantee *to* the player):** "this $250 pack always
   yields at least tier X." This is **always enforceable** by program/prize-pool
   logic regardless of the RNG, because it is just a constraint on the
   outcome→prize mapping. Not security-interesting.
2. **Odds integrity (a guarantee *against* the player):** the player cannot push
   their realized minimum rarity above the published distribution. This is the
   security-relevant question and the one the gist breaks. Unless stated
   otherwise, "enforceable" below means this.

---

## Why on-chain deterministic RNG is derivable (the gist, generalized)

A pull resolves rarity as `rarity = f(seed, params)`. The exploit is possible
whenever **all inputs to `f` are fixed and observable before the player must
irrevocably commit**, *and* the player retains the ability to not-commit
(abort) after evaluating `f`.

Common "seed" sources that are already-known-at-tx-time and therefore
**derivable**:

- `recent_blockhash`, `Clock` (slot, unix_timestamp), `Slot`, `SlotHashes`
  sysvar for *past* slots, `instructions` sysvar, the signer pubkey, a PDA's
  current data, an oracle account that is already populated, or any seed the
  backend hands the client *before* the commit.
- Anything the player can reproduce off-chain, or — crucially — anything the
  player can observe via `simulateTransaction`, which returns post-execution
  account state and logs **without landing the transaction**. Even if `f` is
  opaque, the player simulates the whole mint, reads the resulting rarity from
  simulated state/logs/the would-be-minted metadata, and only signs-for-real on
  a hit.

Abort mechanisms that defeat naive defenses (all from the gist's reasoning):

- **Two-step:** simulate → only submit on a hit.
- **Atomic check-and-abort:** one transaction where a custom instruction reads
  the resulting rarity (via CPI / return data / account introspection) and
  `panic!`s the whole transaction if below threshold, so a miss costs only
  fees, never the pack price.
- **Jito bundle post-condition:** wrap the mint with a guard transaction;
  the bundle lands atomically only if the guard passes. This specifically
  defeats "block transaction introspection" and "ban contracts that CPI into us"
  defenses, because the decision lives outside the target program.

**Conclusion for this class:** rarities are **derivable**, and minimum-rarity /
odds enforcement is **impossible** — the house cannot distinguish a selective
miner from an unlucky-then-lucky player, and cannot claw back the aborted
attempts because they never paid. This is precisely why the gist says V3 "has
the same issue" and why open-source proliferation makes blocklist defenses
futile.

---

## What actually makes it non-derivable and enforceable

The fix is to **separate irrevocable commitment from reveal**, and source the
reveal from entropy that is *unknown and uncontrollable at commit time and
cannot be aborted after it is known*. Required properties:

1. **Irrevocable commit.** The player pays and binds to a specific
   nonce/request in transaction T1. Funds are captured; there is **no
   cancel/refund** path for a committed-but-unrevealed pull. (A refundable or
   cancellable commit is economically identical to an abort and reopens the
   exploit.)
2. **Future, unknowable seed.** The random value is drawn from a source not
   determined at T1: a VRF callback (Switchboard On-Demand / ORAO / Pyth
   Entropy), or a *future* slot hash `SlotHashes[T1.slot + k]` that does not yet
   exist when T1 lands. The player cannot simulate it because it does not exist
   yet.
3. **Non-abortable reveal.** The reveal+mint (T2) must not be a transaction the
   player can wrap, condition, or refuse. Either the oracle/operator drives T2,
   or T2 is permissionlessly callable by anyone (so the player cannot suppress a
   bad result by simply not submitting). If the *player* signs T2 and can choose
   not to, the property is broken.
4. **No grinding.** The bound nonce/clientSeed must be fixed at T1 and cost-
   bearing, so the player cannot brute-force many seeds per payment.
5. **No same-transaction consumption.** If the VRF/oracle value is read in the
   same transaction the player signs (account already populated, or a past
   slothash), it is simulatable → derivable. Reveal must be strictly later.

If **all five** hold, the player faces a genuine ex-ante lottery: rarity is
**not derivable**, and the published odds are **enforced** because every
committed pull resolves whether the player likes it or not. Break **any one**
and you are back to the gist.

---

## Platform assessment

### Collector Crypt gacha (`gacha.collectorcrypt.com`)

Public descriptions state the gacha is **powered by a VRF**, combining
**client-side entropy with server-side entropy** to produce a number mapped to a
prize tier — i.e., the classic casino "provably-fair" construction
(`serverSeedHash` published first; outcome = HMAC(serverSeed, clientSeed‖nonce);
`serverSeed` revealed afterward for verification).

- **Derivable by the player?** **No, assuming the design holds.** The player
  never sees `serverSeed` before committing — only its hash — so they cannot
  compute `f`, and there is nothing on-chain to simulate that contains the
  hidden seed. The Candy-Machine simulate-and-abort attack does **not** apply,
  because the deciding entropy is withheld until after the commit. This is the
  correct shape to defeat the gist.
- **Minimum rarity / odds enforceable against the player?** **Yes.** Because the
  player cannot predict and (in a proper implementation) cannot cancel a
  committed pull, they cannot selectively realize only high tiers.
- **But the trust model inverts.** This is *centralized* provably-fair, not
  trustless. "Provably fair" here means *after-the-fact verifiable*, not
  *unbiasable*. The operator can still:
  - **Grind/select `serverSeed`** before publishing its hash to shape the global
    outcome stream, or pick favorable salts.
  - **Withhold reveal / re-roll** on outcomes it dislikes if the commit isn't
    truly bound on-chain.
  - **Manipulate inventory** behind the tier mapping (which physical card backs a
    "big win") independent of the RNG.
  So the right questions to actually verify are operational, not just
  cryptographic:
  1. Is `serverSeedHash` published and **timestamped on-chain before** the
     player's clientSeed/commit? (Prevents seed grinding.)
  2. Is the commit **irrevocable on-chain** (funds captured, no cancel before
     reveal)? (Prevents player-side abort.)
  3. Is the reveal **forced/permissionless**, or can the operator drop
     unfavorable reveals? (Prevents operator-side selective reveal.)
  4. If a true on-chain VRF (Switchboard/ORAO/Pyth) is used, is the request
     account bound to the paid commit and consumed only in a **later**
     transaction the player can't abort?
  - If (1)–(4) hold: **not derivable, odds enforceable** — the design is sound
    against the gist, with residual trust in the operator's inventory/tier
    mapping.
  - If any fail: the specific failure (pre-revealed seed, refundable commit,
    droppable reveal) re-enables either derivation or operator bias.

### Phygitals claw (`www.phygitals.com/claw`)

No public documentation of the on-chain RNG mechanism was found; the marketing
page exposes only pack tiers/prices and buyback boosts.

- **If** the claw resolves rarity from on-chain deterministic state visible at
  sign time (blockhash/slot/clock/account state, or a backend-provided seed
  delivered before commit), it is **derivable and not enforceable** — directly
  the gist's exploit, including the simulate-then-abort and Jito-bundle variants.
- **If** it uses a hidden-future-seed VRF/commit–reveal with an irrevocable
  commit and non-abortable reveal, it is **not derivable and enforceable**, with
  the same centralized-trust caveats as Collector Crypt.
- **Verdict: indeterminate without inspecting the program.** The diagnostic is
  the same single property — try `simulateTransaction` on a pull and check
  whether the resulting rarity is readable from simulated state/logs *before*
  landing it, and whether a committed pull can be abandoned without paying. If
  either is true, it is exploitable.

---

## How to test a live deployment (decision procedure)

For either platform, the question reduces to two empirical checks:

1. **Derivability check.** Build the pull transaction and
   `simulateTransaction`. Inspect returned logs / post-state / would-be-minted
   metadata for the rarity. If it is determinable from the simulation (or from
   any value the backend returned to the client before commit), **rarities are
   derivable.**
2. **Enforceability check.** Commit a pull, then attempt to *not* complete /
   cancel / get refunded *after* learning the outcome (or simply never submit
   the reveal/mint if the player is the one who must). If a bad outcome can be
   abandoned without forfeiting the pack price, **minimum rarities are not
   enforceable** — selective minting is live, and the gist's exploit applies as
   written.

A system is robust **iff** check 1 yields "not determinable until after an
irrevocable commit" **and** check 2 yields "committed pulls always resolve and
are paid for."

---

## Bottom line

- **Are gacha rarities derivable?** *Only when the rarity-determining randomness
  is knowable or simulatable at commit time.* For the fully on-chain
  deterministic model in the gist (Candy Machine), **yes** — provably so. For a
  correctly built VRF / hidden-server-seed commit–reveal (what Collector Crypt
  describes), **no**.
- **Are minimum rarities (published odds) enforceable?** *Only when the player
  can neither predict nor abort.* For the gist's model, **no**. For the
  commit–reveal/VRF model with an irrevocable commit and a non-abortable reveal,
  **yes — against the player**, at the cost of trusting the operator not to bias
  seed selection, reveal timing, or the inventory→tier mapping.
- The decisive variable is identical for both questions and both platforms:
  **whether the random value is hidden until after an irrevocable commitment and
  cannot be aborted once revealed.** Derivability and (un)enforceability are two
  views of that one property.

## Sources

- Gist: Candy Machine rarity exploit — https://gist.github.com/staccDOTsol/09ef242e4715bce5fe4539c497cd5790
- Phygitals claw — https://www.phygitals.com/claw
- Collector Crypt gacha — https://gacha.collectorcrypt.com
- Collector Crypt overview (gacha, VRF, client+server entropy, tier odds, buyback) —
  https://coinmarketcap.com/cmc-ai/collector-crypt/what-is/ ,
  https://nftevening.com/collector-crypt-cards/ ,
  https://www.webopedia.com/news/collector-crypt-tokenized-trading-cards-solana/
- Provably-fair server-seed/client-seed/nonce construction —
  https://provablysmart.com/provably-fair-server-seed-client-seed-nonce/ ,
  https://proofbets.com/guides/server-seed-vs-client-seed/
- On-chain VRF for Solana (Switchboard/ORAO/Pyth Entropy), commit-reveal —
  https://coinranking.com/blog/provably-fair-gaming-solana-on-chain-randomness-rugpot/ ,
  https://chain.link/article/provably-fair-randomness
- Bad-randomness NFT rarity exploitation & detection (SoK) — https://arxiv.org/pdf/2312.08000
