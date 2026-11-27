import { icon } from './icons.js';

export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
export const options = (items, selected) => items.map(item => {
  const [key, label] = Array.isArray(item) ? item : [item, item];
  return '<option value="' + esc(key) + '"' + (key === selected ? ' selected' : '') + '>' + esc(label) + '</option>';
}).join('');
export const tag = (label, color = '') => label ? '<span class="tag ' + color + '">' + esc(label) + '</span>' : '';
export const jump = (label, action, id = '', symbol = 'arrow') =>
  '<button type="button" class="text-button" data-' + action + '="' + esc(id) + '">' + esc(label) + icon(symbol, 16) + '</button>';
export const button = (label, action, id = '', symbol = '', className = '') =>
  '<button type="button" class="button ' + className + '" data-' + action + '="' + esc(id) + '">' + (symbol ? icon(symbol, 18) : '') + esc(label) + '</button>';
export const empty = (symbol, title, text = '', action = '') =>
  '<div class="empty"><span class="empty-icon">' + icon(symbol, 23) + '</span><strong>' + esc(title) + '</strong>' +
  (text ? '<p>' + esc(text) + '</p>' : '') + action + '</div>';
export const motif = '<div class="hero-deco" aria-hidden="true"><svg viewBox="0 0 340 230" fill="none"><circle cx="217" cy="116" r="108"/><circle cx="217" cy="116" r="82"/><circle cx="217" cy="116" r="54"/><path d="M0 155h107l23-36 30 51 32-71 28 46h120"/><circle cx="192" cy="99" r="5" class="dot"/><circle cx="130" cy="119" r="4" class="dot"/><circle cx="269" cy="145" r="4" class="dot"/></svg></div>';
