import { CommandPreviewModel, type CommandPreviewDocument } from "../models/command-preview.js";
import { canonicalPayloadHash } from "../command-hash.js";
import type { PreviewTokenCodec } from "../mcp/preview.js";
import { confirmationTokenHash } from "../mcp/preview.js";
import type { ServiceContext } from "./types/service-context.js";

export type PreviewReceiptRepository = {
  insert: (record: CommandPreviewDocument) => Promise<void>;
};

const mongoRepository: PreviewReceiptRepository = {
  async insert(record) {
    await CommandPreviewModel.create(record);
  },
};

const binding = (ctx: ServiceContext) => ({ workspaceId: ctx.workspaceId, userId: ctx.userId, channel: ctx.channel });

export class PreviewConfirmationService {
  constructor(private readonly repository: PreviewReceiptRepository = mongoRepository) {}

  async issue(ctx: ServiceContext, operation: string, payload: unknown, codec: PreviewTokenCodec) {
    const metadata = codec.issue(operation, payload, binding(ctx));
    const payloadHash = canonicalPayloadHash(payload);
    await this.repository.insert({
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      channel: ctx.channel,
      operation: operation.trim(),
      previewId: metadata.previewId,
      payloadHash,
      tokenHash: confirmationTokenHash(metadata.confirmationToken),
      status: "ISSUED",
      expiresAt: new Date(metadata.expiresAt),
      consumedAt: null,
    });
    return metadata;
  }
}

export const previewConfirmationService = new PreviewConfirmationService();
