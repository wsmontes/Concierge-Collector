import type { SVGProps } from 'react'

/**
 * Ícones do Admin — desenhados aqui, sem dependência nova.
 *
 * São oito traços de 1.5px na grelha de 16: o suficiente para o menu e as ações
 * da casca. A alternativa (uma biblioteca de ícones) traria um pacote inteiro
 * para oito glifos e uma segunda linguagem visual ao lado da que o Payload já
 * usa nos próprios controles.
 *
 * Todos são `aria-hidden` por padrão: o nome acessível vem do texto ao lado, e
 * um `<svg>` sem rótulo anunciado duas vezes é ruído para leitor de tela.
 */
type IconProps = SVGProps<SVGSVGElement>

function Base({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="16"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 16 16"
      width="16"
      {...props}
    >
      {children}
    </svg>
  )
}

export function IconDashboard(props: IconProps) {
  return (
    <Base {...props}>
      <rect height="5.5" rx="1" width="5.5" x="2" y="2" />
      <rect height="5.5" rx="1" width="5.5" x="8.5" y="2" />
      <rect height="5.5" rx="1" width="5.5" x="2" y="8.5" />
      <rect height="5.5" rx="1" width="5.5" x="8.5" y="8.5" />
    </Base>
  )
}

export function IconCurations(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M3 4.5h10M3 8h10M3 11.5h6" />
    </Base>
  )
}

export function IconEntities(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 1 0-9 0C3.5 9.8 8 14 8 14Z" />
      <circle cx="8" cy="6.5" r="1.6" />
    </Base>
  )
}

export function IconCollections(props: IconProps) {
  return (
    <Base {...props}>
      <path d="m8 2 5.5 3-5.5 3-5.5-3 5.5-3Z" />
      <path d="m3 8.5 5 2.7 5-2.7" />
      <path d="m3 11.5 5 2.7 5-2.7" />
    </Base>
  )
}

export function IconApplications(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="5.5" cy="8" r="2.5" />
      <path d="M8 8h6M12 8v2.5M10 8v2" />
    </Base>
  )
}

export function IconOperations(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M2.5 8.5h3l1.5-4 2.5 8 1.5-4h3" />
    </Base>
  )
}

export function IconOverview(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="8" cy="8" r="5.5" />
      <path d="M8 5v3.2l2 1.4" />
    </Base>
  )
}

export function IconSun(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1" />
    </Base>
  )
}

export function IconMoon(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M13 9.6A5.6 5.6 0 0 1 6.4 3a5.6 5.6 0 1 0 6.6 6.6Z" />
    </Base>
  )
}

export function IconSearch(props: IconProps) {
  return (
    <Base {...props}>
      <circle cx="7" cy="7" r="4.5" />
      <path d="m10.5 10.5 3 3" />
    </Base>
  )
}

export function IconKeyboard(props: IconProps) {
  return (
    <Base {...props}>
      <rect height="7" rx="1.5" width="13" x="1.5" y="4.5" />
      <path d="M4 7h1M7 7h1M10 7h1M5 9.5h6" />
    </Base>
  )
}

export function IconLogOut(props: IconProps) {
  return (
    <Base {...props}>
      <path d="M6 13.5H4a1.5 1.5 0 0 1-1.5-1.5V4A1.5 1.5 0 0 1 4 2.5h2" />
      <path d="M10 11l3-3-3-3M13 8H6" />
    </Base>
  )
}

/** Ícone de um grupo do menu, por chave declarada em `nav-groups.ts`. */
export const NAV_ICONS: Record<string, (props: IconProps) => React.JSX.Element> = {
  applications: IconApplications,
  collections: IconCollections,
  curations: IconCurations,
  dashboard: IconDashboard,
  entities: IconEntities,
  operations: IconOperations,
  overview: IconOverview,
}
