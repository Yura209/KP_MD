const $cart = selector => document.querySelector(selector);
let cartCsrfToken = '';
let signedInUser = null;

function money(value) {
  return `${Number(value || 0).toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} ₽`;
}

function showCartMessage(message, isError = false) {
  const box = $cart('#cart-message');
  box.textContent = message;
  box.classList.toggle('error', isError);
  box.hidden = false;
}

async function cartApi(url, options = {}) {
  const headers = {
    ...(options.headers || {})
  };

  if (options.body) {
    headers['Content-Type'] = 'application/json';
    headers['X-CSRF-Token'] = cartCsrfToken;
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'same-origin'
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || 'Не удалось выполнить действие.');
  }

  return data;
}

function safeImageUrl(value) {
  if (!value) return null;

  try {
    const url = new URL(value, window.location.origin);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function renderCartItem(item) {
  const row = document.createElement('article');
  row.className = 'cart-item';

  const imageUrl = safeImageUrl(item.image_url);
  if (imageUrl) {
    const image = document.createElement('img');
    image.className = 'cart-item-image';
    image.src = imageUrl;
    image.alt = item.name;
    image.loading = 'lazy';
    image.addEventListener('error', () => image.remove(), {
      once: true
    });
    row.append(image);
  }

  const details = document.createElement('div');
  details.className = 'cart-item-details';

  const name = document.createElement('h3');
  name.textContent = item.name;

  const meta = document.createElement('p');
  meta.className = 'muted';
  meta.textContent = `${item.quantity} ${item.unit_name} × ${money(item.price)}`;

  const lineTotal = document.createElement('strong');
  lineTotal.textContent = money(item.line_total);
  details.append(name, meta, lineTotal);

  const controls = document.createElement('div');
  controls.className = 'cart-item-controls';

  const quantity = document.createElement('input');
  quantity.type = 'number';
  quantity.min = '0.001';
  quantity.step = '0.001';
  quantity.max = String(item.stock);
  quantity.value = String(item.quantity);
  quantity.setAttribute('aria-label', `Количество: ${item.name}`);
  quantity.addEventListener('change', async () => {
    try {
      await cartApi(`/api/cart/${item.product_id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          quantity: Number(quantity.value)
        })
      });
      await loadCart();
      window.dispatchEvent(new Event('cart:updated'));
    } catch (error) {
      showCartMessage(error.message, true);
      await loadCart();
    }
  });

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'button button-outline';
  remove.textContent = 'Удалить';
  remove.addEventListener('click', async () => {
    try {
      await cartApi(`/api/cart/${item.product_id}`, {
        method: 'DELETE',
        body: JSON.stringify({})
      });
      await loadCart();
      window.dispatchEvent(new Event('cart:updated'));
    } catch (error) {
      showCartMessage(error.message, true);
    }
  });

  controls.append(quantity, remove);
  row.append(details, controls);
  return row;
}

async function updateCartTotal(items) {
  const totalElement = $cart('#cart-total');
  const weight = items.reduce(
    (sum, item) => sum + Number(item.weight_kg || 0) * Number(item.quantity),
    0
  );
  const volume = items.reduce(
    (sum, item) => sum + (
      Number(item.length_cm || 0) *
      Number(item.width_cm || 0) *
      Number(item.height_cm || 0) *
      Number(item.quantity)
    ) / 1000000,
    0
  );
  const maxSide = items.reduce(
    (max, item) => Math.max(
      max,
      Number(item.length_cm || 0),
      Number(item.width_cm || 0),
      Number(item.height_cm || 0)
    ),
    0
  );
  const zone = $cart('#checkout-form [name=deliveryZone]').value || 'city';
  const query = new URLSearchParams({
    weightKg: String(weight),
    volumeM3: String(volume),
    maxSideCm: String(maxSide),
    zone
  });
  const estimate = await cartApi(`/api/shipping/estimate?${query}`);

  if (!estimate.available) {
    totalElement.textContent = estimate.warning;
    $cart('#checkout-form button[type=submit]').disabled = true;
    return;
  }

  const productsTotal = items.reduce((sum, item) => sum + Number(item.line_total), 0);
  totalElement.textContent = `Товары: ${money(productsTotal)} · доставка: ${money(estimate.cost)} · итого: ${money(productsTotal + Number(estimate.cost))}`;
  $cart('#checkout-form button[type=submit]').disabled = false;
}

async function loadCart() {
  const host = $cart('#cart-list');
  const form = $cart('#checkout-form');

  try {
    const items = await cartApi('/api/cart');
    host.replaceChildren();

    if (!items.length) {
      host.append(document.createTextNode('Корзина пока пуста. Выберите товары в каталоге магазина.'));
      host.className = 'panel muted';
      form.hidden = true;
      $cart('#cart-total').textContent = '';
      window.dispatchEvent(new Event('cart:updated'));
      return;
    }

    host.className = 'cart-store-list';
    form.hidden = false;

    const groups = new Map();
    for (const item of items) {
      if (!groups.has(item.store_name)) groups.set(item.store_name, []);
      groups.get(item.store_name).push(item);
    }

    for (const [store, storeItems] of groups) {
      const section = document.createElement('section');
      section.className = 'panel cart-store';

      const heading = document.createElement('h2');
      heading.textContent = store;
      section.append(heading);

      for (const item of storeItems) {
        section.append(renderCartItem(item));
      }

      host.append(section);
    }

    await updateCartTotal(items);
    window.dispatchEvent(new Event('cart:updated'));
  } catch (error) {
    host.replaceChildren();
    host.className = 'notice error';
    host.textContent = error.message;
  }
}

$cart('#checkout-form').addEventListener('submit', async event => {
  event.preventDefault();

  const submit = event.currentTarget.querySelector('[type=submit]');
  submit.disabled = true;

  try {
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    const order = await cartApi('/api/orders', {
      method: 'POST',
      body: JSON.stringify(data)
    });

    showCartMessage(`Заказ ${order.number} оформлен. Он появится в истории заказов в личном кабинете.`);
    window.dispatchEvent(new Event('cart:updated'));
    window.location.assign('/account.html');
  } catch (error) {
    showCartMessage(error.message, true);
    submit.disabled = false;
  }
});

$cart('#checkout-form [name=deliveryZone]').addEventListener('change', loadCart);

async function initializeCart() {
  try {
    const session = await cartApi('/api/session');
    cartCsrfToken = session.csrfToken;
    signedInUser = session.user;
    window.dispatchEvent(new CustomEvent('session:updated', {
      detail: {
        user: signedInUser
      }
    }));

    if (!signedInUser || signedInUser.role !== 'customer') {
      const message = $cart('#cart-auth-required');
      const heading = message.querySelector('h2');
      const description = message.querySelector('p');

      if (signedInUser) {
        heading.textContent = 'Корзина доступна покупателю';
        description.textContent = 'Войдите под аккаунтом покупателя, чтобы оформлять заказы.';
      }

      message.hidden = false;
      $cart('#cart-content').hidden = true;
      return;
    }

    $cart('#cart-auth-required').hidden = true;
    $cart('#cart-content').hidden = false;

    if (signedInUser.phone) {
      $cart('#checkout-form [name=phone]').value = signedInUser.phone;
    }

    await loadCart();
  } catch (error) {
    showCartMessage(error.message, true);
  }
}

initializeCart();
