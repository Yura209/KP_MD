const storeGrid = document.getElementById('store-grid');
const storesError = document.getElementById('stores-error');
// Icons for demonstration stores
const storeIcons = {
  1: '🚿',
  2: '🔩',
  3: '💡'
};
// Load stores from PostgreSQL through the API
async function loadStores() {
  try {
    const response = await fetch('/api/stores');
    if (!response.ok) {
      throw new Error('Server returned an error');
    }
    const stores = await response.json();
    storeGrid.innerHTML = '';
    if (stores.length === 0) {
      storeGrid.textContent = 'Пока нет доступных магазинов.';
      return;
    }
    stores.forEach(store => {
      const card = document.createElement('div');
      card.className = 'store-card';
      const icon = document.createElement('div');
      icon.className = 'store-icon';
      icon.textContent = storeIcons[store.id] || '🏪';
      const title = document.createElement('h3');
      title.textContent = store.name;
      const description = document.createElement('p');
      description.textContent = store.description || 'Ассортимент строительных товаров.';
      const link = document.createElement('a');
      link.href = `store.html?store=${store.id}`;
      link.className = 'store-button';
      link.textContent = 'Перейти в магазин';
      card.append(icon, title, description, link);
      storeGrid.appendChild(card);
    });
  } catch (error) {
    console.error('Error loading stores:', error);
    storeGrid.innerHTML = '';
    storesError.hidden = false;
  }
}
loadStores();
