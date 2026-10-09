-- IRDR-477: hand-off proposals. Additive only (one new column).
-- The case is clear, but no template, rule or fact tells the agent how to answer: the proposal has no
-- reply draft and no actions, and Phillip takes over. The reason is one sentence for him.

alter table public.proposals add column if not exists handoff_reason text;

comment on column public.proposals.handoff_reason is 'Set when the agent hands the ticket to Phillip (no instruction fits): no reply draft, no actions. Null for every other proposal.';

-- A hand-off never carries a reply draft (the agent schema enforces it too).
alter table public.proposals drop constraint if exists proposals_handoff_no_reply;
alter table public.proposals add constraint proposals_handoff_no_reply
  check (handoff_reason is null or reply_draft is null);
