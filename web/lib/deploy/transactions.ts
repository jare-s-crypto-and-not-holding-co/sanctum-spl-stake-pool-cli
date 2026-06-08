/**
 * Browser-side deploy helpers for the leak.markets launch wizard.
 *
 * Pool 2 (DontLeak/Leak) transactions are built server-side using the DBC SDK
 * (correct Anchor discriminators) and returned for wallet signing.
 *
 * Pool 1 (Leak/rfstacc) is already deployed by platform bootstrap.
 */
import { Connection, Keypair, Transaction, PublicKey } from "@solana/web3.js";
import type { WalletProvider } from "./wallet";

export const LEAK_MINT     = new PublicKey("GbGAcydfEkAnvrfQGZuKNdLMJFRf2LpTKeo1eKxZ48LS");
export const POOL1_ADDRESS = new PublicKey("ze1HvkHogbWPRiR6W5DYp82YrtJTAum1WEDLrUJNjwX");
export const POOL1_CONFIG  = new PublicKey("8f6NNHdZeBjDdbECzMAb7Xd3Gttfyd2k7SGR5Qzbus6r");

export interface DeployPool2Result {
  dontLeakMint: string;
  pool2Address: string;
  sig:          string;
}

/**
 * Deploy a user's Pool 2 (DontLeak/Leak) on mainnet.
 *
 * 1. Generates ephemeral keypairs for config account + DontLeak mint (in browser)
 * 2. Fetches one combined unsigned transaction from the server
 * 3. Partial-signs with both ephemeral keypairs
 * 4. Wallet signs and sends
 */
export async function deployPool2(
  conn: Connection,
  wallet: WalletProvider,
  opts: { name: string; symbol: string; uri: string },
): Promise<DeployPool2Result> {
  const configKp   = Keypair.generate();
  const dontLeakKp = Keypair.generate();

  const res = await fetch("/api/deploy/pool2", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      payer:          wallet.publicKey.toBase58(),
      configPubkey:   configKp.publicKey.toBase58(),
      dontLeakPubkey: dontLeakKp.publicKey.toBase58(),
      name:           opts.name,
      symbol:         opts.symbol,
      uri:            opts.uri,
    }),
  });

  if (!res.ok) {
    const { error } = await res.json().catch(() => ({ error: "API error" }));
    throw new Error(error ?? "Failed to build transaction");
  }

  const { txBase64, pool2Address, blockhash, lastValidBlockHeight } = await res.json();

  const tx = Transaction.from(Buffer.from(txBase64, "base64"));

  // Partial-sign with both ephemeral keypairs (config account + DontLeak mint)
  tx.partialSign(configKp);
  tx.partialSign(dontLeakKp);

  // Wallet provides final signature + broadcasts
  const signed = await wallet.signTransaction(tx);
  const sig    = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");

  return {
    dontLeakMint: dontLeakKp.publicKey.toBase58(),
    pool2Address,
    sig,
  };
}
