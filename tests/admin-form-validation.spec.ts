import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { FormEvent } from 'react'
import { fieldValidationMessage, formValidationMessage, type ValidatableField } from '../apps/admin-web/src/lib/form-validation'

// Exercise native validity states without changing the constraints on any form.
class InputField {
  labels = undefined
  type = 'text'
  min = ''
  max = ''
  minLength = 2
  maxLength = 120
  validity: Partial<ValidityState> = {}
  inline = false
  focus = vi.fn()
  getAttribute = (name: string) => name === 'aria-label' ? 'Customer name' : null
  hasAttribute = (name: string) => name === 'data-inline-invalid' && this.inline
}

const message = (field: InputField) => fieldValidationMessage(field as unknown as ValidatableField)

describe('admin field validation messages', () => {
  beforeEach(() => {
    vi.stubGlobal('HTMLInputElement', InputField)
    vi.stubGlobal('HTMLSelectElement', class {})
    vi.stubGlobal('HTMLTextAreaElement', class {})
  })
  afterEach(() => vi.unstubAllGlobals())

  it('identifies the missing field', () => {
    const field = new InputField()
    field.validity = { valueMissing: true }
    expect(message(field)).toBe('Customer name is required.')
  })

  it('explains malformed email and short text', () => {
    const field = new InputField()
    field.type = 'email'
    field.validity = { typeMismatch: true }
    expect(message(field)).toBe('Enter an email address in the format name@example.com.')
    field.validity = { tooShort: true }
    expect(message(field)).toBe('Customer name must be at least 2 characters.')
  })

  it('preserves numeric range and step guidance', () => {
    const field = new InputField()
    field.min = '1'
    field.max = '200'
    field.validity = { rangeOverflow: true }
    expect(message(field)).toBe('Enter customer name between 1 and 200.')
    field.validity = { stepMismatch: true }
    expect(message(field)).toContain('Check the allowed increments.')
  })

  it('avoids duplicating an inline error in a form banner', () => {
    const field = new InputField()
    field.inline = true
    const setMessage = vi.fn()
    const preventDefault = vi.fn()
    formValidationMessage({ target: field, preventDefault } as unknown as FormEvent<HTMLFormElement>, setMessage)
    expect(preventDefault).toHaveBeenCalled()
    expect(setMessage).not.toHaveBeenCalled()
    expect(field.focus).not.toHaveBeenCalled()
  })

  it('retains the fallback for a form without the shared presenter', () => {
    const field = new InputField()
    field.validity = { valueMissing: true }
    const setMessage = vi.fn()
    formValidationMessage({ target: field, preventDefault: vi.fn() } as unknown as FormEvent<HTMLFormElement>, setMessage)
    expect(setMessage).toHaveBeenCalledWith('Customer name is required.')
    expect(field.focus).toHaveBeenCalledOnce()
  })
})
