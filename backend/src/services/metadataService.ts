import { getPetById } from "./petService";
import { describeLook, lookFromRecord, renderPetSvgFromRecord } from "../../../shared/petArt";

/**
 * Builds Metaplex-standard off-chain NFT JSON metadata for a pet.
 *
 * This is served at GET /api/metadata/:petId and that URL is what gets
 * passed as the `uri` when minting the NFT (see frontend/src/services/nft.ts).
 * Static (image/DNA/rarity) fields live in the NFT metadata as usual;
 * mutable gameplay stats (level, xp, current stats) are duplicated here as
 * attributes for convenience/display, but the database — not the chain —
 * remains the source of truth for them, per the MVP design in the README.
 */
export async function buildPetMetadata(petId: string, appBaseUrl: string) {
  const pet = await getPetById(petId);
  const look = lookFromRecord(pet);

  return {
    name: pet.name,
    symbol: "PETNFT",
    description: `${pet.name} is a ${pet.rarity} hatchling in PetNFT — a Solana devnet GameFi MVP. DNA: ${pet.dnaHash.slice(0, 16)}...`,
    // Rendered from the DNA by shared/petArt — the same renderer the game UI uses.
    image: `${appBaseUrl}/api/metadata/${petId}/image`,
    external_url: appBaseUrl,
    attributes: [
      { trait_type: "Rarity", value: pet.rarity },
      { trait_type: "Generation", value: pet.generation },
      { trait_type: "Aura", value: pet.auraType ?? "None" },
      // The hand-drawn parts actually visible on the image.
      ...describeLook(look),
      { trait_type: "Level", value: pet.level },
      { trait_type: "Strength", value: pet.strength },
      { trait_type: "Speed", value: pet.speed },
      { trait_type: "Luck", value: pet.luck },
      { trait_type: "Trait Score", value: pet.traitScore },
    ],
    properties: {
      category: "image",
      files: [{ uri: `${appBaseUrl}/api/metadata/${petId}/image`, type: "image/svg+xml" }],
    },
    // Custom, non-standard block: convenient for the PetNFT app to re-read,
    // ignored by generic NFT viewers.
    petnft: {
      petId: pet.id,
      dna: pet.dnaHash,
      archetype: pet.archetype,
      look,
      rarity: pet.rarity,
      auraType: pet.auraType,
      level: pet.level,
      strength: pet.strength,
      speed: pet.speed,
      happiness: pet.happiness,
    },
  };
}

/**
 * The NFT image: the pet rendered from its DNA by the shared part-based
 * renderer (shared/petArt), on a palette-tinted background card. Growth
 * stage follows the pet's current level, so the image evolves with it.
 */
export async function buildPetImageSvg(petId: string) {
  const pet = await getPetById(petId);
  return renderPetSvgFromRecord(pet, { background: true });
}
