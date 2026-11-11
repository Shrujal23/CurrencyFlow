/** Pill-style searchable dropdowns; native select stays in sync for form logic. */

function closeCustomSelects(except) {
  document.querySelectorAll('.custom-select.is-open').forEach((root) => {
    if (root === except) return;
    const panel = root.querySelector('.custom-select-panel');
    const trigger = root.querySelector('.custom-select-trigger');
    root.classList.remove('is-open');
    if (panel) panel.hidden = true;
    if (trigger) trigger.setAttribute('aria-expanded', 'false');
  });
}

function syncCustomSelect(select) {
  const root = select.closest('.custom-select');
  if (!root) return;
  const list = root.querySelector('.custom-select-list');
  if (!list) return;

  list.replaceChildren();
  for (const opt of select.options) {
    const li = document.createElement('li');
    li.className = 'custom-select-option';
    li.setAttribute('role', 'option');
    li.dataset.value = opt.value;
    const text = document.createElement('span');
    text.className = 'custom-select-option-text';
    text.textContent = opt.text;
    const check = document.createElement('span');
    check.className = 'custom-select-check';
    check.setAttribute('aria-hidden', 'true');
    check.textContent = '✓';
    li.append(text, check);
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      select.value = opt.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      syncCustomSelect(select);
      closeCustomSelects();
      root.classList.remove('is-open');
      root.querySelector('.custom-select-panel').hidden = true;
      root.querySelector('.custom-select-trigger').setAttribute('aria-expanded', 'false');
    });
    list.appendChild(li);
  }
  updateCustomSelectTrigger(select);
}

function shortSelectLabel(text) {
  if (!text) return '';
  const i = text.indexOf(' - ');
  return i === -1 ? text : text.slice(0, i);
}

function updateCustomSelectTrigger(select) {
  const root = select.closest('.custom-select');
  if (!root) return;
  const opt = select.selectedOptions[0];
  const valueEl = root.querySelector('.custom-select-value');
  if (valueEl) valueEl.textContent = opt ? shortSelectLabel(opt.text) : 'Choose…';
  root.querySelectorAll('.custom-select-option').forEach((li) => {
    const on = li.dataset.value === select.value;
    li.classList.toggle('is-selected', on);
    li.setAttribute('aria-selected', on ? 'true' : 'false');
  });
}

function filterCustomSelectOptions(root, query) {
  const q = query.trim().toUpperCase();
  root.querySelectorAll('.custom-select-option').forEach((li) => {
    const hay = `${li.dataset.value} ${li.textContent}`.toUpperCase();
    li.hidden = Boolean(q && !hay.includes(q));
  });
}

function attachCustomSelect(select) {
  if (!select || select.closest('.custom-select')) return;

  const root = document.createElement('div');
  root.className = 'custom-select';
  select.parentNode.insertBefore(root, select);
  root.appendChild(select);
  select.classList.add('custom-select-native');
  select.tabIndex = -1;

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'custom-select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');

  const valueEl = document.createElement('span');
  valueEl.className = 'custom-select-value';

  const chevron = document.createElement('span');
  chevron.className = 'custom-select-chevron';
  chevron.setAttribute('aria-hidden', 'true');

  trigger.append(valueEl, chevron);

  const panel = document.createElement('div');
  panel.className = 'custom-select-panel';
  panel.hidden = true;

  const filter = document.createElement('input');
  filter.type = 'search';
  filter.className = 'custom-select-filter';
  filter.placeholder = 'Type to filter…';
  filter.setAttribute('autocomplete', 'off');
  filter.setAttribute('aria-label', `Filter ${select.id} options`);

  const list = document.createElement('ul');
  list.className = 'custom-select-list';
  list.setAttribute('role', 'listbox');
  list.id = `${select.id}-listbox`;
  trigger.setAttribute('aria-controls', list.id);

  panel.append(filter, list);
  root.insertBefore(trigger, select);
  root.appendChild(panel);
  root.appendChild(select);

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const opening = !root.classList.contains('is-open');
    closeCustomSelects(opening ? root : null);
    if (opening) {
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      filter.value = '';
      filterCustomSelectOptions(root, '');
      requestAnimationFrame(() => {
        root.classList.add('is-open');
        filter.focus();
      });
    } else {
      root.classList.remove('is-open');
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
    }
  });

  filter.addEventListener('input', () => filterCustomSelectOptions(root, filter.value));
  filter.addEventListener('click', (e) => e.stopPropagation());

  select.addEventListener('change', () => updateCustomSelectTrigger(select));

  syncCustomSelect(select);
}

document.addEventListener('click', () => closeCustomSelects());
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeCustomSelects();
});
