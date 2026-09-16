import { emptyPlan, examplePlan, upgradePlan, validatePlan, type Plan } from './budget'
import { validateBudget, type Budget } from './household'

export const STORAGE_KEY = 'little-budget-v1'
// Everything kept in this browser: the shopping plans and the monthly budgets, each with the one that is open.
export type Library = { version: 2; activeId: string; plans: Plan[]; activeBudgetId: string; budgets: Budget[] }
type Budgets = Pick<Library, 'budgets' | 'activeBudgetId'>

export function validateLibrary(value: unknown): value is Library {
  const library = value as Library
  if (!library || typeof library !== 'object' || library.version !== 2 || !Array.isArray(library.plans) || !library.plans.length || !Array.isArray(library.budgets) || !library.budgets.length) return false
  if (!library.plans.every(validatePlan) || !library.budgets.every(validateBudget)) return false
  if (new Set(library.plans.map(plan => plan.id)).size !== library.plans.length) return false
  if (new Set(library.budgets.map(budget => budget.id)).size !== library.budgets.length) return false
  return library.plans.some(plan => plan.id === library.activeId) && library.budgets.some(budget => budget.id === library.activeBudgetId)
}

// Before v2 a library held only shopping plans; the budgets it goes on with are handed in.
function upgradeLibrary(value: Record<string, unknown> & { plans: unknown[] }, planName: (index: number) => string, budgets: () => Budgets | undefined) {
  const plans = value.plans.map((plan, index) => upgradePlan(plan, planName(index)))
  const kept = value.version === 2 ? { budgets: value.budgets, activeBudgetId: value.activeBudgetId } : budgets()
  return { version: 2, activeId: value.activeId, plans, ...kept } as Library
}

export function exportLibrary(library: Library) {
  return JSON.stringify(library, null, 2)
}

// A file of every plan written before budgets existed replaces the plans and leaves the budgets alone.
export type Imported = { kind: 'plan'; plan: Plan } | { kind: 'budget'; budget: Budget } | { kind: 'library'; library: Library; withBudgets: boolean }

// Accepts a single plan, a single budget or a whole library, written by any version of the app.
export function importFile(text: string, fallbackName = 'Imported plan', current?: Budgets): Imported | null {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object') return null
    const source = parsed as Record<string, unknown>
    if (Array.isArray(source.plans)) {
      const library = upgradeLibrary(source as typeof source & { plans: unknown[] }, index => `${fallbackName} ${index + 1}`, () => current)
      if (!library.plans.some(plan => plan?.id === library.activeId)) library.activeId = library.plans[0]?.id
      if (Array.isArray(library.budgets) && !library.budgets.some(budget => budget?.id === library.activeBudgetId)) library.activeBudgetId = library.budgets[0]?.id
      return validateLibrary(library) ? { kind: 'library', library, withBudgets: source.version === 2 } : null
    }
    if (Array.isArray(source.entries)) return validateBudget(parsed) ? { kind: 'budget', budget: parsed } : null
    const plan = upgradePlan(parsed, fallbackName)
    return validatePlan(plan) ? { kind: 'plan', plan } : null
  } catch {
    return null
  }
}

export function newLibrary(plan: Plan, budget: Budget): Library {
  return { version: 2, activeId: plan.id, plans: [plan], activeBudgetId: budget.id, budgets: [budget] }
}

// The stored value is a library; anything older is a lone plan and gets wrapped in one.
// Data from before budgets existed starts with the example budget, so the start page shows how it works.
export function loadLibrary(exampleName: string, importedName: string, seed: { example: () => Budget; starter: () => Budget }): { library: Library; corrupted: boolean } {
  const example = () => {
    const budget = seed.example()
    return { budgets: [budget], activeBudgetId: budget.id }
  }
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return { library: newLibrary(examplePlan(exampleName), seed.example()), corrupted: false }
    const stored: unknown = JSON.parse(saved)
    if (stored && typeof stored === 'object' && Array.isArray((stored as Library).plans)) {
      const upgraded = upgradeLibrary(stored as Record<string, unknown> & { plans: unknown[] }, () => importedName, example)
      if (!validateLibrary(upgraded)) throw new Error('Invalid saved library')
      return { library: upgraded, corrupted: false }
    }
    const plan = upgradePlan(stored, importedName)
    if (!validatePlan(plan)) throw new Error('Invalid saved plan')
    return { library: newLibrary(plan, seed.example()), corrupted: false }
  } catch {
    return { library: newLibrary(emptyPlan(exampleName), seed.starter()), corrupted: true }
  }
}

export function saveLibrary(library: Library) {
  localStorage.setItem(STORAGE_KEY, exportLibrary(library))
}
