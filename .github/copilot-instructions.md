# Project Standards

- Always apply industry best practices (Clean Architecture, SOLID, etc.).
- Every file must start with a header comment stating its purpose and dependencies.
- No historical or “removed code” comments—only current, relevant notes.
- Any change must leave the file in a complete, final state and automatically update all dependent files (with their headers adjusted).
- Comments must be meaningful, consistent, and non-contradictory.
- Do not introduce mock or fake data; provide real implementations or clearly labeled fallbacks.
- If a requested feature can’t be fully implemented, state that fact and propose valid alternatives.
- Write code and comments so they’re intelligible to an AI with no prior context.
- Don't include data samples in the code as a fallback. Never.
- Don't break what is working while changing other stuff.