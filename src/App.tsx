import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react'
import { ArrowDownLeft, ArrowUpRight, Check, CheckCheck, ChevronDown, CircleHelp, CopyIcon, Database, Download, FolderPlus, GripVertical, Leaf, Moon, MoreHorizontal, Pencil, PiggyBank, Plus, Search, ShieldCheck, ShoppingBag, Shuffle, Sparkles, Sun, Trash2, Upload, Wallet, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { boughtScope, choiceOf, colors, currencies, deleteCategory, deleteChoice, deletePurchase, emptyPlan, layoutOf, lineTotal, moveCategory, moveChoice, moveOption, movePurchase, normalizeLink, priorities, safeLink, statuses, exportFilename, exportPlan, formatMoney, isIncluded, optionAmount, parseAmount, setBought, summarize, withFreshId, withValidSelection, type Category, type Choice, type Currency, type Option, type Plan, type Priority, type Purchase, type Status } from '@/lib/budget'
import { exampleBudget, exportBudget, monthsToAfford, starterBudget, stillToBuy, summarizeBudget, type Budget } from '@/lib/household'
import { exportLibrary, importFile, loadLibrary, saveLibrary, type Library } from '@/lib/library'
import { BudgetPage } from '@/BudgetPage'
import { copy, languages, type Copy, type Language } from '@/lib/i18n'
import { loadLanguage, loadTheme, remember, LANGUAGE_KEY, THEME_KEY, type Theme } from '@/lib/prefs'

type Editor =
  | { type: 'item'; item?: Purchase; categoryId?: string | null; optionId?: string | null }
  | { type: 'category'; category?: Category }
  | { type: 'choice'; choice?: Choice; categoryId?: string | null }
  | { type: 'budget' }
  | { type: 'data' }
  | { type: 'plan'; target?: Plan }
  | { type: 'planDelete'; target: Plan }
  | { type: 'importPlan'; incoming: Plan; filename: string }
  | { type: 'importLibrary'; incoming: Library; filename: string; withBudgets: boolean }
  | { type: 'importBudget'; incoming: Budget; filename: string }
  | { type: 'budgetName'; target?: Budget }
  | { type: 'budgetDelete'; target: Budget }
  | { type: 'itemDelete'; target: Purchase }
  | { type: 'choiceDelete'; target: Choice }
  | { type: 'categoryDelete'; target: Category }
  | { type: 'reset' }
  | null

// The budget book is the start page; the wishlist is kept in the address so reloading and going back stay on it.
type Page = 'wishlist' | 'budget'
const pageFromHash = (): Page => location.hash === '#wishlist' ? 'wishlist' : 'budget'

// What is being dragged, and where it would land: in a category or an either-or option, in front of `before` or last.
type Drag = { kind: 'item' | 'choice' | 'option' | 'category'; id: string }
type DropZone = { categoryId: string | null; optionId: string | null }
type Landing = DropZone & { before: string | null }
type Pending = Drag & Landing
// One row directly in a category: a purchase on its own or an either-or.
type Block = { id: string; kind: 'item'; item: Purchase } | { id: string; kind: 'choice'; choice: Choice }

function arrange(plan: Plan, pending: Pending) {
  if (pending.kind === 'category') return moveCategory(plan, pending)
  if (pending.kind === 'choice') return moveChoice(plan, pending)
  if (pending.kind === 'option') return moveOption(plan, pending)
  return movePurchase(plan, pending)
}

// Something carried elsewhere keeps its old spot, shown faintly, until it is let go. Nothing above the pointer
// changes height that way, so the place it is held over stays under the pointer instead of jumping away.
function withOrigin<T extends { id: string }>(shown: T[], carried: T | undefined, order: string[]) {
  const rows = shown.map(entry => ({ entry, origin: false }))
  if (!carried) return rows
  const at = shown.filter(entry => order.indexOf(entry.id) < order.indexOf(carried.id)).length
  return [...rows.slice(0, at), { entry: carried, origin: true }, ...rows.slice(at)]
}

export default function App() {
  const [language, setLanguage] = useState(loadLanguage)
  const [theme, setTheme] = useState(loadTheme)
  const t = copy[language]
  const [initial] = useState(() => {
    const start = copy[loadLanguage()]
    return loadLibrary(start.examplePlanName, start.importedPlanName, {
      example: () => exampleBudget(start.exampleBudget, start.budgetCategories),
      starter: () => starterBudget(start.firstBudgetName, start.budgetCategories),
    })
  })
  const [library, setLibrary] = useState(initial.library)
  const [storageError, setStorageError] = useState(initial.corrupted ? 'load' : null)
  const [editor, setEditor] = useState<Editor>(null)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'included' | 'excluded'>('all')
  const [collapsed, setCollapsed] = useState<string[]>([])
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [dragging, setDragging] = useState<Drag | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [page, setPage] = useState(pageFromHash)
  const held = useRef<Drag | null>(null)
  // The landing the list shows, and where the pointer was when that last changed.
  const pendingRef = useRef<Pending | null>(null)
  const settledAt = useRef<{ x: number; y: number } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const hasEdited = useRef(false)
  const saved = library.plans.find(candidate => candidate.id === library.activeId) ?? library.plans[0]
  // While something is being dragged the list and the totals show where it would land.
  const plan = pending ? arrange(saved, pending) : saved
  const totals = summarize(plan)
  const money = (amount: number) => formatMoney(amount, plan.currency, t.locale)
  // A budget is optional: without one the card simply reports what everything costs.
  const hasBudget = plan.budget > 0
  const percentage = hasBudget ? Math.min(totals.planned / plan.budget * 100, 100) : 0
  const budget = library.budgets.find(candidate => candidate.id === library.activeBudgetId) ?? library.budgets[0]
  const household = summarizeBudget(budget)
  // What this plan still needs, and how long the monthly budget takes to pay for it.
  const toBuy = stillToBuy(plan)
  const months = monthsToAfford(toBuy, household.forWishlist)

  function updateLibrary(change: (current: Library) => Library) {
    hasEdited.current = true
    setLibrary(change)
  }

  function update(change: (current: Plan) => Plan) {
    updateLibrary(current => ({ ...current, plans: current.plans.map(candidate => candidate.id === current.activeId ? change(candidate) : candidate) }))
  }

  function updateBudget(change: (current: Budget) => Budget) {
    updateLibrary(current => ({ ...current, budgets: current.budgets.map(candidate => candidate.id === current.activeBudgetId ? change(candidate) : candidate) }))
  }

  function go(next: Page) {
    if (next === page) return
    history.pushState(null, '', next === 'wishlist' ? '#wishlist' : `${location.pathname}${location.search}`)
    setPage(next)
    window.scrollTo(0, 0)
  }

  useEffect(() => {
    const follow = () => setPage(pageFromHash())
    window.addEventListener('popstate', follow)
    window.addEventListener('hashchange', follow)
    return () => {
      window.removeEventListener('popstate', follow)
      window.removeEventListener('hashchange', follow)
    }
  }, [])

  useEffect(() => {
    if (storageError === 'load' && !hasEdited.current) return
    try {
      saveLibrary(library)
      setStorageError(null)
    } catch {
      setStorageError('save')
    }
  }, [library, storageError])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
  }, [theme])

  useEffect(() => {
    document.documentElement.lang = language
    document.title = t.documentTitle
  }, [language, t])

  function chooseTheme(next: Theme) {
    setTheme(next)
    remember(THEME_KEY, next)
  }

  function chooseLanguage(next: Language) {
    setLanguage(next)
    remember(LANGUAGE_KEY, next)
  }

  function download(text: string, filename: string, message: string) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.append(link)
    link.click()
    link.remove()
    // Revoking too early can cancel a download that has not started reading the blob.
    setTimeout(() => URL.revokeObjectURL(url), 10_000)
    setNotice({ tone: 'ok', text: message })
  }

  function exportOnePlan(target: Plan) {
    const filename = exportFilename(new Date(), target.name)
    download(exportPlan(target), filename, t.exported(filename))
  }

  function exportOneBudget(target: Budget) {
    const filename = exportFilename(new Date(), target.name)
    download(exportBudget(target), filename, t.exported(filename))
  }

  function exportEverything() {
    const filename = exportFilename(new Date(), 'all')
    download(exportLibrary(library), filename, t.exported(filename))
  }

  async function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const imported = importFile(await file.text(), t.importedPlanName, library)
    if (!imported) { setNotice({ tone: 'error', text: t.importFailed(file.name) }); return }
    setNotice(null)
    setEditor(imported.kind === 'plan' ? { type: 'importPlan', incoming: imported.plan, filename: file.name }
      : imported.kind === 'budget' ? { type: 'importBudget', incoming: imported.budget, filename: file.name }
      : { type: 'importLibrary', incoming: imported.library, filename: file.name, withBudgets: imported.withBudgets })
  }

  // Every drop target works out a landing from where the pointer is. A change moves things around under the
  // pointer, so the list only changes again once the pointer has moved on: holding still never flickers.
  function preview(event: DragEvent, next: Landing | null) {
    const drag = held.current
    if (!drag || next?.before === drag.id) return
    const current = pendingRef.current
    if (next === null ? current === null : current !== null && current.categoryId === next.categoryId && current.optionId === next.optionId && current.before === next.before) return
    const last = settledAt.current
    if (last && Math.abs(event.clientX - last.x) + Math.abs(event.clientY - last.y) < 6) return
    settledAt.current = { x: event.clientX, y: event.clientY }
    pendingRef.current = next && { ...drag, ...next }
    setPending(pendingRef.current)
  }

  function endDrag() {
    setPending(null)
    setDragging(null)
    held.current = null
    pendingRef.current = null
    settledAt.current = null
  }

  function commit(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    const landed = pendingRef.current
    endDrag()
    if (landed) update(current => arrange(current, landed))
  }

  function dragSource(drag: Drag) {
    return {
      draggable: true,
      onDragStart: (event: DragEvent) => {
        event.stopPropagation()
        event.dataTransfer.setData('text/plain', drag.id)
        event.dataTransfer.effectAllowed = 'move'
        held.current = drag
        setDragging(drag)
      },
      onDragEnd: endDrag,
    }
  }

  const isHeld = (kind: Drag['kind'], id: string) => dragging?.kind === kind && dragging.id === id

  // A target only answers for the kind of thing it takes; anything else rises to the target around it.
  function accepts(event: DragEvent, kind: Drag['kind']) {
    if (held.current?.kind !== kind) return false
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    return true
  }

  function upperHalf(event: DragEvent) {
    const box = event.currentTarget.getBoundingClientRect()
    return event.clientY < box.top + box.height / 2
  }

  // Dropping at the end of a category or an option: the purchase lands after everything already there.
  function zoneTarget(key: string, zone: DropZone) {
    return {
      className: pending?.kind === 'item' && zone.categoryId === pending.categoryId && zone.optionId === pending.optionId ? 'drop-active' : undefined,
      onDragOver: (event: DragEvent) => {
        if (accepts(event, 'item')) preview(event, { ...zone, before: null })
      },
      onDrop: commit,
      'data-testid': key,
    }
  }

  // Dropping onto a purchase: the top half puts the dragged one in front of it, the bottom half behind. Among a
  // category's own rows an either-or lands there the same way. Over the faint copy it goes back where it came from.
  function rowTarget(item: Purchase, zone: DropZone, nextId: string | null, origin: boolean) {
    return {
      onDragOver: (event: DragEvent) => {
        const kind = held.current?.kind
        if (!(kind === 'item' || (kind === 'choice' && zone.optionId === null)) || !accepts(event, kind)) return
        if (origin) preview(event, null)
        else if (held.current?.id !== item.id) preview(event, { ...zone, before: upperHalf(event) ? item.id : nextId })
      },
      onDrop: commit,
    }
  }

  // Dropping onto an either-or: in front of it or behind it, in its category. A purchase held over its heading
  // lands in front of it; between its options nothing changes, and on an option it joins that option.
  function choiceTarget(choice: Choice, nextId: string | null, origin: boolean) {
    return {
      onDragOver: (event: DragEvent) => {
        if (held.current?.kind === 'item') {
          if (!accepts(event, 'item')) return
          const overHeading = event.target instanceof Element && event.target.closest('.choice-heading') !== null
          if (overHeading && !origin) preview(event, { categoryId: choice.categoryId, optionId: null, before: choice.id })
          return
        }
        if (!accepts(event, 'choice')) return
        if (origin) preview(event, null)
        else if (held.current?.id !== choice.id) preview(event, { categoryId: choice.categoryId, optionId: null, before: upperHalf(event) ? choice.id : nextId })
      },
      onDrop: commit,
    }
  }

  // An option takes a purchase anywhere on it, its heading included, so there is no gap to fall through.
  // An option held by its heading moves in front of or behind another option of the same either-or.
  function optionTarget(choice: Choice, option: Option, nextOptionId: string | null) {
    const forItems = zoneTarget(`drop-option-${option.id}`, { categoryId: choice.categoryId, optionId: option.id })
    return {
      ...forItems,
      onDragOver: (event: DragEvent) => {
        const drag = held.current
        if (drag?.kind !== 'option') { forItems.onDragOver(event); return }
        if (!choice.options.some(candidate => candidate.id === drag.id) || !accepts(event, 'option')) return
        if (drag.id !== option.id) preview(event, { categoryId: choice.categoryId, optionId: null, before: upperHalf(event) ? option.id : nextOptionId })
      },
    }
  }

  // A category takes whatever nothing inside it took: a purchase or an either-or joins it at the end,
  // and another category takes its place in front of it or behind it.
  function groupTarget(category: Category | null, nextCategoryId: string | null) {
    const categoryId = category?.id ?? null
    return {
      onDragOver: (event: DragEvent) => {
        const drag = held.current
        if (!drag || drag.kind === 'option' || !accepts(event, drag.kind)) return
        if (drag.kind === 'item' || drag.kind === 'choice') preview(event, { categoryId, optionId: null, before: null })
        else if (drag.id !== categoryId) preview(event, { categoryId: null, optionId: null, before: category && upperHalf(event) ? category.id : nextCategoryId })
      },
      onDrop: commit,
    }
  }

  // The rows of one option, with the faint copy of a purchase that is held over another place.
  function itemRows(shown: Purchase[], zone: DropZone) {
    const away = pending?.kind === 'item' && (pending.categoryId !== zone.categoryId || pending.optionId !== zone.optionId)
    const carried = away ? saved.items.find(item => item.id === pending.id && item.categoryId === zone.categoryId && item.optionId === zone.optionId) : undefined
    return withOrigin(shown, carried, saved.items.map(item => item.id))
  }

  // The rows directly in a category, purchases and either-ors in one order, with the faint copy of one held elsewhere.
  function blockRows(loose: Purchase[], choices: Choice[], categoryId: string | null) {
    const byId = new Map<string, Block>([
      ...loose.map(item => [item.id, { id: item.id, kind: 'item', item }] as const),
      ...choices.map(choice => [choice.id, { id: choice.id, kind: 'choice', choice }] as const),
    ])
    const shown = layoutOf(plan).flatMap(id => byId.get(id) ?? [])
    let carried: Block | undefined
    if (pending?.kind === 'item' && (pending.categoryId !== categoryId || pending.optionId !== null)) {
      const item = saved.items.find(candidate => candidate.id === pending.id && candidate.categoryId === categoryId && candidate.optionId === null)
      if (item) carried = { id: item.id, kind: 'item', item }
    } else if (pending?.kind === 'choice' && pending.categoryId !== categoryId) {
      const choice = saved.choices.find(candidate => candidate.id === pending.id && candidate.categoryId === categoryId)
      if (choice) carried = { id: choice.id, kind: 'choice', choice }
    }
    return withOrigin(shown, carried, layoutOf(saved))
  }

  // The next row that is really there, for dropping behind the last one.
  const nextId = (rows: { entry: { id: string }; origin: boolean }[], position: number) => rows.slice(position + 1).find(row => !row.origin)?.entry.id ?? null

  const visibleItems = plan.items.filter(item => {
    const choiceName = choiceOf(plan.choices, item.optionId)?.name ?? ''
    const matchesSearch = `${item.name} ${item.note} ${choiceName} ${plan.categories.find(c => c.id === item.categoryId)?.name ?? ''}`.toLowerCase().includes(search.toLowerCase())
    return matchesSearch && (filter === 'all' || isIncluded(item, plan) === (filter === 'included'))
  })

  function renderItem(item: Purchase, locked: boolean, zone: DropZone, following: string | null, origin = false) {
    const shop = item.link ? safeLink(item.link) : null
    const dragState = isHeld('item', item.id) ? origin ? 'drag-origin' : 'dragging' : ''
    return <div className={`purchase-row ${isIncluded(item, plan) ? '' : 'excluded'} ${dragState}`} key={item.id} aria-hidden={origin || undefined}
      {...rowTarget(item, zone, following, origin)} {...dragSource({ kind: 'item', id: item.id })}>
      <Switch checked={item.enabled} disabled={locked} onCheckedChange={enabled => update(p => ({ ...p, items: p.items.map(i => i.id === item.id ? { ...i, enabled } : i) }))} aria-label={t.includeItem(item.name)} />
      <button className="purchase-details" onClick={() => setEditor({ type: 'item', item })}>
        <span className="purchase-name"><span className="purchase-title">{item.name}</span><span className={`priority-pill priority-${item.priority}`}>{t.priorityNames[item.priority]}</span>{item.status !== 'planned' && <span className={`status-pill status-${item.status}`}>{t.statusNames[item.status]}</span>}</span>
        {(item.note || item.quantity > 1) && <span className="purchase-note">{item.quantity > 1 ? t.perPiece(item.quantity, money(item.amount)) : ''}{item.note && item.quantity > 1 ? ' · ' : ''}{item.note}</span>}
      </button>
      <span className="purchase-amount">{money(lineTotal(item))}</span>
      {shop && <a className="purchase-link" href={shop.href} target="_blank" rel="noreferrer noopener" draggable={false} aria-label={t.openShop(item.name, shop.host)} title={shop.host}><ShoppingBag size={15} /></a>}
      <Button variant="ghost" size="icon" className="row-edit small-icon bought-toggle" aria-pressed={item.status === 'bought'} aria-label={t.markBought(item.name)} title={t.markBought(item.name)}
        onClick={() => update(p => setBought(p, [item.id], item.status !== 'bought'))}><Check size={14} /></Button>
      <Button variant="ghost" size="icon" className="row-edit small-icon" aria-label={t.editItem(item.name)} onClick={() => setEditor({ type: 'item', item })}><Pencil size={14} /></Button>
      <Button variant="ghost" size="icon" className="row-edit small-icon" aria-label={t.deleteItem(item.name)} onClick={() => setEditor({ type: 'itemDelete', target: item })}><Trash2 size={14} /></Button>
    </div>
  }

  // Marks everything given as bought, or, once all of it is, back to still planned.
  function boughtButton(items: Purchase[], label: string) {
    const all = items.length > 0 && items.every(item => item.status === 'bought')
    return <Button variant="ghost" size="icon" className="small-icon bought-all" aria-pressed={all} disabled={!items.length} aria-label={label} title={label}
      onClick={() => update(p => setBought(p, items.map(item => item.id), !all))}><CheckCheck size={16} /></Button>
  }

  function renderChoice(choice: Choice, categoryLocked: boolean, following: string | null, origin = false) {
    const locked = categoryLocked || !choice.enabled
    const total = plan.items.filter(item => item.optionId !== null && choice.options.some(o => o.id === item.optionId) && isIncluded(item, plan)).reduce((sum, item) => sum + lineTotal(item), 0)
    const dragState = isHeld('choice', choice.id) ? origin ? 'drag-origin' : 'dragging' : ''
    // The faint copy left behind is drawn next to the real one, so its options need ids of their own.
    const optionKey = (option: Option) => `${origin ? 'origin-' : ''}option-${option.id}`
    return <div className={`choice-block ${choice.enabled ? '' : 'choice-off'} ${dragState}`} key={choice.id} role="group" aria-label={t.choiceGroup(choice.name)} aria-hidden={origin || undefined}
      {...choiceTarget(choice, following, origin)}>
      <div className="choice-heading" {...dragSource({ kind: 'choice', id: choice.id })}>
        <GripVertical size={14} className="drag-grip" aria-hidden />
        <span className="choice-icon"><Shuffle size={14} /></span>
        <h4>{choice.name}</h4><span className="choice-tag">{t.pickOne}</span>
        <span className="choice-total">{money(total)}</span>
        {boughtButton(boughtScope(plan, { choiceId: choice.id }), t.markChoiceBought(choice.name))}
        <Switch checked={choice.enabled} disabled={categoryLocked} onCheckedChange={enabled => update(p => ({ ...p, choices: p.choices.map(c => c.id === choice.id ? { ...c, enabled } : c) }))} aria-label={t.includeChoice(choice.name)} />
        <Button variant="ghost" size="icon" className="small-icon" aria-label={t.editChoice(choice.name)} onClick={() => setEditor({ type: 'choice', choice })}><MoreHorizontal size={18} /></Button>
      </div>
      <RadioGroup className="choice-options" value={choice.selectedId ?? ''} disabled={locked} aria-label={t.pickOptionFor(choice.name)}
        onValueChange={selectedId => update(p => ({ ...p, choices: p.choices.map(c => c.id === choice.id ? { ...c, selectedId } : c) }))}>
        {choice.options.map((option, index) => {
          const picked = choice.selectedId === option.id
          const zone: DropZone = { categoryId: choice.categoryId, optionId: option.id }
          const target = optionTarget(choice, option, choice.options[index + 1]?.id ?? null)
          const rows = itemRows(visibleItems.filter(item => item.optionId === option.id), zone)
          return <div {...target} className={`choice-option ${picked ? 'picked' : ''} ${target.className ?? ''} ${isHeld('option', option.id) ? 'dragging' : ''}`} key={option.id}>
            {index > 0 && <span className="or-divider"><span />{t.or}<span /></span>}
            <div className="option-heading" {...dragSource({ kind: 'option', id: option.id })}>
              <GripVertical size={14} className="drag-grip" aria-hidden />
              <RadioGroupItem value={option.id} id={optionKey(option)} aria-label={option.label} />
              <Label htmlFor={optionKey(option)} className="option-label">{option.label}</Label>
              <span className="option-amount">{money(optionAmount(plan, option.id))}</span>
            </div>
            <div className="option-items">
              {rows.map((row, position) => renderItem(row.entry, locked || !picked, zone, nextId(rows, position), row.origin))}
              {!rows.length && <p className="empty-category">{t.nothingHereYet}</p>}
              <button className="add-in-group" onClick={() => setEditor({ type: 'item', categoryId: choice.categoryId, optionId: option.id })}><Plus size={15} /> {t.addToOption(option.label)}</button>
            </div>
          </div>
        })}
      </RadioGroup>
    </div>
  }

  function renderGroup(category: Category | null) {
    const groupId = category?.id ?? 'uncategorized'
    const categoryId = category?.id ?? null
    const allItems = plan.items.filter(i => i.categoryId === categoryId)
    const items = visibleItems.filter(i => i.categoryId === categoryId)
    const choices = plan.choices.filter(c => c.categoryId === categoryId)
    const visibleChoices = search || filter !== 'all' ? choices.filter(c => c.options.some(o => items.some(i => i.optionId === o.id))) : choices
    const hidden = !items.length && !visibleChoices.length && (search || filter !== 'all' || !category)
    if (hidden && !dragging) return null
    const groupTotal = allItems.filter(i => isIncluded(i, plan)).reduce((sum, i) => sum + lineTotal(i), 0)
    const isCollapsed = collapsed.includes(groupId)
    const locked = category ? !category.enabled : false
    const zone: DropZone = { categoryId, optionId: null }
    const target = zoneTarget(`drop-${groupId}`, zone)
    const blocks = blockRows(items.filter(i => i.optionId === null), visibleChoices, categoryId)
    const nextCategoryId = category ? plan.categories[plan.categories.indexOf(category) + 1]?.id ?? null : null
    // An either-or held over this category lights it up the way a purchase does.
    const choiceLanding = pending?.kind === 'choice' && pending.categoryId === categoryId
    const heldHere = category !== null && isHeld('category', category.id)
    return <section className={`purchase-group ${locked ? 'group-disabled' : ''} ${target.className ?? ''} ${choiceLanding ? 'drop-active' : ''} ${heldHere ? 'dragging' : ''}`} key={groupId} aria-label={category?.name ?? t.uncategorized}
      {...groupTarget(category, nextCategoryId)}>
      <div className="group-heading" {...(category ? dragSource({ kind: 'category', id: category.id }) : {})}>
        {category && <GripVertical size={14} className="drag-grip" aria-hidden />}
        <button className="group-title" onClick={() => setCollapsed(current => current.includes(groupId) ? current.filter(id => id !== groupId) : [...current, groupId])} aria-expanded={!isCollapsed}>
          <span className={`category-icon color-${category?.color ?? 'neutral'}`}>{category ? <Leaf size={17} /> : <Wallet size={17} />}</span>
          <h3>{category?.name ?? t.uncategorized}</h3><span className="count">{allItems.length}</span><ChevronDown size={15} className={isCollapsed ? 'collapsed-chevron' : ''} />
        </button>
        <div className="group-actions">
          <span className="group-total">{money(groupTotal)}</span>
          {boughtButton(boughtScope(plan, { categoryId }), t.markAllBought(category?.name ?? t.uncategorized))}
          {category && <Switch checked={category.enabled} onCheckedChange={enabled => update(p => ({ ...p, categories: p.categories.map(c => c.id === category.id ? { ...c, enabled } : c) }))} aria-label={t.includeCategory(category.name)} />}
          {category && <Button variant="ghost" size="icon" className="small-icon" aria-label={t.editCategory(category.name)} onClick={() => setEditor({ type: 'category', category })}><MoreHorizontal size={18} /></Button>}
        </div>
      </div>
      {!isCollapsed && <div {...target} className="group-content">
        {blocks.map((row, position) => row.entry.kind === 'item'
          ? renderItem(row.entry.item, locked, zone, nextId(blocks, position), row.origin)
          : renderChoice(row.entry.choice, locked, nextId(blocks, position), row.origin))}
        {!blocks.length && <p className="empty-category">{t.freshCategory}</p>}
        <div className="group-add">
          <button className="add-in-group" onClick={() => setEditor({ type: 'item', categoryId })}><Plus size={15} /> {t.addItem}</button>
          <button className="add-in-group" onClick={() => setEditor({ type: 'choice', categoryId })}><Shuffle size={14} /> {t.addChoice}</button>
        </div>
      </div>}
    </section>
  }

  const notices = <>
    {storageError && <div className="storage-warning" role="alert">{storageError === 'load' ? t.loadFailed : t.saveFailed}</div>}
    {notice && <div className={`plan-notice ${notice.tone}`} data-testid="notice" role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}<button aria-label={t.dismiss} onClick={() => setNotice(null)}><X size={14} /></button></div>}
  </>

  return <div className="app-shell">
    <header className="site-header"><div className="header-inner">
      <a href="./" className="brand"><span className="brand-mark"><Leaf size={22} /></span>little budget<span className="brand-dot">.</span></a>
      <div className="plan-switcher">
        <nav className="page-tabs" aria-label={t.navLabel}>{(['budget', 'wishlist'] as const).map(target => <button key={target} className={page === target ? 'active' : ''} aria-current={page === target ? 'page' : undefined} onClick={() => go(target)}>
          {target === 'wishlist' ? <ShoppingBag size={14} /> : <PiggyBank size={14} />}<span>{target === 'wishlist' ? t.navWishlist : t.navBudget}</span>
        </button>)}</nav>
        {page === 'budget'
          ? <Select value={budget.id} onValueChange={id => updateLibrary(current => ({ ...current, activeBudgetId: id }))}>
            <SelectTrigger aria-label={t.switchBudget} className="plan-select"><SelectValue /></SelectTrigger>
            <SelectContent>{library.budgets.map(candidate => <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>)}</SelectContent>
          </Select>
          : <Select value={plan.id} onValueChange={id => updateLibrary(current => ({ ...current, activeId: id }))}>
            <SelectTrigger aria-label={t.switchPlan} className="plan-select"><SelectValue /></SelectTrigger>
            <SelectContent>{library.plans.map(candidate => <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>)}</SelectContent>
          </Select>}
        <button className="icon-button" aria-label={t.yourData} onClick={() => setEditor({ type: 'data' })}><Database size={16} /></button>
      </div>
      <div className="header-controls">
        <button className="icon-button" aria-label={theme === 'dark' ? t.toLightMode : t.toDarkMode} onClick={() => chooseTheme(theme === 'dark' ? 'light' : 'dark')}>{theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}</button>
        <div className="language-toggle" role="group" aria-label={t.languageLabel}>{languages.map(code => <button key={code} aria-pressed={language === code} className={language === code ? 'active' : ''} onClick={() => chooseLanguage(code)}>{code.toUpperCase()}</button>)}</div>
        <span className="saved-status"><span className={storageError ? 'status-dot error-dot' : 'status-dot'} />{storageError ? t.notSaved : t.saved}</span>
      </div>
    </div></header>
    <main>
      {page === 'budget' ? <BudgetPage t={t} budget={budget} plans={library.plans} notices={notices} update={updateBudget}
        openPlan={id => { updateLibrary(current => ({ ...current, activeId: id })); go('wishlist') }}
        exportBudget={() => exportOneBudget(budget)} openFile={() => fileInput.current?.click()} /> : <>
      <div className="page-intro"><div><div className="eyebrow"><span /> {t.eyebrow}</div><h1>{t.titleLead} <span>{t.titleAccent}</span></h1><p>{t.intro}</p></div><div className="intro-actions"><Button variant="outline" onClick={() => setEditor({ type: 'category' })}><FolderPlus size={16} /> {t.newCategory}</Button><Button variant="outline" onClick={() => setEditor({ type: 'choice' })}><Shuffle size={15} /> {t.newChoice}</Button><Button onClick={() => setEditor({ type: 'item' })}><Plus size={17} /> {t.addPurchase}</Button></div></div>
      {notices}
      {plan.example && <div className="example-banner"><div><Sparkles size={17} /><span>{t.exampleBanner}</span></div><button onClick={() => setEditor({ type: 'reset' })}>{t.startFresh} <ArrowUpRight size={15} /></button></div>}
      <div className="workspace">
        <div className="purchases-panel">
          <div className="section-heading"><div><h2>{t.wishlist} <span>{plan.items.length}</span></h2><p>{t.wishlistHint}</p></div><span className="small-caption">{t.smallCaption}</span></div>
          <div className="list-toolbar"><div className="filter-tabs" role="group" aria-label={t.filterLabel}>{(['all', 'included', 'excluded'] as const).map(tab => <button key={tab} aria-pressed={filter === tab} className={filter === tab ? 'active' : ''} onClick={() => setFilter(tab)}>{tab === 'all' ? t.filterAll : tab === 'included' ? t.filterIncluded : t.filterExcluded}<span>{tab === 'all' ? plan.items.length : tab === 'included' ? totals.includedCount : totals.excludedCount}</span></button>)}</div><div className="search-box"><Search size={15} /><Input aria-label={t.searchLabel} placeholder={t.searchPlaceholder} value={search} onChange={event => setSearch(event.target.value)} />{search && <button aria-label={t.clearSearch} onClick={() => setSearch('')}><X size={13} /></button>}</div></div>
          {/* In the gap between two categories nothing changes, and letting go there keeps what the list shows. */}
          <div className="purchase-groups" onDragOver={event => { if (held.current) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }} onDrop={commit}>{plan.categories.map(renderGroup)}{renderGroup(null)}{visibleItems.length === 0 && (search || filter !== 'all' || (plan.categories.length === 0 && plan.choices.length === 0)) && <div className="empty-state"><span className="empty-state-icon"><Wallet size={28} /></span><h3>{plan.items.length ? t.emptySomeTitle : t.emptyNoneTitle}</h3><p>{search ? t.emptySearch : filter === 'included' ? t.emptyIncluded : filter === 'excluded' ? t.emptyExcluded : t.emptyAdd}</p>{!plan.items.length && <Button onClick={() => setEditor({ type: 'item' })}><Plus size={16} /> {t.addFirst}</Button>}</div>}</div>
          {plan.items.length > 0 && <div className="list-footer"><span><Check size={14} /> {t.footerCount(totals.includedCount, plan.items.length)}</span><span>{t.footerNote}</span></div>}
        </div>
        <aside className="budget-sidebar" aria-label={t.budgetSummary}>
          <p className="sr-only" role="status">{hasBudget ? t.srTotals(money(totals.planned), money(totals.remaining)) : t.srTotalOnly(money(totals.planned))}</p>
          <div className={`budget-card ${hasBudget ? '' : 'no-budget'}`}>
            <div className="budget-card-heading"><span><Wallet size={17} /> {hasBudget ? t.yourBudget : t.totalHeading}</span><button aria-label={t.editBudgetLabel} onClick={() => setEditor({ type: 'budget' })}><Pencil size={15} /></button></div>
            {hasBudget ? <>
              <button className="budget-value" aria-label={t.budgetValueLabel(money(plan.budget))} onClick={() => setEditor({ type: 'budget' })}>{money(plan.budget)}<span className="currency-pill">{plan.currency} <ChevronDown size={12} /></span></button>
              <div className="budget-divider" />
              <div className={`budget-ring ${totals.remaining < 0 ? 'over-budget' : ''}`} style={{ '--progress': `${percentage}%` } as React.CSSProperties}><div className="ring-center"><span className="ring-label">{totals.remaining < 0 ? t.overBudget : t.leftToSpend}</span><strong data-testid="remaining">{money(Math.abs(totals.remaining))}</strong><span className="ring-caption">{totals.remaining < 0 ? t.findBalance : t.breathingRoom}</span></div></div>
              <div className={`budget-status ${totals.remaining < 0 ? 'over' : ''}`} aria-live="polite">{totals.remaining < 0 ? <ArrowUpRight size={14} /> : <Check size={14} />}{totals.remaining < 0 ? t.overBy(money(-totals.remaining)) : totals.remaining === 0 ? t.perfectFit : t.withinBudget}</div>
            </> : <>
              <button className="budget-value" aria-label={t.editTotalLabel(money(totals.planned))} onClick={() => setEditor({ type: 'budget' })}><span data-testid="total">{money(totals.planned)}</span><span className="currency-pill">{plan.currency} <ChevronDown size={12} /></span></button>
              <p className="total-caption">{t.totalCaption}</p>
              <div className="budget-divider" />
            </>}
            <div className="summary-lines">
              {totals.spent > 0 && <div><span><i className="legend-dot spent-dot" /> {t.alreadySpent}</span><strong data-testid="spent">{money(totals.spent)}</strong></div>}
              <div><span><i className="legend-dot planned-dot" /> {hasBudget ? t.plannedSpending : t.totalCost}</span><strong data-testid="planned">{money(totals.planned)}</strong></div>
              {hasBudget && <div><span><i className="legend-dot remaining-dot" /> {totals.remaining < 0 ? t.overBudget : t.remainingBudget}</span><strong className={totals.remaining < 0 ? 'negative' : ''}>{money(totals.remaining)}</strong></div>}
            </div>
            {!hasBudget && <Button type="button" variant="outline" className="set-budget" onClick={() => setEditor({ type: 'budget' })}><Wallet size={15} /> {t.setBudget}</Button>}
            <div className="budget-card-footer"><ArrowDownLeft size={15} /><span data-testid="set-aside">{t.setAside(totals.setAsideCount)}{totals.alternativeCount > 0 ? ` · ${t.alternativesNote(totals.alternativeCount)}` : ''}</span></div>
          </div>
          <div className="funding-card" data-testid="funding">
            <div className="budget-card-heading"><span><PiggyBank size={17} /> {t.fundingTitle}</span></div>
            <p className="funding-rate">{t.fundingRate(formatMoney(household.forWishlist, budget.currency, t.locale), budget.wishlist.mode === 'fixed')}</p>
            <p className="funding-months">{toBuy <= 0 ? t.fundingDone : months === null ? t.fundingNever : t.fundingMonths(months, money(toBuy))}</p>
            <button className="funding-link" onClick={() => go('budget')}>{t.openBudgetNamed(budget.name)} <ArrowUpRight size={13} /></button>
          </div>
          <div className="tip-card"><span className="tip-icon"><CircleHelp size={18} /></span><div><h3>{t.tipTitle}</h3><p>{t.tipText}</p><p>{t.dragHint}</p></div></div>
          <div className="privacy-note"><ShieldCheck size={15} /><span>{t.privacy}</span></div>
          <div className="plan-actions">
            <button onClick={() => exportOnePlan(plan)}><Download size={13} /> {t.exportPlan}</button>
            <button onClick={() => fileInput.current?.click()}><Upload size={13} /> {t.importPlan}</button>
            <button onClick={() => setEditor({ type: 'data' })}><Database size={13} /> {t.yourData}</button>
          </div>
          {(plan.items.length > 0 || plan.categories.length > 0 || plan.choices.length > 0 || plan.budget > 0) && <button className="reset-link" onClick={() => setEditor({ type: 'reset' })}>{t.resetPlan}</button>}
        </aside>
      </div></>}
      <input ref={fileInput} type="file" accept="application/json,.json" className="sr-only" aria-label={t.importFileLabel} onChange={chooseFile} />
      <footer className="page-footer"><span className="footer-brand"><Leaf size={14} /> {t.footerBrand}</span><span>{t.footerTail}</span></footer>
    </main>
    <Dialog open={editor !== null} onOpenChange={open => { if (!open) setEditor(null) }}><DialogContent className={`editor-dialog ${editor?.type === 'data' ? 'data-dialog' : ''}`}>
      {editor?.type === 'data'
        ? <DataPanel t={t} library={library} updateLibrary={updateLibrary} setEditor={setEditor} exportOne={exportOnePlan} exportBudget={exportOneBudget} exportAll={exportEverything} openFile={() => fileInput.current?.click()} go={go} />
        : editor && <EditorForm key={editorKey(editor)} editor={editor} plan={plan} budget={budget} library={library} t={t} update={update} updateLibrary={updateLibrary} setEditor={setEditor} setNotice={setNotice} go={go} close={() => setEditor(null)} />}
    </DialogContent></Dialog>
  </div>
}

