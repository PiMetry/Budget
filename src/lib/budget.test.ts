import { describe, expect, it } from 'vitest'
import { boughtScope, deleteCategory, deleteChoice, deletePurchase, emptyPlan, examplePlan, exportFilename, layoutOf, lineTotal, moveCategory, moveChoice, moveOption, movePurchase, normalizeLink, safeLink, exportPlan, isAlternative, isIncluded, optionAmount, parseAmount, setBought, summarize, upgradePlan, validatePlan, withFreshId, withValidSelection, type Plan } from './budget'
import { exampleBudget } from './household'
import { copy, languages } from './i18n'
import { exportLibrary, importFile, newLibrary, validateLibrary } from './library'

const budgetExample = () => exampleBudget(copy.en.exampleBudget, copy.en.budgetCategories)

const PLANNED = 90700
const BUDGET = 0
const example = () => examplePlan('Example plan')
const pick = (plan: Plan, choiceId: string, optionId: string) => ({ ...plan, choices: plan.choices.map(c => c.id === choiceId ? { ...c, selectedId: optionId } : c) })

describe('budget calculations', () => {
  it('uses cents to avoid floating-point drift', () => {
    const plan = emptyPlan('Cents')
    plan.budget = parseAmount('0.30')!
    plan.items = ['0.10', '0.20'].map((amount, i) => ({ id: String(i), name: 'Item', amount: parseAmount(amount)!, quantity: 1, priority: 'medium' as const, status: 'planned' as const, link: '', categoryId: null, optionId: null, enabled: true, note: '' }))
    expect(summarize(plan).remaining).toBe(0)
  })
  it('adds up the example plan', () => {
    expect(summarize(example())).toMatchObject({ planned: PLANNED, spent: 4500, remaining: BUDGET - PLANNED, includedCount: 8, excludedCount: 4 })
    // A plan without a budget just reports the total; nothing is over or under.
    expect(example().budget).toBe(0)
  })
  it('excludes disabled categories without losing individual choices', () => {
    const plan = example()
    expect(isIncluded(plan.items.find(i => i.id === 'bench')!, plan)).toBe(false)
    plan.categories[1].enabled = false
    expect(summarize(plan).planned).toBe(PLANNED - 22900 - 5900 - 8900)
    plan.categories[1].enabled = true
    expect(summarize(plan).planned).toBe(PLANNED)
    expect(plan.items.find(i => i.id === 'toolbox')!.status).toBe('dropped')
  })
  it('includes uncategorized purchases and allows negative remaining budgets', () => {
    const plan = example()
    plan.budget = 100
    expect(isIncluded(plan.items.find(i => i.id === 'frames')!, plan)).toBe(true)
    expect(summarize(plan).remaining).toBe(100 - PLANNED)
  })
  it('handles an empty plan and a zero budget', () => {
    expect(summarize(emptyPlan('Empty'))).toMatchObject({ planned: 0, remaining: 0, includedCount: 0, excludedCount: 0 })
  })
})

