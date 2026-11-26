const pool = require('../db');

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  throw error;
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Войдите в систему, чтобы продолжить.'
    });
  }

  next();
}

function roles(...allowed) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        error: 'Требуется вход.'
      });
    }

    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({
        error: 'Недостаточно прав.'
      });
    }

    next();
  };
}

function validateText(value, max, label) {
  const text = String(value || '').trim();

  if (!text || text.length > max) {
    fail(400, `Проверьте поле «${label}».`);
  }

  return text;
}

function numeric(value, label, min = 0, max = 10000000) {
  const n = Number(value);

  if (!Number.isFinite(n) || n < min || n > max) {
    fail(400, `Некорректное значение: ${label}.`);
  }

  return n;
}

async function tx(work) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const result = await work(client);

    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function notify(db, userId, title, body) {
  if (userId) {
    await db.query(
      'INSERT INTO notifications(user_id,title,body) VALUES($1,$2,$3)',
      [userId, title, body]
    );
  }
}

async function sellerStore(db, userId) {
  const result = await db.query(
    'SELECT store_id FROM seller_stores WHERE user_id=$1 ORDER BY store_id LIMIT 1',
    [userId]
  );

  if (!result.rowCount) {
    fail(403, 'Для продавца не назначен магазин.');
  }

  return result.rows[0].store_id;
}

async function releaseReservations(db, partId) {
  const items = await db.query(
    `SELECT id, product_id, quantity
     FROM order_items
     WHERE part_id=$1 AND reserved=TRUE AND reservation_released=FALSE
     FOR UPDATE`,
    [partId]
  );

  for (const item of items.rows) {
    if (item.product_id) {
      await db.query(
        'UPDATE products SET stock=stock+$2,updated_at=now() WHERE id=$1',
        [item.product_id, item.quantity]
      );
    }

    await db.query(
      'UPDATE order_items SET reservation_released=TRUE WHERE id=$1',
      [item.id]
    );
  }
}

async function recomputeOrder(db, orderId) {
  const result = await db.query(
    `SELECT
       count(*) FILTER (WHERE status='pending_seller') AS pending,
       count(*) FILTER (WHERE status<>'cancelled') AS active,
       count(*) FILTER (
         WHERE status IN (
           'confirmed',
           'preparing',
           'ready',
           'received_at_hub',
           'handed_to_delivery'
         )
       ) AS accepted,
       coalesce(
         sum(items_total) FILTER (WHERE status<>'cancelled'),
         0
       ) AS items_total
     FROM order_parts
     WHERE order_id=$1`,
    [orderId]
  );

  const order = result.rows[0];
  let status = 'awaiting_sellers';

  if (Number(order.pending) === 0 && Number(order.active) === 0) {
    status = 'cancelled';
  } else if (Number(order.pending) === 0 && Number(order.accepted) > 0) {
    status = 'awaiting_payment';
  } else if (Number(order.accepted) > 0) {
    status = 'partially_confirmed';
  }

  await db.query(
    'UPDATE orders SET status=$2,items_total=$3,total=$3+shipping_total,updated_at=now() WHERE id=$1',
    [orderId, status, order.items_total]
  );

  return status;
}

module.exports = {
  fail,
  requireAuth,
  roles,
  validateText,
  numeric,
  tx,
  notify,
  sellerStore,
  releaseReservations,
  recomputeOrder
};