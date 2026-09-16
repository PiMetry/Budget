import { readFile } from 'node:fs/promises'
import { test, expect, type Locator, type Page } from '@playwright/test'

const openBudget = (page: Page) => page.goto('/')

// Native drag and drop needs the drag to begin at the source, so the pointer moves in steps.
async function drag(page: Page, from: Locator, to: Locator, offsetY: number) {
  const start = (await from.boundingBox())!
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(start.x + start.width / 2 + 10, start.y + start.height / 2 + 6, { steps: 5 })
  const end = (await to.boundingBox())!
  await page.mouse.move(end.x + end.width / 2, end.y + offsetY, { steps: 12 })
  await page.mouse.up()
}

// Picks from a select only once its list is open: a pick in the same instant it opens can close the dialog around it.
async function choose(page: Page, trigger: Locator, option: string) {
  await trigger.click()
  await expect(page.getByRole('listbox')).toBeVisible()
  await page.getByRole('option', { name: option }).click()
}

test('entries and categories are reordered by dragging, and an expense can change category', async ({ page, isMobile }) => {
  test.skip(!!isMobile, 'dragging needs a pointer; on touch the entry editor changes the category instead')
  await page.setViewportSize({ width: 1440, height: 3200 })
  await openBudget(page)
  const titles = (region: Locator) => region.locator('.purchase-title')
  const income = page.getByRole('region', { name: 'Income', exact: true })
  await expect(titles(income)).toHaveText(['Salary', 'Part-time salary', 'Christmas bonus'])
  // The top half of a row puts the dragged entry in front of it.
  await drag(page, income.getByText('Christmas bonus', { exact: true }), income.locator('.purchase-row').first(), 8)
  await expect(titles(income)).toHaveText(['Christmas bonus', 'Salary', 'Part-time salary'])

  // An expense let go on another category's heading joins it at the end, and the month stays the same.
  const leisure = page.getByRole('region', { name: 'Leisure & eating out', exact: true })
  const subscriptions = page.getByRole('region', { name: 'Subscriptions & phone', exact: true })
  await drag(page, subscriptions.getByText('Streaming', { exact: true }), leisure.locator('.group-heading'), 10)
  await expect(titles(leisure)).toHaveText(['Eating out and trips', 'Streaming'])
  await expect(titles(subscriptions)).toHaveText(['Internet and phones'])
  await expect(page.getByTestId('month-expenses')).toHaveText('€2,943.50')

  // A category moves by its heading, in front of the one it is let go on.
  const groups = page.locator('.purchase-groups')
  const headings = groups.locator('h3')
  await expect(headings.first()).toHaveText('Housing')
  await drag(page, groups.getByRole('heading', { name: 'Other', exact: true }), page.getByRole('region', { name: 'Housing', exact: true }).locator('.group-heading'), 6)
  await expect(headings.first()).toHaveText('Other')
  await expect(headings.nth(1)).toHaveText('Housing')

  await page.reload()
  await expect(titles(income)).toHaveText(['Christmas bonus', 'Salary', 'Part-time salary'])
  await expect(titles(leisure)).toHaveText(['Eating out and trips', 'Streaming'])
  await expect(headings.first()).toHaveText('Other')
})

test('the month adds up income, expenses and savings, with yearly bills spread over the months', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openBudget(page)
  await expect(page.getByRole('heading', { name: 'Money in. Money out.' })).toBeVisible()
  await expect(page.getByTestId('month-income')).toHaveText('€5,750.00')
  await expect(page.getByTestId('month-expenses')).toHaveText('€2,943.50')
  await expect(page.getByTestId('month-savings')).toHaveText('€900.00')
  await expect(page.getByTestId('month-left')).toHaveText('€1,706.50')

  // A yearly bill counts with a twelfth of it each month.
  await page.getByRole('region', { name: 'Transport' }).getByRole('button', { name: 'Add expense' }).click()
  await page.getByLabel('Name', { exact: true }).fill('Car service')
  await page.getByLabel('Amount (EUR)').fill('360')
  await choose(page, page.getByLabel('How often'), 'Every year')
  await expect(page.getByTestId('comes-to')).toHaveText('Comes to €30.00 a month.')
  await page.getByRole('dialog').getByRole('button', { name: 'Add expense' }).click()
  await expect(page.getByTestId('month-left')).toHaveText('€1,676.50')
  await expect(page.getByRole('region', { name: 'Transport' }).getByText('€360.00 a year')).toBeVisible()

  // A switched-off category leaves the month and comes back as it was; so does a single expense.
  await page.getByRole('switch', { name: 'Include category Housing' }).click()
  await expect(page.getByTestId('month-left')).toHaveText('€3,221.50')
  await page.getByRole('switch', { name: 'Include category Housing' }).click()
  await page.getByRole('switch', { name: 'Include Eating out and trips' }).click()
  await expect(page.getByTestId('month-left')).toHaveText('€1,926.50')
  await page.reload()
  await expect(page.getByTestId('month-left')).toHaveText('€1,926.50')
  expect(errors).toEqual([])
})

test('spending more than comes in is called out', async ({ page }) => {
  await openBudget(page)
  await page.getByRole('button', { name: 'Edit Salary', exact: true }).click()
  await page.getByLabel('Amount (EUR)').fill('1000')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Short each month')).toBeVisible()
  await expect(page.getByTestId('month-left')).toHaveText('€493.50')
  await expect(page.getByText('You plan €493.50 more than comes in.')).toBeVisible()
})

