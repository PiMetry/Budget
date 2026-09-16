import { readFile, writeFile } from 'node:fs/promises'
import { test, expect, type Locator, type Page } from '@playwright/test'

async function startFresh(page: Page) {
  await page.goto('/#wishlist')
  await page.getByRole('button', { name: 'Reset this plan' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Start fresh' }).click()
}

const openData = (page: Page) => page.getByRole('button', { name: 'Your data' }).first().click()

// Picks from a select only once its list is open: a pick in the same instant it opens can close the dialog around it.
async function choose(page: Page, trigger: Locator, option: string) {
  await trigger.click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.getByRole('option', { name: option }).click()
}

// Native drag and drop needs the drag to begin at the source, so the pointer moves in steps.
async function pickUp(page: Page, label: string) {
  const box = (await page.getByText(label, { exact: true }).boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 + 6, { steps: 5 })
}

async function hoverOver(page: Page, target: Locator, offsetY: number) {
  const box = (await target.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + (offsetY < 0 ? box.height + offsetY : offsetY), { steps: 12 })
}

async function dragOnto(page: Page, label: string, targetId: string) {
  await pickUp(page, label)
  await hoverOver(page, page.getByTestId(targetId), 18)
  await page.mouse.up()
}

const titlesIn = (page: Page, zone: string) => page.getByTestId(zone).locator('.purchase-title')

test('category and item toggles retain choices and persist after reload', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto('/#wishlist')
  await expect(page.getByTestId('total')).toHaveText('€907.00')
  await page.getByRole('switch', { name: 'Include Desk lamp' }).click()
  await expect(page.getByTestId('total')).toHaveText('€848.00')
  await page.getByRole('switch', { name: 'Include category Home office' }).click()
  await expect(page.getByTestId('total')).toHaveText('€530.00')
  await expect(page.getByRole('switch', { name: 'Include Desk chair' })).toBeDisabled()
  await page.getByRole('switch', { name: 'Include category Home office' }).click()
  await expect(page.getByRole('switch', { name: 'Include Desk lamp' })).not.toBeChecked()
  await expect(page.getByTestId('total')).toHaveText('€848.00')
  await page.getByRole('switch', { name: 'Include Picture frames' }).click()
  await expect(page.getByTestId('total')).toHaveText('€790.00')
  await page.reload()
  await expect(page.getByTestId('total')).toHaveText('€790.00')
  expect(errors).toEqual([])
})

test('an either-or counts only the picked option, and the option left over is not set aside', async ({ page }) => {
  await page.goto('/#wishlist')
  await expect(page.getByTestId('total')).toHaveText('€907.00')
  // Four purchases are out of the total, but two of those are only the options that lost.
  await expect(page.getByTestId('set-aside')).toHaveText('2 purchases set aside for now · 2 alternatives not picked')
  await page.getByRole('radio', { name: '90 cm wide' }).click()
  await expect(page.getByTestId('total')).toHaveText('€947.00')
  await expect(page.getByTestId('set-aside')).toContainText('2 purchases set aside')
  await page.getByRole('radio', { name: 'Bean-to-cup' }).click()
  await expect(page.getByTestId('total')).toHaveText('€998.00')
  await page.getByRole('switch', { name: 'Include either-or Coffee setup' }).click()
  await expect(page.getByTestId('total')).toHaveText('€599.00')
  // Switching the whole either-or off does set its purchases aside.
  await expect(page.getByTestId('set-aside')).toHaveText('5 purchases set aside for now · 1 alternative not picked')
  await expect(page.getByRole('switch', { name: 'Include Espresso machine' })).toBeDisabled()
  await page.reload()
  await expect(page.getByTestId('total')).toHaveText('€599.00')
  await expect(page.getByRole('radio', { name: '90 cm wide' })).toBeChecked()
})

test('drag a purchase to reorder it, showing the result while it is still held', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'dragging needs a pointer; on touch the purchase editor moves items instead')
  // Tall enough that both ends of a drag stay on screen.
  await page.setViewportSize({ width: 1440, height: 2400 })
  await page.goto('/#wishlist')
  await expect(titlesIn(page, 'drop-kitchen')).toHaveText(['Pan set', 'Kettle'])
  await pickUp(page, 'Pan set')
  await hoverOver(page, page.getByTestId('drop-kitchen').locator('.purchase-row').filter({ hasText: 'Kettle' }), -8)
  // The list already shows the new order while the purchase is still being dragged.
  await expect(titlesIn(page, 'drop-kitchen')).toHaveText(['Kettle', 'Pan set'])
  await page.mouse.up()
  await page.reload()
  await expect(titlesIn(page, 'drop-kitchen')).toHaveText(['Kettle', 'Pan set'])
})

