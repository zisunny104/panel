/**
 * DOM Utilities - Centralized DOM manipulation with smart null-handling
 * Reduces verbose defensive checking throughout the codebase
 *
 * Usage: Instead of repeated if checks, use these utilities
 */
class DOMUtils {
  /**
   * Safely set multiple values on DOM elements
   * @param {Object} updates - Map of {element: value} pairs
   * @example
   * DOMUtils.setValues({
   *   [scaleRange]: 1.5,
   *   [scaleNumberInput]: "1.50"
   * });
   */
  static setValues(updates) {
    Object.entries(updates).forEach(([element, value]) => {
      if (element?.value !== undefined) {
        element.value = value;
      }
    });
  }

  /**
   * Toggle classes on multiple elements efficiently
   * @param {Element|NodeList|Array} elements - Single or multiple elements
   * @param {string|Array} classNames - Class name(s) to toggle
   * @param {boolean} [force] - Force add (true) or remove (false)
   * @example
   * DOMUtils.toggleClasses(document.querySelectorAll(".button"), "active", false);
   */
  static toggleClasses(elements, classNames, force) {
    const nodeList = NodeList.prototype.isPrototypeOf(elements)
      ? elements
      : Array.isArray(elements)
        ? elements
        : [elements];

    const classList = Array.isArray(classNames) ? classNames : [classNames];

    nodeList.forEach((el) => {
      if (el?.classList) {
        classList.forEach((cn) => el.classList.toggle(cn, force));
      }
    });
  }

  /**
   * Add classes to element(s)
   * @param {Element|Array} elements
   * @param {...string} classNames
   */
  static addClasses(elements, ...classNames) {
    const nodeList = Array.isArray(elements) ? elements : [elements];
    nodeList.forEach((el) => {
      if (el?.classList) {
        el.classList.add(...classNames);
      }
    });
  }

  /**
   * Remove classes from element(s)
   * @param {Element|Array} elements
   * @param {...string} classNames
   */
  static removeClasses(elements, ...classNames) {
    const nodeList = Array.isArray(elements) ? elements : [elements];
    nodeList.forEach((el) => {
      if (el?.classList) {
        el.classList.remove(...classNames);
      }
    });
  }

  /**
   * Set multiple CSS properties on element(s)
   * @param {Element|Array} elements
   * @param {Object} styles - CSS properties as object
   * @example
   * DOMUtils.setStyles(container, { transform: 'scale(1.5)', opacity: '1' });
   */
  static setStyles(elements, styles) {
    const nodeList = Array.isArray(elements) ? elements : [elements];
    nodeList.forEach((el) => {
      if (el?.style) {
        Object.assign(el.style, styles);
      }
    });
  }

  /**
   * Add event listener with automatic null-checking
   * @param {Element} element
   * @param {string} event
   * @param {Function} callback
   * @param {Object} [options]
   */
  static addEventListener(element, event, callback, options = {}) {
    if (element?.addEventListener) {
      element.addEventListener(event, callback, options);
      return true;
    }
    return false;
  }

  /**
   * Safe element query with optional chain fallback
   * @param {string} selector
   * @param {Element} [root]
   * @returns {Element|null}
   */
  static query(selector, root = document) {
    try {
      return root?.querySelector?.(selector) || null;
    } catch (error) {
      console.warn(`Query failed for selector "${selector}":`, error);
      return null;
    }
  }

  /**
   * Safe multi-element query
   * @param {string} selector
   * @param {Element} [root]
   * @returns {Array}
   */
  static queryAll(selector, root = document) {
    try {
      return Array.from(root?.querySelectorAll?.(selector) || []);
    } catch (error) {
      console.warn(`QueryAll failed for selector "${selector}":`, error);
      return [];
    }
  }

  /**
   * Safe element ID lookup
   * @param {string} id
   * @returns {Element|null}
   */
  static byId(id) {
    return document.getElementById(id) || null;
  }

  /**
   * Update element attribute safely
   * @param {Element} element
   * @param {string} name
   * @param {string} value
   */
  static setAttribute(element, name, value) {
    if (element?.setAttribute) {
      element.setAttribute(name, value);
      return true;
    }
    return false;
  }

  /**
   * Get element attribute safely
   * @param {Element} element
   * @param {string} name
   * @returns {string|null}
   */
  static getAttribute(element, name) {
    return element?.getAttribute?.(name) || null;
  }

  /**
   * Check if element has class
   * @param {Element} element
   * @param {string} className
   * @returns {boolean}
   */
  static hasClass(element, className) {
    return element?.classList?.contains?.(className) || false;
  }

  /**
   * Set text content safely
   * @param {Element} element
   * @param {string} text
   */
  static setText(element, text) {
    if (element?.textContent !== undefined) {
      element.textContent = text;
      return true;
    }
    return false;
  }

  /**
   * Set HTML content safely
   * @param {Element} element
   * @param {string} html
   */
  static setHTML(element, html) {
    if (element?.innerHTML !== undefined) {
      element.innerHTML = html;
      return true;
    }
    return false;
  }

  /**
   * Batch hide elements
   * @param {...Element} elements
   */
  static hide(...elements) {
    this.toggleClasses(elements, "is-hidden", true);
  }

  /**
   * Batch show elements
   * @param {...Element} elements
   */
  static show(...elements) {
    this.toggleClasses(elements, "is-hidden", false);
  }

  /**
   * Focus element if it exists
   * @param {Element} element
   */
  static focus(element) {
    if (element?.focus) {
      element.focus();
      return true;
    }
    return false;
  }

  /**
   * Get numeric value from input, with defaults
   * @param {Element} element
   * @param {number} [defaultValue=0]
   * @param {number} [min]
   * @param {number} [max]
   * @returns {number}
   */
  static getNumericValue(element, defaultValue = 0, min, max) {
    const value = parseFloat(element?.value ?? defaultValue);
    if (min !== undefined && value < min) return min;
    if (max !== undefined && value > max) return max;
    return value;
  }

  /**
   * Create element with class names
   * @param {string} tag - Tag name
   * @param {string|Array} classNames - One or more class names
   * @param {string} [text] - Optional text content
   * @returns {Element}
   */
  static createElement(tag, classNames = [], text = "") {
    const element = document.createElement(tag);
    const classes = Array.isArray(classNames) ? classNames : [classNames];
    element.classList.add(...classes);
    if (text) element.textContent = text;
    return element;
  }

  /**
   * Remove element from DOM
   * @param {Element} element
   */
  static remove(element) {
    element?.remove?.();
  }

  /**
   * Clear element's children
   * @param {Element} element
   */
  static clear(element) {
    if (element?.textContent !== undefined) {
      element.textContent = "";
    }
  }
}

// Export for use in modules
if (typeof module !== "undefined" && module.exports) {
  module.exports = DOMUtils;
}
