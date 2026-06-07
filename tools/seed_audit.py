#!/usr/bin/env python3
"""
Server-seed audit harness for off-chain "provably-fair" gacha (Phygitals /
Collector Crypt).

Premise: the pull outcome is output = f(serverSeed, clientSeed, index), where
clientSeed/index are public and f is known (see docs/gacha-rarity-analysis.md).
The ONLY secret is serverSeed, committed as sha256(serverSeed). The hash commit
is worthless if serverSeed generation is weak (time.now(), Math.random(),
sequential, MT19937/LCG, low entropy). If serverSeed is predictable, an attacker
recovers it from the published commitment BEFORE paying, computes the outcome,
and only pays on good pulls -> off-chain "minimum rarity enforcement".

This tool ingests a corpus of fairness proofs and tries to break the seed RNG.

Input JSON: a list of proofs, each:
  { "serverSeed": "<hex>", "serverSeedHash": "<hex>",
    "clientSeed": "<str>", "index": 0,
    "timestampMs": 1781000000000,        # optional, ms epoch of the draw
    "tierRandom": 0.1547667181764132 }   # optional, for construction auto-detect

Usage:  python3 tools/seed_audit.py proofs.json
Get the JSON from each platform's "Your Fairness Proofs" page (last 100 draws).
"""
import sys, json, hashlib, hmac, math, statistics
from collections import Counter

# ---------- construction (reverse-engineered; auto-verified per corpus) ----------
def commit(server_seed_hex):
    return hashlib.sha256(server_seed_hex.encode()).hexdigest()

def tier_random(server_seed_hex, client_seed, index):
    h = hmac.new(server_seed_hex.encode(),
                 f"{client_seed}:{index}".encode(), hashlib.sha256).hexdigest()
    return int(h[:13], 16) / 2**52

# ---------- 1. commitment + construction verification ----------
def verify_corpus(proofs):
    ok_commit = ok_tier = n_tier = 0
    for p in proofs:
        if commit(p["serverSeed"]) == p.get("serverSeedHash"):
            ok_commit += 1
        if "tierRandom" in p:
            n_tier += 1
            if abs(tier_random(p["serverSeed"], p["clientSeed"],
                               p.get("index", 0)) - p["tierRandom"]) < 1e-12:
                ok_tier += 1
    print(f"[verify] commitments OK {ok_commit}/{len(proofs)} | "
          f"tierRandom reproduced {ok_tier}/{n_tier}")
    if n_tier and ok_tier < n_tier:
        print("  !! construction mismatch — this platform may use a different f();"
              " seed-recovery still valid, outcome mapping needs re-derivation.")

# ---------- 2. statistical randomness of pooled seed bytes ----------
def randomness_tests(proofs):
    blob = b"".join(bytes.fromhex(p["serverSeed"]) for p in proofs)
    n = len(blob)
    if n == 0:
        return
    # byte chi-square (uniform over 256)
    cnt = Counter(blob); exp = n / 256
    chi = sum((cnt.get(b, 0) - exp) ** 2 / exp for b in range(256))
    # monobit
    bits = "".join(f"{b:08b}" for b in blob)
    ones = bits.count("1")
    z = (ones - len(bits) / 2) / math.sqrt(len(bits) / 4)
    # runs
    runs = 1 + sum(bits[i] != bits[i - 1] for i in range(1, len(bits)))
    print(f"[stat] bytes={n} chi2(255df)~{chi:.0f} (expect ~255±45) "
          f"monobit z={z:.2f} (|z|<3 ok) runs={runs}")
    if chi > 400 or abs(z) > 4:
        print("  !! seeds deviate from uniform — generation may be biased.")

