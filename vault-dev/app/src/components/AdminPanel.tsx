// Задание 11. Панель админа: кнопка sync_vault (и пауза депозитов из задания 3).
// App показывает панель, только если подключён кошелёк админа vault (VaultState.admin).
// Это лишь удобство интерфейса: защищает контракт — has_one = admin в SyncVault/AdminOnly.
// Чужой кошелёк, даже собрав транзакцию вручную, получит ошибку Unauthorized.
import type { VaultView } from "../lib/vault";

interface Props {
  vault: VaultView;
  tokenB: bigint | null; // TOKEN_B у vault; null — пара не задана
  busy: boolean;
  tokenFmt: (raw: bigint) => string;
  onSync: () => void;
  onTogglePause: () => void;
}

/** Почему sync_vault сейчас не пройдёт (те же проверки, что в raydium.rs::sync_vault). */
export function syncBlockedReason(vault: VaultView, tokenB: bigint | null): string | undefined {
  if (!vault.pairSet) return "Пара TOKEN_B не задана (add_pair_token) — синхронизировать нечего.";
  if (vault.positionOpen) return "Позиция в пуле ещё открыта: сначала close_position.";
  if (tokenB === null) return "Загружаем баланс TOKEN_B…";
  if (tokenB > 0n) return "У vault ещё есть TOKEN_B: сначала swap B → A.";
  if (!vault.inMarket) return "Vault уже в обычном режиме.";
  return undefined;
}

export function AdminPanel({ vault, tokenB, busy, tokenFmt, onSync, onTogglePause }: Props) {
  const blocked = syncBlockedReason(vault, tokenB);
  return (
    <section className="card admin">
      <h2>Панель админа</h2>
      <dl className="stats">
        <div>
          <dt>TOKEN_B у vault</dt>
          <dd>{tokenB === null ? "—" : tokenB.toString()}</dd>
        </div>
        <div>
          <dt>Комиссий Raydium собрано</dt>
          <dd>
            {tokenFmt(vault.totalFeesA)} · {vault.totalFeesB.toString()} B
          </dd>
        </div>
        <div>
          <dt>Депозиты</dt>
          <dd>{vault.paused ? <span className="warn">На паузе</span> : "Открыты"}</dd>
        </div>
      </dl>

      <div className="actions">
        <div className="action">
          <h3>sync_vault</h3>
          <p className="hint">
            Вернуть vault в обычный режим: <code>total_tokens</code> станет равен реальному балансу TOKEN_A, прибыль
            или убыток разделятся на все shares.
          </p>
          <p className="hint">{blocked ?? "Можно синхронизировать."}</p>
          <button disabled={busy || !!blocked} onClick={onSync}>
            {busy ? "Ждём подтверждения…" : "Синхронизировать"}
          </button>
        </div>
        <div className="action">
          <h3>Пауза депозитов</h3>
          <p className="hint">На паузе новые депозиты отклоняются (VaultPaused), вывод остаётся доступен.</p>
          <button className={vault.paused ? "" : "ghost"} disabled={busy} onClick={onTogglePause}>
            {vault.paused ? "Снять паузу" : "Поставить на паузу"}
          </button>
        </div>
      </div>
    </section>
  );
}
