// Задание 10. История своих депозитов и выводов.
import { EXPLORER } from "../config";
import type { HistoryItem, HistoryKind } from "../lib/history";

const LABELS: Record<HistoryKind, string> = {
  create_user_card: "Карточка создана",
  deposit: "Внесение",
  withdraw: "Вывод",
  withdraw_all: "Вывод всего",
  close_user_card: "Карточка закрыта",
  other: "Другое",
};

interface Props {
  items: HistoryItem[] | null; // null — грузим
  error: string;
  tokenFmt: (raw: bigint) => string;
  shareFmt: (raw: bigint) => string;
}

const signed = (v: bigint, fmt: (raw: bigint) => string) => (v > 0n ? `+${fmt(v)}` : v < 0n ? `−${fmt(-v)}` : "");

const when = (time: number | null) =>
  time === null
    ? "—"
    : new Date(time * 1000).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function HistoryCard({ items, error, tokenFmt, shareFmt }: Props) {
  return (
    <section className="card">
      <h2>История</h2>
      {error && <p className="bad small">Не удалось загрузить историю: {error}</p>}
      {!error && items === null && <p className="muted">Загружаем…</p>}
      {items && items.length === 0 && <p className="muted">Операций пока нет.</p>}
      {items && items.length > 0 && (
        <table className="history">
          <thead>
            <tr>
              <th>Когда</th>
              <th>Операция</th>
              <th>Токены</th>
              <th>Shares</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.signature} className={it.ok ? "" : "failed"}>
                <td>{when(it.time)}</td>
                <td>
                  {LABELS[it.kind]}
                  {!it.ok && <span className="bad"> · ошибка</span>}
                </td>
                <td className={it.tokenDelta > 0n ? "plus" : it.tokenDelta < 0n ? "minus" : ""}>
                  {signed(it.tokenDelta, tokenFmt)}
                </td>
                <td className={it.shareDelta > 0n ? "plus" : it.shareDelta < 0n ? "minus" : ""}>
                  {signed(it.shareDelta, shareFmt)}
                </td>
                <td>
                  <a href={EXPLORER("tx", it.signature)} target="_blank" rel="noreferrer">
                    Explorer
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="muted small">
        Последние 15 транзакций вашей карточки (<code>getSignaturesForAddress</code>). Суммы — по изменению балансов
        кошелька: при внесении списывается сумма вместе с комиссией 1%.
      </p>
    </section>
  );
}