describe('either-or options', () => {
  it('counts only the picked option', () => {
    const plan = example()
    expect(isIncluded(plan.items.find(i => i.id === 'shelf-60')!, plan)).toBe(true)
    expect(isIncluded(plan.items.find(i => i.id === 'shelf-90')!, plan)).toBe(false)
    expect(summarize(pick(plan, 'shelf', 'shelf-wide')).planned).toBe(PLANNED - 8900 + 12900)
  })
  it('treats every purchase in an option as one alternative', () => {
    const plan = example()
    expect(optionAmount(plan, 'coffee-manual')).toBe(34800)
    expect(optionAmount(plan, 'coffee-auto')).toBe(39900)
    expect(summarize(pick(plan, 'coffee', 'coffee-auto')).planned).toBe(PLANNED - 34800 + 39900)
  })
  it('counts an option that lost the pick as an alternative, not as set aside', () => {
    const plan = example()
    const totals = summarize(plan)
    // Out: the wide shelf, the bean-to-cup machine, the switched-off toolbox and the garden bench in a switched-off category.
    expect(totals.excludedCount).toBe(4)
    expect(totals.alternativeCount).toBe(2)
    expect(totals.setAsideCount).toBe(2)
    expect(isAlternative(plan.items.find(i => i.id === 'shelf-90')!, plan)).toBe(true)
    expect(isAlternative(plan.items.find(i => i.id === 'toolbox')!, plan)).toBe(false)
    expect(isAlternative(plan.items.find(i => i.id === 'bench')!, plan)).toBe(false)
  })
  it('counts a switched-off either-or as set aside rather than as alternatives', () => {
    const plan = example()
    const off = { ...plan, choices: plan.choices.map(c => c.id === 'coffee' ? { ...c, enabled: false } : c) }
    const totals = summarize(off)
    expect(totals.alternativeCount).toBe(1)
    expect(totals.setAsideCount).toBe(2 + 3)
    expect(totals.planned).toBe(PLANNED - 34800)
    expect(off.choices[1].selectedId).toBe('coffee-manual')
  })
  it('drops an either-or that sits in a switched-off category', () => {
    const plan = example()
    const officeOff = { ...plan, categories: plan.categories.map(c => c.id === 'office' ? { ...c, enabled: false } : c) }
    expect(isIncluded(officeOff.items.find(i => i.id === 'shelf-60')!, officeOff)).toBe(false)
    expect(isAlternative(officeOff.items.find(i => i.id === 'shelf-90')!, officeOff)).toBe(false)
  })
  it('leaves a switched-off purchase out of its option', () => {
    const plan = example()
    const withoutGrinder = { ...plan, items: plan.items.map(i => i.id === 'grinder' ? { ...i, enabled: false } : i) }
    expect(optionAmount(withoutGrinder, 'coffee-manual')).toBe(24900)
    expect(summarize(withoutGrinder).planned).toBe(PLANNED - 9900)
  })
  it('repoints a selection when the picked option disappears', () => {
    const choice = example().choices[0]
    expect(withValidSelection(choice).selectedId).toBe('shelf-narrow')
    expect(withValidSelection({ ...choice, options: choice.options.slice(1) }).selectedId).toBe('shelf-wide')
    expect(withValidSelection({ ...choice, options: [] }).selectedId).toBe(null)
  })
})

describe('quantity, priority and status', () => {
  it('multiplies the price by the quantity', () => {
    const plan = example()
    const frames = plan.items.find(i => i.id === 'frames')!
    expect(frames.quantity).toBe(2)
    expect(lineTotal(frames)).toBe(5800)
    const more = { ...plan, items: plan.items.map(i => i.id === 'frames' ? { ...i, quantity: 5 } : i) }
    expect(summarize(more).planned).toBe(PLANNED - 5800 + 14500)
  })
  it('counts a bought purchase as spent while it still fills the budget', () => {
    const plan = example()
    const totals = summarize(plan)
    expect(totals.spent).toBe(4500)
    expect(totals.planned).toBe(PLANNED)
    const unbought = { ...plan, items: plan.items.map(i => i.id === 'kettle' ? { ...i, status: 'planned' as const } : i) }
    expect(summarize(unbought)).toMatchObject({ spent: 0, planned: PLANNED })
  })
  it('never counts a purchase that is no longer needed', () => {
    const plan = example()
    const toolbox = plan.items.find(i => i.id === 'toolbox')!
    expect(toolbox.enabled).toBe(true)
    expect(isIncluded(toolbox, plan)).toBe(false)
    expect(isAlternative(toolbox, plan)).toBe(false)
    const dropped = { ...plan, items: plan.items.map(i => i.id === 'shelf-60' ? { ...i, status: 'dropped' as const } : i) }
    expect(summarize(dropped).planned).toBe(PLANNED - 8900)
    expect(optionAmount(dropped, 'shelf-narrow')).toBe(0)
  })
  it('marks what counts in a category or either-or as bought, and back', () => {
    const plan = example()
    // The office counts its chair, its lamp and the picked 60 cm shelf; the 90 cm shelf lost the pick.
    const office = boughtScope(plan, { categoryId: 'office' }).map(i => i.id)
    expect(office).toEqual(['chair', 'lamp', 'shelf-60'])
    const bought = setBought(plan, office, true)
    expect(summarize(bought).spent).toBe(4500 + 22900 + 5900 + 8900)
    expect(bought.items.find(i => i.id === 'shelf-90')!.status).toBe('planned')
    expect(summarize(setBought(bought, office, false)).spent).toBe(4500)
    expect(boughtScope(plan, { choiceId: 'coffee' }).map(i => i.id)).toEqual(['espresso', 'grinder'])
    expect(boughtScope(plan, { categoryId: null }).map(i => i.id)).toEqual(['espresso', 'grinder', 'frames'])
    expect(boughtScope(plan, { categoryId: 'garden' })).toEqual([])
    // A switched-off either-or counts for nothing, so marking its category leaves it alone.
    const coffeeOff = { ...plan, choices: plan.choices.map(c => c.id === 'coffee' ? { ...c, enabled: false } : c) }
    expect(boughtScope(coffeeOff, { categoryId: null }).map(i => i.id)).toEqual(['frames'])
    expect(boughtScope(coffeeOff, { choiceId: 'coffee' })).toEqual([])
  })
  it('only changes a purchase that is no longer needed when it is bought after all', () => {
    const plan = example()
    expect(setBought(plan, ['toolbox'], false).items.find(i => i.id === 'toolbox')!.status).toBe('dropped')
    expect(setBought(plan, ['toolbox'], true).items.find(i => i.id === 'toolbox')!.status).toBe('bought')
  })
  it('rejects a quantity that is not a whole number of pieces', () => {
    for (const quantity of [0, -1, 1.5, 1000]) {
      const plan = example()
      plan.items[0].quantity = quantity
      expect(validatePlan(plan), String(quantity)).toBe(false)
    }
  })
  it('rejects an unknown priority or status', () => {
    expect(validatePlan({ ...example(), items: example().items.map(i => ({ ...i, priority: 'urgent' })) })).toBe(false)
    expect(validatePlan({ ...example(), items: example().items.map(i => ({ ...i, status: 'maybe' })) })).toBe(false)
  })
  it('gives older purchases one piece, a middling priority and a plan to buy', () => {
    const v4 = { ...example(), version: 4, items: example().items.map(({ quantity: _q, priority: _p, status: _s, link: _l, ...rest }) => rest) }
    const upgraded = upgradePlan(v4) as Plan
    expect(validatePlan(upgraded)).toBe(true)
    expect(upgraded.items.every(i => i.quantity === 1 && i.priority === 'medium' && i.status === 'planned' && i.link === '')).toBe(true)
  })
})

