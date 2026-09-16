import { useRef, useState, type CSSProperties, type DragEvent, type FormEvent, type ReactNode } from 'react'
import { ArrowDownLeft, ArrowUpRight, CalendarDays, Check, ChevronDown, Download, FolderPlus, GripVertical, Leaf, MoreHorizontal, Pencil, PiggyBank, Plus, ShieldCheck, Sparkles, Trash2, Upload, Users, Wallet, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { colors, currencies, formatMoney, parseAmount, type Category, type Currency, type Plan } from '@/lib/budget'
import { counts, frequencies, fundingModes, kinds, MAX_PEOPLE, monthly, monthsToAfford, moveBudgetCategory, moveEntry, splits, starterBudget, stillToBuy, summarizeBudget, type Budget, type Entry, type Frequency, type Funding, type Kind, type Person, type Split } from '@/lib/household'
import type { Copy } from '@/lib/i18n'
import { Analysis } from '@/Analysis'

type BudgetEditor =
  | { type: 'entry'; kind: Kind; entry?: Entry; categoryId?: string | null }
  | { type: 'category'; category?: Category }
  | { type: 'household' }
  | { type: 'funding' }
  | { type: 'reset' }
  | null

type Change = (change: (current: Budget) => Budget) => void
// What is being dragged, and where it would land: in front of `before`, or last. An entry keeps its kind, so it is
// only ever dropped into its own list; an expense can land in another category.
type BudgetDrag = { kind: 'entry'; id: string; entryKind: Kind } | { kind: 'category'; id: string }
type BudgetLanding = { categoryId: string | null; before: string | null }
type FormProps = { t: Copy; budget: Budget; update: Change; close: () => void }

export function BudgetPage({ t, budget, plans, notices, update, openPlan, exportBudget, openFile }: {
  t: Copy; budget: Budget; plans: Plan[]; notices: ReactNode; update: Change
  openPlan: (id: string) => void; exportBudget: () => void; openFile: () => void
}) {
  const [editor, setEditor] = useState<BudgetEditor>(null)
  const [collapsed, setCollapsed] = useState<string[]>([])
  const totals = summarizeBudget(budget)
  const money = (amount: number) => formatMoney(amount, budget.currency, t.locale)
  const percent = (value: number) => new Intl.NumberFormat(t.locale, { style: 'percent', maximumFractionDigits: 0 }).format(value)
  const outgoing = totals.expenses + totals.savings + totals.wishlist
  const over = totals.left < 0
  const progress = totals.income > 0 ? Math.min(outgoing / totals.income * 100, 100) : outgoing > 0 ? 100 : 0
  const close = () => setEditor(null)
  const countOf = (kind: Kind) => budget.entries.filter(entry => entry.kind === kind).length
  // Nothing moves until it is let go; until then a line shows where it would land.
  const [dragging, setDragging] = useState<BudgetDrag | null>(null)
  const [landing, setLanding] = useState<BudgetLanding | null>(null)
  const held = useRef<BudgetDrag | null>(null)
  const landingRef = useRef<BudgetLanding | null>(null)

  function endDrag() {
    held.current = null
    landingRef.current = null
    setDragging(null)
    setLanding(null)
  }

  function aim(next: BudgetLanding | null) {
    const current = landingRef.current
    if (next === null ? current === null : current !== null && current.categoryId === next.categoryId && current.before === next.before) return
    landingRef.current = next
    setLanding(next)
  }

  function commit(event: DragEvent) {
    event.preventDefault()
    event.stopPropagation()
    const drag = held.current
    const landed = landingRef.current
    endDrag()
    if (!drag || !landed) return
    update(current => drag.kind === 'entry' ? moveEntry(current, { id: drag.id, ...landed }) : moveBudgetCategory(current, { id: drag.id, before: landed.before }))
  }

  function dragSource(drag: BudgetDrag) {
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

  // A target only answers for what it takes; anything else rises to the target around it.
  function accepts(event: DragEvent, takes: (drag: BudgetDrag) => boolean) {
    if (!held.current || !takes(held.current)) return false
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    return true
  }

  const takesEntry = (kind: Kind) => (drag: BudgetDrag) => drag.kind === 'entry' && drag.entryKind === kind
  const upperHalf = (event: DragEvent) => {
    const box = event.currentTarget.getBoundingClientRect()
    return event.clientY < box.top + box.height / 2
  }
  // Whether the entry held now would land in this list.
  const landsIn = (kind: Kind, categoryId: string | null) => dragging?.kind === 'entry' && dragging.entryKind === kind && landing !== null && landing.categoryId === categoryId

  // Dropping onto an entry: the top half puts the dragged one in front of it, the bottom half behind. Over itself it stays.
  function entryTarget(entry: Entry, nextId: string | null) {
    return {
      onDragOver: (event: DragEvent) => {
        if (!accepts(event, takesEntry(entry.kind))) return
        aim(held.current?.id === entry.id ? null : { categoryId: entry.categoryId, before: upperHalf(event) ? entry.id : nextId })
      },
      onDrop: commit,
    }
  }

  // Dropping anywhere else on a list, a category's heading included: the entry lands after everything already there.
  function listTarget(kind: Kind, categoryId: string | null) {
    return {
      onDragOver: (event: DragEvent) => { if (accepts(event, takesEntry(kind))) aim({ categoryId, before: null }) },
      onDrop: commit,
    }
  }

  // A category takes an expense, and another category in front of it or behind it.
  function categoryTarget(category: Category | null, nextCategoryId: string | null) {
    const list = listTarget('expense', category?.id ?? null)
    return {
      onDragOver: (event: DragEvent) => {
        if (held.current?.kind === 'entry') { list.onDragOver(event); return }
        if (!accepts(event, drag => drag.kind === 'category')) return
        aim(held.current?.id === category?.id ? null : { categoryId: null, before: category && upperHalf(event) ? category.id : nextCategoryId })
      },
      onDrop: commit,
    }
  }

  function renderEntry(entry: Entry, locked: boolean, nextId: string | null) {
    const person = budget.people.find(candidate => candidate.id === entry.personId)
    // A bill that is not paid monthly shows what is actually paid, next to what it comes to each month.
    const paid = entry.frequency === 'monthly' ? '' : `${money(entry.amount)} ${t.frequencyAdverbs[entry.frequency]}`
    const note = [paid, entry.note].filter(Boolean).join(' · ')
    const edit = () => setEditor({ type: 'entry', kind: entry.kind, entry })
    const isDragged = dragging?.kind === 'entry' && dragging.id === entry.id
    const dropHere = dragging?.kind === 'entry' && landing?.before === entry.id
    return <div className={`purchase-row entry-row ${counts(entry, budget) ? '' : 'excluded'} ${isDragged ? 'dragging' : ''} ${dropHere ? 'drop-before' : ''}`} key={entry.id}
      {...dragSource({ kind: 'entry', id: entry.id, entryKind: entry.kind })} {...entryTarget(entry, nextId)}>
      <Switch checked={entry.enabled} disabled={locked} aria-label={t.includeItem(entry.name)}
        onCheckedChange={enabled => update(current => ({ ...current, entries: current.entries.map(candidate => candidate.id === entry.id ? { ...candidate, enabled } : candidate) }))} />
      <button className="purchase-details" onClick={edit}>
        <span className="purchase-name"><span className="purchase-title">{entry.name}</span>
          {entry.kind === 'expense' && entry.fixed && <span className="priority-pill priority-medium">{t.fixedPill}</span>}
          {budget.people.length > 0 && <span className="person-pill">{person?.name ?? t.sharedName}</span>}</span>
        {note && <span className="purchase-note">{note}</span>}
      </button>
      <span className="purchase-amount">{money(monthly(entry))}</span>
      <Button variant="ghost" size="icon" className="row-edit small-icon" aria-label={t.editItem(entry.name)} onClick={edit}><Pencil size={14} /></Button>
    </div>
  }

  function sectionHeading(id: string, title: string, hint: string, count: number, total: number) {
    return <div className="section-heading"><div><h2 id={id}>{title} <span>{count}</span></h2><p>{hint}</p></div><strong className="section-total" data-testid={`${id}-total`}>{money(total)}</strong></div>
  }

  function renderList(kind: 'income' | 'saving') {
    const entries = budget.entries.filter(entry => entry.kind === kind)
    const landsHere = landsIn(kind, null)
    return <section className="purchase-group" aria-label={kind === 'income' ? t.incomeHeading : t.savingsHeading} {...listTarget(kind, null)}>
      <div className={`group-content no-heading ${landsHere ? 'drop-active' : ''} ${landsHere && landing?.before === null ? 'drop-end' : ''}`}>
        {entries.map((entry, index) => renderEntry(entry, false, entries[index + 1]?.id ?? null))}
        {!entries.length && <p className="empty-category">{kind === 'income' ? t.noIncome : t.noSavings}</p>}
        <button className="add-in-group" onClick={() => setEditor({ type: 'entry', kind })}><Plus size={15} /> {kind === 'income' ? t.addIncome : t.addSaving}</button>
      </div>
    </section>
  }

  function renderCategory(category: Category | null) {
    const categoryId = category?.id ?? null
    const entries = budget.entries.filter(entry => entry.kind === 'expense' && entry.categoryId === categoryId)
    // While an expense is held, Uncategorized stays in place to take it.
    if (!category && !entries.length && !(dragging?.kind === 'entry' && dragging.entryKind === 'expense')) return null
    const groupId = categoryId ?? 'uncategorized'
    const total = entries.filter(entry => counts(entry, budget)).reduce((sum, entry) => sum + monthly(entry), 0)
    const locked = category ? !category.enabled : false
    const isCollapsed = collapsed.includes(groupId)
    const index = category ? budget.categories.indexOf(category) : -1
    const nextCategoryId = category ? budget.categories[index + 1]?.id ?? null : null
    const categoryHeld = dragging?.kind === 'category'
    const dropBefore = categoryHeld && category !== null && landing?.before === category.id
    const dropAfter = categoryHeld && landing !== null && landing.before === null && category !== null && index === budget.categories.length - 1
    const landsHere = landsIn('expense', categoryId)
    return <section className={`purchase-group ${locked ? 'group-disabled' : ''} ${categoryHeld && dragging.id === categoryId ? 'dragging' : ''} ${dropBefore ? 'drop-before' : ''} ${dropAfter ? 'drop-after' : ''}`} key={groupId} aria-label={category?.name ?? t.uncategorized}
      {...categoryTarget(category, nextCategoryId)}>
      <div className="group-heading" {...(category ? dragSource({ kind: 'category', id: category.id }) : {})}>
        {category && <GripVertical size={14} className="drag-grip" aria-hidden />}
        <button className="group-title" onClick={() => setCollapsed(current => current.includes(groupId) ? current.filter(id => id !== groupId) : [...current, groupId])} aria-expanded={!isCollapsed}>
          <span className={`category-icon color-${category?.color ?? 'neutral'}`}>{category ? <Leaf size={17} /> : <Wallet size={17} />}</span>
          <h3>{category?.name ?? t.uncategorized}</h3><span className="count">{entries.length}</span><ChevronDown size={15} className={isCollapsed ? 'collapsed-chevron' : ''} />
        </button>
        <div className="group-actions">
          <span className="group-total">{money(total)}</span>
          {category && <Switch checked={category.enabled} aria-label={t.includeCategory(category.name)} onCheckedChange={enabled => update(current => ({ ...current, categories: current.categories.map(c => c.id === category.id ? { ...c, enabled } : c) }))} />}
          {category && <Button variant="ghost" size="icon" className="small-icon" aria-label={t.editCategory(category.name)} onClick={() => setEditor({ type: 'category', category })}><MoreHorizontal size={18} /></Button>}
        </div>
      </div>
      {!isCollapsed && <div className={`group-content ${landsHere ? 'drop-active' : ''} ${landsHere && landing?.before === null ? 'drop-end' : ''}`}>
        {entries.map((entry, position) => renderEntry(entry, locked, entries[position + 1]?.id ?? null))}
        {!entries.length && <p className="empty-category">{t.emptyBudgetCategory}</p>}
        <button className="add-in-group" onClick={() => setEditor({ type: 'entry', kind: 'expense', categoryId })}><Plus size={15} /> {t.addExpense}</button>
      </div>}
    </section>
  }

  return <>
    <div className="page-intro">
      <div><div className="eyebrow"><span /> {t.budgetEyebrow}</div><h1>{t.budgetTitleLead} <span>{t.budgetTitleAccent}</span></h1><p>{t.budgetIntro}</p></div>
      <div className="intro-actions">
        <Button variant="outline" onClick={() => setEditor({ type: 'household' })}><Users size={16} /> {t.householdButton}</Button>
        <Button variant="outline" onClick={() => setEditor({ type: 'category' })}><FolderPlus size={16} /> {t.newCategory}</Button>
        <Button variant="outline" onClick={() => setEditor({ type: 'entry', kind: 'income' })}><ArrowDownLeft size={16} /> {t.addIncome}</Button>
        <Button onClick={() => setEditor({ type: 'entry', kind: 'expense' })}><Plus size={17} /> {t.addExpense}</Button>
      </div>
    </div>
    {notices}
    {budget.example && <div className="example-banner"><div><Sparkles size={17} /><span>{t.exampleBudgetBanner}</span></div><button onClick={() => setEditor({ type: 'reset' })}>{t.startFresh} <ArrowUpRight size={15} /></button></div>}
    <div className="workspace">
      <div className="purchases-panel">
        <div className="budget-section">{sectionHeading('income', t.incomeHeading, t.incomeHint, countOf('income'), totals.income)}{renderList('income')}</div>
        <div className="budget-section">{sectionHeading('expenses', t.expensesHeading, t.expensesHint, countOf('expense'), totals.expenses)}<div className="purchase-groups">{budget.categories.map(category => renderCategory(category))}{renderCategory(null)}</div></div>
        <div className="budget-section">{sectionHeading('savings', t.savingsHeading, t.savingsHint, countOf('saving'), totals.savings)}{renderList('saving')}</div>
      </div>
      <aside className="budget-sidebar" aria-label={t.monthHeading}>
        <p className="sr-only" role="status">{t.srMonth(money(totals.left))}</p>
        <div className="budget-card">
          <div className="budget-card-heading"><span><CalendarDays size={17} /> {t.monthHeading}</span></div>
          <div className={`budget-ring ${over ? 'over-budget' : ''}`} style={{ '--progress': `${progress}%` } as CSSProperties}><div className="ring-center">
            <span className="ring-label">{over ? t.shortEachMonth : t.leftOver}</span>
            <strong data-testid="month-left">{money(Math.abs(totals.left))}</strong>
            <span className="ring-caption">{totals.income > 0 ? t.plannedShare(percent(outgoing / totals.income)) : t.monthNoIncome}</span>
          </div></div>
          <div className={`budget-status ${over ? 'over' : ''}`} aria-live="polite">{over ? <ArrowUpRight size={14} /> : <Check size={14} />}{over ? t.monthOver(money(-totals.left)) : t.monthFits}</div>
          <div className="summary-lines">
            <div><span><i className="legend-dot income-dot" /> {t.incomeHeading}</span><strong data-testid="month-income">{money(totals.income)}</strong></div>
            <div><span><i className="legend-dot segment-fixed" /> {t.expensesHeading}</span><strong data-testid="month-expenses">{money(totals.expenses)}</strong></div>
            <div><span><i className="legend-dot segment-savings" /> {t.savingsHeading}</span><strong data-testid="month-savings">{money(totals.savings)}</strong></div>
            {budget.wishlist.mode === 'fixed' && <div><span><i className="legend-dot segment-wishlist" /> {t.forWishlist}</span><strong>{money(totals.wishlist)}</strong></div>}
          </div>
        </div>
        <div className="funding-card">
          <div className="budget-card-heading"><span><PiggyBank size={17} /> {t.fundingCardTitle}</span><button aria-label={t.editFunding} onClick={() => setEditor({ type: 'funding' })}><Pencil size={15} /></button></div>
          <p className="funding-mode">{t.fundingModes[budget.wishlist.mode]}<strong data-testid="for-wishlist">{t.perMonth(money(totals.forWishlist))}</strong></p>
          <ul className="funding-plans">{plans.map(plan => {
            const cost = stillToBuy(plan)
            return <li key={plan.id}><button onClick={() => openPlan(plan.id)}>
              <span className="funding-plan-name">{plan.name}</span>
              <span className="funding-plan-meta">{formatMoney(cost, plan.currency, t.locale)} · {t.planMonths(monthsToAfford(cost, totals.forWishlist))}</span>
            </button></li>
          })}</ul>
        </div>
        <div className="privacy-note"><ShieldCheck size={15} /><span>{t.privacy}</span></div>
        <div className="plan-actions">
          <button onClick={exportBudget}><Download size={13} /> {t.exportBudget}</button>
          <button onClick={openFile}><Upload size={13} /> {t.importFile}</button>
        </div>
        {(budget.entries.length > 0 || budget.people.length > 0) && <button className="reset-link" onClick={() => setEditor({ type: 'reset' })}>{t.resetBudget}</button>}
      </aside>
    </div>
    <Analysis t={t} budget={budget} />
    <Dialog open={editor !== null} onOpenChange={open => { if (!open) close() }}><DialogContent className="editor-dialog">
      {editor?.type === 'entry' && <EntryForm key={`entry-${editor.entry?.id ?? 'new'}`} editor={editor} t={t} budget={budget} update={update} close={close} />}
      {editor?.type === 'category' && <CategoryForm key={`category-${editor.category?.id ?? 'new'}`} category={editor.category} t={t} budget={budget} update={update} close={close} />}
      {editor?.type === 'household' && <HouseholdForm t={t} budget={budget} update={update} close={close} />}
      {editor?.type === 'funding' && <FundingForm t={t} budget={budget} update={update} close={close} />}
      {editor?.type === 'reset' && <ResetForm t={t} budget={budget} update={update} close={close} />}
    </DialogContent></Dialog>
  </>
}

function Footer({ t, submitLabel, onDelete, destructive = false, close }: { t: Copy; submitLabel: string; onDelete?: () => void; destructive?: boolean; close: () => void }) {
  return <DialogFooter className="editor-footer">
    {onDelete && <Button type="button" variant="ghost" className="delete-button" onClick={onDelete}><Trash2 size={15} /> {t.delete}</Button>}
    <Button type="button" variant="outline" onClick={close}>{t.cancel}</Button>
    <Button type="submit" variant={destructive ? 'destructive' : 'default'}>{submitLabel}</Button>
  </DialogFooter>
}

function EntryForm({ editor, t, budget, update, close }: FormProps & { editor: Extract<NonNullable<BudgetEditor>, { type: 'entry' }> }) {
  const existing = editor.entry
  const [kind, setKind] = useState<Kind>(existing?.kind ?? editor.kind)
  const [name, setName] = useState(existing?.name ?? '')
  const [amount, setAmount] = useState(existing ? (existing.amount / 100).toFixed(2) : '')
  const [frequency, setFrequency] = useState<Frequency>(existing?.frequency ?? 'monthly')
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? editor.categoryId ?? 'none')
  const [personId, setPersonId] = useState(existing?.personId ?? 'none')
  const [fixed, setFixed] = useState(existing?.fixed ?? true)
  const [note, setNote] = useState(existing?.note ?? '')
  const [error, setError] = useState('')
  const cents = parseAmount(amount)

  function submit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) { setError(t.errorName); return }
    if (cents === null) { setError(t.errorAmount); return }
    const entry: Entry = {
      id: existing?.id ?? crypto.randomUUID(), kind, name: name.trim(), amount: cents, frequency,
      // Only an expense has a category, or can be a fixed cost.
      categoryId: kind === 'expense' && categoryId !== 'none' ? categoryId : null,
      personId: personId === 'none' ? null : personId,
      fixed: kind === 'expense' && fixed, enabled: existing?.enabled ?? true, note: note.trim(),
    }
    update(current => ({ ...current, entries: existing ? current.entries.map(candidate => candidate.id === entry.id ? entry : candidate) : [...current.entries, entry] }))
    close()
  }

  function remove() {
    update(current => ({ ...current, entries: current.entries.filter(candidate => candidate.id !== existing?.id) }))
    close()
  }

  return <form onSubmit={submit}>
    <DialogHeader><DialogTitle>{existing ? t.titleEntryEdit[kind] : t.titleEntryNew[kind]}</DialogTitle><DialogDescription>{t.descEntry}</DialogDescription></DialogHeader>
    <div className="editor-fields">
      <div className="field"><Label htmlFor="kind">{t.labelKind}</Label><Select value={kind} onValueChange={value => setKind(value as Kind)}><SelectTrigger id="kind"><SelectValue /></SelectTrigger><SelectContent>{kinds.map(option => <SelectItem key={option} value={option}>{t.kindNames[option]}</SelectItem>)}</SelectContent></Select></div>
      <div className="field"><Label htmlFor="entry-name">{t.labelEntryName}</Label><Input id="entry-name" placeholder={t.placeholderEntry[kind]} value={name} onChange={event => setName(event.target.value)} maxLength={100} autoFocus required /></div>
      <div className="form-row">
        <div className="field"><Label htmlFor="entry-amount">{t.labelAmount(budget.currency)}</Label><Input id="entry-amount" inputMode="decimal" placeholder={t.placeholderAmount} value={amount} onChange={event => setAmount(event.target.value)} required /></div>
        <div className="field"><Label htmlFor="frequency">{t.labelFrequency}</Label><Select value={frequency} onValueChange={value => setFrequency(value as Frequency)}><SelectTrigger id="frequency"><SelectValue /></SelectTrigger><SelectContent>{frequencies.map(option => <SelectItem key={option} value={option}>{t.frequencyNames[option]}</SelectItem>)}</SelectContent></Select></div>
      </div>
      {frequency !== 'monthly' && cents !== null && <p className="field-hint" data-testid="comes-to">{t.comesTo(formatMoney(monthly({ amount: cents, frequency }), budget.currency, t.locale))}</p>}
      {kind === 'expense' && <>
        <div className="field"><Label htmlFor="entry-category">{t.labelCategory} <span className="optional">{t.optional}</span></Label><Select value={categoryId} onValueChange={setCategoryId}><SelectTrigger id="entry-category"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t.uncategorized}</SelectItem>{budget.categories.map(category => <SelectItem key={category.id} value={category.id}>{category.name}{category.enabled ? '' : t.categoryOff}</SelectItem>)}</SelectContent></Select></div>
        <div className="switch-field"><Switch id="fixed" checked={fixed} onCheckedChange={setFixed} /><div><Label htmlFor="fixed">{t.labelFixed}</Label><p className="field-hint">{t.hintFixed}</p></div></div>
      </>}
      {budget.people.length > 0 && <div className="field"><Label htmlFor="person">{t.labelPerson}</Label><Select value={personId} onValueChange={setPersonId}><SelectTrigger id="person"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">{t.sharedName}</SelectItem>{budget.people.map(person => <SelectItem key={person.id} value={person.id}>{person.name}</SelectItem>)}</SelectContent></Select></div>}
      <div className="field"><Label htmlFor="entry-note">{t.labelNote} <span className="optional">{t.optional}</span></Label><Input id="entry-note" placeholder={t.placeholderEntryNote} value={note} onChange={event => setNote(event.target.value)} maxLength={180} /></div>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
    <Footer t={t} submitLabel={existing ? t.saveChanges : t.createEntry[kind]} onDelete={existing ? remove : undefined} close={close} />
  </form>
}

