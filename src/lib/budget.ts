export const currencies = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD'] as const
export type Currency = typeof currencies[number]
export type Category = { id: string; name: string; color: string; enabled: boolean }
export type Option = { id: string; label: string }
export type Choice = { id: string; name: string; categoryId: string | null; enabled: boolean; selectedId: string | null; options: Option[] }
export type Purchase = { id: string; name: string; amount: number; quantity: number; priority: Priority; status: Status; link: string; categoryId: string | null; optionId: string | null; enabled: boolean; note: string }
// `layout` is the order of what sits directly in a category: purchases outside any option and either-ors, mixed.
export type Plan = { version: 7; id: string; name: string; budget: number; currency: Currency; categories: Category[]; choices: Choice[]; items: Purchase[]; layout: string[]; example: boolean }
export const colors = ['sage', 'peach', 'blue', 'lavender', 'yellow'] as const
// Ordered from the things you cannot do without down to the ones you could happily drop.
export const priorities = ['must', 'high', 'medium', 'low', 'whim'] as const
export type Priority = typeof priorities[number]
export const statuses = ['planned', 'bought', 'dropped'] as const
export type Status = typeof statuses[number]
export const MAX_QUANTITY = 999
export const MAX_LINK = 2000
export const MAX_AMOUNT = 99_999_999_999

export function parseAmount(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  const [whole, decimal = ''] = normalized.split('.')
  const amount = Number(whole) * 100 + Number(decimal.padEnd(2, '0'))
  return Number.isSafeInteger(amount) && amount <= MAX_AMOUNT ? amount : null
}