describe('where to buy it', () => {
  it('fills in a missing scheme', () => {
    expect(normalizeLink('shop.example.com/thing')).toBe('https://shop.example.com/thing')
    expect(normalizeLink('  https://shop.example.com/thing  ')).toBe('https://shop.example.com/thing')
    expect(normalizeLink('http://shop.example.com')).toBe('http://shop.example.com/')
    expect(normalizeLink('')).toBe('')
    expect(normalizeLink('   ')).toBe('')
  })
  it('refuses anything that is not a web address', () => {
    for (const value of ['javascript:alert(1)', 'data:text/html,x', 'mailto:shop@example.com', 'not a url', `https://example.com/${'x'.repeat(2100)}`]) {
      expect(normalizeLink(value), value).toBe(null)
    }
  })
  it('only ever hands back a web address to put in the page', () => {
    expect(safeLink('https://shop.example.com/thing')?.host).toBe('shop.example.com')
    expect(safeLink('javascript:alert(1)')).toBe(null)
    expect(safeLink('')).toBe(null)
  })
  it('keeps a link with the purchase and rejects an overlong one', () => {
    const plan = example()
    expect(plan.items.find(i => i.id === 'chair')!.link).toBe('https://example.com/shop/desk-chair')
    expect(validatePlan(plan)).toBe(true)
    plan.items[0].link = 'x'.repeat(2100)
    expect(validatePlan(plan)).toBe(false)
  })
  it('drops a stored link that is not a web address when upgrading', () => {
    const v5 = { ...example(), version: 5, items: example().items.map(i => ({ ...i, link: 'javascript:alert(1)' })) }
    const upgraded = upgradePlan(v5) as Plan
    expect(validatePlan(upgraded)).toBe(true)
    expect(upgraded.items.every(i => i.link === '')).toBe(true)
  })
})

