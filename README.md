# Little Budget

A monthly household budget and a purchase wishlist in one small app, built with React, TypeScript, Vite, Tailwind CSS, and shadcn/ui. Everything stays in your browser.

## Run locally

Requires Node.js 22.12+ (developed on Node.js 24).

```powershell
npm.cmd install
npm.cmd run dev
```

Unit tests run with `npm.cmd test`, end-to-end tests with `npm.cmd run test:e2e`.

## Features

### Budget book (Haushaltsbuch)

- The start page shows a typical month: income, expenses by category, and savings. It opens with an example household.
- Each entry is paid weekly, monthly, quarterly, every six months or yearly, and counts as its monthly share, so a €540 yearly insurance counts as €45.
- Expenses start in eight standard categories that can be renamed, recoloured, added, switched off or deleted. Any expense can be marked as a fixed cost.
- Drag entries to reorder them within their list, drag an expense onto another category to move it there, and drag categories by their heading to reorder them. A line shows where the item will land, and nothing moves until you let go.
- You can add the people who share the budget. Each entry then belongs to one person or is shared, and shared costs, savings and income are split by income or equally.
- The analysis covers the savings rate, the share of fixed costs, what to put aside each month for bills that are not monthly, where the income goes (for the household and for each person), and expenses by category. The chart colours are safe for colour-blind viewers.
- You can keep several budgets and duplicate one to try a what-if, such as a new job or a different rent.

### Wishlist (`#wishlist`)

- Each purchase has a price per piece, a quantity, a note, a category, a shop link and a priority from Must have down to Could skip.
- Each purchase is Still planned, Already bought (counted as spent), or No longer needed (kept for the record, never counted). One click on a purchase's check marks it bought. The double check on a category or either-or does the same for everything that counts there.
- Items, categories and either-ors can be switched on and off. Switching a category off keeps the choices made for its items.
- Either-ors compare alternatives, and an option can bundle several purchases. Only the picked option counts, and each option shows what it would cost.
- Drag purchases, either-ors, options and categories to reorder them or move them elsewhere. The list and totals preview the result while you drag. On touch screens, things are moved through the editors.
- A plan has no budget by default and just shows the total. Give it a budget and it shows what is left and warns when you go over.
- The budget book pays for the wishlist, either from what is left each month or from a fixed amount. Each plan shows how many months it takes to afford.
- Search and filter purchases, and keep several plans side by side. Deleting always asks first, and the contents of a deleted category or either-or can be kept.

### Everywhere

- **Your data** lists every budget and plan and can open, rename, duplicate, export or delete any of them. You can export or import one budget, one plan, or everything as JSON, and files from older versions are upgraded.
- Six currencies (the currency changes formatting only, with no exchange-rate conversion), English and German, and light and dark mode.
- Amounts are stored as integer cents. Data is saved automatically in local storage, with no account and no sync, so export a file to keep a copy.
