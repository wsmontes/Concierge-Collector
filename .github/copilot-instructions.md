Project Standards

Apply industry best practices: Clean Architecture, SOLID principles, and strict separation of concerns.

Every file must begin with a header comment describing its purpose, main responsibilities, and dependencies.

All comments must be clear, meaningful, and consistent—no vague, historical, or removed-code comments.

Leave all files in a complete, functional state after any change. Update all dependent files and headers as needed.

Code and comments must be understandable by an AI or new developer with zero project context. No assumptions.

Never include mock, fake, or sample data in code. Only use real implementations, or clearly labeled fallbacks.

If a requested feature cannot be fully implemented, state this clearly in the code and propose valid alternatives.

Never introduce new diagnostic or utility files—analyze and fix the actual codebase instead.

Never break working code when modifying or extending features. Prefer fixing or refactoring existing code over new code.

Always use the ModuleWrapper pattern for creating and extending modules.

All class properties and methods must use this. for both data and function access.

Global variables are not allowed. Attach all state and methods to classes or a dedicated namespace.

Centralize all configuration, API keys, and constants in config.js only. Never declare these elsewhere.

All initialization (modules, services, app state) must be managed from the main entry point (main.js). Modules should register themselves for initialization, but not auto-initialize on load.

Do NOT use ES6 imports/exports or require(). Only use the ModuleWrapper pattern and include scripts via <script> tags. ES6 modules are not allowed.

Declare all dependencies at the top of every module.

Do not alter the script load order. main.js must always serve as the app entry point.

Ask me questions in case of ambiguity or uncertainty. I will provide clarifications and examples as needed.

Always write the whole code. Don't leave it incomplete. If you can't finish the code, explain why and suggest alternatives.

Don't create documentation if not requested. Focus on code only unless I specifically ask for docs.
