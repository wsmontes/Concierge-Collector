import { expect } from 'vitest'
// jest-dom is hoisted at the repo root (used by the root vitest 1.x frontend
// suite). Its own `vitest.js` entry resolves THAT root vitest, so it would
// register matchers on the wrong expect instance here (vitest 4.1.1).
// Importing the plain matchers and extending the local expect keeps the
// admin suite self-contained.
import * as matchers from '@testing-library/jest-dom/matchers'

expect.extend(matchers)