# ---------- 3. timestamp-seeded brute force ----------
def timestamp_attack(proofs, window_ms=3_600_000):
    import hashlib as H
    algos = {"sha256": H.sha256, "sha1": H.sha1, "md5": H.md5}
    hit = 0
    for p in proofs:
        t = p.get("timestampMs")
        if t is None:
            continue
        target = p["serverSeed"]
        cs = p.get("clientSeed", "")
        found = None
        for ms in range(t - window_ms, t + window_ms):
            for nm, fn in algos.items():
                for cand in (str(ms), str(ms // 1000), f"{cs}{ms}", f"{ms}{cs}"):
                    if fn(cand.encode()).hexdigest() == target:
                        found = (nm, cand); break
                if found: break
            if found: break
        if found:
            hit += 1
            print(f"  !! TIMESTAMP-DERIVED seed: {found[0]}({found[1]}) == seed")
    print(f"[time] timestamp-derivation hits {hit}/"
          f"{sum('timestampMs' in p for p in proofs)} "
          f"(window ±{window_ms/1000:.0f}s, ms+sec, sha/md5)")
    if hit:
        print("  >>> BROKEN: seed recoverable from request time before payment.")

# ---------- 4. structure across the seed sequence ----------
def sequence_attacks(proofs):
    seeds = [int(p["serverSeed"], 16) for p in proofs]  # 256-bit ints, chronological
    if len(seeds) < 3:
        print("[seq] need >=3 consecutive proofs for sequence attacks"); return
    diffs = [seeds[i] - seeds[i - 1] for i in range(1, len(seeds))]
    if len(set(diffs)) == 1:
        print(f"  !! SEQUENTIAL seeds, constant step {diffs[0]} -> fully predictable")
    # low 32-bit LCG fit on the trailing word (common when seed = PRNG bytes)
    lo = [s & 0xFFFFFFFF for s in seeds]
    if len(lo) >= 3:
        try:
            m = 2**32
            d0 = (lo[1] - lo[0]) % m; d1 = (lo[2] - lo[1]) % m
            if d0:
                a = (d1 * pow(d0, -1, m)) % m
                c = (lo[1] - a * lo[0]) % m
                if all((a * lo[i] + c) % m == lo[i + 1] for i in range(len(lo) - 1)):
                    print(f"  !! LCG fit on low32: a={a} c={c} -> predictable")
        except Exception:
            pass
    # word-level entropy: do high/low halves look independent?
    words = []
    for p in proofs:
        b = bytes.fromhex(p["serverSeed"])
        words += [int.from_bytes(b[i:i+4], "big") for i in range(0, len(b), 4)]
    distinct = len(set(words)) / len(words) if words else 0
    print(f"[seq] words={len(words)} distinct={distinct:.3f} (≈1.0 expected) "
          f"-> MT19937 needs 624 words (have {len(words)}); "
          f"feed >=78 proofs to attempt MT recovery")
    # NOTE: full MT19937 untempering / xorshift128+ recovery is run only when the
    # seeds are confirmed to be raw PRNG output; hook left intentionally explicit.

# ---------- 5. outcome uniformity + odds conformance (operator bias) ----------
def outcome_tests(proofs):
    trs = []
    for p in proofs:
        try:
            trs.append(tier_random(p["serverSeed"], p["clientSeed"], p.get("index", 0)))
        except Exception:
            pass
    if len(trs) < 10:
        return
    # KS vs uniform(0,1)
    s = sorted(trs); n = len(s)
    d = max(max((i + 1) / n - x, x - i / n) for i, x in enumerate(s))
    crit = 1.36 / math.sqrt(n)
    print(f"[outcome] n={n} tierRandom KS D={d:.3f} crit(5%)={crit:.3f} "
          f"{'BIASED' if d > crit else 'uniform-consistent'}")

def main():
    if len(sys.argv) < 2:
        print(__doc__); sys.exit(1)
    proofs = json.load(open(sys.argv[1]))
    if isinstance(proofs, dict):
        proofs = proofs.get("proofs") or proofs.get("selections") or [proofs]
    # assume already chronological; sort by timestamp if present
    if all("timestampMs" in p for p in proofs):
        proofs.sort(key=lambda p: p["timestampMs"])
    print(f"loaded {len(proofs)} proofs\n")
    verify_corpus(proofs)
    randomness_tests(proofs)
    timestamp_attack(proofs)
    sequence_attacks(proofs)
    outcome_tests(proofs)
    print("\nVerdict: any '!!'/'BROKEN'/'BIASED' line above means the seed RNG is "
          "predictable or biased -> outcomes are 'sus'-able before payment.")

if __name__ == "__main__":
    main()
