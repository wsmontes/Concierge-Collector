import type { ReactNode } from 'react'

export interface CmsNavItem {
  href: string
  label: string
}

export interface CmsNavGroup {
  items: CmsNavItem[]
  label: 'Overview' | 'Content' | 'Distribution' | 'Operations'
}

export const CMS_NAV_GROUPS: readonly CmsNavGroup[] = [
  {
    label: 'Overview',
    items: [{ href: '/admin', label: 'Dashboard' }],
  },
  {
    label: 'Content',
    items: [
      { href: '/admin/collections/collections', label: 'Collections' },
      { href: '/admin/explorer', label: 'Curation Explorer' },
    ],
  },
  {
    label: 'Distribution',
    items: [
      { href: '/admin/applications', label: 'Applications' },
      { href: '/admin/collections/consumer-applications', label: 'Consumer Applications (records)' },
      { href: '/admin/collections/consumer-credentials', label: 'Consumer Credentials (records)' },
    ],
  },
  {
    label: 'Operations',
    items: [{ href: '/admin/operations', label: 'Operations' }],
  },
]

function Brand({ children }: { children: ReactNode }) {
  return <span className="cms-brand">{children}</span>
}

export function CmsIcon() {
  return <Brand>CC</Brand>
}

export function CmsLogo() {
  return <Brand>Concierge Collector</Brand>
}

export function CmsNav() {
  return (
    <nav aria-label="Concierge CMS">
      {CMS_NAV_GROUPS.map((group) => (
        <section className="cms-nav-group" key={group.label} aria-labelledby={`cms-nav-${group.label}`}>
          <h2 id={`cms-nav-${group.label}`}>{group.label}</h2>
          <ul>
            {group.items.map((item) => (
              <li key={item.href}>
                <a href={item.href}>{item.label}</a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </nav>
  )
}