function CategoryForm({ category, t, budget, update, close }: FormProps & { category?: Category }) {
  const [name, setName] = useState(category?.name ?? '')
  const [color, setColor] = useState(category?.color ?? colors[budget.categories.length % colors.length])
  const [error, setError] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) { setError(t.errorName); return }
    if (budget.categories.some(c => c.id !== category?.id && c.name.toLowerCase() === trimmed.toLowerCase())) { setError(t.errorCategoryExists); return }
    update(current => ({ ...current, categories: category ? current.categories.map(c => c.id === category.id ? { ...c, name: trimmed, color } : c) : [...current.categories, { id: crypto.randomUUID(), name: trimmed, color, enabled: true }] }))
    close()
  }

  // Its expenses stay, without a category.
  function remove() {
    update(current => ({ ...current, categories: current.categories.filter(c => c.id !== category?.id), entries: current.entries.map(entry => entry.categoryId === category?.id ? { ...entry, categoryId: null } : entry) }))
    close()
  }

  return <form onSubmit={submit}>
    <DialogHeader><DialogTitle>{category ? t.titleCategoryEdit : t.titleBudgetCategoryNew}</DialogTitle><DialogDescription>{t.descBudgetCategory}</DialogDescription></DialogHeader>
    <div className="editor-fields">
      <div className="field"><Label htmlFor="category-name">{t.labelCategoryName}</Label><Input id="category-name" placeholder={t.placeholderBudgetCategory} value={name} onChange={event => setName(event.target.value)} maxLength={100} autoFocus required /></div>
      <div className="field"><Label>{t.labelColor}</Label><div className="color-picker" role="group" aria-label={t.labelColor}>{colors.map(c => <button key={c} type="button" className={`color-option color-${c} ${color === c ? 'selected' : ''}`} aria-label={t.colorNames[c]} aria-pressed={color === c} onClick={() => setColor(c)}>{color === c && <Check size={18} />}</button>)}</div></div>
      {category && <p className="field-hint">{t.hintBudgetCategoryDelete}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
    <Footer t={t} submitLabel={category ? t.saveChanges : t.createCategory} onDelete={category ? remove : undefined} close={close} />
  </form>
}