test('drag a purchase into another category and into an either-or option', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'dragging needs a pointer; on touch the purchase editor moves items instead')
  await page.setViewportSize({ width: 1440, height: 2400 })
  await page.goto('/#wishlist')
  await dragOnto(page, 'Kettle', 'drop-office')
  await expect(page.getByRole('region', { name: 'Home office' }).getByText('Kettle', { exact: true })).toBeVisible()
  await expect(page.getByTestId('total')).toHaveText('€907.00')
  await dragOnto(page, 'Kettle', 'drop-option-coffee-auto')
  await expect(page.getByTestId('total')).toHaveText('€862.00')
  await page.reload()
  await expect(page.getByTestId('total')).toHaveText('€862.00')
  await page.getByRole('radio', { name: 'Bean-to-cup' }).click()
  await expect(page.getByTestId('total')).toHaveText('€958.00')
})

// Chromium's emulated drag and drop does not hand every dragover to the page, so checks made while something is
// still held raise the drag events themselves, the way a browser does while the pointer moves or rests.
async function startDrag(source: Locator) {
  await source.dispatchEvent('dragstart', { dataTransfer: await source.page().evaluateHandle(() => new DataTransfer()) })
}

async function dragEventAt(page: Page, type: 'dragover' | 'drop', point: { x: number; y: number }) {
  await page.evaluate(({ type, x, y }) => {
    document.elementFromPoint(x, y)!.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, dataTransfer: new DataTransfer() }))
  }, { type, ...point })
}

test('a purchase held still over an either-or stays there, and the category it left keeps its height', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'dragging needs a pointer; on touch the purchase editor moves items instead')
  await page.setViewportSize({ width: 1440, height: 2400 })
  await page.goto('/#wishlist')
  const kitchen = page.getByRole('region', { name: 'Kitchen refresh' })
  const height = (await kitchen.boundingBox())!.height
  const option = (await page.getByTestId('drop-option-coffee-auto').boundingBox())!
  const spot = { x: option.x + option.width / 2, y: option.y + 18 }
  await startDrag(page.getByText('Pan set', { exact: true }))
  // A resting pointer keeps sending dragover. Nothing may shift under it, or the preview flips back and forth.
  for (let beat = 0; beat < 6; beat++) {
    await dragEventAt(page, 'dragover', spot)
    await expect(titlesIn(page, 'drop-option-coffee-auto')).toHaveText(['Bean-to-cup machine', 'Pan set'])
    await expect(kitchen.locator('.drag-origin')).toHaveCount(1)
    expect((await kitchen.boundingBox())!.height).toBe(height)
  }
  await dragEventAt(page, 'drop', spot)
  await expect(titlesIn(page, 'drop-kitchen')).toHaveText(['Kettle'])
  // The bean-to-cup option is not the picked one, so the pan set stops counting.
  await expect(page.getByTestId('total')).toHaveText('€828.00')
})

const categoryOrder = (page: Page) => page.locator('.purchase-group h3')

