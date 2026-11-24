import { useCallback, useEffect, useRef, useState } from "react";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { ActionForm } from "./components/ActionForm";
import { AdminPanel } from "./components/AdminPanel";
import { HistoryCard } from "./components/HistoryCard";
import { EXPLORER, PROGRAM_ID, TOKEN_MINT, TOKEN_SYMBOL } from "./config";
import { formatAmount } from "./lib/amount";
import { describeError } from "./lib/errors";
import { fetchHistory, type HistoryItem } from "./lib/history";
import { watchAccounts } from "./lib/live";
import { depositFee, previewDepositShares, previewWithdraw } from "./lib/math";
import {
  cardPda,
  closeCard,
  connection,
  createCard,
  deposit,
  getProgram,
  loadUser,
  loadVault,
  loadVaultTokenB,
  setPaused,
  shareMintPda,
  syncVault,
  vaultPda,
  vaultTokensPda,
  withdraw,
  withdrawAll,
  type UserView,
  type VaultView,
} from "./lib/vault";
import {
  connectInjected,
  devWallet,
  hasInjectedWallet,
  onInjectedEvent,
  type BrowserWallet,
} from "./lib/wallet";

const SHARE_DECIMALS = 6; // share_mint в контракте: mint::decimals = 6
const MIN_SOL = 0.005; // примерно на создание карточки и пары аккаунтов

type Status = { kind: "ok" | "error"; text: string; sig?: string } | null;

const short = (key: string) => `${key.slice(0, 4)}…${key.slice(-4)}`;

