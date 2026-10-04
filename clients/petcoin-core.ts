// PETCOIN as a real Token-2022 token (course week 7). Shared by clients/petcoin.ts and tests/petcoin.ts.
//
// One mint account carries three extensions, no separate Metaplex account:
//   TransferFeeConfig — 1% of every transfer is withheld on the recipient's token account (game treasury fee)
//   MetadataPointer   — "my metadata lives at <address>"; here it points at the mint itself
//   TokenMetadata     — name / symbol / uri / extra key-value fields stored inside the mint

import {
  ExtensionType,
  TOKEN_2022_PROGRAM_ID,
  TokenAccountNotFoundError,
  calculateEpochFee,
  createAssociatedTokenAccountIdempotentInstruction,
  createBurnCheckedInstruction,
  createHarvestWithheldTokensToMintInstruction,
  createInitializeMetadataPointerInstruction,
  createInitializeMintInstruction,
  createInitializeTransferFeeConfigInstruction,
  createMintToCheckedInstruction,
  createTransferCheckedWithFeeInstruction,
  createWithdrawWithheldTokensFromMintInstruction,
  getAccount,
  getAssociatedTokenAddressSync,
  getMint,
  getMintLen,
  getTransferFeeAmount,
  getTransferFeeConfig,
  unpackAccount,
} from "@solana/spl-token";
import {
  createInitializeInstruction,
  createRemoveKeyInstruction,
  createUpdateFieldInstruction,
  pack,
  type TokenMetadata,
} from "@solana/spl-token-metadata";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  type AccountInfo,
  type Signer,
  type TransactionInstruction,
} from "@solana/web3.js";

export const PETCOIN = {
  name: "PetCoin",
  symbol: "PET",
  decimals: 6,
  /** Off-chain JSON (image, description). Served by the frontend dev server: frontend/public/petcoin/metadata.json */
  uri: process.env.PETCOIN_URI ?? "http://localhost:5173/petcoin/metadata.json",
  /** 100 bps = 1% of each transfer. */
  feeBasisPoints: 100,
  /** Fee cap per transfer: 5 PET. */
  maxFee: 5_000_000n,
  additionalMetadata: [
    ["game", "PetNFT"],
    ["utility", "mini-games, quests, marketplace"],
  ] as [string, string][],
};

/** "12.5" -> 12_500_000n for 6 decimals. Strings, not floats, so 0.1 + 0.2 never leaks into token amounts. */
export function parseAmount(value: string, decimals = PETCOIN.decimals): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value.trim());
  if (!match) throw new Error(`Invalid amount "${value}"`);
  const [, whole, fraction = ""] = match;
  if (fraction.length > decimals) throw new Error(`"${value}" has more than ${decimals} decimals`);
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, "0"));
}

