// Задание 12. Обновлять данные сразу, когда меняется vault, а не раз в 20 секунд.
//
// connection.onAccountChange(адрес, колбэк) открывает подписку через WebSocket RPC
// (адрес wss:// Connection берёт из https:// сам). Нода присылает новое состояние аккаунта,
// как только транзакция с ним подтверждена — без опроса.
//
// Одна транзакция обычно меняет несколько аккаунтов сразу (vault, карточку, токен-аккаунты):
// чтобы не грузить данные 4 раза подряд, колбэки собираются в один вызов (debounce).

import type { Commitment, Connection, PublicKey } from "@solana/web3.js";

/** Вызывает `fn` один раз через `ms` после последнего вызова. `cancel` — отменить ожидающий вызов. */
export function debounce(fn: () => void, ms: number): { call: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    call() {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        fn();
      }, ms);
    },
    cancel() {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

/** Убрать повторы адресов (например, один и тот же ATA для разных ролей). */
export function uniqueKeys(keys: PublicKey[]): PublicKey[] {
  const seen = new Set<string>();
  return keys.filter((k) => {
    const s = k.toBase58();
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

/**
 * Подписаться на изменения аккаунтов. `onChange` получает адрес изменившегося аккаунта
 * (вызовы уже собраны debounce — один вызов на пачку изменений, адрес последнего).
 * Возвращает отписку: её обязательно вызвать при смене кошелька и размонтировании,
 * иначе подписки копятся и WebSocket держит лишние каналы.
 */
export function watchAccounts(
  connection: Connection,
  keys: PublicKey[],
  onChange: (changed: PublicKey) => void,
  opts: { debounceMs?: number; commitment?: Commitment } = {}
): () => void {
  let last: PublicKey | undefined;
  const fire = debounce(() => last && onChange(last), opts.debounceMs ?? 300);
  const ids = uniqueKeys(keys).map((key) =>
    connection.onAccountChange(
      key,
      () => {
        last = key;
        fire.call();
      },
      { commitment: opts.commitment ?? "confirmed" }
    )
  );
  return () => {
    fire.cancel();
    // removeAccountChangeListener — промис; ошибки отписки (сокет уже закрыт) не важны
    for (const id of ids) connection.removeAccountChangeListener(id).catch(() => {});
  };
}