test('drag a category by its heading to reorder the categories', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'dragging needs a pointer')
  await page.setViewportSize({ width: 1440, height: 2400 })
  await page.goto('/#wishlist')
  const original = ['Kitchen refresh', 'Home office', 'Garden someday', 'Uncategorized']
  const moved = ['Garden someday', 'Kitchen refresh', 'Home office', 'Uncategorized']
  await expect(categoryOrder(page)).toHaveText(original)
  // While the heading is held the categories already show the new order; let go outside the list and nothing changes.
  const kitchen = (await page.getByRole('region', { name: 'Kitchen refresh' }).boundingBox())!
  const garden = page.getByText('Garden someday', { exact: true })
  await startDrag(garden)
  await dragEventAt(page, 'dragover', { x: kitchen.x + kitchen.width / 2, y: kitchen.y + 18 })
  await expect(categoryOrder(page)).toHaveText(moved)
  await garden.dispatchEvent('dragend')
  await expect(categoryOrder(page)).toHaveText(original)
  await pickUp(page, 'Garden someday')
  await hoverOver(page, page.getByRole('region', { name: 'Kitchen refresh' }), 18)
  await page.mouse.up()
  await expect(categoryOrder(page)).toHaveText(moved)
  await page.reload()
  await expect(categoryOrder(page)).toHaveText(moved)
  await expect(page.getByTestId('total')).toHaveText('€907.00')
})

test('drag an either-or into another category, in front of the either-or already there', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'dragging needs a pointer; on touch the either-or editor moves it instead')
  await page.setViewportSize({ width: 1440, height: 2400 })
  await page.goto('/#wishlist')
  const office = page.getByRole('region', { name: 'Home office' })
  await pickUp(page, 'Coffee setup')
  await hoverOver(page, page.getByRole('group', { name: 'Either-or Bookshelf' }), 10)
  await page.mouse.up()
  await expect(office.locator('.choice-heading h4')).toHaveText(['Coffee setup', 'Bookshelf'])
  // Its purchases came along and keep counting, now as part of the office.
  await expect(page.getByTestId('total')).toHaveText('€907.00')
  await page.getByRole('switch', { name: 'Include category Home office' }).click()
  await expect(page.getByTestId('total')).toHaveText('€182.00')
  await page.reload()
  await expect(office.locator('.choice-heading h4')).toHaveText(['Coffee setup', 'Bookshelf'])
})

test('drag a purchase below an either-or, and reorder the options of an either-or', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'dragging needs a pointer; on touch the purchase editor moves items instead')
  await page.setViewportSize({ width: 1440, height: 2400 })
  await page.goto('/#wishlist')
  const office = page.getByRole('region', { name: 'Home office' })
  const shown = office.locator('.group-content > .purchase-row .purchase-title, .group-content > .choice-block .choice-heading h4')
  const options = office.locator('.option-label')
  await expect(shown).toHaveText(['Desk chair', 'Desk lamp', 'Bookshelf'])
  // Let go at the end of the category and the chair sits below the either-or.
  await pickUp(page, 'Desk chair')
  await hoverOver(page, office.locator('.group-add'), 10)
  await page.mouse.up()
  await expect(shown).toHaveText(['Desk lamp', 'Bookshelf', 'Desk chair'])
  // An option held by its heading moves in front of the other one; the pick stays.
  await pickUp(page, '90 cm wide')
  await hoverOver(page, page.getByTestId('drop-option-shelf-narrow'), 8)
  await page.mouse.up()
  await expect(options).toHaveText(['90 cm wide', '60 cm wide'])
  await expect(page.getByRole('radio', { name: '60 cm wide' })).toBeChecked()
  await expect(page.getByTestId('total')).toHaveText('€907.00')
  await page.reload()
  await expect(shown).toHaveText(['Desk lamp', 'Bookshelf', 'Desk chair'])
  await expect(options).toHaveText(['90 cm wide', '60 cm wide'])
})

