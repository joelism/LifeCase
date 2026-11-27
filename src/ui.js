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