function HouseholdForm({ t, budget, update, close }: FormProps) {
  const [people, setPeople] = useState<Person[]>(budget.people)
  const [split, setSplit] = useState<Split>(budget.split)
  const [currency, setCurrency] = useState<Currency>(budget.currency)
  const [error, setError] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    const named = people.map(person => ({ ...person, name: person.name.trim() }))
    if (named.some(person => !person.name)) { setError(t.errorPersonName); return }
    // Whatever belonged to someone who is no longer here becomes shared.
    const kept = new Set(named.map(person => person.id))
    update(current => ({ ...current, people: named, split, currency, entries: current.entries.map(entry => entry.personId !== null && !kept.has(entry.personId) ? { ...entry, personId: null } : entry) }))
    close()
  }

  return <form onSubmit={submit}>
    <DialogHeader><DialogTitle>{t.titleHousehold}</DialogTitle><DialogDescription>{t.descHousehold}</DialogDescription></DialogHeader>
    <div className="editor-fields">
      <div className="field"><Label>{t.labelPeople}</Label><div className="option-editor">
        {people.map((person, index) => <div className="option-editor-row" key={person.id}>
          <Input aria-label={t.personNumber(index + 1)} placeholder={t.placeholderPerson} value={person.name} maxLength={40} onChange={event => setPeople(current => current.map(p => p.id === person.id ? { ...p, name: event.target.value } : p))} />
          <Button type="button" variant="ghost" size="icon" className="small-icon" aria-label={t.removePerson(index + 1)} onClick={() => setPeople(current => current.filter(p => p.id !== person.id))}><X size={16} /></Button>
        </div>)}
        {people.length < MAX_PEOPLE && <button type="button" className="add-option" onClick={() => setPeople(current => [...current, { id: crypto.randomUUID(), name: '' }])}><Plus size={15} /> {t.addPerson}</button>}
      </div></div>
      {people.length > 0 && <p className="field-hint">{t.hintPersonRemove}</p>}
      {people.length > 1 && <div className="field"><Label>{t.labelSplit}</Label>
        <RadioGroup className="radio-list" value={split} onValueChange={value => setSplit(value as Split)} aria-label={t.labelSplit}>{splits.map(option => <div className="radio-row" key={option}><RadioGroupItem value={option} id={`split-${option}`} /><Label htmlFor={`split-${option}`}>{t.splitNames[option]}</Label></div>)}</RadioGroup>
        <p className="field-hint">{t.hintSplit}</p></div>}
      <div className="field currency-field"><Label htmlFor="budget-currency">{t.labelCurrency}</Label><Select value={currency} onValueChange={value => setCurrency(value as Currency)}><SelectTrigger id="budget-currency"><SelectValue /></SelectTrigger><SelectContent>{currencies.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
      <p className="field-hint">{t.hintCurrency}</p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
    <Footer t={t} submitLabel={t.saveChanges} close={close} />
  </form>
}