test('a budget is optional, and setting one turns the total into what is left', async ({ page }) => {
  await page.goto('/#wishlist')
  // By default there is no budget: the card just reports the total.
  await expect(page.getByTestId('total')).toHaveText('€907.00')
  await expect(page.getByTestId('remaining')).toHaveCount(0)
  await expect(page.getByText('What it all costs')).toBeVisible()

  await page.getByRole('button', { name: 'Set a budget', exact: true }).click()
  await page.getByLabel('Total budget', { exact: true }).fill('1000')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByTestId('remaining')).toHaveText('€93.00')
  await expect(page.getByText('Left to spend')).toBeVisible()
  await expect(page.getByTestId('total')).toHaveCount(0)
  await expect(page.getByTestId('planned')).toHaveText('€907.00')
  await page.reload()
  await expect(page.getByTestId('remaining')).toHaveText('€93.00')

  // Clearing the budget goes back to the plain total.
  await page.getByRole('button', { name: 'Edit budget and currency' }).click()
  await page.getByLabel('Total budget', { exact: true }).fill('0')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByTestId('total')).toHaveText('€907.00')
  await expect(page.getByText('over your budget')).toHaveCount(0)
})

test('a purchase can carry a link to where it is sold', async ({ page }) => {
  await page.goto('/#wishlist')
  // The example already has a shop link on the desk chair.
  const chairLink = page.getByRole('link', { name: 'Open Desk chair at example.com' })
  await expect(chairLink).toHaveAttribute('href', 'https://example.com/shop/desk-chair')
  await expect(chairLink).toHaveAttribute('target', '_blank')
  await expect(page.getByRole('link', { name: /Open Pan set/ })).toHaveCount(0)

  await page.getByRole('button', { name: 'Edit Pan set', exact: true }).click()
  await page.getByLabel('Where to buy it').fill('shop.example.org/pans')
  await page.getByRole('button', { name: 'Save changes' }).click()
  // A pasted address without a scheme still becomes a working link.
  await expect(page.getByRole('link', { name: 'Open Pan set at shop.example.org' })).toHaveAttribute('href', 'https://shop.example.org/pans')

  await page.getByRole('button', { name: 'Edit Pan set', exact: true }).click()
  await expect(page.getByLabel('Where to buy it')).toHaveValue('https://shop.example.org/pans')
  await page.getByLabel('Where to buy it').fill('javascript:alert(1)')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('alert')).toContainText('does not look like a web address')
  await page.getByLabel('Where to buy it').fill('')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('link', { name: /Open Pan set/ })).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('link', { name: 'Open Desk chair at example.com' })).toBeVisible()
})

test('quantity multiplies the price, and a purchase can be bought or no longer needed', async ({ page }) => {
  await page.goto('/#wishlist')
  // The example already has a kettle that was bought and two picture frames.
  await expect(page.getByTestId('spent')).toHaveText('€45.00')
  await expect(page.getByText('2 × €29.00')).toBeVisible()
  await page.getByRole('button', { name: 'Edit Picture frames', exact: true }).click()
  await expect(page.getByLabel('How many')).toHaveValue('2')
  await page.getByLabel('How many').fill('3')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('3 × €29.00')).toBeVisible()
  await expect(page.getByTestId('total')).toHaveText('€936.00')

  await page.getByRole('button', { name: 'Edit Picture frames', exact: true }).click()
  await choose(page, page.getByLabel('Where it stands'), 'Already bought')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByTestId('spent')).toHaveText('€132.00')
  await expect(page.getByTestId('total')).toHaveText('€936.00')

  await page.getByRole('button', { name: 'Edit Picture frames', exact: true }).click()
  await choose(page, page.getByLabel('Where it stands'), 'No longer needed')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByTestId('total')).toHaveText('€849.00')
  await expect(page.getByTestId('spent')).toHaveText('€45.00')
  await expect(page.getByTestId('set-aside')).toContainText('3 purchases set aside')

  await page.getByRole('button', { name: 'Edit Picture frames', exact: true }).click()
  await page.getByLabel('How many').fill('0')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByRole('alert')).toContainText('whole number of pieces')
})

