import { useCallback, useEffect, useState } from "react";
import type { FC } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { LAMPORTS_PER_SOL, Transaction } from "@solana/web3.js";
import type { TransactionInstruction } from "@solana/web3.js";
import { Button } from "./Button";
import { useToast } from "../context/ToastContext";
import { extractErrorMessage } from "../services/api";
import {
  createProfileInstruction,
  fetchPetRecordName,
  fetchProfile,
  fetchUsernameOwner,
  MAX_BIO_BYTES,
  PROFILE_ACCOUNT_SIZE,
  updateBioInstruction,
  USERNAME_ACCOUNT_SIZE,
  USERNAME_RE,
} from "../services/playerProfile";
import type { OnchainProfile } from "../services/playerProfile";

const explorer = (path: string) => `https://explorer.solana.com/${path}?cluster=devnet`;
const bioBytes = (bio: string) => new TextEncoder().encode(bio).length;

/**
 * The player's decentralized profile (programs/player_profile): read from the
 * PDA ["profile", wallet] on devnet, created/edited with Phantom-signed
 * transactions. PetNFT's backend is not involved at all.
 */
export const OnchainProfileCard: FC = () => {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const { showToast } = useToast();

  const [profile, setProfile] = useState<OnchainProfile | null | undefined>(undefined);
  const [featuredName, setFeaturedName] = useState<string | null>(null);
  const [rentSol, setRentSol] = useState<number | null>(null);
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!publicKey) return;
    try {
      const p = await fetchProfile(connection, publicKey);
      setProfile(p);
      setFeaturedName(p?.featuredPet ? await fetchPetRecordName(connection, p.featuredPet) : null);
    } catch (err) {
      showToast(extractErrorMessage(err), "error");
      setProfile(null);
    }
  }, [connection, publicKey, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    Promise.all([
      connection.getMinimumBalanceForRentExemption(PROFILE_ACCOUNT_SIZE),
      connection.getMinimumBalanceForRentExemption(USERNAME_ACCOUNT_SIZE),
    ])
      .then(([a, b]) => setRentSol((a + b) / LAMPORTS_PER_SOL))
      .catch(() => setRentSol(null));
  }, [connection]);

  const send = async (instruction: TransactionInstruction, success: string) => {
    if (!publicKey) return;
    setBusy(true);
    try {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      const tx = new Transaction({ feePayer: publicKey, blockhash, lastValidBlockHeight }).add(instruction);
      const signature = await sendTransaction(tx, connection);
      await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
      showToast(success, "success");
      setEditing(false);
      await load();
    } catch (err) {
      showToast(extractErrorMessage(err), "error");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!publicKey) return;
    if (!USERNAME_RE.test(username)) {
      showToast("Username: 3-20 lowercase letters, digits or _", "error");
      return;
    }
    if (bioBytes(bio) > MAX_BIO_BYTES) {
      showToast(`Bio is too long (max ${MAX_BIO_BYTES} bytes)`, "error");
      return;
    }
    const owner = await fetchUsernameOwner(connection, username);
    if (owner) {
      showToast(`@${username} is already taken`, "error");
      return;
    }
    await send(createProfileInstruction(publicKey, username, bio), `On-chain profile @${username} created`);
  };

  const saveBio = async () => {
    if (!publicKey) return;
    if (bioBytes(bio) > MAX_BIO_BYTES) {
      showToast(`Bio is too long (max ${MAX_BIO_BYTES} bytes)`, "error");
      return;
    }
    await send(updateBioInstruction(publicKey, bio), "Bio updated on-chain");
  };

  return (
    <div className="glass rounded-2xl p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-bold text-white">On-chain profile</h2>
        <span className="text-[11px] text-gray-400 glass rounded-full px-2 py-1">Solana Devnet · PDA</span>
      </div>

      {profile === undefined && <p className="text-sm text-gray-400">Reading the profile from the chain…</p>}

      {profile && !editing && (
        <div className="flex flex-col gap-2">
          <p className="text-xl font-bold gradient-text">@{profile.username}</p>
          <p className="text-sm text-gray-300">{profile.bio || <span className="text-gray-500">No bio yet.</span>}</p>
          {profile.featuredPet && (
            <p className="text-sm text-gray-300">
              ⭐ Featured pet:{" "}
              <a className="text-purple-300 hover:underline" href={explorer(`address/${profile.featuredPet.toBase58()}`)} target="_blank" rel="noreferrer">
                {featuredName ?? profile.featuredPet.toBase58().slice(0, 8) + "…"}
              </a>
            </p>
          )}
          <p className="text-xs text-gray-500">
            On-chain since {profile.createdAt.toLocaleDateString()} ·{" "}
            <a className="font-mono hover:text-gray-300" href={explorer(`address/${profile.address.toBase58()}`)} target="_blank" rel="noreferrer">
              {profile.address.toBase58()}
            </a>
          </p>
          <div>
            <Button
              variant="secondary"
              className="!py-1.5 !px-3 !text-xs"
              onClick={() => {
                setBio(profile.bio);
                setEditing(true);
              }}
            >
              Edit bio
            </Button>
          </div>
        </div>
      )}

      {profile && editing && (
        <div className="flex flex-col gap-3">
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            rows={3}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
          />
          <p className="text-xs text-gray-500">{bioBytes(bio)}/{MAX_BIO_BYTES} bytes</p>
          <div className="flex gap-2">
            <Button onClick={saveBio} loading={busy}>
              Save on-chain
            </Button>
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {profile === null && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-400">
            Claim a username that lives on Solana, not in our database: anyone can find your profile from your wallet
            address, and nobody else can ever take your username.
          </p>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value.toLowerCase())}
            placeholder="username (a-z, 0-9, _)"
            maxLength={20}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
          />
          <textarea
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder="Bio (optional)"
            rows={2}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-sm text-white"
          />
          <div className="flex items-center gap-3 flex-wrap">
            <Button onClick={create} loading={busy} disabled={!username}>
              Create on-chain profile
            </Button>
            <span className="text-xs text-gray-500">
              Phantom will ask you to approve a transaction{rentSol !== null ? ` (≈ ${rentSol.toFixed(4)} SOL refundable rent)` : ""}.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
