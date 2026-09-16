import { useState } from 'react'
import { formatMoney } from '@/lib/budget'
import { splitByPerson, summarizeBudget, type Budget } from '@/lib/household'
import type { Copy } from '@/lib/i18n'

// Stacked in this order: neighbours are the colour pairs checked for colour-blind separation.
const segments = ['fixed', 'variable', 'savings', 'wishlist', 'left'] as const
type Segment = typeof segments[number]
type Row = { id: string; label: string; income: number; left: number } & Record<Exclude<Segment, 'left'>, number>

export function Analysis({ t, budget }: { t: Copy; budget: Budget }) {
  const [focus, setFocus] = useState<{ row: string; segment: Segment } | null>(null)
  const money = (amount: number) => formatMoney(amount, budget.currency, t.locale)
  const percent = (value: number) => new Intl.NumberFormat(t.locale, { style: 'percent', maximumFractionDigits: 0 }).format(value)
  const totals = summarizeBudget(budget)
  const people = budget.people.length > 1 ? splitByPerson(budget) : []
  const rows: Row[] = [
    { id: 'household', label: t.householdRow, income: totals.income, fixed: totals.fixed, variable: totals.variable, savings: totals.savings, wishlist: totals.wishlist, left: totals.left },
    ...people.map(row => ({ id: row.person.id, label: row.person.name, income: row.income, fixed: row.fixed, variable: row.variable, savings: row.savings, wishlist: row.wishlist, left: row.left })),
  ]
  const valueOf = (row: Row, segment: Segment) => segment === 'left' ? Math.max(row.left, 0) : row[segment]
  // Every bar shares one scale, so a person's month reads against the household's.
  const scale = Math.max(1, ...rows.map(row => Math.max(row.income, row.fixed + row.variable + row.savings + row.wishlist)))
  const describe = (row: Row, segment: Segment) => t.segmentValue(t.segmentNames[segment], money(valueOf(row, segment)), row.income > 0 ? percent(valueOf(row, segment) / row.income) : '–')
  const ofIncome = (amount: number) => totals.income > 0 ? percent(amount / totals.income) : '–'
  const categories = totals.byCategory.filter(entry => entry.amount > 0).sort((a, b) => b.amount - a.amount)
  const largest = categories[0]?.amount ?? 1
  const focusedRow = focus && rows.find(row => row.id === focus.row)

  return <section className="analysis" aria-labelledby="analysis-heading">
    <div className="section-heading"><div><h2 id="analysis-heading">{t.analysisHeading}</h2><p>{t.analysisHint}</p></div></div>
    <div className="stat-tiles">
      <div className="stat-tile"><span className="stat-label">{t.savingsRate}</span><strong className="stat-value" data-testid="savings-rate">{ofIncome(totals.savings)}</strong><span className="stat-note">{t.savingsRateNote}</span></div>
      <div className="stat-tile"><span className="stat-label">{t.fixedShare}</span><strong className="stat-value" data-testid="fixed-share">{ofIncome(totals.fixed)}</strong><span className="stat-note">{t.fixedShareNote}</span></div>
      <div className="stat-tile"><span className="stat-label">{t.reserve}</span><strong className="stat-value" data-testid="reserve">{money(totals.irregular)}</strong><span className="stat-note">{t.reserveNote}</span></div>
    </div>
    <div className="chart-cards">
      <div className="chart-card">
        <h3>{t.moneyChartTitle}</h3>
        <p className="chart-hint">{t.moneyChartHint}</p>
        <div className="money-rows">{rows.map(row => <div className="money-row" key={row.id}>
          <div className="money-row-label"><span>{row.label}</span>{row.left < 0 ? <strong className="short">{t.shortBy(money(-row.left))}</strong> : <strong>{money(row.income)}</strong>}</div>
          <div className="money-track" role="list" aria-label={row.label}>{segments.map(segment => {
            const value = valueOf(row, segment)
            if (value <= 0) return null
            const active = focus?.row === row.id && focus.segment === segment
            const show = () => setFocus({ row: row.id, segment })
            const hide = () => setFocus(null)
            return <span key={segment} role="listitem" tabIndex={0} aria-label={describe(row, segment)} className={`money-segment segment-${segment} ${focus && !active ? 'dim' : ''}`}
              style={{ flexBasis: `${value / scale * 100}%` }} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide} />
          })}</div>
        </div>)}</div>
        <p className="chart-readout" aria-hidden>{focus && focusedRow ? `${focusedRow.label} · ${describe(focusedRow, focus.segment)}` : ' '}</p>
        <div className="chart-legend">{segments.filter(segment => segment !== 'wishlist' || totals.wishlist > 0).map(segment =>
          <span key={segment}><i className={`legend-swatch segment-${segment}`} />{t.segmentNames[segment]} <strong>{money(valueOf(rows[0], segment))}</strong></span>)}</div>
        {people.length > 0 && <p className="split-note" data-testid="split-note">{t.splitNote(budget.split, people.map(row => `${row.person.name} ${percent(row.share)}`).join(' · '))}</p>}
      </div>
      <div className="chart-card">
        <h3>{t.categoryChartTitle}</h3>
        <p className="chart-hint">{t.categoryChartHint}</p>
        {categories.length ? <ul className="category-bars">{categories.map(({ category, amount }) => <li key={category?.id ?? 'uncategorized'}>
          <span className="category-bar-label"><i className={`category-dot color-${category?.color ?? 'neutral'}`} /><span>{category?.name ?? t.uncategorized}</span></span>
          <span className="category-bar-track"><span className="category-bar" style={{ width: `${amount / largest * 100}%` }} /></span>
          <span className="category-bar-value">{money(amount)}<small>{percent(amount / totals.expenses)}</small></span>
        </li>)}</ul> : <p className="empty-category">{t.noExpenses}</p>}
      </div>
    </div>
  </section>
}
