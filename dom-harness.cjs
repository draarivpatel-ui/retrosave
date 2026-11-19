'use strict';

// A small deterministic DOM for controller regression tests. This is not a
// layout engine. It executes the page's real local scripts and event handlers.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

function decode(text) {
  return String(text).replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|middot);/gi, (_, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', middot: '·' };
    if (entity[0] !== '#') return named[entity.toLowerCase()];
    return String.fromCodePoint(entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1)));
  });
}

function escape(text) {
  return String(text).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

class EventTarget {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    if (!event.preventDefault) event.preventDefault = () => { event.defaultPrevented = true; };
    if (!event.stopPropagation) event.stopPropagation = () => { event.cancelBubble = true; };
    event.currentTarget = this;
    for (const handler of this.listeners.get(event.type) || []) handler.call(this, event);
    if (event.bubbles && !event.cancelBubble && this.parentNode) this.parentNode.dispatchEvent(event);
    return !event.defaultPrevented;
  }
}

function descendants(node) {
  return node.childNodes.flatMap(child => child.nodeType === 1 ? [child, ...descendants(child)] : []);
}

function matchesSimple(node, selector) {
  if (node.nodeType !== 1) return false;
  const attrs = [...selector.matchAll(/\[([\w-]+)(?:=["']?([^\]"']*)["']?)?\]/g)];
  let rest = selector.replace(/\[[^\]]*\]/g, '');
  const tag = rest.match(/^[\w-]+|^\*/);
  if (tag && tag[0] !== '*' && node.tagName.toLowerCase() !== tag[0].toLowerCase()) return false;
  const id = rest.match(/#([\w-]+)/);
  if (id && node.id !== id[1]) return false;
  for (const [, name] of rest.matchAll(/\.([\w-]+)/g)) if (!node.classList.contains(name)) return false;
  for (const [, name, value] of attrs) {
    if (!node.hasAttribute(name) || (value !== undefined && node.getAttribute(name) !== value)) return false;
  }
  return true;
}

