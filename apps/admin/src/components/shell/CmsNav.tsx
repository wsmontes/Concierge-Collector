import type { ReactNode } from 'react'

export interface CmsNavItem {
  href: string
  label: string
}

export interface CmsNavGroup {
  emptyState: string
  items: CmsNavItem[]
  label: 'Overview' | 'Content' | 'Distribution' | 'Operations' | 'Administration'
}

export const CMS_NAV_GROUPS: readonly CmsNavGroup[] = [
  {
    label: 'Overview',
    items: [{ href: '/admin', label: 'Dashboard' }],
    emptyState: 'Overview is ready.',
  },
  {
    label: 'Content',
    items: [],
    emptyState: 'Content tools will appear here when available.',
  },
  {
    label: 'Distribution',
    items: [],
    emptyState: 'Distribution tools will appear here when available.',
  },
  {
    label: 'Operations',
    items: [],
    emptyState: 'Operations tools will appear here when available.',
  },
  {
    label: 'Administration',
    items: [],
    emptyState: 'Administration tools will appear here when available.',
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
          {group.items.length > 0 ? (
            <ul>
              {group.items.map((item) => (
                <li key={item.href}>
                  <a href={item.href}>{item.label}</a>
                </li>
              ))}
            </ul>
          ) : (
            <p role="status">{group.emptyState}</p>
          )}
        </section>
      ))}
    </nav>
  )
}
