import { describe, expect, it } from 'vitest'
import { examplePlan } from './budget'
import { exampleBudget, monthly, monthsToAfford, moveBudgetCategory, moveEntry, splitByPerson, starterBudget, stillToBuy, summarizeBudget, validateBudget, type Budget, type Entry } from './household'
import { copy } from './i18n'
import { exportLibrary, importFile, newLibrary } from './library'

const example = () => exampleBudget(copy.en.exampleBudget, copy.en.budgetCategories)
const funded = (mode: 'leftover' | 'fixed', budget = example()): Budget => ({ ...budget, wishlist: { ...budget.wishlist, mode } })

describe('rearranging the budget book', () => {
  const ids = (budget: Budget, keep: (entry: Entry) => boolean) => budget.entries.filter(keep).map(entry => entry.id)
  it('reorders entries and carries an expense into another category', () => {
    const budget = example()
    const income = (entry: Entry) => entry.kind === 'income'
    expect(ids(budget, income)).toEqual(['salary-a', 'salary-b', 'bonus'])
    expect(ids(moveEntry(budget, { id: 'bonus', categoryId: null, before: 'salary-a' }), income)).toEqual(['bonus', 'salary-a', 'salary-b'])
    const moved = moveEntry(budget, { id: 'streaming', categoryId: 'leisure', before: null })
    expect(ids(moved, entry => entry.categoryId === 'leisure')).toEqual(['eating-out', 'streaming'])
    expect(summarizeBudget(moved).expenses).toBe(summarizeBudget(budget).expenses)
    expect(validateBudget(moved)).toBe(true)
  })
  it('keeps income and savings out of categories, and leaves the budget alone for a move that says nothing', () => {
    const budget = example()
    expect(moveEntry(budget, { id: 'salary-a', categoryId: 'housing', before: null }).entries.find(entry => entry.id === 'salary-a')!.categoryId).toBe(null)
    expect(moveEntry(budget, { id: 'rent', categoryId: 'gone', before: null }).entries.find(entry => entry.id === 'rent')!.categoryId).toBe('housing')
    expect(moveEntry(budget, { id: 'rent', categoryId: 'housing', before: 'rent' })).toBe(budget)
    expect(moveEntry(budget, { id: 'missing', categoryId: null, before: null })).toBe(budget)
  })
  it('puts a category in front of another, or last', () => {
    const budget = example()
    expect(moveBudgetCategory(budget, { id: 'other', before: 'housing' }).categories.map(c => c.id).slice(0, 2)).toEqual(['other', 'housing'])
    expect(moveBudgetCategory(budget, { id: 'housing', before: null }).categories.map(c => c.id).at(-1)).toBe('housing')
  })
})

describe('a month of money', () => {
  it('spreads bills that are not monthly over the months', () => {
    expect(monthly({ amount: 54000, frequency: 'yearly' })).toBe(4500)
    expect(monthly({ amount: 6000, frequency: 'halfYearly' })).toBe(1000)
    expect(monthly({ amount: 3000, frequency: 'quarterly' })).toBe(1000)
    expect(monthly({ amount: 1234, frequency: 'monthly' })).toBe(1234)
    // 52 weeks make a little more than four a month; whole cents all the same.
    expect(monthly({ amount: 1000, frequency: 'weekly' })).toBe(4333)
  })
  it('adds up the example budget', () => {
    expect(summarizeBudget(example())).toMatchObject({
      income: 575000, fixed: 180350, variable: 114000, expenses: 294350, savings: 90000,
      free: 190650, wishlist: 20000, left: 170650, forWishlist: 20000, irregular: 12250,
    })
  })
  it('leaves out switched-off entries and the expenses of a switched-off category', () => {
    const budget = example()
    const housingOff = { ...budget, categories: budget.categories.map(c => c.id === 'housing' ? { ...c, enabled: false } : c) }
    expect(summarizeBudget(housingOff).expenses).toBe(294350 - 145000 - 9500)
    const noBonus = { ...budget, entries: budget.entries.map(e => e.id === 'bonus' ? { ...e, enabled: false } : e) }
    expect(summarizeBudget(noBonus).income).toBe(560000)
  })
  it('adds up expenses by category, in category order with the uncategorized last', () => {
    const byCategory = summarizeBudget(example()).byCategory
    expect(byCategory.map(entry => entry.category?.id ?? null)).toEqual(['housing', 'groceries', 'transport', 'insurance', 'health', 'subscriptions', 'leisure', 'other', null])
    expect(byCategory.find(entry => entry.category?.id === 'transport')!.amount).toBe(1500 + 14000 + 5800)
    expect(byCategory.reduce((sum, entry) => sum + entry.amount, 0)).toBe(294350)
  })
  it('handles an empty budget, which starts with the standard categories', () => {
    const empty = starterBudget('Mine', copy.en.budgetCategories)
    expect(empty.categories.map(c => c.name)).toEqual(copy.en.budgetCategories)
    expect(summarizeBudget(empty)).toMatchObject({ income: 0, expenses: 0, savings: 0, left: 0, forWishlist: 0 })
  })
})

