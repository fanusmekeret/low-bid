import type { Prisma } from "@prisma/client";
import { bigintReplacer } from "../../utils/json.js";

type Tx = Pick<Prisma.TransactionClient, "auditLog">;

const plain = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v, bigintReplacer)));

/** Records who did what. Called inside the same transaction as every admin and money write. */
export async function record(
  tx: Tx,
  entry: { actorId?: bigint; action: string; entity: string; entityId: bigint | string; before?: unknown; after?: unknown; ip?: string },
) {
  await tx.auditLog.create({
    data: {
      actorId: entry.actorId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId.toString(),
      before: plain(entry.before),
      after: plain(entry.after),
      ip: entry.ip,
    },
  });
}
