export const STORAGE_KEY = 'little-budget-v1'
export const currencies = ['EUR', 'USD', 'GBP', 'CHF', 'CAD', 'AUD'] as const
export type Currency = typeof currencies[number]
export type Category = { id: string; name: string; color: string; enabled: boolean }
export type Option = { id: string; label: string }
export type Choice = { id: string; name: string; categoryId: string | null; enabled: boolean; selectedId: string | null; options: Option[] }
export type Purchase = { id: string; name: string; amount: number; quantity: number; priority: Priority; status: Status; link: string; categoryId: string | null; optionId: string | null; enabled: boolean; note: string }
export type Plan = { version: 6; id: string; name: string; budget: number; currency: Currency; categories: Category[]; choices: Choice[]; items: Purchase[]; example: boolean }
export type Library = { version: 1; activeId: string; plans: Plan[] }
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

// A pending move: which purchase, where it lands, and which purchase it should sit in front of.
export type Move = { id: string; categoryId: string | null; optionId: string | null; before: string | null }

// Moving is also how purchases are reordered: the list order is the order they are kept in.
export function movePurchase(plan: Plan, move: Move): Plan {
  const item = plan.items.find(candidate => candidate.id === move.id)
  if (!item || move.before === move.id) return plan
  const rest = plan.items.filter(candidate => candidate.id !== move.id)
  const at = move.before === null ? rest.length : rest.findIndex(candidate => candidate.id === move.before)
  const index = at < 0 ? rest.length : at
  const moved = { ...item, categoryId: move.categoryId, optionId: move.optionId }
  return { ...plan, items: [...rest.slice(0, index), moved, ...rest.slice(index)] }
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
  return { version: 6, id: crypto.randomUUID(), name, budget: 0, currency, categories: [], choices: [], items: [], example: false }
}

