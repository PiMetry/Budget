# Little Budget

A simple budget / purchase planner built with React, TypeScript, Vite, Tailwind CSS, and official shadcn/ui components. Node.js runs the development and build tools.

## Run locally

Requires Node.js 22.12+ (developed on Node.js 24).

```powershell
npm.cmd install
npm.cmd run dev
```

## Features

- By default a plan has no budget and simply reports what everything costs, so nothing has to be decided up front.
- Give a plan a budget and the card turns around: it shows what is left of the budget, the ring fills up, and going over is called out. Set the budget back to 0 to return to the plain total.
- Choose EUR, USD, GBP, CHF, CAD, or AUD.
- Add, edit, and delete purchases with a price per piece, a quantity, an optional note, and an optional category.
- Keep a link to where a purchase is sold. A pasted address gets its https:// filled in, and the list shows a shop button that opens it in a new tab. Only http and https addresses are ever turned into links.
- Give every purchase a priority — Must have, Really want, Would be nice, Someday, Could skip — shown as a badge on the row.
- Mark a purchase Already bought and it still fills the budget while being reported separately as spent. Mark one No longer needed and it stays on the list for the record without ever counting.
- Toggle individual items or entire categories to update spending and remaining budget instantly.
- Category toggles preserve individual item choices. Disabled categories pause their item controls.
- Either-ors hold alternatives you are choosing between, such as two sizes of the same shelf. Only the picked option counts toward spending, and every option shows what it would cost if picked, so alternatives can be compared without deleting anything.
- An option can bundle several purchases, so "item 1 and item 2" can compete with "item 3".
- The option that lost a pick is reported as an alternative, not as something set aside — you decided differently, you did not give it up.
- An either-or lives in a category or on its own, and has its own toggle. Switching it off, or switching off its category, sets aside every option while keeping the current pick.
- Drag a purchase to reorder it, or onto another category or either-or option to move it. The list and the totals show where it would land while it is still being dragged. Dragging needs a pointer; the purchase editor does the same job on touch screens.
- Delete a category to move its items and either-ors to Uncategorized; delete an either-or to keep its purchases as plain purchases.
- Search and filter purchases by inclusion.
- Keep several plans side by side, each with its own budget, categories and purchases, and switch between them from the header.
- Your data lists every plan with what it holds, and can open, rename, duplicate, export or delete any of them.
- Export one plan or every plan as a JSON file, and import either back. Importing one plan adds it alongside the others; importing a file of every plan replaces them all, and both ask first. Files written by older versions are upgraded.
- Light and dark mode. The first visit follows the system setting; the toggle then holds the choice for this browser.
- English and German, chosen by a toggle. The first visit follows the browser's languages. Amounts follow the language's number format.
- All amounts use integer cents; over-budget totals are clearly indicated.
- Automatic saving in this browser's local storage. No account, server database, or cross-device sync. Clearing site data removes the plans, so export a file to keep a copy.
- Starts with a small example plan, labeled as one. Start fresh or Reset this plan clears it to an empty slate.
- Changing currency changes formatting only, without exchange-rate conversion.
