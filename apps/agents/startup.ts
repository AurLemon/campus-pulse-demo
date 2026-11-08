import { randomUUID } from 'node:crypto'
import { configure, setting, store } from './store.ts'
import {
	readTaskBudget,
	setTaskBudgetUnlimited,
} from '../../tools/content/budget.ts'

/** Restore the persistent unattended startup policy after ledger reconciliation. */
export async function startAutomaticScheduling() {
	const budget = await readTaskBudget()
	if (budget.stopped) throw new Error(`BUDGET_STOPPED:${budget.stopped}`)
	const previous = {
		enabled: setting('enabled', false),
		pauseReason: setting<string | null>('pauseReason', null),
		decisionLimit: setting('decisionLimit', 200),
		budgetUnlimited: budget.unlimited,
	}
	if (!budget.unlimited) await setTaskBudgetUnlimited(true)
	store.exec(`CREATE TABLE IF NOT EXISTS scheduler_starts (
		id TEXT PRIMARY KEY, startedAt TEXT NOT NULL, previousState TEXT NOT NULL
	)`)
	store.transaction(() => {
		store
			.prepare(
				'INSERT INTO scheduler_starts(id,startedAt,previousState) VALUES(?,?,?)',
			)
			.run(randomUUID(), new Date().toISOString(), JSON.stringify(previous))
		configure('decisionLimit', 0)
		configure('pauseReason', null)
		configure('enabled', true)
	})()
}
