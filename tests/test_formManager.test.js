/**
 * Testes de XSS no FormManager (achado #11 da auditoria 2026-08-18).
 *
 * updateFieldUI interpolava fieldData.errors[0] cru no innerHTML — um
 * validator customizado (ou mensagem vinda de dado externo no futuro)
 * podia injetar markup/script. A regra da casa: qualquer texto dinâmico
 * em innerHTML passa por escape.
 */
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { describe, test, expect, beforeEach, afterEach } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(
  path.resolve(__dirname, '../scripts/managers/formManager.js'),
  'utf8'
);

function loadFormManager() {
  delete globalThis.FormManager;
  // eslint-disable-next-line no-new-func
  const fn = new Function('window', `${src}\nreturn window.FormManager;`);
  return fn(window);
}

describe('FormManager — updateFieldUI escapa mensagens de erro', () => {
  let FormManager;

  beforeEach(() => {
    FormManager = loadFormManager();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  function mountFieldWithError(message) {
    const wrapper = document.createElement('div');
    wrapper.className = 'form-field';
    const input = document.createElement('input');
    input.name = 'name';
    input.value = 'x';
    wrapper.appendChild(input);
    document.body.appendChild(wrapper);

    FormManager.forms.set('test-form', {
      id: 'test-form',
      element: wrapper,
      options: {},
      fields: new Map([
        [
          'name',
          {
            element: input,
            name: 'name',
            type: 'text',
            value: 'x',
            initialValue: 'x',
            isValid: true,
            errors: [],
          },
        ],
      ]),
      validators: new Map(),
      isDirty: false,
      isValid: false,
    });
    FormManager.forms.get('test-form').fields.get('name').errors = [message];
    FormManager.updateFieldUI('test-form', 'name');
    return wrapper;
  }

  test('erro com HTML vira texto literal, não markup', () => {
    const wrapper = mountFieldWithError('<img src=x onerror="window.__xss=1">');
    const errorEl = wrapper.querySelector('.field-error');
    expect(errorEl).toBeTruthy();
    // nada de elemento injetado — o payload aparece como TEXTO
    expect(wrapper.querySelector('img')).toBeNull();
    expect(errorEl.textContent).toContain('<img src=x');
    expect(window.__xss).toBeUndefined();
  });

  test('erro comum continua renderizando normalmente', () => {
    const wrapper = mountFieldWithError('This field is required');
    const errorEl = wrapper.querySelector('.field-error');
    expect(errorEl).toBeTruthy();
    expect(errorEl.textContent).toContain('This field is required');
  });
});