describe('moving and reordering purchases', () => {
  const names = (plan: Plan) => plan.items.map(i => i.id)
  it('reorders within the list', () => {
    const plan = example()
    expect(names(movePurchase(plan, { id: 'kettle', categoryId: 'kitchen', optionId: null, before: 'pans' })).slice(0, 2)).toEqual(['kettle', 'pans'])
  })
  it('carries a purchase into another category and out of its option', () => {
    const plan = example()
    const moved = movePurchase(plan, { id: 'espresso', categoryId: 'kitchen', optionId: null, before: 'kettle' })
    const espresso = moved.items.find(i => i.id === 'espresso')!
    expect(espresso.categoryId).toBe('kitchen')
    expect(espresso.optionId).toBe(null)
    expect(validatePlan(moved)).toBe(true)
    expect(summarize(moved).planned).toBe(PLANNED)
  })
  it('carries a purchase into an either-or option', () => {
    const plan = example()
    const moved = movePurchase(plan, { id: 'kettle', categoryId: null, optionId: 'coffee-auto', before: null })
    expect(validatePlan(moved)).toBe(true)
    expect(names(moved).at(-1)).toBe('kettle')
    // The bean-to-cup option is not the picked one, so the kettle stops counting.
    expect(summarize(moved).planned).toBe(PLANNED - 4500)
  })
  it('leaves the plan alone for a move that says nothing', () => {
    const plan = example()
    expect(movePurchase(plan, { id: 'kettle', categoryId: 'kitchen', optionId: null, before: 'kettle' })).toBe(plan)
    expect(movePurchase(plan, { id: 'nobody', categoryId: null, optionId: null, before: null })).toBe(plan)
  })
})

describe('rearranging categories and either-ors', () => {
  const ids = (list: { id: string }[]) => list.map(entry => entry.id)
  it('puts a category in front of another, or last', () => {
    const plan = example()
    expect(ids(moveCategory(plan, { id: 'garden', before: 'kitchen' }).categories)).toEqual(['garden', 'kitchen', 'office'])
    expect(ids(moveCategory(plan, { id: 'kitchen', before: null }).categories)).toEqual(['office', 'garden', 'kitchen'])
    expect(summarize(moveCategory(plan, { id: 'garden', before: 'kitchen' })).planned).toBe(PLANNED)
  })
  it('takes the purchases of an either-or along into another category', () => {
    const plan = example()
    const moved = moveChoice(plan, { id: 'coffee', categoryId: 'office', before: 'shelf' })
    expect(ids(moved.choices)).toEqual(['coffee', 'shelf'])
    expect(moved.choices[0].categoryId).toBe('office')
    expect(moved.items.filter(i => i.optionId?.startsWith('coffee-')).map(i => i.categoryId)).toEqual(['office', 'office', 'office'])
    expect(validatePlan(moved)).toBe(true)
    expect(summarize(moved).planned).toBe(PLANNED)
  })
  it('stops counting an either-or moved into a switched-off category, keeping its pick', () => {
    const moved = moveChoice(example(), { id: 'coffee', categoryId: 'garden', before: null })
    expect(validatePlan(moved)).toBe(true)
    expect(summarize(moved).planned).toBe(PLANNED - 34800)
    expect(moved.choices.find(c => c.id === 'coffee')!.selectedId).toBe('coffee-manual')
  })
  it('leaves the plan alone for a move that says nothing', () => {
    const plan = example()
    expect(moveCategory(plan, { id: 'kitchen', before: 'kitchen' })).toBe(plan)
    expect(moveCategory(plan, { id: 'nowhere', before: null })).toBe(plan)
    expect(moveChoice(plan, { id: 'shelf', categoryId: 'office', before: 'shelf' })).toBe(plan)
    expect(moveChoice(plan, { id: 'nowhere', categoryId: null, before: null })).toBe(plan)
  })
})

// What a category shows directly, in order.
const shownIn = (plan: Plan, categoryId: string | null) => layoutOf(plan).filter(id =>
  plan.items.some(item => item.id === id && item.categoryId === categoryId) || plan.choices.some(choice => choice.id === id && choice.categoryId === categoryId))

