'use client'

import type { ReactNode } from 'react'

/**
 * Campo de formulário: rótulo, descrição, erro e controle num só lugar, com o
 * vínculo `htmlFor`/`aria-describedby` feito pelo próprio componente.
 *
 * Havia 49 arquivos com controle nativo e par rótulo/controle reinventado, cada
 * um com um jeito de marcar erro — e nenhum com `aria-invalid`.
 */
export function Field({
  label,
  description,
  error,
  required = false,
  htmlFor,
  children,
  className = '',
}: {
  label: string
  description?: string
  error?: string
  required?: boolean
  htmlFor?: string
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`ui-field ${className}`.trim()}>
      <label className="ui-field__label" htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="ui-field__required" aria-hidden="true">
            *
          </span>
        )}
      </label>
      {description && (
        <p className="ui-field__description" id={htmlFor ? `${htmlFor}-description` : undefined}>
          {description}
        </p>
      )}
      {children}
      {error && (
        <p className="ui-field__error" id={htmlFor ? `${htmlFor}-error` : undefined} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export function TextInput({
  label,
  description,
  error,
  id,
  value,
  onChange,
  placeholder,
  type = 'text',
  required = false,
  disabled = false,
  mono = false,
  autoFocus = false,
  onKeyDown,
}: {
  label: string
  description?: string
  error?: string
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  type?: 'text' | 'search' | 'url' | 'email' | 'number'
  required?: boolean
  disabled?: boolean
  /** Valor técnico (id, slug, chave): mono, para bater com o resto do Admin. */
  mono?: boolean
  autoFocus?: boolean
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void
}) {
  return (
    <Field description={description} error={error} htmlFor={id} label={label} required={required}>
      <input
        aria-describedby={description ? `${id}-description` : undefined}
        aria-invalid={error ? true : undefined}
        autoFocus={autoFocus}
        className="ui-input"
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        required={required}
        style={mono ? { fontFamily: 'var(--cms-font-mono)' } : undefined}
        type={type}
        value={value}
      />
    </Field>
  )
}

export function SelectInput({
  label,
  description,
  error,
  id,
  value,
  onChange,
  options,
  disabled = false,
}: {
  label: string
  description?: string
  error?: string
  id: string
  value: string
  onChange: (value: string) => void
  options: Array<{ label: string; value: string }>
  disabled?: boolean
}) {
  return (
    <Field description={description} error={error} htmlFor={id} label={label}>
      <select
        aria-describedby={description ? `${id}-description` : undefined}
        aria-invalid={error ? true : undefined}
        className="ui-select"
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </Field>
  )
}

export function TextareaInput({
  label,
  description,
  error,
  id,
  value,
  onChange,
  rows = 4,
  required = false,
  disabled = false,
}: {
  label: string
  description?: string
  error?: string
  id: string
  value: string
  onChange: (value: string) => void
  rows?: number
  required?: boolean
  disabled?: boolean
}) {
  return (
    <Field description={description} error={error} htmlFor={id} label={label} required={required}>
      <textarea
        aria-describedby={description ? `${id}-description` : undefined}
        aria-invalid={error ? true : undefined}
        className="ui-textarea"
        disabled={disabled}
        id={id}
        onChange={(event) => onChange(event.target.value)}
        required={required}
        rows={rows}
        value={value}
      />
    </Field>
  )
}

export function CheckboxInput({
  label,
  id,
  checked,
  onChange,
  disabled = false,
  description,
}: {
  label: string
  id: string
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  description?: string
}) {
  return (
    <div className="ui-field">
      <div className="ui-checkbox">
        <input
          checked={checked}
          disabled={disabled}
          id={id}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        <label className="ui-field__label" htmlFor={id}>
          {label}
        </label>
      </div>
      {description && <p className="ui-field__description">{description}</p>}
    </div>
  )
}