// A pasted address is usually missing its scheme; anything that is not a web address is refused.
export function normalizeLink(value: string): string | null {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (trimmed.length > MAX_LINK) return null
  const candidate = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const url = new URL(candidate)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

// Only web addresses are ever put in the page, whatever a stored or imported plan happens to contain.
export function safeLink(link: string) {
  try {
    const url = new URL(link)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
  } catch {
    return null
  }
}

// The choice an option belongs to. Option IDs are unique across the plan.
export function choiceOf(choices: Choice[], optionId: string | null) {
  return optionId === null ? undefined : choices.find(choice => choice.options.some(option => option.id === optionId))
}

// What a line costs: the price is per piece.
export function lineTotal(item: Purchase) {
  return item.amount * item.quantity
}

export function isIncluded(item: Purchase, plan: Pick<Plan, 'categories' | 'choices'>) {
  if (!item.enabled || item.status === 'dropped') return false
  if (item.categoryId !== null && !plan.categories.some(category => category.id === item.categoryId && category.enabled)) return false
  if (item.optionId === null) return true
  const choice = choiceOf(plan.choices, item.optionId)
  return choice !== undefined && choice.enabled && choice.selectedId === item.optionId
}

// What an option would cost if it were the picked one, whatever is picked now.
export function optionAmount(plan: Pick<Plan, 'items'>, optionId: string) {
  return plan.items.filter(item => item.optionId === optionId && item.enabled && item.status !== 'dropped').reduce((sum, item) => sum + lineTotal(item), 0)
}

// Out of the total only because a different option of its either-or is picked: a decision, not something set aside.
export function isAlternative(item: Purchase, plan: Pick<Plan, 'categories' | 'choices'>) {
  if (!item.enabled || item.status === 'dropped' || item.optionId === null) return false
  if (item.categoryId !== null && !plan.categories.some(category => category.id === item.categoryId && category.enabled)) return false
  const choice = choiceOf(plan.choices, item.optionId)
  return choice !== undefined && choice.enabled && choice.selectedId !== item.optionId
}

// What marking a category or an either-or as bought covers: whatever counts there now. Of an either-or that is only
// the picked option; purchases switched off, set aside or no longer needed are left as they are.
export type BoughtScope = { categoryId: string | null } | { choiceId: string }

export function boughtScope(plan: Plan, scope: BoughtScope): Purchase[] {
  const inScope = 'choiceId' in scope
    ? (item: Purchase) => choiceOf(plan.choices, item.optionId)?.id === scope.choiceId
    : (item: Purchase) => item.categoryId === scope.categoryId
  return plan.items.filter(item => inScope(item) && isIncluded(item, plan))
}

// Unmarking puts a bought purchase back to still planned; one that is no longer needed only changes if it is bought after all.
export function setBought(plan: Plan, ids: string[], bought: boolean): Plan {
  const marked = new Set(ids)
  return {
    ...plan,
    items: plan.items.map(item => {
      if (!marked.has(item.id)) return item
      const status: Status = bought ? 'bought' : item.status === 'bought' ? 'planned' : item.status
      return { ...item, status }
    }),
  }
}

// A pending move: which purchase, where it lands, and which purchase it should sit in front of.
export type Move = { id: string; categoryId: string | null; optionId: string | null; before: string | null }

// Takes an entry out of a list and puts it back in front of `before`, or at the end.
export function placeBefore<T extends { id: string }>(list: T[], entry: T, before: string | null) {
  const rest = list.filter(candidate => candidate.id !== entry.id)
  const at = before === null ? -1 : rest.findIndex(candidate => candidate.id === before)
  const index = at < 0 ? rest.length : at
  return [...rest.slice(0, index), entry, ...rest.slice(index)]
}

function placeIdBefore(ids: string[], id: string, before: string | null) {
  return placeBefore(ids.map(entry => ({ id: entry })), { id }, before).map(entry => entry.id)
}

// What sits directly in a category, in the order it is shown. Anything not listed yet goes last, and ids of
// things that are gone or tucked into an option are skipped, so the list never has to be kept in step by hand.
export function layoutOf(plan: Pick<Plan, 'layout' | 'items' | 'choices'>): string[] {
  const top = [...plan.items.filter(item => item.optionId === null).map(item => item.id), ...plan.choices.map(choice => choice.id)]
  const present = new Set(top)
  const listed = [...new Set(plan.layout)].filter(id => present.has(id))
  const seen = new Set(listed)
  return [...listed, ...top.filter(id => !seen.has(id))]
}

// Moving is also how purchases are reordered. Inside an option the list order is the order they are kept in;
// on their own they share the category's order with its either-ors, so `before` can be either kind.
export function movePurchase(plan: Plan, move: Move): Plan {
  const item = plan.items.find(candidate => candidate.id === move.id)
  if (!item || move.before === move.id) return plan
  const items = placeBefore(plan.items, { ...item, categoryId: move.categoryId, optionId: move.optionId }, move.before)
  const layout = move.optionId === null ? placeIdBefore(layoutOf(plan), item.id, move.before) : layoutOf(plan).filter(id => id !== item.id)
  return { ...plan, items, layout }
}

// Categories are listed in the order they are kept in.
export type CategoryMove = { id: string; before: string | null }

export function moveCategory(plan: Plan, move: CategoryMove): Plan {
  const category = plan.categories.find(candidate => candidate.id === move.id)
  if (!category || move.before === move.id) return plan
  return { ...plan, categories: placeBefore(plan.categories, category, move.before) }
}

// An either-or takes the purchases in its options along, so they always live in the same category as it does.
export type ChoiceMove = { id: string; categoryId: string | null; before: string | null }

export function moveChoice(plan: Plan, move: ChoiceMove): Plan {
  const choice = plan.choices.find(candidate => candidate.id === move.id)
  if (!choice || move.before === move.id) return plan
  const owned = new Set(choice.options.map(option => option.id))
  return {
    ...plan,
    choices: placeBefore(plan.choices, { ...choice, categoryId: move.categoryId }, move.before),
    items: move.categoryId === choice.categoryId ? plan.items : plan.items.map(item => item.optionId !== null && owned.has(item.optionId) ? { ...item, categoryId: move.categoryId } : item),
    layout: placeIdBefore(layoutOf(plan), choice.id, move.before),
  }
}

// Options are reordered within their own either-or, in front of `before` or last.
export type OptionMove = { id: string; before: string | null }

export function moveOption(plan: Plan, move: OptionMove): Plan {
  const choice = choiceOf(plan.choices, move.id)
  const option = choice?.options.find(candidate => candidate.id === move.id)
  if (!choice || !option || move.before === move.id) return plan
  return { ...plan, choices: plan.choices.map(candidate => candidate.id === choice.id ? { ...candidate, options: placeBefore(candidate.options, option, move.before) } : candidate) }
}

export function deletePurchase(plan: Plan, id: string): Plan {
  const next = { ...plan, items: plan.items.filter(item => item.id !== id) }
  return { ...next, layout: layoutOf(next) }
}

// An either-or's purchases go with it, or stay where it stood as plain purchases, option by option.
export function deleteChoice(plan: Plan, id: string, withPurchases: boolean): Plan {
  const choice = plan.choices.find(candidate => candidate.id === id)
  if (!choice) return plan
  const inside = choice.options.flatMap(option => plan.items.filter(item => item.optionId === option.id).map(item => item.id))
  const gone = new Set(inside)
  return {
    ...plan,
    choices: plan.choices.filter(candidate => candidate.id !== id),
    items: withPurchases ? plan.items.filter(item => !gone.has(item.id)) : plan.items.map(item => gone.has(item.id) ? { ...item, optionId: null } : item),
    layout: layoutOf(plan).flatMap(entry => entry !== id ? [entry] : withPurchases ? [] : inside),
  }
}

// A category's purchases and either-ors go with it, or move to Uncategorized in the order they had.
export function deleteCategory(plan: Plan, id: string, withContents: boolean): Plan {
  const categories = plan.categories.filter(category => category.id !== id)
  const next = withContents
    ? { ...plan, categories, choices: plan.choices.filter(choice => choice.categoryId !== id), items: plan.items.filter(item => item.categoryId !== id) }
    : { ...plan, categories, choices: plan.choices.map(choice => choice.categoryId === id ? { ...choice, categoryId: null } : choice), items: plan.items.map(item => item.categoryId === id ? { ...item, categoryId: null } : item) }
  return { ...next, layout: layoutOf(next) }
}

export function summarize(plan: Plan) {
  let planned = 0
  let spent = 0
  let includedCount = 0
  let alternativeCount = 0
  for (const item of plan.items) {
    if (isIncluded(item, plan)) {
      planned += lineTotal(item)
      includedCount += 1
      if (item.status === 'bought') spent += lineTotal(item)
    } else if (isAlternative(item, plan)) alternativeCount += 1
  }
  const excludedCount = plan.items.length - includedCount
  return { planned, spent, remaining: plan.budget - planned, includedCount, excludedCount, alternativeCount, setAsideCount: excludedCount - alternativeCount }
}

export function formatMoney(cents: number, currency: Currency, locale = 'en-GB') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100)
}

