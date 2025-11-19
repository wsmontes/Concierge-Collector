/**
 * Chip Component Tests
 * Purpose: Test Chip component variants and remove functionality
 */

import { render } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { expect, test, describe } from 'vitest';
import Chip from './Chip.svelte';

describe('Chip Component', () => {
	test('renders with default props', () => {
		const { container } = render(Chip);
		
		const chip = container.querySelector('.inline-flex');
		expect(chip).toBeInTheDocument();
		expect(chip).toHaveClass('rounded-full');
	});

	test('applies primary variant', () => {
		const { container } = render(Chip, { props: { variant: 'primary' } });
		
		const chip = container.querySelector('.inline-flex');
		expect(chip).toHaveClass('bg-teal-100', 'text-teal-800');
	});

	test('applies secondary variant', () => {
		const { container } = render(Chip, { props: { variant: 'secondary' } });
		
		const chip = container.querySelector('.inline-flex');
		expect(chip).toHaveClass('bg-amber-100', 'text-amber-800');
	});

	test('applies neutral variant', () => {
		const { container } = render(Chip, { props: { variant: 'neutral' } });
		
		const chip = container.querySelector('.inline-flex');
		expect(chip).toHaveClass('bg-neutral-100', 'text-neutral-800');
	});

	test('shows remove button when removable', () => {
		const { container } = render(Chip, { props: { removable: true } });
		
		const button = container.querySelector('button');
		expect(button).toBeInTheDocument();
		expect(button).toHaveAttribute('aria-label', 'Remove');
	});

	test('calls onremove when remove button clicked', async () => {
		const user = userEvent.setup();
		let removed = false;

		const { container } = render(Chip, { 
			props: { 
				removable: true,
				onremove: () => { removed = true; }
			} 
		});

		const button = container.querySelector('button')!;
		await user.click(button);

		expect(removed).toBe(true);
	});

	test('does not show remove button when not removable', () => {
		const { container } = render(Chip, { props: { removable: false } });
		
		const button = container.querySelector('button');
		expect(button).not.toBeInTheDocument();
	});
});
