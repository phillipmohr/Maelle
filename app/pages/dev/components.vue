<script setup lang="ts">
/**
 * /dev/components — every component in every state, side by side with the design.
 * Owner: IRDR-454. Add a section here whenever a shared component gains a state.
 */
import { toast } from 'vue-sonner'
import { ACTION_LIST } from '#shared/actions'
import { CASE_TYPE_LIST } from '#shared/case-types'

useHead({ title: 'Components' })

const checked = ref(true)
const unchecked = ref(false)
const mode = ref('always_ask')
const undoWindow = ref('10')
const who = ref('all')
const text = ref("Hi Tom, thanks for reaching out!\n\nI've cancelled your subscription.")
const input = ref('')
const dialogOpen = ref(false)
const confirmOpen = ref(false)
const paletteOpen = ref(false)

const tokens = [
  ['page', '#17110B', 'bg-page'],
  ['base', '#211810', 'bg-base'],
  ['elevated', '#2C2117', 'bg-elevated'],
  ['border', '#433426', 'bg-line'],
  ['ivory', '#F1E7D4', 'bg-ivory'],
  ['ivory 200 (primary)', '#EEE2C9', 'bg-primary'],
  ['sand', '#B3A48C', 'bg-sand'],
  ['gilt', '#C6A15B', 'bg-gilt'],
  ['ink', '#1C140C', 'bg-ink'],
  ['sage', '#8DBA84', 'bg-sage'],
  ['slate blue', '#88A9CF', 'bg-slate-blue'],
  ['ember', '#E58C4F', 'bg-ember'],
  ['brick', '#E26A60', 'bg-brick'],
] as const

const type = [
  ['display 44 serif', 'type-display', 'Nothing needs you right now.'],
  ['heading 28 serif', 'type-heading', 'Cancel at period end, store the reason, send reply.'],
  ['decision 26 serif', 'type-decision', 'Refund $13.07 and cancel immediately'],
  ['title 17 semibold', 'type-title', 'Pioneer Valley Credit Union'],
  ['subject 15', 'text-subject', 'Re: Disputed charges · case PV-2026-08812'],
  [
    'body 14/1.55',
    'type-body',
    'Rachel cancelled her first subscription on Mar 18, then started a new one from the same account on Apr 4.',
  ],
  ['small 13', 'text-small', 'Reversible · no confirmation needed'],
  ['caption 12', 'type-caption', 'Prepared by AnastasAI from Stripe events'],
  ['eyebrow 11 / 0.14em', 'type-eyebrow text-fg-muted', 'Needs decision'],
  ['mono 12', 'type-mono', 'sub_1PzT8c · pi_3QfA7x · #4825'],
] as const

function doneToast() {
  toast.success('#4823 Sofia Ruiz · done', {
    description:
      '✓ Created Linear ticket INS-214\n✓ Stored email for release notification\n✓ Sent reply\n\nMoved to the next ticket · View audit trail',
  })
}
</script>

