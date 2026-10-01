# Solana-тулчейн на Windows без WSL

Недели 4–5 собраны, задеплоены и протестированы на Windows 11 без WSL.
Всё ставится в профиль пользователя, права администратора не нужны.

| Инструмент | Версия | Откуда | Куда |
|---|---|---|---|
| Rust | 1.98 | `rustup-init.exe` с rustup.rs (MSVC, нужен Visual Studio C++ Build Tools) | `%USERPROFILE%\.cargo\bin` |
| Solana CLI (Agave) | 4.3.0 | `solana-release-x86_64-pc-windows-msvc.tar.bz2` из релизов anza-xyz/agave | `%USERPROFILE%\.local\share\solana-tools\solana-release\bin` |
| Anchor CLI | 1.2.0 | `anchor-1.2.0-x86_64-pc-windows-msvc.exe` из релизов solana-foundation/anchor | `...\solana-tools\anchor\anchor.exe` |
| surfpool | 1.6.0 | `surfpool-windows-x64.tar.gz` из релизов solana-foundation/surfpool | `...\solana-tools\surfpool\surfpool.exe` |
| platform-tools | 1.57 | `cargo build-sbf` скачивает сам при первой сборке (~580 МБ) | `%USERPROFILE%\.cache\solana` |

PATH для текущего окна PowerShell:

```powershell
$t = "$env:USERPROFILE\.local\share\solana-tools"
$env:PATH = "$t\solana-release\bin;$t\anchor;$t\surfpool;$env:USERPROFILE\.cargo\bin;$env:PATH"
```

## Подвохи, на которые мы наткнулись

1. **`solana airdrop` на devnet не работает**: публичный RPC почти всегда
   отвечает rate limit. Пополняйте кошелёк через <https://faucet.solana.com>
   (вход через GitHub, до 5 SOL) или переводом из Phantom в режиме Devnet.
2. **`solana-test-validator` падает** с `os error 1314` («Клиент не обладает
   требуемыми правами»): ему нужны символические ссылки, а их на Windows
   дают только права администратора или «Режим разработчика». Вместо него
   используйте `surfpool`, это локальный валидатор, который Anchor 1.2 и так
   берёт по умолчанию.
3. **`anchor test` запускает скрипт тестов через `bash`**, а Windows находит
   `C:\Windows\System32\bash.exe` (лаунчер WSL) раньше PATH. Без WSL-дистрибутива
   скрипт не стартует. Запускайте скрипт из `Anchor.toml` напрямую (ниже).
4. **Автодеплой surfpool из `anchor test`** падает с `Runbook execution failed`.
   Надёжнее запустить surfpool самому с `--no-deploy` и задеплоить программы
   через `solana program deploy`.
5. **`solana program deploy` в surfpool висит**: CLI шлёт транзакции через
   TPU/QUIC, а surfpool принимает только RPC. Добавляйте `--use-rpc`.
6. **`anchor keys sync` обновляет только `[programs.<provider.cluster>]`**
   (у нас это devnet). Адреса в `[programs.localnet]` выровняйте вручную.
7. **Два одинаковых вызова подряд** (например, `increment()` дважды) при одном
   recent blockhash дают одинаковые байты и одинаковую подпись. Второй
   отклоняется как `already processed`. В тестах перед повтором ждём новый
   blockhash (`nextBlockhash()` в `tests/pet-counter.ts`).

## Локальная проверка (как это сделано в проекте)

```powershell
# 1. Сборка
anchor build                                  # programs/* → target/deploy/*.so, target/idl, target/types
cd native\pet_passport; cargo build-sbf; cd ..\..

# 2. Локальный валидатор (отдельное окно; 10 000 SOL на CLI-кошелёк)
surfpool start --offline --no-deploy --no-tui --no-studio --airdrop-keypair-path "$env:USERPROFILE\.config\solana\id.json"

# 3. Деплой в него
$u = "http://127.0.0.1:8899"
solana program deploy target\deploy\pet_counter.so --program-id target\deploy\pet_counter-keypair.json --url $u --use-rpc
solana program deploy target\deploy\petnft.so --program-id target\deploy\petnft-keypair.json --url $u --use-rpc
solana program deploy target\deploy\player_profile.so --program-id target\deploy\player_profile-keypair.json --url $u --use-rpc
solana program deploy native\pet_passport\target\deploy\pet_passport.so --program-id native\pet_passport\target\deploy\pet_passport-keypair.json --url $u --use-rpc

# 4. Тесты Anchor — тот же скрипт, что в Anchor.toml
$env:ANCHOR_PROVIDER_URL = $u
$env:ANCHOR_WALLET = "$env:USERPROFILE\.config\solana\id.json"
npx ts-mocha -p ./tsconfig.json -t 1000000 "tests/**/*.ts"

# 5. Клиенты
$env:SOLANA_RPC_URL = $u
npm run passport -- create --name Blaze
npm run counter -- init --pet cm1petnftdemo0000000000001
```
