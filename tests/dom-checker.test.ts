import { describe, it, expect } from 'vitest';
import { hasElementWithText, isLoginButtonPresent } from '../lib/utils/dom-checker';

describe('DOM Checker', () => {
  it('should safely return false when document is undefined or element not found', () => {
    expect(hasElementWithText('non-existent-selector', ['登录', 'Sign in'])).toBe(false);
    expect(hasElementWithText(':invalid-selector{', ['登录'])).toBe(false);
    expect(isLoginButtonPresent('non-existent-selector')).toBe(false);
  });
});