describe('purchases and either-ors in one order', () => {
  it('starts with purchases above either-ors, as plans always showed them', () => {
    expect(shownIn(example(), 'office')).toEqual(['chair', 'lamp', 'shelf'])
  })
  it('puts a purchase behind an either-or, and an either-or between purchases', () => {
    const plan = example()
    expect(shownIn(movePurchase(plan, { id: 'chair', categoryId: 'office', optionId: null, before: null }), 'office')).toEqual(['lamp', 'shelf', 'chair'])
    const between = moveChoice(plan, { id: 'shelf', categoryId: 'office', before: 'lamp' })
    expect(shownIn(between, 'office')).toEqual(['chair', 'shelf', 'lamp'])
    expect(validatePlan(between)).toBe(true)
  })
  it('keeps a purchase out of the order while it sits in an option', () => {
    const moved = movePurchase(example(), { id: 'lamp', categoryId: 'office', optionId: 'shelf-wide', before: null })
    expect(moved.layout).not.toContain('lamp')
    expect(shownIn(moved, 'office')).toEqual(['chair', 'shelf'])
  })
  it('reorders the options of an either-or, and only within it', () => {
    const moved = moveOption(example(), { id: 'shelf-wide', before: 'shelf-narrow' })
    expect(moved.choices.find(choice => choice.id === 'shelf')!.options.map(option => option.id)).toEqual(['shelf-wide', 'shelf-narrow'])
    expect(validatePlan(moved)).toBe(true)
    const plan = example()
    expect(moveOption(plan, { id: 'shelf-wide', before: 'shelf-wide' })).toBe(plan)
    expect(moveOption(plan, { id: 'nowhere', before: null })).toBe(plan)
  })
})

describe('deleting', () => {
  it('deletes one purchase', () => {
    const deleted = deletePurchase(example(), 'lamp')
    expect(deleted.items.map(item => item.id)).not.toContain('lamp')
    expect(deleted.layout).not.toContain('lamp')
  })
  it('keeps an either-or’s purchases where it stood, or deletes them with it', () => {
    const kept = deleteChoice(example(), 'shelf', false)
    expect(shownIn(kept, 'office')).toEqual(['chair', 'lamp', 'shelf-60', 'shelf-90'])
    expect(validatePlan(kept)).toBe(true)
    const gone = deleteChoice(example(), 'shelf', true)
    expect(gone.items.map(item => item.id)).not.toContain('shelf-60')
    expect(shownIn(gone, 'office')).toEqual(['chair', 'lamp'])
    expect(validatePlan(gone)).toBe(true)
  })
  it('moves a category’s contents to Uncategorized, or deletes them with it', () => {
    const kept = deleteCategory(example(), 'office', false)
    expect(kept.categories.map(category => category.id)).not.toContain('office')
    expect(shownIn(kept, null)).toEqual(['chair', 'lamp', 'frames', 'toolbox', 'shelf', 'coffee'])
    expect(kept.items.filter(item => ['chair', 'shelf-60'].includes(item.id)).map(item => item.categoryId)).toEqual([null, null])
    expect(validatePlan(kept)).toBe(true)
    const gone = deleteCategory(example(), 'office', true)
    expect(gone.items.some(item => ['chair', 'lamp', 'shelf-60', 'shelf-90'].includes(item.id))).toBe(false)
    expect(gone.choices.map(choice => choice.id)).toEqual(['coffee'])
    expect(validatePlan(gone)).toBe(true)
  })
})