test('people share the costs by income or equally', async ({ page }) => {
  await openBudget(page)
  await expect(page.getByTestId('split-note')).toHaveText('Shared costs are split by income: Alex 58% · Sam 42%.')
  await page.getByRole('button', { name: 'Household' }).click()
  await page.getByRole('radio', { name: 'Equally' }).click()
  await page.getByRole('textbox', { name: 'Person 2' }).fill('Robin')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByTestId('split-note')).toHaveText('Shared costs are split equally: Alex 50% · Robin 50%.')

  // Without a second person there is nothing to split, and nothing is lost from the month.
  await page.getByRole('button', { name: 'Household' }).click()
  await page.getByRole('button', { name: 'Remove person 2' }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByTestId('split-note')).toHaveCount(0)
  await expect(page.getByTestId('month-left')).toHaveText('€1,706.50')
})

test('the budget pays for the wishlist, from a fixed amount or from everything left over', async ({ page }) => {
  await page.goto('/#wishlist')
  const funding = page.getByTestId('funding')
  await expect(funding).toContainText('€200.00 a month is set aside for your wishlist.')
  await expect(funding).toContainText('That pays for the €862.00 still to buy in about 5 months.')
  await funding.getByRole('button', { name: 'Open budget Example budget' }).click()
  await expect(page).not.toHaveURL(/#/)
  await expect(page.getByTestId('for-wishlist')).toHaveText('€200.00 a month')

  await page.getByRole('button', { name: 'Change how the wishlist is paid for' }).click()
  await page.getByRole('radio', { name: 'Everything left over' }).click()
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByTestId('for-wishlist')).toHaveText('€1,906.50 a month')
  await page.getByRole('button', { name: /^Example plan/ }).click()
  await expect(page.getByTestId('funding')).toContainText('within a month')
  // Going back returns to the budget.
  await page.goBack()
  await expect(page.getByTestId('month-left')).toHaveText('€1,906.50')
})

test('duplicate a budget to try a what-if, and switch between them', async ({ page }) => {
  await openBudget(page)
  await page.getByRole('button', { name: 'Your data' }).first().click()
  await page.getByRole('button', { name: 'Duplicate Example budget' }).click()
  await expect(page.getByRole('dialog').getByText('Example budget (copy)')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('combobox', { name: 'Switch budget' })).toHaveText('Example budget (copy)')
  await page.getByRole('button', { name: 'Edit Salary', exact: true }).click()
  await page.getByLabel('Amount (EUR)').fill('4000')
  await page.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByTestId('month-left')).toHaveText('€2,506.50')

  await page.getByRole('combobox', { name: 'Switch budget' }).click()
  await page.getByRole('option', { name: 'Example budget', exact: true }).click()
  await expect(page.getByTestId('month-left')).toHaveText('€1,706.50')
  await page.reload()
  await expect(page.getByTestId('month-left')).toHaveText('€1,706.50')
})

test('export a budget and import it back alongside the others', async ({ page }, testInfo) => {
  await openBudget(page)
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export budget' }).click()])
  expect(download.suggestedFilename()).toMatch(/^little-budget-example-budget-\d{4}-\d{2}-\d{2}\.json$/)
  const file = testInfo.outputPath('budget.json')
  await download.saveAs(file)
  expect(JSON.parse(await readFile(file, 'utf8')).entries).toHaveLength(18)
  await page.getByLabel('Import a plan file').setInputFiles(file)
  await expect(page.getByRole('dialog')).toContainText('a budget with 18 entries')
  await page.getByRole('button', { name: 'Add budget' }).click()
  await page.getByRole('combobox', { name: 'Switch budget' }).click()
  await expect(page.getByRole('option', { name: 'Example budget', exact: true })).toHaveCount(2)
})

test('the budget reads in German, with German number formatting', async ({ page }) => {
  await openBudget(page)
  await page.getByRole('button', { name: 'DE', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Was reinkommt. Was rausgeht.' })).toBeVisible()
  await expect(page.getByTestId('month-left')).toHaveText('1.706,50 €')
  await expect(page.getByRole('button', { name: 'Haushaltsbuch', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('navigation', { name: 'Seiten' }).getByRole('button')).toHaveText(['Haushaltsbuch', 'Wunschliste'])
})

test('data saved before budgets existed opens on the example budget', async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('little-budget-v1')) return
    localStorage.setItem('little-budget-v1', JSON.stringify({ version: 1, name: 'Old plan', budget: 0, currency: 'EUR', categories: [], items: [] }))
  })
  await page.goto('/')
  await expect(page.getByRole('combobox', { name: 'Switch budget' })).toHaveText('Example budget')
  await expect(page.getByTestId('month-left')).toHaveText('€1,706.50')
})

test('the budget page fits the viewport and renders without errors', async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await openBudget(page)
  await expect(page.getByRole('heading', { name: 'Analysis' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `test-results/${testInfo.project.name}-monthly.png`, fullPage: true })
  await page.getByRole('button', { name: 'Switch to dark mode' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: `test-results/${testInfo.project.name}-monthly-dark.png`, fullPage: true })
  expect(errors).toEqual([])
})