// Keeps a choice pointing at one of its own options, or at nothing when it has none.
export function withValidSelection(choice: Choice): Choice {
  if (choice.options.some(option => option.id === choice.selectedId)) return choice
  return { ...choice, selectedId: choice.options[0]?.id ?? null }
}

export function emptyPlan(name: string, currency: Currency = 'EUR'): Plan {
  return { version: 7, id: crypto.randomUUID(), name, budget: 0, currency, categories: [], choices: [], items: [], layout: [], example: false }
}

export function examplePlan(name: string): Plan {
  return {
    version: 7, id: crypto.randomUUID(), name, budget: 0, currency: 'EUR', example: true, layout: [],
    categories: [
      { id: 'kitchen', name: 'Kitchen refresh', color: 'sage', enabled: true },
      { id: 'office', name: 'Home office', color: 'blue', enabled: true },
      { id: 'garden', name: 'Garden someday', color: 'peach', enabled: false },
    ],
    choices: [
      { id: 'shelf', name: 'Bookshelf', categoryId: 'office', enabled: true, selectedId: 'shelf-narrow', options: [{ id: 'shelf-narrow', label: '60 cm wide' }, { id: 'shelf-wide', label: '90 cm wide' }] },
      { id: 'coffee', name: 'Coffee setup', categoryId: null, enabled: true, selectedId: 'coffee-manual', options: [{ id: 'coffee-manual', label: 'Machine and grinder' }, { id: 'coffee-auto', label: 'Bean-to-cup' }] },
    ],
    items: [
      { id: 'pans', name: 'Pan set', amount: 7900, quantity: 1, priority: 'high', status: 'planned', link: '', categoryId: 'kitchen', optionId: null, enabled: true, note: 'The old one has seen things' },
      { id: 'kettle', name: 'Kettle', amount: 4500, quantity: 1, priority: 'must', status: 'bought', link: '', categoryId: 'kitchen', optionId: null, enabled: true, note: '' },
      { id: 'chair', name: 'Desk chair', amount: 22900, quantity: 1, priority: 'must', status: 'planned', link: 'https://example.com/shop/desk-chair', categoryId: 'office', optionId: null, enabled: true, note: 'Kinder to the back' },
      { id: 'lamp', name: 'Desk lamp', amount: 5900, quantity: 1, priority: 'medium', status: 'planned', link: '', categoryId: 'office', optionId: null, enabled: true, note: '' },
      { id: 'shelf-60', name: 'Bookshelf, 60 cm', amount: 8900, quantity: 1, priority: 'medium', status: 'planned', link: '', categoryId: 'office', optionId: 'shelf-narrow', enabled: true, note: 'Fits beside the door' },
      { id: 'shelf-90', name: 'Bookshelf, 90 cm', amount: 12900, quantity: 1, priority: 'medium', status: 'planned', link: '', categoryId: 'office', optionId: 'shelf-wide', enabled: true, note: 'Room to grow' },
      { id: 'bench', name: 'Garden bench', amount: 14900, quantity: 1, priority: 'low', status: 'planned', link: '', categoryId: 'garden', optionId: null, enabled: true, note: '' },
      { id: 'espresso', name: 'Espresso machine', amount: 24900, quantity: 1, priority: 'high', status: 'planned', link: 'https://example.com/shop/espresso-machine', categoryId: null, optionId: 'coffee-manual', enabled: true, note: '' },
      { id: 'grinder', name: 'Burr grinder', amount: 9900, quantity: 1, priority: 'medium', status: 'planned', link: '', categoryId: null, optionId: 'coffee-manual', enabled: true, note: 'Only makes sense with the machine' },
      { id: 'bean-to-cup', name: 'Bean-to-cup machine', amount: 39900, quantity: 1, priority: 'high', status: 'planned', link: '', categoryId: null, optionId: 'coffee-auto', enabled: true, note: 'One button, no fuss' },
      { id: 'frames', name: 'Picture frames', amount: 2900, quantity: 2, priority: 'low', status: 'planned', link: '', categoryId: null, optionId: null, enabled: true, note: '' },
      { id: 'toolbox', name: 'Toolbox', amount: 5900, quantity: 1, priority: 'whim', status: 'dropped', link: '', categoryId: null, optionId: null, enabled: true, note: '' },
    ],
  }
}

