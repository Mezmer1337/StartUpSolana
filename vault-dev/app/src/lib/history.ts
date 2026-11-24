// Задание 10. История депозитов и выводов пользователя.
//
// Карточка пользователя (PDA) участвует в каждой его операции с vault: create_user_card, deposit,
// withdraw, withdraw_all, close_user_card. Поэтому connection.getSignaturesForAddress(карточка)
// возвращает ровно историю этого пользователя в этом vault — без чужих транзакций.
//
// Что произошло в транзакции, узнаём так:
//   - какая инструкция — декодируем данные инструкций нашей программы по IDL (8 байт discriminator);
//   - сколько токенов и shares — по разнице балансов пользователя до/после (meta.pre/postTokenBalances).
//     Так видно реальное движение денег: при депозите списано 100 TOKEN_A (вместе с комиссией 1%),
//     а пришло 99 shares.

import type { Connection, PublicKey, VersionedTransactionResponse } from "@solana/web3.js";

export type HistoryKind = "create_user_card" | "deposit" | "withdraw" | "withdraw_all" | "close_user_card" | "other";

export interface HistoryItem {
  signature: string;
  time: number | null; // unix-время в секундах (blockTime), null — RPC не знает
  kind: HistoryKind;
  ok: boolean; // false — транзакция упала (деньги не двигались)
  tokenDelta: bigint; // изменение TOKEN_A на кошельке пользователя (+ пришло, − ушло)
  shareDelta: bigint; // изменение shares на кошельке пользователя
}

/** То, что нужно из meta.preTokenBalances / postTokenBalances. */
export interface TokenBalanceLite {
  mint: string;
  owner?: string;
  uiTokenAmount: { amount: string };
}

const KINDS: HistoryKind[] = ["deposit", "withdraw_all", "withdraw", "create_user_card", "close_user_card"];

/** "withdrawAll" и "withdraw_all" → "withdraw_all": декодер может вернуть имя в любом из стилей. */
export const snakeCase = (name: string) => name.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** Какая операция пользователя в транзакции (по именам инструкций нашей программы). */
export function kindOf(ixNames: string[]): HistoryKind {
  const names = ixNames.map(snakeCase);
  return KINDS.find((k) => names.includes(k)) ?? "other";
}

/** Сколько токенов `mint` у `owner` стало больше (+) или меньше (−) после транзакции. */
export function ownerDelta(
  pre: TokenBalanceLite[] | null | undefined,
  post: TokenBalanceLite[] | null | undefined,
  mint: string,
  owner: string
): bigint {
  const sum = (list: TokenBalanceLite[] | null | undefined) =>
    (list ?? [])
      .filter((b) => b.mint === mint && b.owner === owner)
      .reduce((acc, b) => acc + BigInt(b.uiTokenAmount.amount), 0n);
  return sum(post) - sum(pre);
}

export interface RawTx {
  signature: string;
  blockTime: number | null | undefined;
  failed: boolean;
  ixNames: string[];
  preTokenBalances: TokenBalanceLite[] | null | undefined;
  postTokenBalances: TokenBalanceLite[] | null | undefined;
}

/** Одна строка истории из уже разобранной транзакции. Чистая функция — покрыта тестами. */
export function summarize(tx: RawTx, user: string, tokenMint: string, shareMint: string): HistoryItem {
  return {
    signature: tx.signature,
    time: tx.blockTime ?? null,
    kind: kindOf(tx.ixNames),
    ok: !tx.failed,
    tokenDelta: tx.failed ? 0n : ownerDelta(tx.preTokenBalances, tx.postTokenBalances, tokenMint, user),
    shareDelta: tx.failed ? 0n : ownerDelta(tx.preTokenBalances, tx.postTokenBalances, shareMint, user),
  };
}

/** Имена инструкций нашей программы в транзакции. `decode` — program.coder.instruction.decode. */
export function programIxNames(
  tx: VersionedTransactionResponse,
  programId: PublicKey,
  decode: (data: Buffer) => { name: string } | null
): string[] {
  const message = tx.transaction.message;
  // ID программы всегда среди статических ключей (из lookup-таблиц программы не вызываются)
  const keys = message.staticAccountKeys;
  const names: string[] = [];
  for (const ix of message.compiledInstructions) {
    if (!keys[ix.programIdIndex]?.equals(programId)) continue;
    try {
      const decoded = decode(Buffer.from(ix.data));
      if (decoded) names.push(decoded.name);
    } catch {
      // не наша версия IDL — пропускаем
    }
  }
  return names;
}

/**
 * Загрузить историю: последние `limit` транзакций карточки, новые сверху.
 * Нет карточки и не было — пустой список.
 */
export async function fetchHistory(opts: {
  connection: Connection;
  card: PublicKey;
  user: PublicKey;
  tokenMint: PublicKey;
  shareMint: PublicKey;
  programId: PublicKey;
  decode: (data: Buffer) => { name: string } | null;
  limit?: number;
}): Promise<HistoryItem[]> {
  const { connection, card, user, tokenMint, shareMint, programId, decode } = opts;
  const sigs = await connection.getSignaturesForAddress(card, { limit: opts.limit ?? 15 }, "confirmed");
  if (sigs.length === 0) return [];

  const txs = await connection.getTransactions(
    sigs.map((s) => s.signature),
    { maxSupportedTransactionVersion: 0, commitment: "confirmed" }
  );

  return sigs.map((sig, i) => {
    const tx = txs[i];
    return summarize(
      {
        signature: sig.signature,
        blockTime: tx?.blockTime ?? sig.blockTime,
        failed: sig.err !== null || !!tx?.meta?.err,
        ixNames: tx ? programIxNames(tx, programId, decode) : [],
        preTokenBalances: tx?.meta?.preTokenBalances,
        postTokenBalances: tx?.meta?.postTokenBalances,
      },
      user.toBase58(),
      tokenMint.toBase58(),
      shareMint.toBase58()
    );
  });
}