describe('input and stored data', () => {
  it('accepts decimal and comma amounts, including zero', () => {
    expect(parseAmount('12.34')).toBe(1234)
    expect(parseAmount(' 12,3 ')).toBe(1230)
    expect(parseAmount('0')).toBe(0)
  })
  it('rejects negative, incomplete, overprecise and excessive values', () => {
    for (const value of ['', '-1', '1.234', '1e3', 'Infinity', '10.', '1000000000']) expect(parseAmount(value)).toBeNull()
  })
  it('validates stored data and rejects orphaned references and duplicate IDs', () => {
    expect(validatePlan(example())).toBe(true)
    expect(validatePlan({ version: 6 })).toBe(false)
    const plan = example()
    plan.items[0].categoryId = 'missing'
    expect(validatePlan(plan)).toBe(false)
    plan.items[0].categoryId = null
    plan.items[1].id = plan.items[0].id
    expect(validatePlan(plan)).toBe(false)
  })
  it('rejects a plan without an identity', () => {
    expect(validatePlan({ ...example(), id: '' })).toBe(false)
    expect(validatePlan({ ...example(), name: 7 })).toBe(false)
  })
  it('rejects broken either-or references', () => {
    const missingOption = example()
    missingOption.items[4].optionId = 'gone'
    expect(validatePlan(missingOption)).toBe(false)
    const strayCategory = example()
    strayCategory.items[4].categoryId = 'kitchen'
    expect(validatePlan(strayCategory)).toBe(false)
    const straySelection = example()
    straySelection.choices[0].selectedId = 'gone'
    expect(validatePlan(straySelection)).toBe(false)
  })
  it('validates a library and its active plan', () => {
    const library = newLibrary(example(), budgetExample())
    expect(validateLibrary(library)).toBe(true)
    expect(validateLibrary({ ...library, activeId: 'gone' })).toBe(false)
    expect(validateLibrary({ ...library, plans: [] })).toBe(false)
    expect(validateLibrary({ ...library, plans: [library.plans[0], library.plans[0]] })).toBe(false)
  })
  it('upgrades plans saved before either-ors existed', () => {
    const v1 = { version: 1, budget: 5000, currency: 'EUR', example: false, categories: [], items: [{ id: 'a', name: 'Kettle', amount: 4000, categoryId: null, enabled: true, note: '' }] }
    const upgraded = upgradePlan(v1, 'Old plan') as Plan
    expect(validatePlan(upgraded)).toBe(true)
    expect(upgraded.items[0].optionId).toBe(null)
    expect(upgraded.name).toBe('Old plan')
    expect(summarize(upgraded).remaining).toBe(1000)
  })
  it('upgrades a plan file that has no name of its own', () => {
    const v3 = { ...example(), version: 3 } as unknown as Record<string, unknown>
    delete v3.id
    delete v3.name
    const upgraded = upgradePlan(v3, 'From a file') as Plan
    expect(validatePlan(upgraded)).toBe(true)
    expect(upgraded.name).toBe('From a file')
    expect(summarize(upgraded).planned).toBe(PLANNED)
  })
})

describe('export and import', () => {
  it('survives a round trip through a file', () => {
    const plan = example()
    expect(importFile(exportPlan(plan))).toEqual({ kind: 'plan', plan })
  })
  it('carries every plan through an export of the whole library', () => {
    const library = { ...newLibrary(example(), budgetExample()), plans: [example(), emptyPlan('Second')] }
    const restored = importFile(exportLibrary({ ...library, activeId: library.plans[0].id }))
    expect(restored?.kind).toBe('library')
    expect(restored?.kind === 'library' && restored.library.plans.map(p => p.name)).toEqual(['Example plan', 'Second'])
  })
  it('repairs a library whose active plan is missing', () => {
    const library = newLibrary(example(), budgetExample())
    const restored = importFile(exportLibrary({ ...library, activeId: 'gone' }))
    expect(restored?.kind === 'library' && restored.library.activeId).toBe(library.plans[0].id)
  })
  it('gives an imported plan its own id when the library already has that one', () => {
    const plan = example()
    expect(withFreshId(plan, [plan]).id).not.toBe(plan.id)
    expect(withFreshId(plan, []).id).toBe(plan.id)
  })
  it('refuses anything that is not a plan', () => {
    for (const text of ['', 'not json', '{}', '[]', 'null', JSON.stringify({ version: 6, budget: -1 })]) expect(importFile(text)).toBe(null)
  })
  it('names the exported file by date and plan', () => {
    expect(exportFilename(new Date(2026, 8, 10))).toBe('little-budget-2026-09-10.json')
    expect(exportFilename(new Date(2026, 8, 10), 'The move')).toBe('little-budget-the-move-2026-09-10.json')
  })
})

describe('translations', () => {
  it('says everything in every language', () => {
    const keys = Object.keys(copy.en) as (keyof typeof copy.en)[]
    for (const language of languages) {
      for (const key of keys) {
        const value = copy[language][key]
        expect(typeof value, `${language}.${key}`).toBe(typeof copy.en[key])
        if (typeof value === 'string') expect(value.length, `${language}.${key}`).toBeGreaterThan(0)
      }
    }
  })
  it('translates the strings that carry a value', () => {
    expect(copy.de.setAside(1)).toBe('1 Anschaffung vorerst zurückgestellt')
    expect(copy.de.setAside(3)).toBe('3 Anschaffungen vorerst zurückgestellt')
    expect(copy.en.alternativesNote(2)).toBe('2 alternatives not picked')
    expect(copy.de.includeItem('Kettle')).toBe('Kettle einbeziehen')
  })
})
