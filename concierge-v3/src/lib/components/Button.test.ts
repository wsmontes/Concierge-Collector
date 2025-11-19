/**
 * Button Component Tests
 * Purpose: Test Button component variants, sizes, and interactions
 * 
 * Best Practices:
 * - Use @testing-library/svelte for component testing
 * - Test user interactions, not implementation details
 * - Use semantic queries (getByRole, getByText)
 */

import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { expect, test, describe } from 'vitest';
import Button from './Button.svelte';

describe('Button Component', () => {
	test('renders as button element', () => {
		const { container } = render(Button);
		
		const button = container.querySelector('button');
		expect(button).toBeInTheDocument();
		expect(button).toHaveClass('btn');
	});

	test('handles click events', async () => {
		const user = userEvent.setup();
		let clicked = false;

		const { container } = render(Button, { 
			props: { 
				onclick: () => { clicked = true; }
			} 
		});

		const button = container.querySelector('button')!;
		await user.click(button);

		expect(clicked).toBe(true);
	});

	test('renders as link when href provided', () => {
		const { container } = render(Button, { 
			props: { 
				href: '/test'
			} 
		});

		const link = container.querySelector('a');
		expect(link).toBeInTheDocument();
		expect(link).toHaveAttribute('href', '/test');
	});

	test('applies variant classes', () => {
		render(Button, { 
			props: { 
				variant: 'primary',
				children: () => 'Primary'
			} 
		});

		const button = screen.getByRole('button');
		expect(button).toHaveClass('bg-teal-600');
	});

	test('disables button when disabled prop is true', () => {
		render(Button, { 
			props: { 
				disabled: true,
				children: () => 'Disabled'
			} 
		});

		const button = screen.getByRole('button');
		expect(button).toBeDisabled();
	});

	test('shows loading state', () => {
		render(Button, { 
			props: { 
				loading: true,
				children: () => 'Loading'
			} 
		});

		const button = screen.getByRole('button');
		expect(button).toHaveTextContent('⏳');
		expect(button).toBeDisabled();
	});
});