test('a purchase, a category or an either-or is marked bought in one click', async ({ page }) => {
  await page.goto('/#wishlist')
  await expect(page.getByTestId('spent')).toHaveText('€45.00')
  const lamp = page.getByRole('button', { name: 'Mark Desk lamp as bought' })
  await expect(lamp).toHaveAttribute('aria-pressed', 'false')
  await lamp.click()
  await expect(lamp).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('spent')).toHaveText('€104.00')
  await lamp.click()
  await expect(page.getByTestId('spent')).toHaveText('€45.00')

  // Only the picked coffee option is bought; the one that lost the pick stays planned.
  await page.getByRole('button', { name: 'Mark the picked option of Coffee setup as bought' }).click()
  await expect(page.getByTestId('spent')).toHaveText('€393.00')
  await expect(page.getByRole('button', { name: 'Mark Bean-to-cup machine as bought' })).toHaveAttribute('aria-pressed', 'false')

  const office = page.getByRole('button', { name: 'Mark everything in Home office as bought' })
  await office.click()
  await expect(office).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('spent')).toHaveText('€770.00')
  await office.click()
  await expect(page.getByTestId('spent')).toHaveText('€393.00')
  // A switched-off category has nothing that counts, so nothing to mark.
  await expect(page.getByRole('button', { name: 'Mark everything in Garden someday as bought' })).toBeDisabled()
  await page.reload()
  await expect(page.getByTestId('spent')).toHaveText('€393.00')
})

test('priorities show on every purchase and can be changed', async ({ page }) => {
  await page.goto('/#wishlist')
  const chair = page.getByRole('region', { name: 'Home office' }).getByText('Desk chair', { exact: true }).locator('..')
  await expect(chair.getByText('Must have')).toBeVisible()
  await page.getByRole('button', { name: 'Edit Desk chair', exact: true }).click()
  await choose(page, page.getByLabel('How much you want it'), 'Could skip')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(chair.getByText('Could skip')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('region', { name: 'Home office' }).getByText('Could skip')).toBeVisible()
})

