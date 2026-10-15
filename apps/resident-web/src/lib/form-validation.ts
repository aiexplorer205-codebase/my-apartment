import type { FormEvent } from 'react'

type ValidatableField =
  | InstanceType<typeof globalThis.HTMLInputElement>
  | InstanceType<typeof globalThis.HTMLSelectElement>
  | InstanceType<typeof globalThis.HTMLTextAreaElement>

const isValidatableField = (target: unknown): target is ValidatableField =>
  target instanceof globalThis.HTMLInputElement
  || target instanceof globalThis.HTMLSelectElement
  || target instanceof globalThis.HTMLTextAreaElement

export const formValidationMessage = (event: FormEvent<globalThis.HTMLFormElement>, setMessage: (message: string) => void) => {
  event.preventDefault()
  if (!isValidatableField(event.target)) {
    setMessage('Please review the highlighted fields and try again.')
    return
  }

  const field = event.target
  const label = field.labels?.[0]?.textContent?.trim().replace(/\s+/g, ' ') || field.getAttribute('aria-label') || 'This field'
  const { validity } = field

  if (validity.valueMissing) {
    setMessage(label.startsWith('Pay ·') ? 'Please enter valid amount to pay' : `${label} is required.`)
  } else if (validity.typeMismatch && field instanceof globalThis.HTMLInputElement && field.type === 'email') {
    setMessage('Enter an email address in the format name@example.com.')
  } else if (validity.tooShort && field instanceof globalThis.HTMLInputElement) {
    setMessage(`${label} must be at least ${field.minLength} characters.`)
  } else if (validity.tooLong && field instanceof globalThis.HTMLInputElement) {
    setMessage(`${label} must be no more than ${field.maxLength} characters.`)
  } else if (validity.badInput) {
    setMessage(`Enter a valid value for ${label.toLowerCase()}.`)
  } else if (validity.rangeUnderflow || validity.rangeOverflow) {
    if (field instanceof globalThis.HTMLInputElement) {
      const range = field.min && field.max
        ? `between ${field.min} and ${field.max}`
        : field.min
          ? `of at least ${field.min}`
          : `of no more than ${field.max}`
      setMessage(`Enter ${label.toLowerCase()} ${range}.`)
    } else {
      setMessage(`Check ${label.toLowerCase()} and try again.`)
    }
  } else if (validity.stepMismatch) {
    setMessage(`${label} has an unsupported value. Check the allowed increments.`)
  } else if (validity.patternMismatch) {
    setMessage(`Check the format for ${label.toLowerCase()}.`)
  } else {
    setMessage(`Check ${label.toLowerCase()} and try again.`)
  }

  field.focus()
}
