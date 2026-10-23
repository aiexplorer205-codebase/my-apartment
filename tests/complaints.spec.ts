import { describe, expect, it } from 'vitest'
import { validateComplaintTransition } from '../apps/api/src/complaints.ts'

describe('complaint resolution permissions', () => {
  it('requires a public resolution note', () => {
    expect(() => validateComplaintTransition('admin', 'In progress', 'Resolved', '')).toThrow('public resolution note')
    expect(() => validateComplaintTransition('admin', 'In progress', 'Resolved', 'Pipe repaired and tested.')).not.toThrow()
  })
  it('reserves acceptance for the resident', () => {
    expect(() => validateComplaintTransition('admin', 'Resolved', 'Closed', 'Done')).toThrow('resident must accept')
    expect(() => validateComplaintTransition('resident', 'Resolved', 'Closed', '')).not.toThrow()
  })
  it('allows residents to reopen only resolved requests with a reason', () => {
    expect(() => validateComplaintTransition('resident', 'Resolved', 'Open', '')).toThrow('reopening')
    expect(() => validateComplaintTransition('resident', 'Resolved', 'Open', 'Water is still leaking.')).not.toThrow()
    expect(() => validateComplaintTransition('resident', 'Open', 'In progress', 'Please hurry')).toThrow('accept or reopen')
    expect(() => validateComplaintTransition('resident', 'Closed', 'Open', 'Still leaking')).toThrow()
  })
  it('does not allow an administrator to revive a closed request', () => {
    expect(() => validateComplaintTransition('admin', 'Closed', 'Open', 'Retry')).toThrow('closed')
  })
})