<template>
  <div class="grid flex-1 auto-rows-max content-start gap-12 overflow-auto px-12 pb-16 pt-9">
    <header class="flex flex-col gap-3">
      <Eyebrow tone="accent">Design system · dev only</Eyebrow>
      <h1 class="type-display">Every component, every state.</h1>
      <p class="max-w-[640px] text-body text-fg-muted [text-wrap:pretty]">
        Compare with the Claude Design project at 1512 × 944. Warm near-black, clair-obscur: light
        falls only on what needs a decision.
      </p>
    </header>

    <section class="flex flex-col gap-4">
      <Eyebrow>Tokens · palette</Eyebrow>
      <div class="grid grid-cols-7 gap-3">
        <div v-for="[name, hex, cls] in tokens" :key="name" class="flex flex-col gap-2">
          <div :class="['h-14 rounded-md border border-line', cls]" />
          <span class="text-caption">{{ name }}</span>
          <Mono class="text-[11px]">{{ hex }}</Mono>
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-4">
      <Eyebrow>Tokens · type</Eyebrow>
      <div class="flex flex-col gap-4">
        <div
          v-for="[name, cls, sample] in type"
          :key="name"
          class="grid grid-cols-[200px_minmax(0,1fr)] items-baseline gap-6"
        >
          <Mono class="text-[11px]">{{ name }}</Mono>
          <span :class="cls">{{ sample }}</span>
        </div>
      </div>
    </section>

    <section class="flex flex-col gap-4">
      <Eyebrow>Button</Eyebrow>
      <div class="flex flex-wrap items-center gap-3">
        <Button kbd="A">Approve &amp; execute</Button>
        <Button variant="secondary" kbd="E">Edit</Button>
        <Button variant="ghost" kbd="R">Reject</Button>
        <Button variant="ghost" kbd="S">Snooze</Button>
        <Button variant="danger">Mark as done manually</Button>
        <Button disabled>Disabled</Button>
        <Button loading>Executing</Button>
        <Button size="sm" variant="secondary">Pause all</Button>
        <Button size="sm">Retry failed action</Button>
        <Button variant="secondary" to="/anastasai">As a link</Button>
      </div>
    </section>

    <section class="flex flex-col gap-4">
      <Eyebrow>StatusPill</Eyebrow>
      <div class="flex flex-wrap items-center gap-3">
        <StatusPill status="draft">Needs decision</StatusPill>
        <StatusPill status="info">Needs customer confirmation</StatusPill>
        <StatusPill status="info">Researching</StatusPill>
        <StatusPill status="success">Customer confirmed</StatusPill>
        <StatusPill status="success">Done</StatusPill>
        <StatusPill status="warning">High risk</StatusPill>
        <StatusPill status="warning">Held back</StatusPill>
        <StatusPill status="error">1 action failed</StatusPill>
        <StatusPill status="neutral">Handled manually</StatusPill>
        <StatusPill status="draft" :dot="false">Auto</StatusPill>
      </div>
    </section>

    <section class="flex flex-col gap-4">
      <Eyebrow>Chips, Kbd, Mono, SourceChip, LockShape, RiskDot</Eyebrow>
      <div class="flex flex-wrap items-center gap-3">
        <Chip variant="filter" active>All</Chip>
        <Chip variant="filter" interactive>Risk</Chip>
        <Chip variant="filter" interactive>Billing</Chip>
        <Chip variant="meta">Due Oct 7</Chip>
        <Chip variant="meta">Stage 1 of 2</Chip>
        <Chip variant="meta">Executed 2m ago</Chip>
        <Chip variant="tag">Long-term</Chip>
        <Chip variant="tag">Resubscribed</Chip>
        <Kbd keys="⌘K" /><Kbd keys="G I" /><Kbd keys="⏎" /><Kbd keys="Esc" /><Kbd
          keys="?"
          tone="muted"
        />
        <Mono>sub_1PzT8c</Mono><Mono chip>$13.07</Mono><Mono tone="primary">#4825</Mono>
        <SourceChip href="https://dashboard.stripe.com">Stripe · sub_1PzT8c</SourceChip>
        <SourceChip>Knowledge base · Refund policy</SourceChip>
        <SourceChip to="/anastasai/t/4410">Email history · #4410</SourceChip>
        <span
          class="inline-flex items-center gap-[6px] rounded-sm border border-ember/33 bg-ember/8 px-2 py-[2px] text-[11px] font-semibold text-ember"
          ><LockShape />Irreversible</span
        >
        <span
          class="rounded-sm border border-line px-2 py-[2px] text-[11px] font-medium text-fg-muted"
          >Reversible</span
        >
      </div>
      <div class="flex items-center gap-4 text-caption text-fg-muted">
        <span class="flex items-center gap-2"><RiskDot kind="high" />high</span>
        <span class="flex items-center gap-2"><RiskDot kind="safety" />safety</span>
        <span class="flex items-center gap-2"><RiskDot kind="research" />researching</span>
        <span class="flex items-center gap-2"><RiskDot kind="wait" />waiting</span>
        <span class="flex items-center gap-2"><RiskDot kind="snoozed" />snoozed</span>
        <span class="flex items-center gap-2"><RiskDot kind="failed" />failed</span>
        <span class="flex items-center gap-2"><RiskDot kind="auto" />auto</span>
        <span class="flex items-center gap-2"><RiskDot kind="done" />done</span>
        <span class="flex items-center gap-2"><RiskDot kind="none" />none</span>
      </div>
    </section>

    <section class="grid grid-cols-3 gap-6">
      <div class="flex flex-col gap-4">
        <Eyebrow>Panel · base</Eyebrow>
        <Panel>
          <PanelHeader title="Proposed actions" meta="3 of 11" eyebrow />
          <div class="px-[18px] py-4 text-body text-fg-muted">Hairline border, umber-900.</div>
        </Panel>
      </div>
      <div class="flex flex-col gap-4">
        <Eyebrow>Panel · elevated</Eyebrow>
        <Panel elevation="elevated">
          <PanelHeader title="Incoming" meta="5 open" />
          <div class="px-[18px] py-4 text-body text-fg-muted">Umber-850, serif header.</div>
        </Panel>
      </div>
      <div class="flex flex-col gap-4">
        <Eyebrow>Panel · focus (the lamp)</Eyebrow>
        <Panel elevation="focus" :padding="24">
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between">
              <Eyebrow tone="accent">Proposal</Eyebrow
              ><Mono class="text-[11px]">3 actions · all reversible</Mono>
            </div>
            <p class="type-heading">Cancel at period end, store the reason, send reply.</p>
            <Provenance
              >Prepared by AnastasAI from Stripe billing and the cancellation template</Provenance
            >
          </div>
        </Panel>
      </div>
    </section>

    <section class="grid grid-cols-[320px_minmax(0,1fr)] gap-6">
      <div class="flex flex-col gap-4">
        <Eyebrow>TicketRow</Eyebrow>
        <Panel class="flex flex-col">
          <TicketRow
            name="Pioneer Valley Credit Union"
            time="3h"
            sub="Chargeback · 3 disputed charges of $7.99 · 1 action"
            risk="high"
            class="border-t-0"
          />
          <TicketRow
            name="Tom Becker"
            time="6h"
            sub="Cancellation only · “Please unsubscribe me.” · 3 actions"
            selected
          />
          <TicketRow
            name="amelie.dupont@outlook.fr"
            time="4m"
            sub="Researching"
            risk="research"
            research="Stripe ✓  Supabase ✓  Vercel ⋯  KB ✓"
          />
          <TicketRow
            name="Daniel Okafor"
            time="1d"
            sub="Refund request · Customer confirmed · stage 2"
            tag="Returned from waiting"
            tag-tone="slate-blue"
          />
          <TicketRow
            name="Priya Nair"
            time="5h"
            sub="Bug report · 1 action failed, reply held"
            risk="failed"
            tag="Retry or mark done"
          />
          <TicketRow
            name="Marco Bianchi"
            time="2h"
            sub="Refund request · Waiting for “Yes, refund” · 2 queued"
            risk="wait"
          />
          <TicketRow
            name="Kate Morgan"
            time="Tmrw"
            sub="Billing question · Returns tomorrow at 09:00"
            risk="snoozed"
          />
        </Panel>
      </div>
      <div class="flex flex-col gap-4">
        <Eyebrow>KeyValueList, RiskBanner, Provenance, Wordmark</Eyebrow>
        <div class="grid grid-cols-2 gap-4">
          <KeyValueList
            :items="[
              { label: 'Plan', value: 'Pro Monthly' },
              { label: 'Status', value: 'Cancelled Aug 2' },
              { label: 'Customer since', value: 'Jan 12, 2026' },
              { label: 'Card', value: 'Visa ··4417', mono: true },
            ]"
          />
          <div class="flex flex-col gap-4">
            <RiskBanner eyebrow="High risk · chargeback"
              >A credit union disputes 3 charges ($23.97) for its member Rachel Kim. The reply is
              evidence, so review the wording.</RiskBanner
            >
            <RiskBanner level="safety" eyebrow="Safety · removal request"
              >Pinned to the top. Cannot be snoozed.</RiskBanner
            >
          </div>
        </div>
        <div class="flex items-end gap-10 pt-2">
          <Wordmark :size="104" />
          <Wordmark :size="56" tagline />
          <Wordmark :size="28" />
          <Wordmark :size="28" monogram />
        </div>
      </div>
    </section>

    <section class="grid grid-cols-3 gap-6">
      <div class="flex flex-col gap-4">
        <Eyebrow>Checkbox (action states)</Eyebrow>
        <div class="flex flex-col gap-3 text-small">
          <label class="flex items-center gap-3"
            ><Checkbox v-model="checked" /> Checked (ivory)</label
          >
          <label class="flex items-center gap-3"><Checkbox v-model="unchecked" /> Unchecked</label>
          <span class="flex items-center gap-3"
            ><Checkbox :model-value="true" tone="success" readonly /> Done (sage)</span
          >
          <span class="flex items-center gap-3"
            ><Checkbox :model-value="false" tone="error" readonly /> Failed (brick ×)</span
          >
          <span class="flex items-center gap-3"
            ><Checkbox :model-value="false" tone="queued" readonly /> Queued · pending
            confirmation</span
          >
          <span class="flex items-center gap-3"
            ><Checkbox :model-value="false" tone="held" readonly /> Held back</span
          >
          <label class="flex items-center gap-3"
            ><Checkbox :model-value="true" disabled /> Disabled</label
          >
        </div>
      </div>
      <div class="flex flex-col gap-4">
        <Eyebrow>SegmentedControl, Tabs</Eyebrow>
        <div class="flex flex-col gap-3">
          <SegmentedControl
            v-model="mode"
            :options="[
              { value: 'always_ask', label: 'Always ask' },
              { value: 'auto', label: 'Auto' },
            ]"
            aria-label="Mode"
          />
          <SegmentedControl
            v-model="undoWindow"
            mono
            :options="[
              { value: '5', label: '5 min' },
              { value: '10', label: '10 min' },
              { value: '15', label: '15 min' },
            ]"
            aria-label="Undo window"
          />
          <SegmentedControl
            v-model="who"
            size="sm"
            :options="[
              { value: 'all', label: 'All' },
              { value: 'you', label: 'You' },
              { value: 'auto', label: 'Auto' },
            ]"
            aria-label="Filter"
          />
          <Tabs default-value="approved">
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="approved">Approved</TabsTrigger>
              <TabsTrigger value="edited">Edited</TabsTrigger>
              <TabsTrigger value="rejected">Rejected</TabsTrigger>
            </TabsList>
            <TabsContent value="all" class="text-caption text-fg-muted"
              >Everything closed.</TabsContent
            >
            <TabsContent value="approved" class="text-caption text-fg-muted"
              >Approved unchanged.</TabsContent
            >
            <TabsContent value="edited" class="text-caption text-fg-muted"
              >Approved with edits.</TabsContent
            >
            <TabsContent value="rejected" class="text-caption text-fg-muted"
              >Rejected and handled manually.</TabsContent
            >
          </Tabs>
        </div>
      </div>
      <div class="flex flex-col gap-4">
        <Eyebrow>Textarea, Input</Eyebrow>
        <Textarea v-model="text" :rows="5" />
        <Input v-model="input" placeholder="Search names, emails, ticket IDs" />
        <Input model-value="disabled" disabled />
      </div>
    </section>

    <section class="flex flex-col gap-4">
      <Eyebrow>Table</Eyebrow>
      <Panel>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Ticket</TableHead><TableHead>Customer</TableHead><TableHead>Case</TableHead
              ><TableHead>Status</TableHead><TableHead>Proposal</TableHead
              ><TableHead>Age</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow tint="ember" interactive>
              <TableCell
                ><span class="flex items-center gap-[10px]"
                  ><RiskDot kind="high" /><Mono>#4825</Mono></span
                ></TableCell
              >
              <TableCell
                ><div class="flex flex-col">
                  <span class="font-semibold">Pioneer Valley Credit Union</span
                  ><Mono class="text-[11px]">disputes@pvcu.org</Mono>
                </div></TableCell
              >
              <TableCell>Chargeback / bank dispute</TableCell>
              <TableCell><StatusPill status="warning">High risk</StatusPill></TableCell>
              <TableCell
                >Contest the dispute with a formal reply, the payment timeline and proof of
                use.</TableCell
              >
              <TableCell mono>3h</TableCell>
            </TableRow>
            <TableRow interactive selected>
              <TableCell
                ><span class="flex items-center gap-[10px]"
                  ><RiskDot /><Mono>#4824</Mono></span
                ></TableCell
              >
              <TableCell
                ><div class="flex flex-col">
                  <span class="font-semibold">Tom Becker</span
                  ><Mono class="text-[11px]">tom.becker@web.de</Mono>
                </div></TableCell
              >
              <TableCell>Cancellation only</TableCell>
              <TableCell><StatusPill status="draft">Needs decision</StatusPill></TableCell>
              <TableCell>Cancel at period end, store the reason, send reply.</TableCell>
              <TableCell mono>6h</TableCell>
            </TableRow>
            <TableRow interactive>
              <TableCell
                ><span class="flex items-center gap-[10px]"
                  ><RiskDot kind="research" /><Mono>#4828</Mono></span
                ></TableCell
              >
              <TableCell
                ><div class="flex flex-col">
                  <span class="font-semibold">Amélie Dupont</span
                  ><Mono class="text-[11px]">amelie.dupont@outlook.fr</Mono>
                </div></TableCell
              >
              <TableCell>Classifying…</TableCell>
              <TableCell><StatusPill status="info">Researching</StatusPill></TableCell>
              <TableCell class="text-fg-muted">Researching · Vercel logs still loading</TableCell>
              <TableCell mono>4m</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Panel>
    </section>

    <section class="flex flex-col gap-4">
      <Eyebrow>Dialog, Popover, Tooltip, DropdownMenu, Toast, Command palette</Eyebrow>
      <div class="flex flex-wrap items-center gap-3">
        <Dialog v-model:open="dialogOpen">
          <DialogTrigger as-child><Button variant="secondary">Open dialog</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <Eyebrow tone="accent">Snooze</Eyebrow>
              <DialogTitle>When should this come back?</DialogTitle>
              <DialogDescription
                >Presets follow your timezone. Safety tickets cannot be snoozed.</DialogDescription
              >
            </DialogHeader>
            <div class="mt-5 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm">Tonight</Button>
              <Button variant="secondary" size="sm">Tomorrow 09:00</Button>
              <Button variant="secondary" size="sm">Next week</Button>
              <Button variant="ghost" size="sm">Custom…</Button>
            </div>
            <DialogFooter>
              <DialogClose as-child><Button variant="ghost" kbd="Esc">Back</Button></DialogClose>
              <Button kbd="⏎" @click="dialogOpen = false">Snooze</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog v-model:open="confirmOpen">
          <DialogTrigger as-child
            ><Button variant="secondary">Confirm dialog (ember)</Button></DialogTrigger
          >
          <DialogContent class="border-ember/33">
            <DialogHeader>
              <Eyebrow tone="ember">Irreversible</Eyebrow>
              <DialogTitle>Press A again to run 2 irreversible actions</DialogTitle>
              <DialogDescription
                >Refund $13.07 to Visa ··2291 · Cancel immediately and delete 2
                profiles</DialogDescription
              >
            </DialogHeader>
            <DialogFooter>
              <DialogClose as-child><Button variant="ghost" kbd="Esc">Back</Button></DialogClose>
              <Button kbd="A" @click="confirmOpen = false">Confirm &amp; execute</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Popover>
          <PopoverTrigger as-child><Button variant="secondary">Popover</Button></PopoverTrigger>
          <PopoverContent>
            <div class="flex flex-col gap-2">
              <Eyebrow>Filters</Eyebrow>
              <label class="flex items-center gap-2 text-small"
                ><Checkbox :model-value="true" /> Needs confirmation</label
              >
              <label class="flex items-center gap-2 text-small"
                ><Checkbox :model-value="false" /> High risk only</label
              >
            </div>
          </PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger as-child><Button variant="ghost">Tooltip</Button></TooltipTrigger>
          <TooltipContent>Retry is safe · the Linear link won’t be duplicated</TooltipContent>
        </Tooltip>

        <DropdownMenu>
          <DropdownMenuTrigger as-child
            ><Button variant="secondary">Dropdown</Button></DropdownMenuTrigger
          >
          <DropdownMenuContent>
            <DropdownMenuLabel>Reject because</DropdownMenuLabel>
            <DropdownMenuItem kbd="1">Wrong case</DropdownMenuItem>
            <DropdownMenuItem kbd="2">Wrong actions</DropdownMenuItem>
            <DropdownMenuItem kbd="3">Wrong tone</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem kbd="4">I’ll handle it</DropdownMenuItem>
            <DropdownMenuItem tone="danger" disabled>Delete ticket</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button variant="secondary" @click="doneToast">Success toast</Button>
        <Button
          variant="secondary"
          @click="
            toast.error('Stripe: rate_limit (429)', {
              description: 'Nothing was charged or refunded · retry is safe',
            })
          "
          >Error toast</Button
        >
        <Button
          variant="secondary"
          @click="
            toast.warning('Reply held back', {
              description: 'Waiting on “Store email for release notification”',
            })
          "
          >Warning toast</Button
        >
        <Button variant="secondary" kbd="⌘K" @click="paletteOpen = true">Command palette</Button>
        <CommandDialog
          :open="paletteOpen"
          @update:open="(v) => (paletteOpen = v)"
          @select="paletteOpen = false"
        >
          <CommandInput />
          <CommandList>
            <CommandEmpty />
            <CommandGroup heading="Ticket">
              <CommandItem value="approve" keys="A">Approve &amp; execute</CommandItem>
              <CommandItem value="snooze" keys="S">Snooze</CommandItem>
              <CommandItem value="reject" keys="R">Reject</CommandItem>
              <CommandItem value="case">Change case</CommandItem>
              <CommandItem value="rerun">Re-run research</CommandItem>
            </CommandGroup>
            <CommandGroup heading="Go to">
              <CommandItem value="inbox" keys="G I">Inbox</CommandItem>
              <CommandItem value="autonomy" keys="G A">Autonomy</CommandItem>
            </CommandGroup>
          </CommandList>
        </CommandDialog>
      </div>
    </section>

    <section class="grid grid-cols-2 gap-6">
      <div class="flex flex-col gap-4">
        <Eyebrow>Action registry ({{ ACTION_LIST.length }})</Eyebrow>
        <Panel class="divide-hairline">
          <div
            v-for="a in ACTION_LIST"
            :key="a.key"
            class="flex items-center justify-between gap-4 px-[18px] py-[10px] text-small"
          >
            <span
              class="flex items-center gap-2 font-semibold"
              :class="a.irreversible ? 'text-ember' : 'text-fg'"
              ><LockShape v-if="a.irreversible" />{{ a.label }}</span
            >
            <Mono class="text-[11px]">{{ a.key }} · {{ a.target }}</Mono>
          </div>
        </Panel>
      </div>
      <div class="flex flex-col gap-4">
        <Eyebrow>Case types ({{ CASE_TYPE_LIST.length }})</Eyebrow>
        <Panel class="divide-hairline">
          <div
            v-for="c in CASE_TYPE_LIST"
            :key="c.key"
            class="flex items-center justify-between gap-4 px-[18px] py-[10px] text-small"
          >
            <span class="font-semibold">{{ c.label }}</span>
            <span class="flex items-center gap-2">
              <StatusPill v-if="c.requiresConfirmation" status="info" :dot="false"
                >Confirm first</StatusPill
              >
              <StatusPill v-if="c.defaultRisk !== 'none'" status="warning" :dot="false">{{
                c.defaultRisk
              }}</StatusPill>
              <Mono class="text-[11px]">{{ c.key }}</Mono>
            </span>
          </div>
        </Panel>
      </div>
    </section>
  </div>
</template>
