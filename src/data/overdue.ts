import type { LoanRequest } from './lending.ts'

/** "45 minutes", "3 hours", "2 days": the largest whole unit, never rounded up. */
export function overdueSpan(minutes: number): string {
  const safe = Number.isFinite(minutes) && minutes > 0 ? Math.floor(minutes) : 0
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
  if (safe >= 1440) return unit(Math.floor(safe / 1440), 'day')
  if (safe >= 60) return unit(Math.floor(safe / 60), 'hour')
  return unit(Math.max(safe, 1), 'minute')
}

const first = (name: string) => name.split(' ')[0] ?? name

/** One line telling the viewer what is late, and what to do. Null when nothing is late. */
export function overdueNotice(loan: LoanRequest, lending: boolean): string | null {
  const item = loan.itemName.toLowerCase()
  if (loan.overdue) {
    const span = overdueSpan(loan.overdueMinutes ?? 0)
    return lending
      ? `${first(loan.borrowerName ?? 'Your neighbor')} still has your ${item}. It was due back ${span} ago.`
      : `Your ${item} is ${span} overdue. Please return it to ${first(loan.lenderName)}.`
  }
  if (loan.dueSoon) {
    return `Your ${item} is due back soon (${loan.returnLabel}).`
  }
  return null
}

export function overdueCount(loans: readonly LoanRequest[]): number {
  return loans.filter((loan) => loan.overdue).length
}
