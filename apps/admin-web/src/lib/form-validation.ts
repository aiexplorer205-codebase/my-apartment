import type { FormEvent } from 'react'

export type ValidatableField =
  | InstanceType<typeof globalThis.HTMLInputElement>
  | InstanceType<typeof globalThis.HTMLSelectElement>
  | InstanceType<typeof globalThis.HTMLTextAreaElement>

export const isValidatableField = (target: unknown): target is ValidatableField =>
  target instanceof globalThis.HTMLInputElement
  || target instanceof globalThis.HTMLSelectElement
  || target instanceof globalThis.HTMLTextAreaElement

export const fieldValidationMessage = (field: ValidatableField): string => {
  const labelContent = field.labels?.[0]?.cloneNode(true) as globalThis.HTMLElement | undefined
  labelContent?.querySelectorAll('[data-field-feedback], [role="alert"], input, select, textarea').forEach((element) => element.remove())
  const labelText = labelContent?.textContent?.trim().replace(/\s+/g, ' ')
  const label = labelText || field.getAttribute('aria-label') || 'This field'
  const { validity } = field

  if (validity.valueMissing) {
    return label.startsWith('Pay ·') ? 'Please enter valid amount to pay' : `${label} is required.`
  } else if (validity.typeMismatch && field instanceof globalThis.HTMLInputElement && field.type === 'email') {
    return 'Enter an email address in the format name@example.com.'
  } else if (validity.tooShort && field instanceof globalThis.HTMLInputElement) {
    return `${label} must be at least ${field.minLength} characters.`
  } else if (validity.tooLong && field instanceof globalThis.HTMLInputElement) {
    return `${label} must be no more than ${field.maxLength} characters.`
  } else if (validity.badInput) {
    return `Enter a valid value for ${label.toLowerCase()}.`
  } else if (validity.rangeUnderflow || validity.rangeOverflow) {
    if (field instanceof globalThis.HTMLInputElement) {
      const range = field.min && field.max
        ? `between ${field.min} and ${field.max}`
        : field.min
          ? `of at least ${field.min}`
          : `of no more than ${field.max}`
      return `Enter ${label.toLowerCase()} ${range}.`
    } else {
      return `Check ${label.toLowerCase()} and try again.`
    }
  } else if (validity.stepMismatch) {
    return `${label} has an unsupported value. Check the allowed increments.`
  } else if (validity.patternMismatch) {
    return `Check the format for ${label.toLowerCase()}.`
  } else {
    return `Check ${label.toLowerCase()} and try again.`
  }
}

export const formValidationMessage = (event: FormEvent<globalThis.HTMLFormElement>, setMessage: (message: string) => void) => {
  event.preventDefault()
  if (!isValidatableField(event.target)) {
    setMessage('Please review the highlighted fields and try again.')
    return
  }
  // The shared presenter already placed this message beside the input.
  if (event.target.hasAttribute('data-inline-invalid')) return
  setMessage(fieldValidationMessage(event.target))
  event.target.focus()
}
