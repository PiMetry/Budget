import { colors, currencies, isAmount, placeBefore, summarize, validCategories, type Category, type Currency, type Plan } from './budget'

export const kinds = ['income', 'expense', 'saving'] as const
export type Kind = typeof kinds[number]
export const frequencies = ['weekly', 'monthly', 'quarterly', 'halfYearly', 'yearly'] as const
export type Frequency = typeof frequencies[number]
// How the costs nobody owns alone are shared out between the people of a household.
export const splits = ['income', 'equal'] as const
export type Split = typeof splits[number]
export const fundingModes = ['leftover', 'fixed'] as const
export type Person = { id: string; name: string }
export type Entry = { id: string; kind: Kind; name: string; amount: number; frequency: Frequency; categoryId: string | null; personId: string | null; fixed: boolean; enabled: boolean; note: string }
// The wishlist is paid from whatever is left each month, or from a fixed amount put aside for it.
export type Funding = { mode: typeof fundingModes[number]; amount: number }
export type Budget = { version: 1; id: string; name: string; currency: Currency; categories: Category[]; people: Person[]; entries: Entry[]; split: Split; wishlist: Funding; example: boolean }
export const MAX_PEOPLE = 6

const perYear: Record<Frequency, number> = { weekly: 52, monthly: 12, quarterly: 4, halfYearly: 2, yearly: 1 }

// What an entry comes to in an average month: a yearly bill is spread over twelve.
export function monthly(entry: Pick<Entry, 'amount' | 'frequency'>) {
  return Math.round(entry.amount * perYear[entry.frequency] / 12)
}

// Only expenses have a category, and a switched-off category takes its expenses out of the month.
export function counts(entry: Entry, budget: Pick<Budget, 'categories'>) {
  if (!entry.enabled) return false
  return entry.categoryId === null || budget.categories.some(category => category.id === entry.categoryId && category.enabled)
}

type Buckets = { income: number; fixed: number; variable: number; savings: number }
const bucketOf = (entry: Entry): keyof Buckets => entry.kind === 'income' ? 'income' : entry.kind === 'saving' ? 'savings' : entry.fixed ? 'fixed' : 'variable'

export function summarizeBudget(budget: Budget) {
  const totals: Buckets = { income: 0, fixed: 0, variable: 0, savings: 0 }
  let irregular = 0
  const byCategory = new Map<string | null, number>()
  for (const entry of budget.entries) {
    if (!counts(entry, budget)) continue
    const amount = monthly(entry)
    totals[bucketOf(entry)] += amount
    if (entry.kind !== 'expense') continue
    if (entry.frequency !== 'monthly' && entry.frequency !== 'weekly') irregular += amount
    byCategory.set(entry.categoryId, (byCategory.get(entry.categoryId) ?? 0) + amount)
  }
  const expenses = totals.fixed + totals.variable
  // What is free once every expense and saving is paid; a fixed amount for the wishlist comes out of that.
  const free = totals.income - expenses - totals.savings
  const wishlist = budget.wishlist.mode === 'fixed' ? budget.wishlist.amount : 0
  return {
    ...totals, expenses, free, wishlist, irregular,
    left: free - wishlist,
    // What goes toward the wishlist each month.
    forWishlist: budget.wishlist.mode === 'fixed' ? wishlist : Math.max(free, 0),
    byCategory: [...budget.categories.map(category => ({ category, amount: byCategory.get(category.id) ?? 0 })), { category: null, amount: byCategory.get(null) ?? 0 }],
  }
}