function matches(node, selector) {
  return selector.split(',').some(part => {
    const segments = part.trim().split(/\s+(?![^\[]*\])/);
    if (!matchesSimple(node, segments.pop())) return false;
    let parent = node.parentElement;
    while (segments.length) {
      const segment = segments.pop();
      while (parent && !matchesSimple(parent, segment)) parent = parent.parentElement;
      if (!parent) return false;
      parent = parent.parentElement;
    }
    return true;
  });
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

class Element extends EventTarget {
  constructor(tagName, document) {
    super();
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = document;
    this.attributes = new Map();
    this.childNodes = [];
    this.parentNode = null;
    this.style = {};
    this.dataset = {};
    this.offsetWidth = 180;
    this.offsetHeight = 80;
    const element = this;
    this.classList = {
      contains(name) { return element.className.split(/\s+/).includes(name); },
      add(...names) { element.className = [...new Set([...element.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove(...names) { element.className = element.className.split(/\s+/).filter(name => name && !names.includes(name)).join(' '); },
      toggle(name, force) {
        const next = force === undefined ? !this.contains(name) : !!force;
        if (next) this.add(name); else this.remove(name);
        return next;
      }
    };
  }
  get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
  get children() { return this.childNodes.filter(node => node.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get id() { return this.getAttribute('id') || ''; }
  set id(value) { this.setAttribute('id', value); }
  get className() { return this.getAttribute('class') || ''; }
  set className(value) { this.setAttribute('class', value); }
  get type() { return this.getAttribute('type') || (this.tagName === 'INPUT' ? 'text' : ''); }
  get min() { return this.getAttribute('min') || ''; }
  get max() { return this.getAttribute('max') || ''; }
  get step() { return this.getAttribute('step') || ''; }
  get href() { return this.getAttribute('href') || ''; }
  set href(value) { this.setAttribute('href', value); }
  get download() { return this.getAttribute('download') || ''; }
  set download(value) { this.setAttribute('download', value); }
  get value() {
    if (this._value !== undefined) return this._value;
    if (this.tagName === 'SELECT') {
      const options = this.querySelectorAll('option');
      const chosen = options.find(option => option.hasAttribute('selected')) || options[0];
      return chosen ? chosen.value : '';
    }
    return this.tagName === 'TEXTAREA' ? this.textContent : this.getAttribute('value') || '';
  }
  set value(value) { this._value = String(value); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(value) { if (value) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(value) { if (value) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get checked() { return this.hasAttribute('checked'); }
  set checked(value) { if (value) this.setAttribute('checked', ''); else this.removeAttribute('checked'); }
  get textContent() { return this.childNodes.map(node => node.textContent).join(''); }
  set textContent(value) {
    this.replaceChildren();
    if (value !== '') this.appendChild(this.ownerDocument.createTextNode(String(value)));
  }
  get innerHTML() { return this.childNodes.map(node => node.outerHTML ?? escape(node.textContent)).join(''); }
  set innerHTML(value) { this.replaceChildren(); parseHTML(String(value), this, this.ownerDocument); }
  get outerHTML() {
    const name = this.tagName.toLowerCase();
    const attrs = [...this.attributes].map(([key, value]) => ' ' + key + '="' + escape(value) + '"').join('');
    return '<' + name + attrs + '>' + (VOID.has(name) ? '' : this.innerHTML + '</' + name + '>');
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
    if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
  }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  hasAttribute(name) { return this.attributes.has(name); }
  removeAttribute(name) { this.attributes.delete(name); }
  appendChild(node) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  removeChild(node) {
    const index = this.childNodes.indexOf(node);
    assert.ok(index >= 0, 'removeChild needs an existing child');
    this.childNodes.splice(index, 1);
    node.parentNode = null;
    return node;
  }
  replaceChildren(...nodes) { for (const node of [...this.childNodes]) this.removeChild(node); for (const node of nodes) this.appendChild(node); }
  remove() { this.parentNode?.removeChild(this); }
  querySelectorAll(selector) { return descendants(this).filter(node => matches(node, selector)); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { let node = this; while (node?.nodeType === 1) { if (matches(node, selector)) return node; node = node.parentElement; } return null; }
  focus() { this.ownerDocument.activeElement = this; this.dispatchEvent({ type: 'focus' }); }
  select() { this.selected = true; }
  click() {
    if (this.disabled) return;
    if (this.tagName === 'A' && this.download) this.ownerDocument.downloads.push({ filename: this.download, href: this.href });
    this.dispatchEvent({ type: 'click', bubbles: true });
  }
  getContext(kind) {
    assert.equal(kind, '2d');
    if (!this.context) {
      this.context = { calls: [] };
      for (const name of ['clearRect', 'fillRect', 'strokeRect', 'drawImage', 'save', 'restore', 'translate', 'fillText', 'beginPath', 'moveTo', 'lineTo', 'stroke']) {
        this.context[name] = (...args) => {
          assert.ok(args.every(value => typeof value !== 'number' || Number.isFinite(value)), 'non-finite Canvas coordinate in ' + name);
          if (this.context.calls.length < 100) this.context.calls.push([name, ...args]);
        };
      }
    }
    return this.context;
  }
}

function parseHTML(source, container, document) {
  const stack = [container];
  for (const token of source.match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]*>|[^<]+/g) || []) {
    if (token.startsWith('<!')) continue;
    if (token.startsWith('</')) {
      const name = token.match(/^<\/([\w-]+)/)?.[1].toUpperCase();
      for (let index = stack.length - 1; index > 0; index--) if (stack[index].tagName === name) { stack.length = index; break; }
    } else if (token.startsWith('<')) {
      const tag = token.match(/^<([\w-]+)/)?.[1];
      if (!tag) continue;
      const node = document.createElement(tag);
      const attributes = token.slice(tag.length + 1).replace(/\/?\s*>$/, '');
      for (const match of attributes.matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) node.setAttribute(match[1], decode(match[2] ?? match[3] ?? match[4] ?? ''));
      stack.at(-1).appendChild(node);
      if (!VOID.has(tag) && !token.endsWith('/>')) stack.push(node);
    } else stack.at(-1).appendChild(document.createTextNode(decode(token)));
  }
}

function createPage(directory, options = {}) {
  const document = new EventTarget();
  document.nodeType = 9;
  document.childNodes = [];
  document.downloads = [];
  document.readyState = options.loading ? 'loading' : 'complete';
  document.createElement = tag => new Element(tag, document);
  document.createElementNS = (_, tag) => document.createElement(tag);
  document.createTextNode = text => ({ nodeType: 3, textContent: String(text), parentNode: null });
  document.appendChild = Element.prototype.appendChild;
  document.querySelectorAll = Element.prototype.querySelectorAll;
  document.querySelector = Element.prototype.querySelector;
  document.getElementById = id => descendants(document).find(node => node.id === id) || null;
  document.elementFromPoint = () => document.pointElement || null;
  const html = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  parseHTML(html, document, document);
  document.documentElement = document.querySelector('html');
  document.body = document.querySelector('body');
  document.activeElement = document.body;

  let now = 1000;
  const animationFrames = [];
  const blobs = new Map();
  const window = new EventTarget();
  const storage = new Map(Object.entries(options.storage || {}));
  const localStorage = {
    getItem(key) { if (options.storageBlocked) throw new Error('storage disabled'); return storage.get(key) ?? null; },
    setItem(key, value) { if (options.storageBlocked) throw new Error('storage disabled'); storage.set(key, String(value)); }
  };
  class FakeURL extends URL {}
  FakeURL.createObjectURL = blob => { const url = 'blob:fixture/' + blobs.size; blobs.set(url, blob); return url; };
  FakeURL.revokeObjectURL = url => blobs.delete(url);
  const navigator = { getGamepads: () => [] };
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : ['2026-11-15T12:00:00.000Z'])); }
    static now() { return Date.parse('2026-11-15T12:00:00.000Z'); }
  }
  const sandbox = {
    window, document, navigator, localStorage, location: { search: options.search || '' },
    performance: { now: () => now }, Date: FixtureDate, URL: FakeURL, URLSearchParams, Blob, TextEncoder, TextDecoder,
    getComputedStyle: () => ({ getPropertyValue: () => '#333333' }),
    requestAnimationFrame: callback => { animationFrames.push(callback); return animationFrames.length; },
    setTimeout() {},
    console: { log() {}, warn() {}, error(...args) { throw new Error(args.join(' ')); } }
  };
  Object.assign(window, sandbox, { innerWidth: 1280, innerHeight: 800, print() { document.printed = true; }, matchMedia: () => ({ matches: false }) });
  const context = vm.createContext(window);
  for (const script of document.querySelectorAll('script[src]')) {
    const filename = script.getAttribute('src');
    assert.match(filename, /^[a-zA-Z0-9_.-]+\.js$/, 'only local scripts may run');
    vm.runInContext(fs.readFileSync(path.join(directory, filename), 'utf8'), context, { filename, timeout: 5000 });
  }
  if (options.loading) { document.readyState = 'complete'; document.dispatchEvent({ type: 'DOMContentLoaded' }); }
  return {
    document, window, context, html, blobs, storage, navigator,
    get(id) { const node = document.getElementById(id); assert.ok(node, 'missing element #' + id); return node; },
    fire(target, type, extra = {}) { target.dispatchEvent({ type, bubbles: true, ...extra }); },
    key(code, type = 'keydown', target = document.body, extra = {}) { window.dispatchEvent({ type, code, target, ...extra }); },
    flushFrame(deltaMs = 1000 / 60) { now += deltaMs; const batch = animationFrames.splice(0); for (const callback of batch) callback(now); }
  };
}

function auditPage(page) {
  const ids = new Set();
  for (const node of page.document.querySelectorAll('[id]')) { assert.ok(!ids.has(node.id), 'duplicate id: ' + node.id); ids.add(node.id); }
  for (const node of page.document.querySelectorAll('[for], [aria-controls], [aria-labelledby]')) {
    for (const attribute of ['for', 'aria-controls', 'aria-labelledby']) {
      const value = node.getAttribute(attribute);
      if (value) for (const id of value.split(/\s+/)) assert.ok(ids.has(id), 'unresolved ' + attribute + ': ' + id);
    }
  }
  assert.match(page.html, /<html\b[^>]*lang="en"/);
  assert.doesNotMatch(page.html, /[\u2013\u2014]|&(?:mdash|ndash);|font-variant[^;]*small-caps/i);
}

module.exports = { createPage, auditPage };