export function formatAmount(raw: bigint, decimals = PETCOIN.decimals): string {
  const base = 10n ** BigInt(decimals);
  const fraction = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${raw / base}${fraction ? `.${fraction}` : ""}`;
}

export async function send(conn: Connection, payer: Signer, ixs: TransactionInstruction[], extraSigners: Signer[] = []) {
  return sendAndConfirmTransaction(conn, new Transaction().add(...ixs), [payer, ...extraSigners], { commitment: "confirmed" });
}

export const petcoinAta = (mint: PublicKey, owner: PublicKey) =>
  getAssociatedTokenAddressSync(mint, owner, false, TOKEN_2022_PROGRAM_ID);

/**
 * Creates the PETCOIN mint in one transaction. Order matters: extensions that live in the fixed part of the
 * mint (TransferFeeConfig, MetadataPointer) must be initialized BEFORE InitializeMint; TokenMetadata is
 * variable-length and is written after it — the token program reallocs the account, so the rent for the
 * metadata bytes has to be paid up front in createAccount.
 */
export async function createPetcoinMint(
  conn: Connection,
  payer: Signer,
  authority: PublicKey,
  options: { mint?: Keypair; uri?: string } = {},
) {
  const mint = options.mint ?? Keypair.generate();
  const metadata: TokenMetadata = {
    mint: mint.publicKey,
    updateAuthority: authority,
    name: PETCOIN.name,
    symbol: PETCOIN.symbol,
    uri: options.uri ?? PETCOIN.uri,
    additionalMetadata: PETCOIN.additionalMetadata,
  };
  const mintLen = getMintLen([ExtensionType.TransferFeeConfig, ExtensionType.MetadataPointer]);
  const metadataLen = 2 + 2 + pack(metadata).length; // TLV: 2-byte type + 2-byte length + data
  const lamports = await conn.getMinimumBalanceForRentExemption(mintLen + metadataLen);

  const ixs: TransactionInstruction[] = [
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mint.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeTransferFeeConfigInstruction(
      mint.publicKey,
      authority, // may change the fee
      authority, // may withdraw withheld fees
      PETCOIN.feeBasisPoints,
      PETCOIN.maxFee,
      TOKEN_2022_PROGRAM_ID,
    ),
    createInitializeMetadataPointerInstruction(mint.publicKey, authority, mint.publicKey, TOKEN_2022_PROGRAM_ID),
    createInitializeMintInstruction(mint.publicKey, PETCOIN.decimals, authority, null, TOKEN_2022_PROGRAM_ID),
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint.publicKey,
      updateAuthority: authority,
      mint: mint.publicKey,
      mintAuthority: authority,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
    }),
    ...metadata.additionalMetadata.map(([field, value]) =>
      createUpdateFieldInstruction({
        programId: TOKEN_2022_PROGRAM_ID,
        metadata: mint.publicKey,
        updateAuthority: authority,
        field,
        value,
      }),
    ),
  ];
  const signature = await send(conn, payer, ixs, [mint]);
  return { mint: mint.publicKey, signature };
}

/** Mints `amount` raw units to `owner`'s associated token account, creating it if needed. */
export async function mintPetcoin(conn: Connection, payer: Signer, mintAuthority: Signer, mint: PublicKey, owner: PublicKey, amount: bigint) {
  const ata = petcoinAta(mint, owner);
  const signature = await send(
    conn,
    payer,
    [
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, ata, owner, mint, TOKEN_2022_PROGRAM_ID),
      createMintToCheckedInstruction(mint, ata, mintAuthority.publicKey, amount, PETCOIN.decimals, [], TOKEN_2022_PROGRAM_ID),
    ],
    mintAuthority.publicKey.equals(payer.publicKey) ? [] : [mintAuthority],
  );
  return { ata, signature };
}

/** Fee the token program will withhold for `amount` in the current epoch. */
export async function expectedFee(conn: Connection, mint: PublicKey, amount: bigint) {
  const config = getTransferFeeConfig(await getMint(conn, mint, "confirmed", TOKEN_2022_PROGRAM_ID));
  if (!config) return 0n;
  return calculateEpochFee(config, BigInt((await conn.getEpochInfo()).epoch), amount);
}

/**
 * TransferCheckedWithFee: the sender states the fee explicitly and the program rejects the transfer if it
 * disagrees, so a fee change between signing and execution can never surprise the sender.
 */
export async function transferPetcoin(
  conn: Connection,
  payer: Signer,
  owner: Signer,
  mint: PublicKey,
  to: PublicKey,
  amount: bigint,
  fee?: bigint,
) {
  const source = petcoinAta(mint, owner.publicKey);
  const destination = petcoinAta(mint, to);
  const actualFee = fee ?? (await expectedFee(conn, mint, amount));
  const signature = await send(
    conn,
    payer,
    [
      createAssociatedTokenAccountIdempotentInstruction(payer.publicKey, destination, to, mint, TOKEN_2022_PROGRAM_ID),
      createTransferCheckedWithFeeInstruction(
        source,
        mint,
        destination,
        owner.publicKey,
        amount,
        PETCOIN.decimals,
        actualFee,
        [],
        TOKEN_2022_PROGRAM_ID,
      ),
    ],
    owner.publicKey.equals(payer.publicKey) ? [] : [owner],
  );
  return { signature, fee: actualFee, destination };
}

export async function burnPetcoin(conn: Connection, owner: Signer, mint: PublicKey, amount: bigint) {
  return send(conn, owner, [
    createBurnCheckedInstruction(petcoinAta(mint, owner.publicKey), mint, owner.publicKey, amount, PETCOIN.decimals, [], TOKEN_2022_PROGRAM_ID),
  ]);
}

/** Sets a metadata field (name / symbol / uri / any custom key). Tops up rent first if the mint grows. */
export async function updatePetcoinField(conn: Connection, updateAuthority: Signer, mint: PublicKey, field: string, value: string) {
  const info = await conn.getAccountInfo(mint, "confirmed");
  if (!info) throw new Error(`Mint ${mint.toBase58()} not found`);
  const ixs: TransactionInstruction[] = [];
  // Worst case the account grows by the new key + value (+ 8 bytes of length prefixes).
  const needed = await conn.getMinimumBalanceForRentExemption(info.data.length + field.length + value.length + 8);
  if (needed > info.lamports) {
    ixs.push(SystemProgram.transfer({ fromPubkey: updateAuthority.publicKey, toPubkey: mint, lamports: needed - info.lamports }));
  }
  ixs.push(
    createUpdateFieldInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority: updateAuthority.publicKey,
      field,
      value,
    }),
  );
  return send(conn, updateAuthority, ixs);
}

export async function removePetcoinField(conn: Connection, updateAuthority: Signer, mint: PublicKey, key: string) {
  return send(conn, updateAuthority, [
    createRemoveKeyInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      metadata: mint,
      updateAuthority: updateAuthority.publicKey,
      key,
      idempotent: false,
    }),
  ]);
}

/**
 * Every PETCOIN token account: Token-2022 accounts whose first 32 bytes (the mint field) equal our mint.
 * Public devnet RPC refuses getProgramAccounts for the Token-2022 program ("excluded from account secondary
 * indexes"), so there we fall back to the mint's transaction history: every transfer/mint/burn lists the mint,
 * and its postTokenBalances name the token accounts involved.
 */
export async function petcoinHolders(conn: Connection, mint: PublicKey) {
  let accounts: { pubkey: PublicKey; account: AccountInfo<Buffer> }[];
  try {
    accounts = [
      ...(await conn.getProgramAccounts(TOKEN_2022_PROGRAM_ID, {
        commitment: "confirmed",
        filters: [{ memcmp: { offset: 0, bytes: mint.toBase58() } }],
      })),
    ];
  } catch (err) {
    if (!/secondary indexes|unavailable/i.test(String(err))) throw err;
    const addresses = await tokenAccountsFromHistory(conn, mint);
    const infos = await conn.getMultipleAccountsInfo(addresses, "confirmed");
    accounts = addresses.flatMap((pubkey, i) => (infos[i] ? [{ pubkey, account: infos[i]! }] : [])); // skip closed accounts
  }
  return accounts.map(({ pubkey, account }) => {
    const token = unpackAccount(pubkey, account, TOKEN_2022_PROGRAM_ID);
    return { address: pubkey, owner: token.owner, amount: token.amount, withheld: getTransferFeeAmount(token)?.withheldAmount ?? 0n };
  });
}

async function tokenAccountsFromHistory(conn: Connection, mint: PublicKey) {
  const signatures: string[] = [];
  for (let before: string | undefined; ; ) {
    const page = await conn.getSignaturesForAddress(mint, { before, limit: 1000 }, "confirmed");
    signatures.push(...page.filter((s) => !s.err).map((s) => s.signature));
    if (page.length < 1000) break;
    before = page[page.length - 1].signature;
  }
  const found = new Set<string>();
  // One request at a time: public devnet answers batched getTransaction calls with 429.
  for (const signature of signatures) {
    const tx = await conn.getParsedTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    for (const balance of tx?.meta?.postTokenBalances ?? []) {
      if (balance.mint === mint.toBase58()) found.add(tx!.transaction.message.accountKeys[balance.accountIndex].pubkey.toBase58());
    }
  }
  return [...found].map((address) => new PublicKey(address));
}

/**
 * Collects transfer fees into the authority's own token account in two steps:
 *   HarvestWithheldTokensToMint   — permissionless: moves withheld fees from holder accounts into the mint
 *   WithdrawWithheldTokensFromMint — only the withdraw authority: mint -> destination
 */
export async function collectPetcoinFees(conn: Connection, authority: Signer, mint: PublicKey) {
  const sources = (await petcoinHolders(conn, mint)).filter((h) => h.withheld > 0n).map((h) => h.address);
  const destination = petcoinAta(mint, authority.publicKey);
  const ixs: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(authority.publicKey, destination, authority.publicKey, mint, TOKEN_2022_PROGRAM_ID),
  ];
  // Keep the transaction under the 1232-byte limit: ~20 source accounts per harvest instruction.
  for (let i = 0; i < sources.length; i += 20) {
    ixs.push(createHarvestWithheldTokensToMintInstruction(mint, sources.slice(i, i + 20), TOKEN_2022_PROGRAM_ID));
  }
  ixs.push(createWithdrawWithheldTokensFromMintInstruction(mint, destination, authority.publicKey, [], TOKEN_2022_PROGRAM_ID));
  const before = await balanceOf(conn, mint, authority.publicKey);
  const signature = await send(conn, authority, ixs);
  return { signature, collected: (await balanceOf(conn, mint, authority.publicKey)) - before, sources: sources.length };
}

export async function balanceOf(conn: Connection, mint: PublicKey, owner: PublicKey) {
  try {
    return (await getAccount(conn, petcoinAta(mint, owner), "confirmed", TOKEN_2022_PROGRAM_ID)).amount;
  } catch (err) {
    if (err instanceof TokenAccountNotFoundError) return 0n; // no token account yet
    throw err;
  }
}
