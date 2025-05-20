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
- Always prefer fixing the code over introducing new code.
- Avoid creating diagnostic utilities; instead, analyze the code and fix it.
- Don't break what is working while changing other stuff.

Follow these structural and coding rules at all times when editing or generating code for this project:

1. File and Directory Organization
Only one class/module per file.

Each feature/module has its own file in /modules/featureName/ModuleName.js or /modules/domain/ModuleName.js.

No duplicated or legacy files.

2. Class and Instance Naming
Class names: PascalCase (e.g. RestaurantModule)

Instance names: camelCase (e.g. restaurantModule)

Module file name must match the class name.

3. Global Guards and Singleton Instantiation
Protect all class and instance declarations:

js
Copy
Edit
if (!window.ClassName) { class ClassName { ... }; window.ClassName = ClassName; }
window.className = window.className || new window.ClassName(...);
Only instantiate singletons in main.js and pass dependencies via constructors.

4. Dependency Management
Never access other modules via window inside modules.

Pass dependencies as constructor arguments, assign to this.

5. App Initialization
Only main.js is allowed to initialize and wire up modules.

Create all major objects in order, and assign to window for debug only.

6. DOM and Events
All UI logic and DOM manipulation must be inside UI/view classes.

Always check for or remove old event listeners before adding new ones.

Use event delegation for dynamic lists.

7. Constants and Config
Place all magic values in a config/constants file.

Reference app-wide settings via a central config object.

8. Documentation
Add a file header with purpose, dependencies, usage.

Briefly document non-trivial methods.

9. Extension Points
Use registerX pattern for extensibility.

Document extension points and accepted formats.

10. Error Handling
Methods must handle and log their own errors.

Never fail silently.

11. Code Style
Consistent formatting, naming, and commenting.

Explain and comment any exception to the rules.

12. Security
Never hardcode secrets or sensitive info.

Validate/sanitize all user input.

Namespace storage keys by app name and version.

Never use import/export.
Never access other modules via window except in main.js.
Do not pollute the global scope.
Do not write or duplicate code outside these standards.
Always follow these rules.