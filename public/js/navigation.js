const accountLink = document.querySelector('[data-account-link]');
const cartCount = document.querySelector('[data-cart-count]');
let navigationUser = null;

async function refreshCartCount() {
  if (!cartCount || !navigationUser || navigationUser.role !== 'customer') {
    if (cartCount) cartCount.hidden = true;
    return;
  }

  try {
    const cartResponse = await fetch('/api/cart', {
      credentials: 'same-origin'
    });

    if (!cartResponse.ok) {
      cartCount.hidden = true;
      return;
    }

    const items = await cartResponse.json();
    cartCount.textContent = String(items.length);
    cartCount.hidden = items.length === 0;
  } catch {
    if (cartCount) cartCount.hidden = true;
  }
}

window.addEventListener('session:updated', event => {
  navigationUser = event.detail.user;
  if (accountLink) accountLink.textContent = navigationUser ? 'Кабинет' : 'Войти';
  refreshCartCount();
});

window.addEventListener('cart:updated', refreshCartCount);