// Each person carries their own entries plus a part of the shared ones: by income, or in equal parts.
// Shared income, like child benefit, is handed out the same way. The parts add up to the household.
export function splitByPerson(budget: Budget) {
  const people = budget.people
  if (!people.length) return []
  const own = new Map<string, Buckets>(people.map(person => [person.id, { income: 0, fixed: 0, variable: 0, savings: 0 }]))
  const shared: Buckets = { income: 0, fixed: 0, variable: 0, savings: 0 }
  for (const entry of budget.entries) {
    if (!counts(entry, budget)) continue
    const target = (entry.personId !== null && own.get(entry.personId)) || shared
    target[bucketOf(entry)] += monthly(entry)
  }
  const earned = people.reduce((sum, person) => sum + own.get(person.id)!.income, 0)
  const shares = people.map(person => budget.split === 'income' && earned > 0 ? own.get(person.id)!.income / earned : 1 / people.length)
  // Whole cents for everyone; the last person takes the rounding so nothing is lost or made up.
  const portion = (total: number, index: number) => index < people.length - 1
    ? Math.round(total * shares[index])
    : total - shares.slice(0, -1).reduce((sum, share) => sum + Math.round(total * share), 0)
  const wishlist = budget.wishlist.mode === 'fixed' ? budget.wishlist.amount : 0
  return people.map((person, index) => {
    const mine = own.get(person.id)!
    const part = (key: keyof Buckets) => mine[key] + portion(shared[key], index)
    const row = { person, share: shares[index], income: part('income'), fixed: part('fixed'), variable: part('variable'), savings: part('savings'), wishlist: portion(wishlist, index) }
    return { ...row, left: row.income - row.fixed - row.variable - row.savings - row.wishlist }
  })
}

// Entries are listed in the order they are kept in: one lands in front of `before`, or last. An expense can
// change category on the way; income and savings have none, so they only ever move within their own list.
export type EntryMove = { id: string; categoryId: string | null; before: string | null }

export function moveEntry(budget: Budget, move: EntryMove): Budget {
  const entry = budget.entries.find(candidate => candidate.id === move.id)
  if (!entry || move.before === move.id) return budget
  const categoryId = entry.kind === 'expense' && (move.categoryId === null || budget.categories.some(category => category.id === move.categoryId)) ? move.categoryId : entry.categoryId
  return { ...budget, entries: placeBefore(budget.entries, { ...entry, categoryId }, move.before) }
}

export function moveBudgetCategory(budget: Budget, move: { id: string; before: string | null }): Budget {
  const category = budget.categories.find(candidate => candidate.id === move.id)
  if (!category || move.before === move.id) return budget
  return { ...budget, categories: placeBefore(budget.categories, category, move.before) }
}

// What a shopping plan still needs: purchases already bought are paid for.
export function stillToBuy(plan: Plan) {
  const totals = summarize(plan)
  return totals.planned - totals.spent
}

// Whole months until the money put toward the wishlist covers a cost; null when nothing goes toward it.
export function monthsToAfford(cost: number, perMonth: number) {
  if (cost <= 0) return 0
  return perMonth > 0 ? Math.ceil(cost / perMonth) : null
}

export function starterCategories(names: readonly string[]): Category[] {
  return names.map((name, index) => ({ id: crypto.randomUUID(), name, color: colors[index % colors.length], enabled: true }))
}

export function starterBudget(name: string, categoryNames: readonly string[], currency: Currency = 'EUR'): Budget {
  return { version: 1, id: crypto.randomUUID(), name, currency, categories: starterCategories(categoryNames), people: [], entries: [], split: 'income', wishlist: { mode: 'leftover', amount: 0 }, example: false }
}

export const exampleEntryIds = ['salary-a', 'salary-b', 'bonus', 'rent', 'energy', 'groceries', 'internet', 'streaming', 'car-insurance', 'liability', 'car-tax', 'fuel', 'transit', 'gym', 'eating-out', 'presents', 'emergency', 'etf'] as const
export type ExampleWords = { name: string; people: readonly [string, string]; entries: Record<typeof exampleEntryIds[number], string> }