function FundingForm({ t, budget, update, close }: FormProps) {
  const [mode, setMode] = useState<Funding['mode']>(budget.wishlist.mode)
  const [amount, setAmount] = useState(budget.wishlist.amount ? (budget.wishlist.amount / 100).toFixed(2) : '')
  const [error, setError] = useState('')

  function submit(event: FormEvent) {
    event.preventDefault()
    const cents = mode === 'fixed' ? parseAmount(amount) : budget.wishlist.amount
    if (cents === null) { setError(t.errorAmount); return }
    update(current => ({ ...current, wishlist: { mode, amount: cents } }))
    close()
  }

  return <form onSubmit={submit}>
    <DialogHeader><DialogTitle>{t.titleFunding}</DialogTitle><DialogDescription>{t.descFunding}</DialogDescription></DialogHeader>
    <div className="editor-fields">
      <RadioGroup className="radio-list" value={mode} onValueChange={value => setMode(value as Funding['mode'])} aria-label={t.titleFunding}>{fundingModes.map(option => <div className="radio-row" key={option}><RadioGroupItem value={option} id={`funding-${option}`} /><Label htmlFor={`funding-${option}`}>{t.fundingModes[option]}</Label></div>)}</RadioGroup>
      {mode === 'fixed' && <div className="field"><Label htmlFor="funding-amount">{t.labelFundingAmount(budget.currency)}</Label><Input id="funding-amount" inputMode="decimal" placeholder={t.placeholderAmount} value={amount} onChange={event => setAmount(event.target.value)} autoFocus required /></div>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
    <Footer t={t} submitLabel={t.saveChanges} close={close} />
  </form>
}

function ResetForm({ t, update, close }: FormProps) {
  function submit(event: FormEvent) {
    event.preventDefault()
    update(current => ({ ...starterBudget(current.name, t.budgetCategories, current.currency), id: current.id }))
    close()
  }
  return <form onSubmit={submit}>
    <DialogHeader><DialogTitle>{t.titleReset}</DialogTitle><DialogDescription>{t.descResetBudget}</DialogDescription></DialogHeader>
    <div className="editor-fields" />
    <Footer t={t} submitLabel={t.startFresh} destructive close={close} />
  </form>
}
