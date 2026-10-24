'use client'

import { useEffect } from 'react'
import { fieldValidationMessage, isValidatableField, type ValidatableField } from './form-validation'

// One presenter covers native validation in every admin form, including dialogs.
// It only owns the feedback nodes and attributes it adds, leaving form rules intact.
export function AdminFormFeedback() {
  useEffect(() => {
    const feedback = new Map<ValidatableField, { message: globalThis.HTMLSpanElement; invalid: string | null }>()
    let nextId = 0
    let focusQueued = false

    const clear = (field: ValidatableField) => {
      const entry = feedback.get(field)
      if (!entry) return
      const descriptions = (field.getAttribute('aria-describedby') ?? '').split(/\s+/).filter((id) => id && id !== entry.message.id)
      if (descriptions.length) field.setAttribute('aria-describedby', descriptions.join(' '))
      else field.removeAttribute('aria-describedby')
      if (entry.invalid === null) field.removeAttribute('aria-invalid')
      else field.setAttribute('aria-invalid', entry.invalid)
      field.removeAttribute('data-inline-invalid')
      entry.message.remove()
      feedback.delete(field)
    }

    const show = (field: ValidatableField) => {
      let entry = feedback.get(field)
      if (!entry) {
        const message = document.createElement('span')
        message.id = `admin-field-feedback-${++nextId}`
        message.className = 'admin-input-error'
        message.setAttribute('data-field-feedback', '')
        message.setAttribute('aria-live', 'polite')
        entry = { message, invalid: field.getAttribute('aria-invalid') }
        feedback.set(field, entry)
        field.insertAdjacentElement('afterend', message)
        field.setAttribute('aria-describedby', [field.getAttribute('aria-describedby'), message.id].filter(Boolean).join(' '))
      }
      entry.message.textContent = fieldValidationMessage(field)
      field.setAttribute('aria-invalid', 'true')
      field.setAttribute('data-inline-invalid', '')
    }

    const invalid = (event: globalThis.Event) => {
      if (!isValidatableField(event.target)) return
      event.preventDefault()
      const field = event.target
      show(field)
      // Native validation fires once for each invalid control. Focus the first.
      if (!focusQueued) {
        focusQueued = true
        globalThis.queueMicrotask(() => { if (field.isConnected) field.focus(); focusQueued = false })
      }
    }
    const input = (event: globalThis.Event) => {
      if (!isValidatableField(event.target) || !feedback.has(event.target)) return
      if (event.target.validity.valid) clear(event.target)
      else show(event.target)
    }
    const reset = (event: globalThis.Event) => {
      for (const field of feedback.keys()) if (field.form === event.target) clear(field)
    }
    const observer = new globalThis.MutationObserver(() => {
      for (const field of feedback.keys()) if (!field.isConnected) clear(field)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener('invalid', invalid, true)
    document.addEventListener('input', input, true)
    document.addEventListener('change', input, true)
    document.addEventListener('reset', reset, true)
    return () => {
      observer.disconnect()
      document.removeEventListener('invalid', invalid, true)
      document.removeEventListener('input', input, true)
      document.removeEventListener('change', input, true)
      document.removeEventListener('reset', reset, true)
      for (const field of feedback.keys()) clear(field)
    }
  }, [])
  return null
}