// A two-person household. The categories are the standard ones, in the order the names come in.
export function exampleBudget(words: ExampleWords, categoryNames: readonly string[]): Budget {
  const [housing, groceries, transport, insurance, health, subscriptions, leisure, other] = ['housing', 'groceries', 'transport', 'insurance', 'health', 'subscriptions', 'leisure', 'other']
  const categoryIds = [housing, groceries, transport, insurance, health, subscriptions, leisure, other]
  const entry = (id: typeof exampleEntryIds[number], kind: Kind, amount: number, frequency: Frequency, categoryId: string | null, personId: string | null, fixed = true): Entry =>
    ({ id, kind, name: words.entries[id], amount, frequency, categoryId, personId, fixed, enabled: true, note: '' })
  return {
    version: 1, id: crypto.randomUUID(), name: words.name, currency: 'EUR', example: true, split: 'income',
    wishlist: { mode: 'fixed', amount: 20000 },
    categories: categoryNames.map((name, index) => ({ id: categoryIds[index] ?? crypto.randomUUID(), name, color: colors[index % colors.length], enabled: true })),
    people: [{ id: 'person-a', name: words.people[0] }, { id: 'person-b', name: words.people[1] }],
    entries: [
      entry('salary-a', 'income', 320000, 'monthly', null, 'person-a'),
      entry('salary-b', 'income', 240000, 'monthly', null, 'person-b'),
      entry('bonus', 'income', 180000, 'yearly', null, 'person-a'),
      entry('rent', 'expense', 145000, 'monthly', housing, null),
      entry('energy', 'expense', 9500, 'monthly', housing, null),
      entry('groceries', 'expense', 70000, 'monthly', groceries, null, false),
      entry('internet', 'expense', 7500, 'monthly', subscriptions, null),
      entry('streaming', 'expense', 1800, 'monthly', subscriptions, null),
      entry('car-insurance', 'expense', 54000, 'yearly', insurance, null),
      entry('liability', 'expense', 15000, 'yearly', insurance, null),
      entry('car-tax', 'expense', 18000, 'yearly', transport, 'person-a'),
      entry('fuel', 'expense', 14000, 'monthly', transport, 'person-a', false),
      entry('transit', 'expense', 5800, 'monthly', transport, 'person-b'),
      entry('gym', 'expense', 3500, 'monthly', health, 'person-b'),
      entry('eating-out', 'expense', 25000, 'monthly', leisure, null, false),
      entry('presents', 'expense', 60000, 'yearly', other, null, false),
      entry('emergency', 'saving', 40000, 'monthly', null, null),
      entry('etf', 'saving', 50000, 'monthly', null, 'person-a'),
    ],
  }
}

export function validateBudget(value: unknown): value is Budget {
  if (!value || typeof value !== 'object') return false
  const budget = value as Budget
  if (budget.version !== 1 || typeof budget.id !== 'string' || !budget.id || typeof budget.name !== 'string' || typeof budget.example !== 'boolean' || !currencies.includes(budget.currency)
    || !Array.isArray(budget.categories) || !Array.isArray(budget.people) || !Array.isArray(budget.entries) || !splits.includes(budget.split)) return false
  if (!budget.wishlist || typeof budget.wishlist !== 'object' || !fundingModes.includes(budget.wishlist.mode) || !isAmount(budget.wishlist.amount)) return false
  if (!validCategories(budget.categories)) return false
  if (budget.people.length > MAX_PEOPLE || !budget.people.every(person => person && typeof person.id === 'string' && person.id && typeof person.name === 'string')) return false
  if (new Set(budget.people.map(person => person.id)).size !== budget.people.length) return false
  if (new Set(budget.entries.map(entry => entry?.id)).size !== budget.entries.length) return false
  return budget.entries.every(entry => entry && typeof entry.id === 'string' && typeof entry.name === 'string' && typeof entry.note === 'string'
    && typeof entry.enabled === 'boolean' && typeof entry.fixed === 'boolean' && kinds.includes(entry.kind) && frequencies.includes(entry.frequency) && isAmount(entry.amount)
    && (entry.categoryId === null || (entry.kind === 'expense' && budget.categories.some(category => category.id === entry.categoryId)))
    && (entry.personId === null || budget.people.some(person => person.id === entry.personId)))
}

export function exportBudget(budget: Budget) {
  return JSON.stringify(budget, null, 2)
}
