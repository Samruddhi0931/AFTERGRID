import { z } from "zod";

export const ResourceRequestSchema = z.object({
  messageId: z.uuid(),

  type: z.literal("RESOURCE_REQUEST"),

  householdId: z.string().min(1).max(64),

  level: z.number().int().min(1).max(100),

  resource: z.enum([
    "food",
    "water",
    "medicine",
  ]),

  quantity: z.number().int().positive(),

  urgency: z.enum([
    "normal",
    "high",
    "critical",
  ]),

  createdAt: z.iso.datetime(),
});

export type ResourceRequest = z.infer<
  typeof ResourceRequestSchema
>;