export function isAmount(amount: unknown): amount is number {
  return typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0 && amount <= MAX_AMOUNT
}

export function validCategories(categories: Category[]) {
  if (!categories.every(c => c && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.enabled === 'boolean' && colors.includes(c.color as typeof colors[number]))) return false
  return new Set(categories.map(c => c.id)).size === categories.length
}

export function validatePlan(value: unknown): value is Plan {
  if (!value || typeof value !== 'object') return false
  const plan = value as Plan
  if (plan.version !== 7 || typeof plan.id !== 'string' || !plan.id || typeof plan.name !== 'string' || typeof plan.example !== 'boolean' || !isAmount(plan.budget) || !currencies.includes(plan.currency) || !Array.isArray(plan.categories) || !Array.isArray(plan.choices) || !Array.isArray(plan.items)) return false
  if (!Array.isArray(plan.layout) || !plan.layout.every(id => typeof id === 'string')) return false
  if (!validCategories(plan.categories)) return false
  if (!plan.choices.every(c => c && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.enabled === 'boolean' && Array.isArray(c.options)
    && (c.categoryId === null || plan.categories.some(category => category.id === c.categoryId))
    && c.options.every(o => o && typeof o.id === 'string' && typeof o.label === 'string')
    && (c.selectedId === null ? c.options.length === 0 : c.options.some(o => o.id === c.selectedId)))) return false
  const optionIds = plan.choices.flatMap(c => c.options.map(o => o.id))
  if (new Set(optionIds).size !== optionIds.length) return false
  if (new Set(plan.choices.map(c => c.id)).size !== plan.choices.length) return false
  if (new Set(plan.items.map(i => i?.id)).size !== plan.items.length) return false
  return plan.items.every(i => i && typeof i.id === 'string' && typeof i.name === 'string' && typeof i.note === 'string' && typeof i.enabled === 'boolean' && isAmount(i.amount)
    && Number.isSafeInteger(i.quantity) && i.quantity >= 1 && i.quantity <= MAX_QUANTITY && isAmount(lineTotal(i))
    && priorities.includes(i.priority) && statuses.includes(i.status)
    && typeof i.link === 'string' && i.link.length <= MAX_LINK
    && (i.categoryId === null || plan.categories.some(c => c.id === i.categoryId))
    && (i.optionId === null || choiceOf(plan.choices, i.optionId)?.categoryId === i.categoryId))
}

