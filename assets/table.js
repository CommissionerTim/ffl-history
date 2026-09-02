// table.js — tiny sortable-table helper shared by both pages.
//
// Sorting rule (per spec): whenever two managers are tied on the sorted
// stat, break the tie alphabetically by manager name — always, regardless
// of sort direction or which column is active.

/**
 * @param {HTMLTableElement} table
 * @param {Array<object>} data
 * @param {Array<{key:string, label:string, get:(row)=>any, format:(row)=>string, numeric?:boolean, tooltip?:string}>} columns
 *   `tooltip`, when present, adds a small "ⓘ" next to the header with that
 *   plain-language text shown on hover (native title attribute).
 * @param {string} managerKeyField - field on each row holding the manager's display name, for the alphabetical tiebreak
 * @param {{key:string, dir:1|-1}} [initialSort]
 */
export function renderSortableTable(table, data, columns, managerKeyField, initialSort) {
  let sortKey = initialSort?.key ?? columns[0].key;
  let sortDir = initialSort?.dir ?? 1;

  function sortedRows() {
    const col = columns.find((c) => c.key === sortKey);
    const rows = [...data];
    rows.sort((a, b) => {
      const av = col.get(a);
      const bv = col.get(b);
      const aNull = av === null || av === undefined;
      const bNull = bv === null || bv === undefined;
      if (aNull && bNull) {
        // fall through to alphabetical
      } else if (aNull) {
        return 1; // nulls sort last regardless of direction
      } else if (bNull) {
        return -1;
      } else if (av !== bv) {
        return av < bv ? -sortDir : sortDir;
      }
      return String(a[managerKeyField]).localeCompare(String(b[managerKeyField]));
    });
    return rows;
  }

  function render() {
    table.innerHTML = '';
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const col of columns) {
      const th = document.createElement('th');
      th.tabIndex = 0;
      th.setAttribute('role', 'button');

      const labelText = col.label + (col.key === sortKey ? (sortDir === 1 ? ' ▲' : ' ▼') : '');
      th.appendChild(document.createTextNode(labelText));
      if (col.key === sortKey) th.classList.add('sorted');

      if (col.tooltip) {
        const info = document.createElement('span');
        info.className = 'th-info';
        info.textContent = 'ⓘ';
        info.title = col.tooltip;
        info.setAttribute('aria-label', col.tooltip);
        // Don't let a click/hover on the icon itself trigger a sort toggle.
        info.addEventListener('click', (e) => e.stopPropagation());
        th.appendChild(info);
      }

      const activate = () => {
        if (sortKey === col.key) {
          sortDir = -sortDir;
        } else {
          sortKey = col.key;
          sortDir = 1;
        }
        render();
      };
      th.addEventListener('click', activate);
      th.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); }
      });
      headRow.appendChild(th);
    }
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of sortedRows()) {
      const tr = document.createElement('tr');
      for (const col of columns) {
        const td = document.createElement('td');
        td.textContent = col.format(row);
        if (col.numeric) td.classList.add('num');
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
  }

  render();
}