describe('paying for the wishlist', () => {
  it('uses everything left over, or a fixed amount taken out of it', () => {
    expect(summarizeBudget(funded('leftover'))).toMatchObject({ wishlist: 0, left: 190650, forWishlist: 190650 })
    expect(summarizeBudget(funded('fixed'))).toMatchObject({ wishlist: 20000, left: 170650, forWishlist: 20000 })
  })
  it('puts nothing toward the wishlist when nothing is left', () => {
    const budget = funded('leftover')
    const broke = { ...budget, entries: budget.entries.filter(entry => entry.kind !== 'income') }
    expect(summarizeBudget(broke).forWishlist).toBe(0)
  })
  it('counts the months until a plan is paid for, leaving out what is already bought', () => {
    expect(stillToBuy(examplePlan('Plan'))).toBe(90700 - 4500)
    expect(monthsToAfford(86200, 20000)).toBe(5)
    expect(monthsToAfford(20000, 20000)).toBe(1)
    expect(monthsToAfford(0, 0)).toBe(0)
    expect(monthsToAfford(100, 0)).toBe(null)
  })
})

describe('people sharing a budget', () => {
  it('splits shared costs by income, and the parts add up to the household', () => {
    const budget = example()
    const [a, b] = splitByPerson(budget)
    expect(a.share).toBeCloseTo(335000 / 575000)
    expect(a).toMatchObject({ income: 335000, fixed: 100281, variable: 72261, savings: 73304, wishlist: 11652, left: 77502 })
    expect(b).toMatchObject({ income: 240000, fixed: 80069, variable: 41739, savings: 16696, wishlist: 8348, left: 93148 })
    const totals = summarizeBudget(budget)
    for (const key of ['income', 'fixed', 'variable', 'savings', 'wishlist', 'left'] as const) expect(a[key] + b[key], key).toBe(totals[key])
  })
  it('splits equally when asked, or when nobody has an income of their own', () => {
    const [a, b] = splitByPerson({ ...example(), split: 'equal' })
    expect([a.share, b.share]).toEqual([0.5, 0.5])
    expect(a.fixed).toBe(1500 + 169550 / 2)
    const noIncome = { ...example(), entries: example().entries.filter(entry => entry.kind !== 'income') }
    expect(splitByPerson(noIncome).map(row => row.share)).toEqual([0.5, 0.5])
  })
  it('hands out shared income the way shared costs are handed out', () => {
    const benefit: Entry = { id: 'benefit', kind: 'income', name: 'Child benefit', amount: 25000, frequency: 'monthly', categoryId: null, personId: null, fixed: false, enabled: true, note: '' }
    const budget = { ...example(), entries: [...example().entries, benefit] }
    const [a, b] = splitByPerson(budget)
    expect(a.income).toBe(335000 + Math.round(25000 * 335000 / 575000))
    expect(a.income + b.income).toBe(600000)
  })
  it('has nothing to split without people', () => {
    const alone = { ...example(), people: [], entries: example().entries.map(entry => ({ ...entry, personId: null })) }
    expect(validateBudget(alone)).toBe(true)
    expect(splitByPerson(alone)).toEqual([])
  })
})

describe('stored budgets', () => {
  it('accepts the example and a starter budget', () => {
    expect(validateBudget(example())).toBe(true)
    expect(validateBudget(starterBudget('Mine', copy.de.budgetCategories))).toBe(true)
  })
  it('rejects broken references and unknown values', () => {
    const spoilers: ((budget: Budget) => void)[] = [
      budget => { budget.entries[0].categoryId = 'housing' },
      budget => { budget.entries[3].categoryId = 'gone' },
      budget => { budget.entries[3].personId = 'nobody' },
      budget => { (budget.entries[3] as { frequency: string }).frequency = 'daily' },
      budget => { budget.entries[3].amount = -1 },
      budget => { budget.entries[4].id = budget.entries[3].id },
      budget => { budget.people.push({ ...budget.people[0] }) },
      budget => { (budget.wishlist as { mode: string }).mode = 'sometimes' },
      budget => { (budget as { split: string }).split = 'coin toss' },
    ]
    for (const [index, spoil] of spoilers.entries()) {
      const budget = example()
      spoil(budget)
      expect(validateBudget(budget), String(index)).toBe(false)
    }
  })
})

describe('plans and budgets in one library', () => {
  it('reads a file with a single budget', () => {
    const budget = example()
    expect(importFile(JSON.stringify(budget))).toEqual({ kind: 'budget', budget })
  })
  it('carries the budgets through an export of everything', () => {
    const library = newLibrary(examplePlan('Plan'), example())
    expect(importFile(exportLibrary(library))).toEqual({ kind: 'library', library, withBudgets: true })
  })
  it('keeps the current budgets when a file of every plan predates them', () => {
    const current = newLibrary(examplePlan('Plan'), example())
    const old = { version: 1, activeId: current.plans[0].id, plans: current.plans }
    const imported = importFile(JSON.stringify(old), 'Imported plan', current)
    expect(imported).toMatchObject({ kind: 'library', withBudgets: false })
    expect(imported?.kind === 'library' && imported.library.budgets).toEqual(current.budgets)
    // Without budgets to keep, such a file cannot become a library.
    expect(importFile(JSON.stringify(old))).toBe(null)
  })
})
