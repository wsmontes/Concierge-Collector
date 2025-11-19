# 🧪 Testing Guide - Concierge Collector V3

## Stack

- **Vitest** - Fast unit test framework (Vite-native)
- **@testing-library/svelte** - Component testing utilities
- **@testing-library/user-event** - Realistic user interactions
- **jsdom** - DOM environment simulation
- **@testing-library/jest-dom** - Custom matchers for DOM assertions

## Running Tests

```bash
# Run tests in watch mode (recommended for development)
npm test

# Run tests once (CI/CD)
npm run test:run

# Open Vitest UI (interactive dashboard)
npm run test:ui

# Run with coverage report
npm run test:coverage
```

## Test Structure

```
src/
├── lib/
│   ├── components/
│   │   ├── Button.svelte
│   │   └── Button.test.ts          ← Component tests
│   ├── stores/
│   │   ├── curations.ts
│   │   └── curations.test.ts       ← Store/logic tests
│   ├── utils/
│   │   ├── helpers.ts
│   │   └── helpers.test.ts         ← Utility tests
│   └── test/
│       └── setup.ts                 ← Global test configuration
├── routes/
│   └── +page.test.ts                ← Integration tests (optional)
```

## Best Practices (Svelte 5)

### 1. Component Tests

Use `@testing-library/svelte` for component testing:

```typescript
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import Button from './Button.svelte';

test('handles click events', async () => {
	const user = userEvent.setup();
	let clicked = false;

	render(Button, { 
		props: { 
			onclick: () => { clicked = true; }
		} 
	});

	await user.click(screen.getByRole('button'));
	expect(clicked).toBe(true);
});
```

**Key Points:**
- ✅ Test user interactions, not implementation details
- ✅ Use semantic queries (`getByRole`, `getByLabelText`, `getByText`)
- ✅ Use `userEvent` for realistic interactions (not `fireEvent`)
- ❌ Don't test CSS classes or internal state directly
- ❌ Don't access component internals (use public API)

### 2. Store/Logic Tests

Test reactive logic without components:

```typescript
import { expect, test } from 'vitest';
import { get } from 'svelte/store';
import { curations } from './curations';

test('can add new curation', () => {
	const newCuration = { id: '1', title: 'Test', /* ... */ };
	
	curations.update(items => [...items, newCuration]);
	
	const value = get(curations);
	expect(value).toContainEqual(newCuration);
});
```

### 3. Effects Tests (Svelte 5 Runes)

When testing code with `$effect`, wrap in `$effect.root`:

```typescript
import { flushSync } from 'svelte';

test('effect runs on state change', () => {
	const cleanup = $effect.root(() => {
		let count = $state(0);
		let doubled = $state(0);

		$effect(() => {
			doubled = count * 2;
		});

		flushSync(); // Run effects synchronously
		expect(doubled).toBe(0);

		count = 5;
		flushSync();
		expect(doubled).toBe(10);
	});

	cleanup();
});
```

### 4. Utility/Helper Tests

Pure functions are easiest to test:

```typescript
import { expect, test } from 'vitest';
import { formatDate } from './helpers';

test('formats date correctly', () => {
	const date = new Date('2024-01-15');
	expect(formatDate(date)).toBe('Jan 15, 2024');
});
```

## Testing Patterns

### ✅ DO

```typescript
// Test user-visible behavior
test('shows error message on invalid input', async () => {
	const user = userEvent.setup();
	render(LoginForm);
	
	await user.type(screen.getByLabelText(/email/i), 'invalid');
	await user.click(screen.getByRole('button', { name: /submit/i }));
	
	expect(screen.getByText(/invalid email/i)).toBeInTheDocument();
});

// Use descriptive test names
test('disables submit button while loading', () => { /* ... */ });

// Clean up after tests
afterEach(() => {
	curations.set([]);
});
```

### ❌ DON'T

```typescript
// Don't test implementation details
test('sets internal loading state', () => {
	const component = mount(Button);
	component.isLoading = true; // ❌ Accessing internals
});

// Don't use vague test names
test('it works', () => { /* ... */ });

// Don't forget cleanup
test('adds item', () => {
	store.add(item);
	// ❌ No cleanup - affects other tests
});
```

## Useful Queries (Testing Library)

```typescript
// By role (BEST - semantic, accessible)
screen.getByRole('button', { name: /submit/i })
screen.getByRole('textbox', { name: /email/i })
screen.getByRole('heading', { level: 1 })

// By label (forms)
screen.getByLabelText(/email address/i)

// By text
screen.getByText(/welcome back/i)

// By test ID (last resort)
screen.getByTestId('custom-element')
```

## Custom Matchers (jest-dom)

```typescript
expect(button).toBeInTheDocument()
expect(button).toBeDisabled()
expect(button).toHaveClass('btn-primary')
expect(input).toHaveValue('test')
expect(element).toHaveTextContent(/hello/i)
expect(link).toHaveAttribute('href', '/home')
```

## Debugging Tests

```typescript
// Print current DOM
import { screen } from '@testing-library/svelte';
screen.debug(); // Prints entire DOM
screen.debug(element); // Prints specific element

// Use queries to find elements
screen.logTestingPlaygroundURL(); // Suggests better queries

// Check if element exists
expect(screen.queryByText(/not found/i)).not.toBeInTheDocument();
```

## Coverage Goals

- **Components**: 80%+ coverage
- **Stores/Logic**: 90%+ coverage
- **Utils**: 95%+ coverage
- **Focus**: Critical paths (auth, data persistence, API calls)

## CI/CD Integration

Add to your CI pipeline:

```yaml
- name: Run tests
  run: npm run test:run

- name: Check coverage
  run: npm run test:coverage
```

## Resources

- [Vitest Docs](https://vitest.dev/)
- [Testing Library Docs](https://testing-library.com/docs/svelte-testing-library/intro)
- [Svelte 5 Testing Guide](https://svelte.dev/docs/svelte/testing)
- [Testing Library Queries](https://testing-library.com/docs/queries/about)

## Examples

See:
- `src/lib/components/Button.test.ts` - Component testing
- `src/lib/stores/curations.test.ts` - Store testing