test('build an either-or, bundle items in one option, and remove it', async ({ page }) => {
  await startFresh(page)
  await page.getByRole('button', { name: 'Edit budget and currency' }).click()
  await page.getByLabel('Total budget', { exact: true }).fill('2000')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByRole('button', { name: 'New either-or' }).click()
  await page.getByLabel('What are you deciding?').fill('The sofa')
  await page.getByRole('textbox', { name: 'Option 1' }).fill('Two-seater')
  await page.getByRole('textbox', { name: 'Option 2' }).fill('Sofa and armchair')
  await page.getByRole('button', { name: 'Create either-or' }).click()
  await page.getByRole('button', { name: 'Add to Two-seater' }).click()
  await page.getByLabel('Purchase name').fill('Two-seater sofa')
  await page.getByLabel('Price (EUR)').fill('800')
  await page.getByRole('dialog').getByRole('button', { name: 'Add purchase' }).click()
  await expect(page.getByTestId('remaining')).toHaveText('€1,200.00')
  await page.getByRole('button', { name: 'Add to Sofa and armchair' }).click()
  await page.getByLabel('Purchase name').fill('Three-seater sofa')
  await page.getByLabel('Price (EUR)').fill('1100')
  await page.getByRole('dialog').getByRole('button', { name: 'Add purchase' }).click()
  await page.getByRole('button', { name: 'Add to Sofa and armchair' }).click()
  await page.getByLabel('Purchase name').fill('Armchair')
  await page.getByLabel('Price (EUR)').fill('450')
  await page.getByRole('dialog').getByRole('button', { name: 'Add purchase' }).click()
  await expect(page.getByTestId('remaining')).toHaveText('€1,200.00')
  await page.getByRole('radio', { name: 'Sofa and armchair' }).click()
  await expect(page.getByTestId('remaining')).toHaveText('€450.00')
  await page.getByRole('button', { name: 'Edit either-or The sofa' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('Delete this either-or?')
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('radio')).toHaveCount(0)
  await expect(page.getByTestId('remaining')).toHaveText('€350.00')
  await expect(page.getByText('€350.00 over your budget')).toBeVisible()
})

test('create and edit a plan, move items, delete categories, and show overspending', async ({ page }) => {
  await startFresh(page)
  await page.getByRole('button', { name: 'Edit budget and currency' }).click()
  await page.getByLabel('Total budget', { exact: true }).fill('500')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await page.getByRole('button', { name: 'New category' }).click()
  await page.getByLabel('Category name').fill('Travel')
  await page.getByRole('button', { name: 'Create category' }).click()
  await page.getByRole('region', { name: 'Travel' }).getByRole('button', { name: 'Add an item' }).click()
  await page.getByLabel('Purchase name').fill('Train ticket')
  await page.getByLabel('Price (EUR)').fill('125.50')
  await page.getByRole('dialog').getByRole('button', { name: 'Add purchase' }).click()
  await expect(page.getByTestId('remaining')).toHaveText('€374.50')
  await page.getByRole('button', { name: 'Edit Train ticket', exact: true }).click()
  await page.getByLabel('Price (EUR)').fill('600')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('€100.00 over your budget')).toBeVisible()
  await page.getByRole('button', { name: 'Edit category Travel' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Uncategorized' }).getByText('Train ticket')).toBeVisible()
  await page.getByRole('button', { name: 'Edit Train ticket', exact: true }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByTestId('remaining')).toHaveText('€500.00')
  await page.reload()
  await expect(page.getByTestId('remaining')).toHaveText('€500.00')
})

test('deleting asks first, and can take what is inside along', async ({ page }) => {
  await page.goto('/#wishlist')
  await page.getByRole('button', { name: 'Delete Desk lamp' }).click()
  await expect(page.getByRole('dialog')).toContainText('Delete this purchase?')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByText('Desk lamp')).toBeVisible()
  await page.getByRole('button', { name: 'Delete Desk lamp' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByText('Desk lamp')).toHaveCount(0)

  // Left unticked, a category's contents move to Uncategorized; ticked, they go with it.
  await page.getByRole('button', { name: 'Edit category Home office' }).click()
  await page.getByRole('button', { name: 'Delete', exact: true }).click()
  await page.getByRole('checkbox', { name: 'Also delete the 3 purchases and the either-or in it' }).check()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Home office' })).toHaveCount(0)
  await expect(page.getByText('Desk chair')).toHaveCount(0)
  await expect(page.getByRole('group', { name: /Bookshelf/ })).toHaveCount(0)
})

test('search, filters, validation, and currency work', async ({ page }) => {
  await page.goto('/#wishlist')
  await page.getByRole('button', { name: 'Excluded', exact: false }).click()
  await expect(page.getByText('Bookshelf, 90 cm', { exact: true })).toBeVisible()
  await expect(page.getByText('Pan set', { exact: true })).not.toBeVisible()
  await page.getByRole('button', { name: 'All items' }).click()
  await page.getByLabel('Search purchases').fill('kettle')
  await expect(page.getByText('Kettle', { exact: true })).toBeVisible()
  await expect(page.getByText('Desk lamp', { exact: true })).not.toBeVisible()
  await page.getByLabel('Search purchases').fill('coffee setup')
  await expect(page.getByText('Espresso machine', { exact: true })).toBeVisible()
  await expect(page.getByText('Bean-to-cup machine', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Clear search' }).click()
  await page.getByRole('button', { name: 'Add purchase', exact: true }).click()
  await page.getByLabel('Purchase name').fill('Test')
  await page.getByLabel('Price (EUR)').fill('-5')
  await page.getByRole('dialog').getByRole('button', { name: 'Add purchase' }).click()
  await expect(page.getByRole('alert')).toContainText('Enter an amount')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Edit budget and currency' }).click()
  await choose(page, page.getByLabel('Currency', { exact: true }), 'USD')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByTestId('total')).toContainText('907.00')
  await expect(page.getByTestId('total')).not.toContainText('€')
})

test('export a plan to a file and import it back as a second plan', async ({ page }, testInfo) => {
  await page.goto('/#wishlist')
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export plan' }).click()])
  expect(download.suggestedFilename()).toMatch(/^little-budget-example-plan-\d{4}-\d{2}-\d{2}\.json$/)
  const file = testInfo.outputPath('plan.json')
  await download.saveAs(file)
  const saved = JSON.parse(await readFile(file, 'utf8'))
  expect(saved.items).toHaveLength(12)
  expect(saved.budget).toBe(0)
  await expect(page.getByTestId('notice')).toContainText('was saved as')
  await page.getByRole('switch', { name: 'Include category Kitchen refresh' }).click()
  await expect(page.getByTestId('total')).toHaveText('€783.00')
  await page.getByLabel('Import a plan file').setInputFiles(file)
  await expect(page.getByRole('dialog')).toContainText('12 purchases, 3 categories and 2 either-ors')
  await page.getByRole('button', { name: 'Add plan' }).click()
  // The imported copy is opened, and the plan it came from keeps its own state.
  await expect(page.getByTestId('total')).toHaveText('€907.00')
  await page.reload()
  await expect(page.getByTestId('total')).toHaveText('€907.00')
  const junk = testInfo.outputPath('junk.json')
  await writeFile(junk, 'not a plan at all')
  await page.getByLabel('Import a plan file').setInputFiles(junk)
  await expect(page.getByTestId('notice')).toContainText('could not be read as a plan')
  await expect(page.getByTestId('total')).toHaveText('€907.00')
})

test('keep several plans side by side and export them all', async ({ page }, testInfo) => {
  await page.goto('/#wishlist')
  await openData(page)
  await page.getByRole('button', { name: 'New plan' }).click()
  await page.getByLabel('Plan name').fill('The move')
  await page.getByRole('button', { name: 'Create plan' }).click()
  await expect(page.getByRole('dialog')).toContainText('The move')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('combobox', { name: 'Switch plan' })).toHaveText('The move')
  await expect(page.getByRole('heading', { name: 'Good plans start with a little wish' })).toBeVisible()
  await expect(page.getByTestId('total')).toHaveText('€0.00')

  await openData(page)
  await page.getByRole('button', { name: 'Duplicate Example plan' }).click()
  await expect(page.getByRole('dialog').getByText('Example plan (copy)')).toBeVisible()
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export all budgets and plans' }).click()])
  const file = testInfo.outputPath('all.json')
  await download.saveAs(file)
  const saved = JSON.parse(await readFile(file, 'utf8'))
  expect(saved.plans.map((plan: { name: string }) => plan.name)).toEqual(['Example plan', 'The move', 'Example plan (copy)'])

  await page.getByRole('button', { name: 'Delete The move' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await expect(page.getByRole('dialog').getByText('The move')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Switch plan' })).toHaveText('Example plan (copy)')
  await openData(page)
  await page.getByRole('button', { name: 'Open Example plan', exact: true }).click()
  await expect(page.getByTestId('total')).toHaveText('€907.00')
})

test('the theme follows the system until it is switched, then it is remembered', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.goto('/#wishlist')
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.getByRole('button', { name: 'Switch to light mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
})

test('the interface can be read in German, with German number formatting', async ({ page }) => {
  await page.goto('/#wishlist')
  await expect(page.getByRole('heading', { name: 'Big ideas. Little budget.' })).toBeVisible()
  await page.getByRole('button', { name: 'DE', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Große Pläne. Kleines Budget.' })).toBeVisible()
  await expect(page.getByTestId('total')).toHaveText('907,00 €')
  await expect(page.getByTestId('set-aside')).toHaveText('2 Anschaffungen vorerst zurückgestellt · 2 Alternativen nicht gewählt')
  await expect(page.getByRole('switch', { name: 'Kategorie Home office einbeziehen' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'de')
  await page.reload()
  await expect(page.getByTestId('total')).toHaveText('907,00 €')
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(page.getByTestId('total')).toHaveText('€907.00')
})

test('layout fits the viewport and renders without errors', async ({ page }, testInfo) => {
  await page.goto('/#wishlist')
  await expect(page.getByRole('heading', { name: 'Big ideas. Little budget.' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `test-results/${testInfo.project.name}-budget.png`, fullPage: true })
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `test-results/${testInfo.project.name}-budget-dark.png`, fullPage: true })
})