// Plans saved by earlier versions: v1 had no either-ors, and before v4 a plan had no name of its own.
// Before v7 a category listed its purchases above its either-ors, which is what an empty layout gives.
export function upgradePlan(value: unknown, fallbackName = 'Imported plan'): unknown {
  const saved = value as { version?: number; id?: unknown; name?: unknown; example?: unknown; items?: Purchase[] }
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.items)) return value
  if (saved.version === undefined || ![1, 2, 3, 4, 5, 6].includes(saved.version)) return value
  const upgraded: Record<string, unknown> = {
    ...saved,
    version: 7,
    layout: [],
    id: typeof saved.id === 'string' && saved.id ? saved.id : crypto.randomUUID(),
    name: typeof saved.name === 'string' && saved.name.trim() ? saved.name : fallbackName,
    example: saved.example === true,
  }
  if (saved.version === 1) upgraded.choices = []
  // Purchases gained a quantity, a priority and a status in v5; before that every line was one planned piece.
  upgraded.items = saved.items.map(item => ({
    ...item,
    optionId: item.optionId ?? null,
    quantity: Number.isSafeInteger(item.quantity) && item.quantity >= 1 ? Math.min(item.quantity, MAX_QUANTITY) : 1,
    priority: priorities.includes(item.priority) ? item.priority : 'medium',
    status: statuses.includes(item.status) ? item.status : 'planned',
    link: typeof item.link === 'string' ? normalizeLink(item.link) ?? '' : '',
  }))
  return upgraded
}

export function exportPlan(plan: Plan) {
  return JSON.stringify(plan, null, 2)
}

// A plan or budget joining a library needs an identity of its own.
export function withFreshId<T extends { id: string }>(entry: T, taken: { id: string }[]): T {
  return taken.some(existing => existing.id === entry.id) ? { ...entry, id: crypto.randomUUID() } : entry
}

export function exportFilename(now = new Date(), name?: string) {
  const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map(part => String(part).padStart(2, '0')).join('-')
  const slug = (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return `little-budget-${slug ? `${slug}-` : ''}${stamp}.json`
}