function editorKey(editor: Exclude<NonNullable<Editor>, { type: 'data' }>) {
  if (editor.type === 'item') return `item-${editor.item?.id ?? 'new'}`
  if (editor.type === 'category') return `category-${editor.category?.id ?? 'new'}`
  if (editor.type === 'choice') return `choice-${editor.choice?.id ?? 'new'}`
  if (editor.type === 'plan') return `plan-${editor.target?.id ?? 'new'}`
  if (editor.type === 'planDelete') return `delete-${editor.target.id}`
  if (editor.type === 'budgetName') return `budget-${editor.target?.id ?? 'new'}`
  if (editor.type === 'budgetDelete') return `budget-delete-${editor.target.id}`
  if (editor.type === 'itemDelete' || editor.type === 'choiceDelete' || editor.type === 'categoryDelete') return `${editor.type}-${editor.target.id}`
  if (editor.type === 'importPlan' || editor.type === 'importLibrary' || editor.type === 'importBudget') return `import-${editor.filename}`
  return editor.type
}

function DataPanel({ t, library, updateLibrary, setEditor, exportOne, exportBudget, exportAll, openFile, go }: {
  t: Copy; library: Library; updateLibrary: (change: (current: Library) => Library) => void
  setEditor: (editor: Editor) => void; exportOne: (plan: Plan) => void; exportBudget: (budget: Budget) => void; exportAll: () => void; openFile: () => void
  go: (page: Page) => void
}) {
  return <div className="data-panel">
    <DialogHeader><DialogTitle>{t.yourData}</DialogTitle><DialogDescription>{t.dataDescription}</DialogDescription></DialogHeader>
    {/* Budget books come first, the same order as the pages. */}
    <h3 className="data-heading">{t.dataBudgetsHeading}</h3>
    <ul className="plan-list">{library.budgets.map(entry => {
      const active = entry.id === library.activeBudgetId
      return <li className={active ? 'plan-entry active' : 'plan-entry'} key={entry.id}>
        <button className="plan-open" aria-label={t.openPlan(entry.name)} onClick={() => { updateLibrary(current => ({ ...current, activeBudgetId: entry.id })); go('budget'); setEditor(null) }}>
          <span className="plan-name">{entry.name}{active && <span className="plan-badge">{t.openNow}</span>}</span>
          <span className="plan-meta">{t.budgetMeta(entry.entries.length, formatMoney(summarizeBudget(entry).left, entry.currency, t.locale))}</span>
        </button>
        <div className="plan-entry-actions">
          <button aria-label={t.exportOne(entry.name)} onClick={() => exportBudget(entry)}><Download size={15} /></button>
          <button aria-label={t.duplicatePlan(entry.name)} onClick={() => updateLibrary(current => {
            const clone = { ...structuredClone(entry), id: crypto.randomUUID(), name: t.copyOfPlan(entry.name), example: false }
            return { ...current, budgets: [...current.budgets, clone], activeBudgetId: clone.id }
          })}><CopyIcon size={15} /></button>
          <button aria-label={t.renamePlan(entry.name)} onClick={() => setEditor({ type: 'budgetName', target: entry })}><Pencil size={15} /></button>
          <button aria-label={t.deletePlan(entry.name)} disabled={library.budgets.length === 1} title={library.budgets.length === 1 ? t.onlyBudget : undefined} onClick={() => setEditor({ type: 'budgetDelete', target: entry })}><Trash2 size={15} /></button>
        </div>
      </li>
    })}</ul>
    <h3 className="data-heading">{t.dataPlansHeading}</h3>
    <ul className="plan-list">{library.plans.map(entry => {
      const totals = summarize(entry)
      const active = entry.id === library.activeId
      return <li className={active ? 'plan-entry active' : 'plan-entry'} key={entry.id}>
        <button className="plan-open" aria-label={t.openPlan(entry.name)} onClick={() => { updateLibrary(current => ({ ...current, activeId: entry.id })); go('wishlist'); setEditor(null) }}>
          <span className="plan-name">{entry.name}{active && <span className="plan-badge">{t.openNow}</span>}</span>
          <span className="plan-meta">{t.planSummary(entry.items.length, formatMoney(totals.planned, entry.currency, t.locale))}</span>
        </button>
        <div className="plan-entry-actions">
          <button aria-label={t.exportOne(entry.name)} onClick={() => exportOne(entry)}><Download size={15} /></button>
          <button aria-label={t.duplicatePlan(entry.name)} onClick={() => updateLibrary(current => {
            const clone = { ...structuredClone(entry), id: crypto.randomUUID(), name: t.copyOfPlan(entry.name), example: false }
            return { ...current, plans: [...current.plans, clone], activeId: clone.id }
          })}><CopyIcon size={15} /></button>
          <button aria-label={t.renamePlan(entry.name)} onClick={() => setEditor({ type: 'plan', target: entry })}><Pencil size={15} /></button>
          <button aria-label={t.deletePlan(entry.name)} disabled={library.plans.length === 1} title={library.plans.length === 1 ? t.onlyPlan : undefined} onClick={() => setEditor({ type: 'planDelete', target: entry })}><Trash2 size={15} /></button>
        </div>
      </li>
    })}</ul>
    <DialogFooter className="data-footer">
      <Button type="button" variant="outline" onClick={() => setEditor({ type: 'budgetName' })}><Plus size={15} /> {t.newBudget}</Button>
      <Button type="button" variant="outline" onClick={() => setEditor({ type: 'plan' })}><Plus size={15} /> {t.newPlan}</Button>
      <Button type="button" variant="outline" onClick={openFile}><Upload size={15} /> {t.importFile}</Button>
      <Button type="button" onClick={exportAll}><Download size={15} /> {t.exportAll}</Button>
    </DialogFooter>
  </div>
}

