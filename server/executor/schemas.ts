/** Request body schemas for the decision routes. The server never trusts the UI. */
import { z } from 'zod'
import { ActionTypeSchema, AttachmentSchema, CaseTypeSchema } from '#shared/proposal'
import { REJECT_REASONS } from '#shared/services'

const params = z.record(z.string(), z.unknown())

export const ApproveBodySchema = z.object({
  proposalVersion: z.number().int().nonnegative(),
  actions: z
    .array(
      z.object({
        position: z.number().int().nonnegative(),
        enabled: z.boolean(),
        params: params.optional(),
      }),
    )
    .default([]),
  reply: z
    .object({
      subject: z.string().min(1).max(300),
      body: z.string().min(1).max(10_000),
      attachments: z.array(AttachmentSchema).max(10).optional(),
    })
    .optional(),
  confirmIrreversible: z.boolean().optional(),
  addedActions: z
    .array(z.object({ type: ActionTypeSchema, params, reason: z.string().min(1).max(300) }))
    .max(11)
    .optional(),
  note: z.string().max(2000).optional(),
})

export const RejectBodySchema = z.object({
  reason: z.enum(REJECT_REASONS),
  note: z.string().max(2000).optional(),
})

export const ManualSendBodySchema = z.object({
  reply: z.object({
    to: z.email(),
    subject: z.string().min(1).max(300),
    body: z.string().min(1).max(10_000),
  }),
  actions: z
    .array(z.object({ type: ActionTypeSchema, params }))
    .max(10)
    .default([]),
  handledManually: z.boolean().default(true),
  /** Additive: irreversible actions need it, like approve. */
  confirmIrreversible: z.boolean().optional(),
})

export const SnoozeBodySchema = z.object({
  until: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'until must be an ISO timestamp'),
})

export const MarkDoneBodySchema = z.object({
  note: z.string().trim().min(1, 'A note is required').max(2000),
})

export const SetCaseBodySchema = z.object({
  caseType: CaseTypeSchema,
})

export type ManualSendBody = z.infer<typeof ManualSendBodySchema>
