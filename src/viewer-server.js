let allProducts = []; 
let currentData = []; 
let currentSortColumn = 'originalRank'; 
let sortAscending = true; 

async function loadData() {
  try {
    const response = await fetch('../output/wyniki.json');
    if (!response.ok) throw new Error('Nie udało się załadować pliku wyniki.json');

    const data = await response.json();
    
    allProducts = data.map((item, index) => {
      return { ...item, originalRank: index + 1 };
    });

    currentData = [...allProducts];
    renderTable(currentData);

  } catch (error) {
    console.error('Błąd:', error);
    document.getElementById('error-msg').style.display = 'block';
    document.getElementById('error-msg').innerHTML = `
      Wystąpił błąd podczas ładowania danych.<br><br>
    `;
  }
}

function renderTable(dataToRender) {
  const tbody = document.getElementById('results-body');
  tbody.innerHTML = ''; 

  if (dataToRender.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center;">Brak wyników dla podanych filtrów.</td></tr>`;
    return;
  }

  dataToRender.forEach(item => {
    const tr = document.createElement('tr');

    let rankDisplay = item.originalRank;
    if (rankDisplay === 1) rankDisplay = '🥇 1';
    if (rankDisplay === 2) rankDisplay = '🥈 2';
    if (rankDisplay === 3) rankDisplay = '🥉 3';

    tr.innerHTML = `
      <td><strong>${rankDisplay}</strong></td>
      <td>${item.name}</td>
      <td>${item.wymiary}<br><small>(${item.pojemnoscCm3.toFixed(2)} cm³)</small></td>
      <td class="price-col">${item.price.toFixed(2)} PLN</td>
      <td><strong>${item.cenaZaCm3.toFixed(8)}</strong></td>
      <td><a href="${item.url}" target="_blank" class="btn btn-link">Zobacz</a></td>
    `;
    tbody.appendChild(tr);
  });
}

function applyFilters() {
  const minPrice = parseFloat(document.getElementById('min-price').value) || 0;
  const maxPrice = parseFloat(document.getElementById('max-price').value) || Infinity;

  currentData = allProducts.filter(item => {
    return item.price >= minPrice && item.price <= maxPrice;
  });

  sortData(currentSortColumn, sortAscending);
}

function resetFilters() {
  document.getElementById('min-price').value = '';
  document.getElementById('max-price').value = '';
  currentData = [...allProducts];
  sortData('originalRank', true); // powrót do domyślnego sortowania
}

function sortData(column, asc = true) {
  currentSortColumn = column;
  sortAscending = asc;

  currentData.sort((a, b) => {
    let valA = a[column];
    let valB = b[column];

    if (typeof valA === 'string') {
      return asc ? valA.localeCompare(valB) : valB.localeCompare(valA);
    } else {
      return asc ? valA - valB : valB - valA;
    }
  });

  renderTable(currentData);
}


document.getElementById('filter-btn').addEventListener('click', applyFilters);

document.getElementById('reset-btn').addEventListener('click', resetFilters);

document.querySelectorAll('th.sortable').forEach(th => {
  th.addEventListener('click', () => {
    const column = th.getAttribute('data-sort');
    
    if (currentSortColumn === column) {
      sortData(column, !sortAscending);
    } else {
      sortData(column, true); 
    }
  });
});

loadData();