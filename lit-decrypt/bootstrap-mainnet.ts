/**
 * bootstrap-mainnet.ts
 *
 * One-shot mainnet bootstrap for leak.markets.
 * Deploys all on-chain infrastructure and writes mainnet-deployment.json.
 *
 * What it does:
 *   1. Creates the platform-owned Meteora DBC PoolConfig for Pool 1
 *      (Leak / r-fstacc LST — real mainnet mint, no mock)
 *   2. Mints Leak token    (1 B supply, Token-2022, 9 decimals)
 *   3. Mints DontLeak token (1 B supply, Token-2022, 9 decimals)
 *   4. Creates a user-owned DBC PoolConfig for Pool 2 (DontLeak / Leak)
 *   5. Deploys Pool 1 (Leak / rfstacc)
 *   6. Deploys Pool 2 (DontLeak / Leak)
 *   7. Writes mainnet-deployment.json
 *
 * Prerequisites:
 *   Fund the platform keypair with at least 0.1 SOL on mainnet:
 *     Address: GYKSfwaTZXJ29vGha39ETNxkBPeBGs6KaRP2eDjaRw6U
 *
 * Run:
 *   cd lit-decrypt && npx tsx bootstrap-mainnet.ts
 */
import {
  Connection, Keypair, PublicKey, Transaction, SystemProgram,
  sendAndConfirmTransaction, TransactionInstruction, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  createInitializeMint2Instruction, getMintLen,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createMintToInstruction,
} from "@solana/spl-token";
import { readFileSync, writeFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dir = path.dirname(fileURLToPath(import.meta.url));

const RPC_URL         = process.env.SOLANA_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const SUPPLY          = BigInt("1000000000000000000"); // 1B * 10^9
const BINDING_TARGET  = BigInt("10000000000000");       // 10000 * 10^9
const DECIMALS        = 9;
const MIN_SOL         = 0.1;

const RFSTACC_MINT    = new PublicKey("pSYRpDqr847kB2nD5ZhjcPsHLV2ZpUxweXm1MwiSTcc");
const DBC_PROGRAM     = new PublicKey("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");

const DISC_CONFIG     = Buffer.from([0x9b,0x16,0x44,0x2e,0xc8,0x04,0x1b,0xf5]);
const DISC_POOL       = Buffer.from([0x11,0x37,0x20,0x9a,0x4e,0x85,0x9f,0x1d]);

function u64LE(v: bigint): Buffer { const b = Buffer.alloc(8); b.writeBigUInt64LE(v); return b; }
function u16LE(v: number): Buffer { const b = Buffer.alloc(2); b.writeUInt16LE(v); return b; }

async function createMint(c: Connection, p: Keypair, dec: number): Promise<Keypair> {
  const kp = Keypair.generate();
  const len = getMintLen([]);
  const lam = await c.getMinimumBalanceForRentExemption(len);
  const tx = new Transaction().add(
    SystemProgram.createAccount({ fromPubkey: p.publicKey, newAccountPubkey: kp.publicKey, space: len, lamports: lam, programId: TOKEN_2022_PROGRAM_ID }),
    createInitializeMint2Instruction(kp.publicKey, dec, p.publicKey, null, TOKEN_2022_PROGRAM_ID)
  );
  const sig = await sendAndConfirmTransaction(c, tx, [p, kp], { commitment: "confirmed" });
  console.log(`    mint: ${kp.publicKey.toBase58()} (${sig.slice(0,16)}...)`);
  return kp;
}

async function mintSupply(c: Connection, p: Keypair, mint: PublicKey, amount: bigint): Promise<void> {
  const ata = getAssociatedTokenAddressSync(mint, p.publicKey, false, TOKEN_2022_PROGRAM_ID);
  const tx = new Transaction();
  if (!await c.getAccountInfo(ata)) {
    tx.add(createAssociatedTokenAccountInstruction(p.publicKey, ata, p.publicKey, mint, TOKEN_2022_PROGRAM_ID));
  }
  tx.add(createMintToInstruction(mint, ata, p.publicKey, amount, [], TOKEN_2022_PROGRAM_ID));
  const sig = await sendAndConfirmTransaction(c, tx, [p], { commitment: "confirmed" });
  console.log(`    supply minted (${sig.slice(0,16)}...)`);
}

async function createConfig(c: Connection, p: Keypair, quoteMint: PublicKey, binding: bigint, initFee: number, baseFee: number, decay: number): Promise<PublicKey> {
  const kp = Keypair.generate();
  const data = Buffer.concat([DISC_CONFIG, u64LE(BigInt(100)), u64LE(BigInt(20)), u64LE(binding), u16LE(initFee), u16LE(baseFee), u64LE(BigInt(decay))]);
  const tx = new Transaction().add(new TransactionInstruction({
    programId: DBC_PROGRAM,
    keys: [
      { pubkey: kp.publicKey,             isSigner: true,  isWritable: true  },
      { pubkey: p.publicKey,              isSigner: true,  isWritable: false },
      { pubkey: quoteMint,                isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,  isSigner: false, isWritable: false },
    ],
    data,
  }));
  const sig = await sendAndConfirmTransaction(c, tx, [p, kp], { commitment: "confirmed" });
  console.log(`    config: ${kp.publicKey.toBase58()} (${sig.slice(0,16)}...)`);
  return kp.publicKey;
}

async function deployPool(c: Connection, creator: Keypair, base: PublicKey, quote: PublicKey, config: PublicKey): Promise<PublicKey> {
  const [pool] = PublicKey.findProgramAddressSync([Buffer.from("pool"), config.toBuffer(), base.toBuffer(), quote.toBuffer()], DBC_PROGRAM);
  const [ev]   = PublicKey.findProgramAddressSync([Buffer.from("__event_authority")], DBC_PROGRAM);
  const bv = getAssociatedTokenAddressSync(base,  pool, true, TOKEN_2022_PROGRAM_ID);
  const qv = getAssociatedTokenAddressSync(quote, pool, true, TOKEN_2022_PROGRAM_ID);
  const tx = new Transaction();
  if (!await c.getAccountInfo(bv)) tx.add(createAssociatedTokenAccountInstruction(creator.publicKey, bv, pool, base,  TOKEN_2022_PROGRAM_ID));
  if (!await c.getAccountInfo(qv)) tx.add(createAssociatedTokenAccountInstruction(creator.publicKey, qv, pool, quote, TOKEN_2022_PROGRAM_ID));
  tx.add(new TransactionInstruction({
    programId: DBC_PROGRAM,
    keys: [
      { pubkey: pool,                       isSigner: false, isWritable: true  },
      { pubkey: config,                     isSigner: false, isWritable: false },
      { pubkey: creator.publicKey,          isSigner: true,  isWritable: true  },
      { pubkey: base,                       isSigner: false, isWritable: false },
      { pubkey: quote,                      isSigner: false, isWritable: false },
      { pubkey: bv,                         isSigner: false, isWritable: true  },
      { pubkey: qv,                         isSigner: false, isWritable: true  },
      { pubkey: ev,                         isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId,    isSigner: false, isWritable: false },
      { pubkey: TOKEN_2022_PROGRAM_ID,      isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID,isSigner: false, isWritable: false },
    ],
    data: DISC_POOL,
  }));
  const sig = await sendAndConfirmTransaction(c, tx, [creator], { commitment: "confirmed" });
  console.log(`    pool: ${pool.toBase58()} (${sig.slice(0,16)}...)`);
  return pool;
}

(async () => {
  const conn     = new Connection(RPC_URL, "confirmed");
  const raw      = JSON.parse(readFileSync(path.join(__dir, "../platform-keypair.json"), "utf8"));
  const platform = Keypair.fromSecretKey(Uint8Array.from(raw));

  console.log("\nleak.markets — mainnet bootstrap");
  console.log(`  Platform : ${platform.publicKey.toBase58()}`);
  console.log(`  rfstacc  : ${RFSTACC_MINT.toBase58()}`);
  console.log(`  RPC      : ${RPC_URL}\n`);

  const bal = await conn.getBalance(platform.publicKey);
  console.log(`  Balance  : ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  if (bal < MIN_SOL * LAMPORTS_PER_SOL) {
    console.error(`\n  Need >= ${MIN_SOL} SOL to proceed.`);
    console.error(`  Send SOL to: ${platform.publicKey.toBase58()}`);
    process.exit(1);
  }

  console.log("\n1. Pool 1 DBC config (Leak/rfstacc, binding=10000, fee 99%->1%)...");
  const pool1Config = await createConfig(conn, platform, RFSTACC_MINT, BINDING_TARGET, 9900, 100, 500);

  console.log("\n2. Leak token mint (Token-2022, 1B supply)...");
  const leakKp = await createMint(conn, platform, DECIMALS);
  await mintSupply(conn, platform, leakKp.publicKey, SUPPLY);

  console.log("\n3. DontLeak token mint (Token-2022, 1B supply)...");
  const dontLeakKp = await createMint(conn, platform, DECIMALS);
  await mintSupply(conn, platform, dontLeakKp.publicKey, SUPPLY);

  console.log("\n4. Pool 2 DBC config (DontLeak/Leak, fee 5%->1%)...");
  const pool2Config = await createConfig(conn, platform, leakKp.publicKey, BigInt(0), 500, 100, 300);

  console.log("\n5. Deploy Pool 1 (Leak/rfstacc)...");
  const leakPool = await deployPool(conn, platform, leakKp.publicKey, RFSTACC_MINT, pool1Config);

  console.log("\n6. Deploy Pool 2 (DontLeak/Leak)...");
  const dontLeakPool = await deployPool(conn, platform, dontLeakKp.publicKey, leakKp.publicKey, pool2Config);

  const out = {
    network:             "mainnet-beta",
    platformPubkey:      platform.publicKey.toBase58(),
    rfstaccMint:         RFSTACC_MINT.toBase58(),
    leakMint:            leakKp.publicKey.toBase58(),
    dontLeakMint:        dontLeakKp.publicKey.toBase58(),
    pool1ConfigAddress:  pool1Config.toBase58(),
    pool2ConfigAddress:  pool2Config.toBase58(),
    leakPoolAddress:     leakPool.toBase58(),
    dontLeakPoolAddress: dontLeakPool.toBase58(),
    bindingTarget:       BINDING_TARGET.toString(),
    supply:              SUPPLY.toString(),
    decimals:            DECIMALS,
    createdAt:           new Date().toISOString(),
  };

  writeFileSync(path.join(__dir, "../mainnet-deployment.json"), JSON.stringify(out, null, 2));
  console.log("\n  Bootstrap complete! Saved to mainnet-deployment.json");
  console.table(out);
})();