export function examplePlan(name: string): Plan {
  return {
    version: 6, id: crypto.randomUUID(), name, budget: 0, currency: 'EUR', example: true,
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

export function validatePlan(value: unknown): value is Plan {
  if (!value || typeof value !== 'object') return false
  const plan = value as Plan
  const validAmount = (amount: unknown) => typeof amount === 'number' && Number.isSafeInteger(amount) && amount >= 0 && amount <= MAX_AMOUNT
  if (plan.version !== 6 || typeof plan.id !== 'string' || !plan.id || typeof plan.name !== 'string' || typeof plan.example !== 'boolean' || !validAmount(plan.budget) || !currencies.includes(plan.currency) || !Array.isArray(plan.categories) || !Array.isArray(plan.choices) || !Array.isArray(plan.items)) return false
  if (!plan.categories.every(c => c && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.enabled === 'boolean' && colors.includes(c.color as typeof colors[number]))) return false
  if (new Set(plan.categories.map(c => c.id)).size !== plan.categories.length) return false
  if (!plan.choices.every(c => c && typeof c.id === 'string' && typeof c.name === 'string' && typeof c.enabled === 'boolean' && Array.isArray(c.options)
    && (c.categoryId === null || plan.categories.some(category => category.id === c.categoryId))
    && c.options.every(o => o && typeof o.id === 'string' && typeof o.label === 'string')
    && (c.selectedId === null ? c.options.length === 0 : c.options.some(o => o.id === c.selectedId)))) return false
  const optionIds = plan.choices.flatMap(c => c.options.map(o => o.id))
  if (new Set(optionIds).size !== optionIds.length) return false
  if (new Set(plan.choices.map(c => c.id)).size !== plan.choices.length) return false
  if (new Set(plan.items.map(i => i?.id)).size !== plan.items.length) return false
  return plan.items.every(i => i && typeof i.id === 'string' && typeof i.name === 'string' && typeof i.note === 'string' && typeof i.enabled === 'boolean' && validAmount(i.amount)
    && Number.isSafeInteger(i.quantity) && i.quantity >= 1 && i.quantity <= MAX_QUANTITY && validAmount(lineTotal(i))
    && priorities.includes(i.priority) && statuses.includes(i.status)
    && typeof i.link === 'string' && i.link.length <= MAX_LINK
    && (i.categoryId === null || plan.categories.some(c => c.id === i.categoryId))
    && (i.optionId === null || choiceOf(plan.choices, i.optionId)?.categoryId === i.categoryId))
}

// Plans saved by earlier versions: v1 had no either-ors, and before v4 a plan had no name of its own.
export function upgradePlan(value: unknown, fallbackName = 'Imported plan'): unknown {
  const saved = value as { version?: number; id?: unknown; name?: unknown; example?: unknown; items?: Purchase[] }
  if (!saved || typeof saved !== 'object' || !Array.isArray(saved.items)) return value
  if (saved.version === undefined || ![1, 2, 3, 4, 5].includes(saved.version)) return value
  const upgraded: Record<string, unknown> = {
    ...saved,
    version: 6,
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

export function validateLibrary(value: unknown): value is Library {
  const library = value as Library
  if (!library || typeof library !== 'object' || library.version !== 1 || !Array.isArray(library.plans) || !library.plans.length) return false
  if (!library.plans.every(validatePlan)) return false
  if (new Set(library.plans.map(plan => plan.id)).size !== library.plans.length) return false
  return library.plans.some(plan => plan.id === library.activeId)
}

export function exportPlan(plan: Plan) {
  return JSON.stringify(plan, null, 2)
}

export function exportLibrary(library: Library) {
  return JSON.stringify(library, null, 2)
}

export type Imported = { kind: 'plan'; plan: Plan } | { kind: 'library'; library: Library }

// Accepts a single plan or a whole library, written by any version of the app.
export function importFile(text: string, fallbackName = 'Imported plan'): Imported | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as Library).plans)) {
      const source = parsed as Library
      const library = { version: 1, activeId: source.activeId, plans: source.plans.map((plan, index) => upgradePlan(plan, `${fallbackName} ${index + 1}`)) } as Library
      if (!library.plans.some(plan => plan.id === library.activeId)) library.activeId = library.plans[0]?.id
      return validateLibrary(library) ? { kind: 'library', library } : null
    }
    const plan = upgradePlan(parsed, fallbackName)
    return validatePlan(plan) ? { kind: 'plan', plan } : null
  } catch {
    return null
  }
}

// A plan joining a library needs an identity of its own.
export function withFreshId(plan: Plan, taken: Plan[]): Plan {
  return taken.some(existing => existing.id === plan.id) ? { ...plan, id: crypto.randomUUID() } : plan
}

export function exportFilename(now = new Date(), name?: string) {
  const stamp = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map(part => String(part).padStart(2, '0')).join('-')
  const slug = (name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
  return `little-budget-${slug ? `${slug}-` : ''}${stamp}.json`
}

export function newLibrary(plan: Plan): Library {
  return { version: 1, activeId: plan.id, plans: [plan] }
}

// The stored value is a library; anything older is a lone plan and gets wrapped in one.
export function loadLibrary(exampleName: string, importedName: string): { library: Library; corrupted: boolean } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return { library: newLibrary(examplePlan(exampleName)), corrupted: false }
    const stored: unknown = JSON.parse(saved)
    if (stored && typeof stored === 'object' && Array.isArray((stored as Library).plans)) {
      const library = stored as Library
      const upgraded = { ...library, plans: library.plans.map(plan => upgradePlan(plan, importedName)) } as Library
      if (!validateLibrary(upgraded)) throw new Error('Invalid saved library')
      return { library: upgraded, corrupted: false }
    }
    const plan = upgradePlan(stored, importedName)
    if (!validatePlan(plan)) throw new Error('Invalid saved plan')
    return { library: newLibrary(plan), corrupted: false }
  } catch {
    return { library: newLibrary(emptyPlan(exampleName)), corrupted: true }
  }
}

export function saveLibrary(library: Library) {
  localStorage.setItem(STORAGE_KEY, exportLibrary(library))
}