function EditorForm({ editor, plan, budget, library, t, update, updateLibrary, setEditor, setNotice, go, close }: {
  editor: Exclude<NonNullable<Editor>, { type: 'data' }>; plan: Plan; budget: Budget; library: Library; t: Copy
  go: (page: Page) => void
  update: (change: (current: Plan) => Plan) => void
  updateLibrary: (change: (current: Library) => Library) => void
  setEditor: (editor: Editor) => void
  setNotice: (notice: { tone: 'ok' | 'error'; text: string } | null) => void
  close: () => void
}) {
  const [name, setName] = useState(editor.type === 'item' ? editor.item?.name ?? '' : editor.type === 'category' ? editor.category?.name ?? '' : editor.type === 'choice' ? editor.choice?.name ?? '' : editor.type === 'plan' || editor.type === 'budgetName' ? editor.target?.name ?? '' : '')
  const [amount, setAmount] = useState(editor.type === 'budget' ? (plan.budget / 100).toFixed(2) : editor.type === 'item' && editor.item ? (editor.item.amount / 100).toFixed(2) : '')
  const [categoryId, setCategoryId] = useState(editor.type === 'item' ? editor.item?.categoryId ?? editor.categoryId ?? 'none' : editor.type === 'choice' ? editor.choice?.categoryId ?? editor.categoryId ?? 'none' : 'none')
  const [optionId, setOptionId] = useState(editor.type === 'item' ? editor.item?.optionId ?? editor.optionId ?? 'none' : 'none')
  const [options, setOptions] = useState<Option[]>(editor.type === 'choice' ? editor.choice?.options ?? [{ id: crypto.randomUUID(), label: '' }, { id: crypto.randomUUID(), label: '' }] : [])
  const [quantity, setQuantity] = useState(editor.type === 'item' ? String(editor.item?.quantity ?? 1) : '1')
  const [priority, setPriority] = useState<Priority>(editor.type === 'item' ? editor.item?.priority ?? 'medium' : 'medium')
  const [status, setStatus] = useState<Status>(editor.type === 'item' ? editor.item?.status ?? 'planned' : 'planned')
  const [link, setLink] = useState(editor.type === 'item' ? editor.item?.link ?? '' : '')
  const [note, setNote] = useState(editor.type === 'item' ? editor.item?.note ?? '' : '')
  const [color, setColor] = useState(editor.type === 'category' ? editor.category?.color ?? colors[plan.categories.length % colors.length] : colors[0])
  const [currency, setCurrency] = useState<Currency>(plan.currency)
  const [error, setError] = useState('')
  const [withContents, setWithContents] = useState(false)
  const chosenCategory = categoryId === 'none' ? null : categoryId
  // An item can only join an either-or that lives in the same category.
  const available = plan.choices.filter(choice => choice.categoryId === chosenCategory)
  const pickedOption = available.some(choice => choice.options.some(option => option.id === optionId)) ? optionId : 'none'
  const needsName = editor.type === 'item' || editor.type === 'category' || editor.type === 'choice' || editor.type === 'plan' || editor.type === 'budgetName'
  // What a deleted category or either-or would take along when asked to.
  let contents: { items: number; choices: number } | null = null
  if (editor.type === 'categoryDelete') {
    const id = editor.target.id
    contents = { items: plan.items.filter(item => item.categoryId === id).length, choices: plan.choices.filter(choice => choice.categoryId === id).length }
  }
  if (editor.type === 'choiceDelete') {
    const owned = new Set(editor.target.options.map(option => option.id))
    contents = { items: plan.items.filter(item => item.optionId !== null && owned.has(item.optionId)).length, choices: 0 }
  }
  const title = editor.type === 'itemDelete' ? t.titleItemDelete
    : editor.type === 'choiceDelete' ? t.titleChoiceDelete
    : editor.type === 'categoryDelete' ? t.titleCategoryDelete
    : editor.type === 'budget' ? t.titleBudget
    : editor.type === 'budgetName' ? editor.target ? t.titleBudgetRename : t.titleBudgetNew
    : editor.type === 'budgetDelete' ? t.titleBudgetDelete
    : editor.type === 'importBudget' ? t.titleImportBudget
    : editor.type === 'importPlan' ? t.titleImportPlan
    : editor.type === 'importLibrary' ? t.titleImportLibrary
    : editor.type === 'planDelete' ? t.titlePlanDelete
    : editor.type === 'plan' ? editor.target ? t.titlePlanRename : t.titlePlanNew
    : editor.type === 'reset' ? t.titleReset
    : editor.type === 'item' ? editor.item ? t.titleItemEdit : t.titleItemNew
    : editor.type === 'choice' ? editor.choice ? t.titleChoiceEdit : t.titleChoiceNew
    : editor.type === 'category' && editor.category ? t.titleCategoryEdit : t.titleCategoryNew
  const description = editor.type === 'itemDelete' ? t.descItemDelete(editor.target.name)
    : editor.type === 'choiceDelete' ? t.descChoiceDelete(editor.target.name)
    : editor.type === 'categoryDelete' ? t.descCategoryDelete(editor.target.name)
    : editor.type === 'budget' ? t.descBudget
    : editor.type === 'importPlan' ? t.descImportPlan(editor.filename, editor.incoming.items.length, editor.incoming.categories.length, editor.incoming.choices.length)
    : editor.type === 'importLibrary' ? t.descImportLibrary(editor.filename, editor.incoming.plans.length, editor.withBudgets ? editor.incoming.budgets.length : null)
    : editor.type === 'importBudget' ? t.descImportBudget(editor.filename, editor.incoming.entries.length)
    : editor.type === 'budgetName' ? editor.target ? t.descBudgetRename : t.descBudgetNew
    : editor.type === 'budgetDelete' ? t.descBudgetDelete(editor.target.name, editor.target.entries.length)
    : editor.type === 'planDelete' ? t.descPlanDelete(editor.target.name, editor.target.items.length)
    : editor.type === 'plan' ? editor.target ? t.descPlanRename : t.descPlanNew
    : editor.type === 'reset' ? t.descReset
    : editor.type === 'item' ? t.descItem
    : editor.type === 'choice' ? t.descChoice
    : t.descCategory

  function submit(event: FormEvent) {
    event.preventDefault()
    if (editor.type === 'reset') { update(current => ({ ...emptyPlan(current.name, current.currency), id: current.id })); close(); return }
    if (editor.type === 'itemDelete') { const id = editor.target.id; update(p => deletePurchase(p, id)); close(); return }
    if (editor.type === 'choiceDelete') { const id = editor.target.id; update(p => deleteChoice(p, id, withContents)); close(); return }
    if (editor.type === 'categoryDelete') { const id = editor.target.id; update(p => deleteCategory(p, id, withContents)); close(); return }
    if (editor.type === 'importPlan') {
      const incoming = withFreshId(editor.incoming, library.plans)
      updateLibrary(current => ({ ...current, plans: [...current.plans, incoming], activeId: incoming.id }))
      setNotice({ tone: 'ok', text: t.planAdded(incoming.name) })
      go('wishlist')
      close()
      return
    }
    if (editor.type === 'importBudget') {
      const incoming = withFreshId(editor.incoming, library.budgets)
      updateLibrary(current => ({ ...current, budgets: [...current.budgets, incoming], activeBudgetId: incoming.id }))
      setNotice({ tone: 'ok', text: t.planAdded(incoming.name) })
      go('budget')
      close()
      return
    }
    if (editor.type === 'importLibrary') {
      updateLibrary(() => editor.incoming)
      setNotice({ tone: 'ok', text: t.plansReplaced(editor.incoming.plans.length) })
      close()
      return
    }
    if (editor.type === 'planDelete') {
      updateLibrary(current => {
        const plans = current.plans.filter(entry => entry.id !== editor.target.id)
        if (!plans.length) {
          const fresh = emptyPlan(t.newPlanName(1))
          return { ...current, plans: [fresh], activeId: fresh.id }
        }
        return { ...current, plans, activeId: plans.some(entry => entry.id === current.activeId) ? current.activeId : plans[0].id }
      })
      setEditor({ type: 'data' })
      return
    }
    if (editor.type === 'budgetDelete') {
      updateLibrary(current => {
        const budgets = current.budgets.filter(entry => entry.id !== editor.target.id)
        if (!budgets.length) {
          const fresh = starterBudget(t.newBudgetName(1), t.budgetCategories)
          return { ...current, budgets: [fresh], activeBudgetId: fresh.id }
        }
        return { ...current, budgets, activeBudgetId: budgets.some(entry => entry.id === current.activeBudgetId) ? current.activeBudgetId : budgets[0].id }
      })
      setEditor({ type: 'data' })
      return
    }
    if (needsName && !name.trim()) { setError(t.errorName); return }
    if (editor.type === 'plan') {
      const trimmed = name.trim()
      if (editor.target) updateLibrary(current => ({ ...current, plans: current.plans.map(entry => entry.id === editor.target!.id ? { ...entry, name: trimmed, example: false } : entry) }))
      else updateLibrary(current => {
        const created = emptyPlan(trimmed, plan.currency)
        return { ...current, plans: [...current.plans, created], activeId: created.id }
      })
      setEditor({ type: 'data' })
      return
    }
    if (editor.type === 'budgetName') {
      const trimmed = name.trim()
      if (editor.target) updateLibrary(current => ({ ...current, budgets: current.budgets.map(entry => entry.id === editor.target!.id ? { ...entry, name: trimmed, example: false } : entry) }))
      else updateLibrary(current => {
        const created = starterBudget(trimmed, t.budgetCategories, budget.currency)
        return { ...current, budgets: [...current.budgets, created], activeBudgetId: created.id }
      })
      setEditor({ type: 'data' })
      return
    }
    if (editor.type === 'category') {
      if (plan.categories.some(c => c.id !== editor.category?.id && c.name.toLowerCase() === name.trim().toLowerCase())) { setError(t.errorCategoryExists); return }
      update(p => ({ ...p, categories: editor.category ? p.categories.map(c => c.id === editor.category!.id ? { ...c, name: name.trim(), color } : c) : [...p.categories, { id: crypto.randomUUID(), name: name.trim(), color, enabled: true }] }))
    } else if (editor.type === 'choice') {
      const trimmed = options.map(option => ({ ...option, label: option.label.trim() }))
      if (trimmed.length < 2) { setError(t.errorTwoOptions); return }
      if (trimmed.some(option => !option.label)) { setError(t.errorOptionName); return }
      const kept = new Set(trimmed.map(option => option.id))
      update(p => {
        const choice = withValidSelection({ id: editor.choice?.id ?? crypto.randomUUID(), name: name.trim(), categoryId: chosenCategory, enabled: editor.choice?.enabled ?? true, selectedId: editor.choice?.selectedId ?? null, options: trimmed })
        const owned = editor.choice?.options.map(option => option.id) ?? []
        return {
          ...p,
          choices: editor.choice ? p.choices.map(c => c.id === choice.id ? choice : c) : [...p.choices, choice],
          // Put in another category, it goes to the end there.
          layout: editor.choice && editor.choice.categoryId !== chosenCategory ? p.layout.filter(id => id !== choice.id) : p.layout,
          // Items follow their either-or between categories; items in a removed option stay as plain purchases.
          items: p.items.map(item => item.optionId !== null && owned.includes(item.optionId)
            ? kept.has(item.optionId) ? { ...item, categoryId: chosenCategory } : { ...item, optionId: null, categoryId: chosenCategory }
            : item),
        }
      })
    } else {
      const cents = parseAmount(amount)
      if (cents === null) { setError(t.errorAmount); return }
      if (editor.type === 'budget') update(p => ({ ...p, budget: cents, currency }))
      else {
        const pieces = /^\d{1,3}$/.test(quantity.trim()) ? Number(quantity.trim()) : 0
        if (pieces < 1) { setError(t.errorQuantity); return }
        const address = normalizeLink(link)
        if (address === null) { setError(t.errorLink); return }
        const item: Purchase = { id: editor.item?.id ?? crypto.randomUUID(), name: name.trim(), amount: cents, quantity: pieces, priority, status, link: address, categoryId: chosenCategory, optionId: pickedOption === 'none' ? null : pickedOption, note: note.trim(), enabled: editor.item?.enabled ?? true }
        const previous = editor.item
        // Put somewhere else, it goes to the end of its new place.
        const moved = previous !== undefined && (previous.categoryId !== item.categoryId || previous.optionId !== item.optionId)
        update(p => ({ ...p, items: previous ? p.items.map(i => i.id === item.id ? item : i) : [...p.items, item], layout: moved ? p.layout.filter(id => id !== item.id) : p.layout }))
      }
    }
    close()
  }

  // Deleting always asks first.
  function remove() {
    if (editor.type === 'item' && editor.item) setEditor({ type: 'itemDelete', target: editor.item })
    if (editor.type === 'choice' && editor.choice) setEditor({ type: 'choiceDelete', target: editor.choice })
    if (editor.type === 'category' && editor.category) setEditor({ type: 'categoryDelete', target: editor.category })
  }

  const deletable = (editor.type === 'item' && editor.item) || (editor.type === 'category' && editor.category) || (editor.type === 'choice' && editor.choice)
  const deleting = editor.type === 'itemDelete' || editor.type === 'choiceDelete' || editor.type === 'categoryDelete'
  const confirmLabel = deleting ? t.delete
    : editor.type === 'reset' ? t.startFresh
    : editor.type === 'importBudget' ? t.addBudget
    : editor.type === 'budgetDelete' ? t.delete
    : editor.type === 'budgetName' && !editor.target ? t.createBudget
    : editor.type === 'importPlan' ? t.addPlan
    : editor.type === 'importLibrary' ? t.replaceAll
    : editor.type === 'planDelete' ? t.delete
    : editor.type === 'plan' && !editor.target ? t.createPlan
    : editor.type === 'item' && !editor.item ? t.addPurchase
    : editor.type === 'category' && !editor.category ? t.createCategory
    : editor.type === 'choice' && !editor.choice ? t.createChoice
    : t.saveChanges
  const destructive = deleting || editor.type === 'reset' || editor.type === 'importLibrary' || editor.type === 'planDelete' || editor.type === 'budgetDelete'
  const categoryField = <div className="field"><Label htmlFor="category">{t.labelCategory} <span className="optional">{t.optional}</span></Label><Select value={categoryId} onValueChange={setCategoryId}><SelectTrigger id="category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t.uncategorized}</SelectItem>{plan.categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}{c.enabled ? '' : t.categoryOff}</SelectItem>)}</SelectContent></Select></div>

  return <form onSubmit={submit}><DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader><div className="editor-fields">
    {needsName && <div className="field"><Label htmlFor="name">{editor.type === 'item' ? t.labelItemName : editor.type === 'choice' ? t.labelChoiceName : editor.type === 'plan' ? t.labelPlanName : editor.type === 'budgetName' ? t.labelBudgetName : t.labelCategoryName}</Label><Input id="name" placeholder={editor.type === 'item' ? t.placeholderItem : editor.type === 'choice' ? t.placeholderChoice : editor.type === 'plan' ? t.placeholderPlanName : editor.type === 'budgetName' ? t.placeholderBudgetName : t.placeholderCategory} value={name} onChange={e => setName(e.target.value)} maxLength={100} autoFocus required /></div>}
    {(editor.type === 'item' || editor.type === 'budget') && <div className="form-row"><div className="field"><Label htmlFor="amount">{editor.type === 'budget' ? t.labelTotalBudget : t.labelPrice(plan.currency)}</Label><Input id="amount" inputMode="decimal" placeholder={t.placeholderAmount} value={amount} onChange={e => setAmount(e.target.value)} required autoFocus={editor.type === 'budget'} /></div>{editor.type === 'item' && <div className="field quantity-field"><Label htmlFor="quantity">{t.labelQuantity}</Label><Input id="quantity" inputMode="numeric" value={quantity} onChange={e => setQuantity(e.target.value)} required /></div>}{editor.type === 'budget' && <div className="field currency-field"><Label htmlFor="currency">{t.labelCurrency}</Label><Select value={currency} onValueChange={v => setCurrency(v as Currency)}><SelectTrigger id="currency"><SelectValue /></SelectTrigger><SelectContent>{currencies.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>}</div>}
    {editor.type === 'budget' && <p className="field-hint">{t.hintNoBudget} {t.hintCurrency}</p>}
    {editor.type === 'item' && <>{categoryField}
      {available.length > 0 && <div className="field"><Label htmlFor="option">{t.labelOption} <span className="optional">{t.optional}</span></Label><Select value={pickedOption} onValueChange={setOptionId}><SelectTrigger id="option"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t.optionNone}</SelectItem>{available.flatMap(choice => choice.options.map(option => <SelectItem key={option.id} value={option.id}>{choice.name}: {option.label}</SelectItem>))}</SelectContent></Select></div>}
      <div className="form-row">
        <div className="field"><Label htmlFor="priority">{t.labelPriority}</Label><Select value={priority} onValueChange={v => setPriority(v as Priority)}><SelectTrigger id="priority"><SelectValue /></SelectTrigger><SelectContent>{priorities.map(level => <SelectItem key={level} value={level}>{t.priorityNames[level]}</SelectItem>)}</SelectContent></Select></div>
        <div className="field"><Label htmlFor="status">{t.labelStatus}</Label><Select value={status} onValueChange={v => setStatus(v as Status)}><SelectTrigger id="status"><SelectValue /></SelectTrigger><SelectContent>{statuses.map(state => <SelectItem key={state} value={state}>{t.statusNames[state]}</SelectItem>)}</SelectContent></Select></div>
      </div>
      {status === 'dropped' && <p className="field-hint">{t.hintDropped}</p>}
      <div className="field"><Label htmlFor="note">{t.labelNote} <span className="optional">{t.optional}</span></Label><Input id="note" placeholder={t.placeholderNote} value={note} onChange={e => setNote(e.target.value)} maxLength={180} /></div>
      <div className="field"><Label htmlFor="link">{t.labelLink} <span className="optional">{t.optional}</span></Label><Input id="link" inputMode="url" placeholder={t.placeholderLink} value={link} onChange={e => setLink(e.target.value)} maxLength={2000} /><p className="field-hint">{t.hintLink}</p></div></>}
    {editor.type === 'choice' && <>{categoryField}
      <div className="field"><Label>{t.labelOptions}</Label><div className="option-editor">{options.map((option, index) => <div className="option-editor-row" key={option.id}>
        <Input aria-label={t.optionNumber(index + 1)} placeholder={index === 0 ? t.placeholderOptionFirst : t.placeholderOptionNext} value={option.label} maxLength={60} onChange={e => setOptions(current => current.map(o => o.id === option.id ? { ...o, label: e.target.value } : o))} />
        <Button type="button" variant="ghost" size="icon" className="small-icon" aria-label={t.removeOption(index + 1)} disabled={options.length <= 2} onClick={() => setOptions(current => current.filter(o => o.id !== option.id))}><X size={16} /></Button>
      </div>)}<button type="button" className="add-option" onClick={() => setOptions(current => [...current, { id: crypto.randomUUID(), label: '' }])}><Plus size={15} /> {t.addOption}</button></div></div>
      <p className="field-hint">{editor.choice ? t.hintChoiceEdit : t.hintChoiceNew}</p></>}
    {editor.type === 'category' && <><div className="field"><Label>{t.labelColor}</Label><div className="color-picker" role="group" aria-label={t.labelColor}>{colors.map(c => <button key={c} type="button" className={`color-option color-${c} ${color === c ? 'selected' : ''}`} aria-label={t.colorNames[c]} aria-pressed={color === c} onClick={() => setColor(c)}>{color === c && <Check size={18} />}</button>)}</div></div>{editor.category && <p className="field-hint">{t.hintCategoryDelete}</p>}</>}
    {contents && contents.items + contents.choices > 0 && <label className="check-field">
      <input type="checkbox" checked={withContents} onChange={event => setWithContents(event.target.checked)} />
      <span>{editor.type === 'choiceDelete' ? t.alsoDeleteChoiceItems(contents.items) : t.alsoDeleteCategoryContents(contents.items, contents.choices)}</span>
    </label>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </div><DialogFooter className="editor-footer">{deletable && <Button type="button" variant="ghost" className="delete-button" onClick={remove}><Trash2 size={15} /> {t.delete}</Button>}<Button type="button" variant="outline" onClick={() => ['plan', 'planDelete', 'budgetName', 'budgetDelete'].includes(editor.type) ? setEditor({ type: 'data' }) : close()}>{t.cancel}</Button><Button type="submit" variant={destructive ? 'destructive' : 'default'}>{confirmLabel}</Button></DialogFooter></form>
}