export default function App() {
  const [wallet, setWallet] = useState<BrowserWallet | null>(null);
  const [vault, setVault] = useState<VaultView | null | undefined>(undefined); // undefined = грузим
  const [user, setUser] = useState<UserView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [history, setHistory] = useState<HistoryItem[] | null>(null); // задание 10; null = грузим
  const [historyError, setHistoryError] = useState("");
  const [tokenB, setTokenB] = useState<bigint | null>(null); // задание 11: TOKEN_B у vault для админа
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null); // задание 12

  // Текущий кошелёк для асинхронного кода: замыкание могло запомнить уже старый
  const walletRef = useRef<BrowserWallet | null>(null);
  walletRef.current = wallet;
  const requestId = useRef(0);
  // Пользователь сам нажал «Подключить» или «Отключить» — тихое автоподключение больше не вмешивается
  const userChoseWallet = useRef(false);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    const w = walletRef.current;
    // Ответ устарел, если за это время начался новый запрос или сменился кошелёк:
    // иначе медленный ответ для кошелька A перезапишет данные кошелька B
    const stale = () => id !== requestId.current || walletRef.current !== w;
    try {
      const [v, u] = await Promise.all([loadVault(), w ? loadUser(w.publicKey) : null]);
      // Админу ещё нужен баланс TOKEN_B (sync_vault требует 0) — остальным не грузим
      const b = v && w && v.admin.equals(w.publicKey) ? await loadVaultTokenB(v) : null;
      if (stale()) return;
      setVault(v);
      setUser(u);
      setTokenB(b);
      setLoadError("");
      setLastUpdate(new Date());
    } catch (e) {
      if (stale()) return;
      setLoadError(describeError(e));
    }
  }, []);

  // Сменился кошелёк — сразу убираем чужие балансы и грузим свои
  useEffect(() => {
    setUser(null);
    setLoadError("");
    setHistory(null);
    setHistoryError("");
    refresh();
  }, [wallet, refresh]);

  // Задание 12. Вместо опроса раз в 20 секунд — подписки onAccountChange на всё, что показывает сайт:
  // vault и его токены, а с кошельком — карточку, ATA для TOKEN_A и shares и сам кошелёк (SOL).
  // Любое изменение (своя транзакция, чужой депозит, sync_vault админа) → refresh() почти сразу.
  const vaultB = vault?.pairSet ? vault.vaultTokenAccountB.toBase58() : null;
  useEffect(() => {
    const keys = [vaultPda, vaultTokensPda];
    if (wallet) {
      const owner = wallet.publicKey;
      keys.push(
        cardPda(owner),
        getAssociatedTokenAddressSync(TOKEN_MINT, owner),
        getAssociatedTokenAddressSync(shareMintPda, owner),
        owner
      );
    }
    if (vaultB) keys.push(new PublicKey(vaultB));
    return watchAccounts(connection, keys, () => refresh());
  }, [wallet, vaultB, refresh]);

  // Задание 10. История карточки. Перезагружаем, когда меняются данные карточки или балансы:
  // значит, прошла новая операция (неважно — с этого сайта или нет).
  const historyKey = user
    ? `${user.card ? `${user.card.deposited}/${user.card.shares}` : "no-card"}/${user.shares}/${user.tokens}`
    : null;
  const historyReq = useRef(0);
  useEffect(() => {
    if (!wallet || historyKey === null) return;
    const id = ++historyReq.current;
    const program = getProgram();
    fetchHistory({
      connection,
      card: cardPda(wallet.publicKey),
      user: wallet.publicKey,
      tokenMint: TOKEN_MINT,
      shareMint: shareMintPda,
      programId: PROGRAM_ID,
      decode: (data) => program.coder.instruction.decode(data),
    })
      .then((items) => {
        if (id !== historyReq.current) return;
        setHistory(items);
        setHistoryError("");
      })
      .catch((e) => id === historyReq.current && setHistoryError(describeError(e)));
  }, [wallet, historyKey]);

  // Phantom: тихое подключение, если сайт уже разрешён; смена аккаунта; отключение из кошелька.
  // Тестовый кошелёк события Phantom не трогают.
  useEffect(() => {
    if (!hasInjectedWallet()) return;
    const usingPhantom = () => walletRef.current?.kind === "injected";
    connectInjected(true)
      .then((w) => {
        if (!userChoseWallet.current) setWallet(w); // пользователь мог уже выбрать кошелёк или отключиться
      })
      .catch(() => {});
    const offAccount = onInjectedEvent("accountChanged", () => {
      if (!usingPhantom()) return;
      connectInjected(true)
        .then((w) => usingPhantom() && setWallet(w))
        .catch(() => usingPhantom() && setWallet(null));
    });
    const offDisconnect = onInjectedEvent("disconnect", () => usingPhantom() && setWallet(null));
    return () => {
      offAccount();
      offDisconnect();
    };
  }, []);

  async function connect(kind: "injected" | "dev") {
    userChoseWallet.current = true;
    setStatus(null);
    try {
      // import.meta.env.DEV = false в `yarn build` — код тестового кошелька туда не попадёт
      setWallet(import.meta.env.DEV && kind === "dev" ? devWallet() : await connectInjected());
    } catch (e) {
      setStatus({ kind: "error", text: describeError(e) });
    }
  }

  async function disconnect() {
    userChoseWallet.current = true;
    await wallet?.disconnect().catch(() => {});
    setWallet(null);
    setStatus(null);
  }

  /** Отправить транзакцию, показать результат и обновить данные. */
  async function run(okText: string, send: () => Promise<string>): Promise<boolean> {
    setBusy(true);
    setStatus(null);
    try {
      const sig = await send();
      setStatus({ kind: "ok", text: okText, sig });
      return true;
    } catch (e) {
      console.error(e);
      setStatus({ kind: "error", text: describeError(e) });
      return false;
    } finally {
      setBusy(false);
      await refresh();
    }
  }

  const tokenFmt = (raw: bigint) => `${formatAmount(raw, vault?.decimals ?? 6)} ${TOKEN_SYMBOL}`;
  const shareFmt = (raw: bigint) => `${formatAmount(raw, SHARE_DECIMALS)} shares`;

  const pausedReason = vault?.inMarket
    ? "Деньги vault сейчас в рынке (swap или позиция Raydium). Внесение и вывод откроются после sync_vault."
    : undefined;
  // Задание 3: админ поставил депозиты на паузу — вывод при этом работает
  const depositBlocked = pausedReason ?? (vault?.paused ? "Админ поставил депозиты на паузу. Вывод доступен." : undefined);
  const isAdmin = !!(vault && wallet && vault.admin.equals(wallet.publicKey));

  return (
    <div className="page">
      <header>
        <div>
          <h1>Simple Vault</h1>
          <p className="muted">
            Учебный vault на Solana <span className="badge">devnet</span>
          </p>
        </div>
        <div className="wallet">
          {wallet ? (
            <>
              <button className="ghost" title="Скопировать адрес" onClick={() => navigator.clipboard?.writeText(wallet.publicKey.toBase58())}>
                {wallet.name}: {short(wallet.publicKey.toBase58())}
              </button>
              <button className="ghost" onClick={disconnect}>
                Отключить
              </button>
            </>
          ) : (
            <>
              <button onClick={() => connect("injected")}>Подключить Phantom</button>
              {import.meta.env.DEV && (
                <button className="ghost" onClick={() => connect("dev")}>
                  Тестовый кошелёк
                </button>
              )}
            </>
          )}
        </div>
      </header>

      {status && (
        <div className={`status ${status.kind}`} role="status">
          {status.text}{" "}
          {status.sig && (
            <a href={EXPLORER("tx", status.sig)} target="_blank" rel="noreferrer">
              Транзакция в Explorer
            </a>
          )}
        </div>
      )}
      {loadError && <div className="status error">Не удалось загрузить данные: {loadError}</div>}

      <section className="card">
        <h2>Vault</h2>
        {vault === undefined && <p className="muted">Загружаем…</p>}
        {vault === null && (
          <p>
            Vault для токена <code>{short(TOKEN_MINT.toBase58())}</code> ещё не создан. Админ: в корне проекта
            выполните <code>yarn setup-demo</code>.
          </p>
        )}
        {vault && (
          <>
            <dl className="stats">
              <div>
                <dt>Всего в vault</dt>
                <dd>{tokenFmt(vault.totalTokens)}</dd>
              </div>
              <div>
                <dt>Выпущено shares</dt>
                <dd>{shareFmt(vault.totalShares)}</dd>
              </div>
              <div>
                <dt>{vault.inMarket ? "Цена 1 share до выхода в рынок" : "Цена 1 share"}</dt>
                <dd>
                  {vault.totalShares === 0n
                    ? `1 ${TOKEN_SYMBOL}`
                    : tokenFmt(previewWithdraw(10n ** BigInt(SHARE_DECIMALS), vault.totalTokens, vault.totalShares))}
                </dd>
              </div>
              <div>
                <dt>Режим</dt>
                <dd>{vault.inMarket ? <span className="warn">Деньги в рынке</span> : "Обычный"}</dd>
              </div>
            </dl>
            <p className="muted small">
              Комиссия депозита 1% · Минимум {tokenFmt(vault.minDeposit)} ·{" "}
              {vault.paused && (
                <>
                  <span className="warn">Депозиты на паузе</span> ·{" "}
                </>
              )}
              Пара для Raydium: {vault.pairSet ? "задана" : "не задана"} · Позиция в пуле:{" "}
              {vault.positionOpen ? "открыта" : "нет"} · Админ:{" "}
              <a href={EXPLORER("address", vault.admin.toBase58())} target="_blank" rel="noreferrer">
                {short(vault.admin.toBase58())}
              </a>{" "}
              · Vault:{" "}
              <a href={EXPLORER("address", vaultPda.toBase58())} target="_blank" rel="noreferrer">
                {short(vaultPda.toBase58())}
              </a>
            </p>
          </>
        )}
      </section>

      {vault && (
        <section className="card">
          <h2>Мой счёт</h2>
          {!wallet && <p className="muted">Подключите кошелёк, чтобы вносить и выводить токены.</p>}
          {wallet && !user && <p className="muted">Загружаем…</p>}
          {wallet && user && (
            <>
              <dl className="stats">
                <div>
                  <dt>SOL</dt>
                  <dd>{user.sol.toFixed(4)}</dd>
                </div>
                <div>
                  <dt>{TOKEN_SYMBOL} на кошельке</dt>
                  <dd>{tokenFmt(user.tokens)}</dd>
                </div>
                <div>
                  <dt>Мои shares</dt>
                  <dd>{shareFmt(user.shares)}</dd>
                </div>
                <div>
                  {/* total_tokens обновляется только на sync_vault — пока деньги в рынке, цифра старая */}
                  <dt>{vault.inMarket ? "Стоили до выхода в рынок" : "Они стоят сейчас"}</dt>
                  <dd>{tokenFmt(previewWithdraw(user.shares, vault.totalTokens, vault.totalShares))}</dd>
                </div>
              </dl>

              {(user.sol < MIN_SOL || user.tokens === 0n) && (
                <p className="note">
                  Нужны тестовые SOL и {TOKEN_SYMBOL}. Попросите админа выполнить в корне проекта:
                  <br />
                  <code>yarn faucet {wallet.publicKey.toBase58()}</code>
                </p>
              )}

              {!user.card ? (
                <div className="action">
                  <h3>Шаг 1. Карточка</h3>
                  <p className="hint">
                    Карточка — ваш личный аккаунт в vault (PDA). Без неё контракт не примет депозит. Создаётся один
                    раз, стоит ~0.001 SOL ренты.
                  </p>
                  <button
                    disabled={busy || user.sol < MIN_SOL}
                    onClick={() => run("Карточка создана.", () => createCard(wallet))}
                  >
                    {busy ? "Ждём подтверждения…" : "Создать карточку"}
                  </button>
                </div>
              ) : (
                <>
                  <p className="muted small">
                    Карточка: внесено {tokenFmt(user.card.deposited)}, shares по карточке {shareFmt(user.card.shares)}
                  </p>
                  {/* key: при смене кошелька формы создаются заново, введённые суммы не переносятся */}
                  <div className="actions" key={wallet.publicKey.toBase58()}>
                    <ActionForm
                      title="Внести"
                      unit={TOKEN_SYMBOL}
                      decimals={vault.decimals}
                      max={user.tokens}
                      min={vault.minDeposit}
                      busy={busy}
                      blockedReason={depositBlocked}
                      submitLabel="Внести"
                      previewOut={(a) => previewDepositShares(a, vault.totalTokens, vault.totalShares)}
                      formatOut={shareFmt}
                      note={(a) => `комиссия 1%: ${tokenFmt(depositFee(a))}`}
                      onSubmit={(a) => run(`Внесено ${tokenFmt(a)}.`, () => deposit(wallet, a, vault.feeWallet))}
                    />
                    <ActionForm
                      title="Вывести"
                      unit="shares"
                      decimals={SHARE_DECIMALS}
                      max={user.shares}
                      busy={busy}
                      blockedReason={pausedReason}
                      submitLabel="Вывести"
                      previewOut={(s) => previewWithdraw(s, vault.totalTokens, vault.totalShares)}
                      formatOut={tokenFmt}
                      onSubmit={(s) => run(`Выведено ${shareFmt(s)}.`, () => withdraw(wallet, s))}
                    />
                  </div>
                  <div className="row-buttons">
                    {/* Задание 5: вывести все shares одной инструкцией */}
                    <button
                      className="ghost"
                      disabled={busy || !!pausedReason || user.shares === 0n}
                      onClick={() => run("Выведены все shares.", () => withdrawAll(wallet))}
                    >
                      Вывести всё
                    </button>
                    {/* Задание 6: закрыть карточку без shares и вернуть ренту */}
                    <button
                      className="ghost"
                      disabled={busy || user.shares > 0n || user.card.shares > 0n}
                      title={user.shares > 0n ? "Сначала выведите все shares" : "Рента ~0.0015 SOL вернётся на кошелёк"}
                      onClick={() => run("Карточка закрыта, рента возвращена.", () => closeCard(wallet))}
                    >
                      Закрыть карточку
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </section>
      )}

      {vault && wallet && user?.card && (
        <HistoryCard items={history} error={historyError} tokenFmt={tokenFmt} shareFmt={shareFmt} />
      )}

      {/* Задание 11: только кошелёк админа видит панель (проверку делает и контракт: has_one = admin) */}
      {vault && wallet && isAdmin && (
        <AdminPanel
          vault={vault}
          tokenB={tokenB}
          busy={busy}
          tokenFmt={tokenFmt}
          onSync={() => run("Vault синхронизирован.", () => syncVault(wallet, vault))}
          onTogglePause={() =>
            run(vault.paused ? "Пауза снята." : "Депозиты на паузе.", () => setPaused(wallet, !vault.paused))
          }
        />
      )}

      <footer className="muted small">
        Swap и позицию Raydium админ делает скриптами и тестами (недели 12–13); sync_vault и пауза — в панели админа.
        Данные обновляются сами через WebSocket (<code>onAccountChange</code>)
        {lastUpdate && <> · обновлено {lastUpdate.toLocaleTimeString("ru-RU")}</>} ·{" "}
        <button className="link" onClick={() => refresh()}>
          обновить
        </button>
      </footer>
    </div>
  );
}
