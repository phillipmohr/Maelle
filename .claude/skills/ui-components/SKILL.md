---
name: ui-components
description: Use this skill when building, modifying, or adding any UI component or page. Covers component lookup in app/components/ui, the reka-ui primitive rules, and reusability rules.
---

## Before building any UI component

1. Check `app/components/ui/` (Maelle's primitives, built on reka-ui and restyled
   to the Maelle design tokens) or `app/components/` directly — reuse existing
   components before building new ones. `/dev/components` shows every shared
   component in every state.
2. If nothing fits, build a new primitive on reka-ui the way the existing ones
   do (forward props/emits with `useForwardPropsEmits`, style with `cn()` and the
   tokens from `app/assets/css/tokens.css`). Do not install shadcn-vue
   components: nothing in the app may look like default shadcn.
3. Components in `app/components/ui/` can be edited directly to match the
   design. When making dramatic edits ensure it still looks good and works in
   the other places the component is used (check `/dev/components`).

## Rules

- Use existing component variants (e.g. button variants) as-is. Do not add custom classes unless strictly necessary (e.g. `w-full`).
- If two elements look and behave identically, extract them into a shared component. Never duplicate logic or styling.
- No one-off inline style overrides. If a layout need isn't covered by an existing component, extend the component itself rather than patching it at the call site.
- Dark only. No icon set: locks, checkboxes and dots are CSS shapes
  (`LockShape.vue`, `RiskDot.vue`, `Checkbox.vue`). Don't add an icon library.
- The proposal is the only lit surface on a screen (`<Panel elevation="focus">`);
  don't hand out `elevation="focus"` to other panels.

## Dialogs / modals

- Build modals on `components/ui/Dialog.vue` + `DialogContent.vue` (+
  `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`,
  `DialogClose`). `DialogContent` already renders the scrim, the elevated panel
  and the `Esc` text close button; just add your content in the slot. Don't
  hand-roll a new dialog wrapper.
- Command-palette style UIs go through `CommandDialog.vue` and the `Command*`
  primitives, registered via `useCommands.ts` / `useShortcuts.ts`.
