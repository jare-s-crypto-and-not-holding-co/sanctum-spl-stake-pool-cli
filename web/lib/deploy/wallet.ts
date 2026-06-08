/**
 * Minimal wallet connector for Phantom / Solflare / any window.solana wallet.
 * Uses the Wallet Standard rather than the full wallet-adapter package.
 */
import { Connection, Transaction, PublicKey } from "@solana/web3.js";

export type WalletProvider = {
  publicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
};

declare global {
  interface Window {
    solana?: {
      publicKey: { toBase58(): string } | null;
      isPhantom?: boolean;
      connect: (opts?: { onlyIfTrusted?: boolean }) => Promise<{ publicKey: { toBase58(): string } }>;
      disconnect: () => Promise<void>;
      signTransaction: (tx: Transaction) => Promise<Transaction>;
      signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
    };
    solflare?: {
      publicKey: { toBase58(): string } | null;
      isSolflare?: boolean;
      connect: () => Promise<void>;
      disconnect: () => Promise<void>;
      signTransaction: (tx: Transaction) => Promise<Transaction>;
      signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
    };
  }
}

export function detectWallet(): "phantom" | "solflare" | "none" {
  if (typeof window === "undefined") return "none";
  if (window.solana?.isPhantom) return "phantom";
  if (window.solflare?.isSolflare) return "solflare";
  if (window.solana) return "phantom";  // other wallets injecting window.solana
  return "none";
}

export async function connectWallet(): Promise<WalletProvider> {
  const type = detectWallet();
  if (type === "none") {
    throw new Error("No Solana wallet detected. Install Phantom or Solflare.");
  }

  if (type === "solflare" && window.solflare) {
    await window.solflare.connect();
    const pkStr = window.solflare.publicKey?.toBase58();
    if (!pkStr) throw new Error("Solflare connection failed");
    return {
      publicKey: new PublicKey(pkStr),
      signTransaction: (tx) => window.solflare!.signTransaction(tx),
      signAllTransactions: (txs) => window.solflare!.signAllTransactions(txs),
    };
  }

  const resp = await window.solana!.connect();
  const pkStr = resp.publicKey.toBase58();
  return {
    publicKey: new PublicKey(pkStr),
    signTransaction: (tx) => window.solana!.signTransaction(tx),
    signAllTransactions: (txs) => window.solana!.signAllTransactions(txs),
  };
}

/** Sign the tx with any ephemeral co-signers, then sign+send via wallet. */
export async function signAndSend(
  conn: Connection,
  wallet: WalletProvider,
  tx: Transaction,
  coSigners: { publicKey: PublicKey; secretKey: Uint8Array }[]
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = blockhash;
  tx.feePayer = wallet.publicKey;

  // Co-sign with ephemeral keypairs first
  if (coSigners.length > 0) {
    const { Keypair } = await import("@solana/web3.js");
    for (const s of coSigners) {
      const kp = Keypair.fromSecretKey(s.secretKey);
      tx.partialSign(kp);
    }
  }

  const signed = await wallet.signTransaction(tx);
  const sig    = await conn.sendRawTransaction(signed.serialize(), { skipPreflight: false });

  await conn.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}
