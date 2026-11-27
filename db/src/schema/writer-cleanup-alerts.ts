import { sql } from 'drizzle-orm';
import { pgTable, integer, text, check } from 'drizzle-orm/pg-core';

// Persist only the current warning-code signature for transition-only log alerts.
export const writerCleanupAlertState = pgTable('writer_cleanup_alert_state', {
  id: integer('id').primaryKey().default(1),
  warningState: text('warning_state'),
}, t => [check('writer_cleanup_alert_singleton', sql`${t.id}=1`)]);
