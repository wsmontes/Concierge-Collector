/**
 * Accessibility Checker
 * Purpose: Audit and fix WCAG 2.1 AA accessibility issues
 * 
 * Features:
 * - Automated accessibility audits
 * - WCAG 2.1 AA compliance checking
 * - Color contrast validation
 * - ARIA label verification
 * - Keyboard navigation testing
 * - Focus indicator checks
 * - Heading hierarchy validation
 * - Alt text verification
 * - Form label associations
 * - Detailed issue reporting
 * 
 * Dependencies:
 * - None (standalone checker)
 * 
 * Usage:
 *   const results = accessibilityChecker.run();
 *   accessibilityChecker.fix(); // Auto-fix issues
 * 
 * Author: Concierge Collector Team
 * Last Updated: October 19, 2025
 */

(function() {
    'use strict';

    /**
     * AccessibilityChecker - Audit and fix a11y issues
     */
    const AccessibilityChecker = {
        /**
         * All accessibility checks
         */
        checks: [
            {
                id: 'alt-text',
                name: 'Images have alt text',
                level: 'A',
                test() {
                    const images = document.querySelectorAll('img');
                    const withoutAlt = Array.from(images).filter(img => {
                        return !img.alt && !img.getAttribute('aria-label') && img.getAttribute('role') !== 'presentation';
                    });
                    return {
                        pass: withoutAlt.length === 0,
                        issues: withoutAlt.map(img => ({
                            element: img,
                            message: `Image missing alt text: ${img.src}`,
                            fix: () => img.alt = 'Decorative image'
                        }))
                    };
                }
            },
            {
                id: 'aria-labels',
                name: 'Icon buttons have labels',
                level: 'A',
                test() {
                    const buttons = document.querySelectorAll('button');
                    const iconOnly = Array.from(buttons).filter(btn => {
                        const hasIconOnly = btn.querySelector('.material-icons') && 
                                          !btn.textContent.trim().replace(/[^\w]/g, '');
                        const hasLabel = btn.getAttribute('aria-label') || btn.getAttribute('title');
                        return hasIconOnly && !hasLabel;
                    });
                    return {
                        pass: iconOnly.length === 0,
                        issues: iconOnly.map(btn => ({
                            element: btn,
                            message: 'Icon-only button missing aria-label',
                            fix() {
                                const icon = btn.querySelector('.material-icons')?.textContent;
                                btn.setAttribute('aria-label', icon || 'Button');
                            }
                        }))
                    };
                }
            },
            {
                id: 'color-contrast',
                name: 'Text has sufficient contrast',
                level: 'AA',
                test() {
                    const textElements = document.querySelectorAll('p, h1, h2, h3, h4, h5, h6, span, a, button, label');
                    const lowContrast = Array.from(textElements).filter(el => {
                        if (!el.offsetParent) return false; // Skip hidden elements
                        
                        const style = window.getComputedStyle(el);
                        const color = style.color;
                        const bgColor = this.getBackgroundColor(el);
                        const fontSize = parseFloat(style.fontSize);
                        const fontWeight = parseInt(style.fontWeight) || 400;
                        
                        const contrast = this.getContrastRatio(color, bgColor);
                        const isLargeText = fontSize >= 18 || (fontSize >= 14 && fontWeight >= 700);
                        const minContrast = isLargeText ? 3 : 4.5;
                        
                        return contrast < minContrast;
                    });
                    
                    return {
                        pass: lowContrast.length === 0,
                        issues: lowContrast.map(el => ({
                            element: el,
                            message: `Low contrast ratio (needs ${parseFloat(window.getComputedStyle(el).fontSize) >= 18 ? '3:1' : '4.5:1'})`,
                            fix: null // Manual fix required
                        }))
                    };
                }
            },
            {
                id: 'focus-visible',
                name: 'Focus indicators present',
                level: 'AA',
                test() {
                    const focusable = document.querySelectorAll('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])');
                    const noFocusStyle = Array.from(focusable).filter(el => {
                        const style = window.getComputedStyle(el, ':focus');
                        return style.outline === 'none' && !style.boxShadow && !style.border;
                    });
                    
                    return {
                        pass: noFocusStyle.length === 0,
                        issues: noFocusStyle.map(el => ({
                            element: el,
                            message: 'Element has no visible focus indicator',
                            fix: null // CSS fix required
                        }))
                    };
                }
            },
            {
                id: 'heading-hierarchy',
                name: 'Proper heading hierarchy',
                level: 'A',
                test() {
                    const headings = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
                    let lastLevel = 0;
                    const issues = [];
                    
                    headings.forEach(h => {
                        const level = parseInt(h.tagName[1]);
                        if (level > lastLevel + 1) {
                            issues.push({
                                element: h,
                                message: `${h.tagName} appears after H${lastLevel} (skipped H${lastLevel + 1})`,
                                fix: null
                            });
                        }
                        lastLevel = level;
                    });
                    
                    return {
                        pass: issues.length === 0,
                        issues
                    };
                }
            },
            {
                id: 'form-labels',
                name: 'Form inputs have labels',
                level: 'A',
                test() {
                    const inputs = document.querySelectorAll('input:not([type="hidden"]), select, textarea');
                    const withoutLabels = Array.from(inputs).filter(input => {
                        const hasLabel = input.labels && input.labels.length > 0;
                        const hasAriaLabel = input.getAttribute('aria-label') || input.getAttribute('aria-labelledby');
                        const hasPlaceholder = input.getAttribute('placeholder');
                        return !hasLabel && !hasAriaLabel && !hasPlaceholder;
                    });
                    
                    return {
                        pass: withoutLabels.length === 0,
                        issues: withoutLabels.map(input => ({
                            element: input,
                            message: `Input missing label: ${input.name || input.id || input.type}`,
                            fix() {
                                const label = input.name || input.id || 'Input';
                                input.setAttribute('aria-label', label);
                            }
                        }))
                    };
                }
            },
            {
                id: 'link-text',
                name: 'Links have descriptive text',
                level: 'A',
                test() {
                    const links = document.querySelectorAll('a[href]');
                    const vague = Array.from(links).filter(link => {
                        const text = link.textContent.trim().toLowerCase();
                        const vagueTerms = ['click here', 'here', 'more', 'read more', 'link'];
                        return vagueTerms.includes(text);
                    });
                    
                    return {
                        pass: vague.length === 0,
                        issues: vague.map(link => ({
                            element: link,
                            message: `Link has vague text: "${link.textContent.trim()}"`,
                            fix: null // Content fix required
                        }))
                    };
                }
            },
            {
                id: 'keyboard-accessible',
                name: 'Interactive elements are keyboard accessible',
                level: 'A',
                test() {
                    const interactive = document.querySelectorAll('[onclick], [ondblclick]');
                    const notKeyboardAccessible = Array.from(interactive).filter(el => {
                        return el.tagName !== 'BUTTON' && 
                               el.tagName !== 'A' && 
                               !el.hasAttribute('tabindex') &&
                               el.getAttribute('role') !== 'button';
                    });
                    
                    return {
                        pass: notKeyboardAccessible.length === 0,
                        issues: notKeyboardAccessible.map(el => ({
                            element: el,
                            message: 'Interactive element not keyboard accessible',
                            fix() {
                                el.setAttribute('tabindex', '0');
                                el.setAttribute('role', 'button');
                            }
                        }))
                    };
                }
            },
            {
                id: 'language-attribute',
                name: 'HTML has lang attribute',
                level: 'A',
                test() {
                    const html = document.documentElement;
                    const hasLang = html.hasAttribute('lang');
                    
                    return {
                        pass: hasLang,
                        issues: hasLang ? [] : [{
                            element: html,
                            message: 'HTML missing lang attribute',
                            fix() {
                                html.setAttribute('lang', 'en');
                            }
                        }]
                    };
                }
            },
            {
                id: 'skip-link',
                name: 'Skip to main content link present',
                level: 'A',
                test() {
                    const skipLink = document.querySelector('a[href="#main"], a[href="#content"]');
                    return {
                        pass: !!skipLink,
                        issues: skipLink ? [] : [{
                            element: document.body,
                            message: 'No skip to main content link found',
                            fix: null // Manual addition required
                        }]
                    };
                }
            }
        ],

        /**
         * Run all accessibility checks
         * @param {Object} options - Check options
         * @returns {Object} Check results
         */
        run(options = {}) {
            const { verbose = true, level = 'AA' } = options;
            
            console.group('🔍 Accessibility Audit (WCAG 2.1 ' + level + ')');
            
            const results = this.checks.map(check => {
                const result = check.test.call(this);
                const status = result.pass ? '✅' : '❌';
                
                if (verbose) {
                    console.log(
                        status,
                        check.name,
                        result.pass ? '' : `(${result.issues.length} issues)`
                    );
                    
                    if (!result.pass && result.issues.length > 0) {
                        console.table(result.issues.map(issue => ({
                            Message: issue.message,
                            Element: issue.element.tagName,
                            Fixable: !!issue.fix
                        })));
                    }
                }
                
                return {
                    ...check,
                    ...result
                };
            });
            
            console.groupEnd();
            
            // Summary
            const total = results.length;
            const passed = results.filter(r => r.pass).length;
            const failed = total - passed;
            const score = Math.round((passed / total) * 100);
            
            console.log(`📊 Accessibility Score: ${score}% (${passed}/${total} checks passed)`);
            
            return {
                score,
                passed,
                failed,
                total,
                results
            };
        },

        /**
         * Auto-fix fixable issues
         * @returns {number} Number of issues fixed
         */
        fix() {
            console.log('🔧 Auto-fixing accessibility issues...');
            
            const results = this.run({ verbose: false });
            let fixedCount = 0;
            
            results.results.forEach(result => {
                if (!result.pass) {
                    result.issues.forEach(issue => {
                        if (typeof issue.fix === 'function') {
                            try {
                                issue.fix();
                                fixedCount++;
                            } catch (error) {
                                console.error('Failed to fix issue:', issue.message, error);
                            }
                        }
                    });
                }
            });
            
            console.log(`✅ Fixed ${fixedCount} issues`);
            
            // Re-run to verify
            this.run();
            
            return fixedCount;
        },

        /**
         * Get contrast ratio between two colors
         * @param {string} color1 - First color (RGB)
         * @param {string} color2 - Second color (RGB)
         * @returns {number} Contrast ratio
         */
        getContrastRatio(color1, color2) {
            const lum1 = this.getRelativeLuminance(color1);
            const lum2 = this.getRelativeLuminance(color2);
            const lighter = Math.max(lum1, lum2);
            const darker = Math.min(lum1, lum2);
            return (lighter + 0.05) / (darker + 0.05);
        },

        /**
         * Get relative luminance of color
         * @param {string} color - RGB color string
         * @returns {number} Relative luminance
         */
        getRelativeLuminance(color) {
            const rgb = this.parseColor(color);
            const [r, g, b] = rgb.map(val => {
                val = val / 255;
                return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
            });
            return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        },

        /**
         * Parse color string to RGB array
         * @param {string} color - Color string
         * @returns {number[]} RGB values
         */
        parseColor(color) {
            const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (match) {
                return [parseInt(match[1]), parseInt(match[2]), parseInt(match[3])];
            }
            return [0, 0, 0];
        },

        /**
         * Get effective background color of element
         * @param {HTMLElement} element - Element
         * @returns {string} Background color
         */
        getBackgroundColor(element) {
            let el = element;
            while (el) {
                const bgColor = window.getComputedStyle(el).backgroundColor;
                if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
                    return bgColor;
                }
                el = el.parentElement;
            }
            return 'rgb(255, 255, 255)'; // Default to white
        },

        /**
         * Generate accessibility report
         * @returns {string} HTML report
         */
        generateReport() {
            const results = this.run({ verbose: false });
            
            const html = `
                <div class="a11y-report">
                    <h2>Accessibility Report</h2>
                    <div class="a11y-summary">
                        <div class="a11y-score ${results.score >= 80 ? 'good' : results.score >= 60 ? 'fair' : 'poor'}">
                            ${results.score}%
                        </div>
                        <div class="a11y-stats">
                            <div>✅ ${results.passed} passed</div>
                            <div>❌ ${results.failed} failed</div>
                        </div>
                    </div>
                    <div class="a11y-issues">
                        ${results.results.filter(r => !r.pass).map(result => `
                            <div class="a11y-issue">
                                <h3>${result.name}</h3>
                                <p>Level: WCAG ${result.level}</p>
                                <ul>
                                    ${result.issues.map(issue => `
                                        <li>${issue.message} ${issue.fix ? '🔧' : ''}</li>
                                    `).join('')}
                                </ul>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
            
            return html;
        }
    };

    // Expose to global scope
    window.accessibilityChecker = AccessibilityChecker;

    // Add helper command for development
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
        window.checkA11y = () => AccessibilityChecker.run();
        window.fixA11y = () => AccessibilityChecker.fix();
        console.log('💡 Accessibility helpers available: checkA11y(), fixA11y()');
    }

    console.log('✅ AccessibilityChecker initialized');
})();
