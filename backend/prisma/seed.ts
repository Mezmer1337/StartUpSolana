import { PrismaClient } from "@prisma/client";
import { ITEM_CATALOG } from "../src/constants/items";

const prisma = new PrismaClient();

async function main() {
  for (const { key, name, description, category, rarity, icon } of ITEM_CATALOG) {
    const item = { key, name, description, category, rarity, icon };
    await prisma.item.upsert({ where: { key }, update: item, create: item });
  }
  console.log(`Seeded ${ITEM_CATALOG.length} items.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
