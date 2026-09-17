import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'
import { AdminSection } from '../../../../src/components/ui/AdminPage'
import { CurationOutline } from '../../../../src/components/curations/CurationOutline'

afterEach(cleanup)

/**
 * The outline is derived from section titles, so these cases are about the two
 * things that can go wrong: it appearing where it adds nothing (two sections),
 * and an item pointing at a section that is not there.
 */
describe('CurationOutline', () => {
  test('lists the sections and points each item at the section it names', () => {
    const sections = ['About', 'Concepts', 'Media & sources', 'Advanced']
    render(
      <>
        <CurationOutline sections={sections} />
        {sections.map((title) => (
          <AdminSection key={title} title={title}>
            {title} body
          </AdminSection>
        ))}
      </>,
    )

    const outline = screen.getByRole('navigation', { name: 'On this page' })
    const items = within(outline).getAllByRole('link')
    expect(items.map((item) => item.textContent)).toEqual(sections)

    for (const item of items) {
      const heading = screen.getByRole('heading', { level: 2, name: item.textContent ?? '' })
      expect(item).toHaveAttribute('href', `#${heading.id}`)
      expect(document.getElementById(heading.id)).not.toBeNull()
    }
  })

  test('stays out of the way when there is nothing to navigate', () => {
    render(<CurationOutline sections={['About', 'History']} />)
    expect(screen.queryByRole('navigation', { name: 'On this page' })).toBeNull()
  })

  test('marks the section the reader jumped to and clears the previous one', () => {
    render(<CurationOutline sections={['About', 'Concepts', 'Advanced']} />)

    const outline = screen.getByRole('navigation', { name: 'On this page' })
    const about = within(outline).getByRole('link', { name: 'About' })
    const advanced = within(outline).getByRole('link', { name: 'Advanced' })
    expect(about).toHaveAttribute('aria-current', 'location')

    fireEvent.click(advanced)

    expect(advanced).toHaveAttribute('aria-current', 'location')
    expect(about).not.toHaveAttribute('aria-current')
  })
})
