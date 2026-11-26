const express = require('express');
const pool = require('../db');
const {
  roles,
  fail,
  numeric,
  validateText,
  tx,
  notify
} = require('../lib/http');
const {
  hashPassword
} = require('../lib/auth');
const router = express.Router();
router.get('/admin/overview', roles('admin'), async (req, res) => {
  const [
    users,
    stores,
    products,
    orders,
    returns
  ] = await Promise.all([
    pool.query('SELECT role,count(*)::int count FROM users GROUP BY role'),
    pool.query('SELECT count(*)::int count FROM stores'),
    pool.query('SELECT count(*)::int count FROM products WHERE is_active=TRUE'),
    pool.query('SELECT status,count(*)::int count FROM orders GROUP BY status'),
    pool.query("SELECT count(*)::int count FROM return_requests WHERE status='pending'")
  ]);
  res.json({
    users: users.rows,
    stores: stores.rows[0].count,
    products: products.rows[0].count,
    orders: orders.rows,
    openReturns: returns.rows[0].count
  });
});
router.get('/admin/stores', roles('admin'), async (req, res) => {
  const r = await pool.query('SELECT * FROM stores ORDER BY id');
  res.json(r.rows);
});
router.post('/admin/stores', roles('admin'), async (req, res) => {
  const slug = validateText(req.body.slug, 80, 'код магазина').toLowerCase().replace(/[^a-z0-9-]/g, '-'),
  name = validateText(req.body.name, 160, 'название'),
  description = String(req.body.description || '').slice(0, 3000),
  r = await pool.query('INSERT INTO stores(slug,name,description,address,phone) VALUES($1,$2,$3,$4,$5) RETURNING id', [
    slug,
    name,
    description,
    String(req.body.address || '').slice(0, 500),
    String(req.body.phone || '').slice(0, 30)
  ]);
  await pool.query("INSERT INTO audit_log(actor_id,action,object_type,object_id) VALUES($1,'create','store',$2)", [
    req.user.id,
    r.rows[0].id
  ]);
  res.status(201).json({
    id: r.rows[0].id
  });
});
router.patch('/admin/stores/:id', roles('admin'), async (req, res) => {
  const r = await pool.query('UPDATE stores SET name=coalesce($2,name),description=coalesce($3,description),is_active=coalesce($4,is_active) WHERE id=$1 RETURNING id', [
    Number(req.params.id),
    req.body.name ? validateText(req.body.name, 160, 'название'): null,
    req.body.description === undefined ? null: String(req.body.description).slice(0, 3000),
    typeof req.body.isActive === 'boolean' ? req.body.isActive: null
  ]);
  if (!r.rowCount) fail(404, 'Магазин не найден.');
  await pool.query("INSERT INTO audit_log(actor_id,action,object_type,object_id,details) VALUES($1,'update','store',$2,$3::jsonb)", [
    req.user.id,
    r.rows[0].id,
    JSON.stringify(req.body)
  ]);
  res.json({
    ok: true
  });
});
router.post('/admin/sellers', roles('admin'), async (req, res) => {
  const name = validateText(req.body.fullName, 120, 'имя'),
  email = validateText(req.body.email, 254, 'электронная почта').toLowerCase(),
  password = String(req.body.password || ''),
  storeId = numeric(req.body.storeId, 'магазин', 1);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Укажите корректный адрес электронной почты.');
  if (password.length < 10) fail(400, 'Пароль должен содержать не менее 10 символов.');
  const id = await tx(async db => {
    const u = await db.query("INSERT INTO users(full_name,email,phone,password_hash,role) VALUES($1,$2,$3,$4,'seller') RETURNING id", [
      name,
      email,
      String(req.body.phone || '').slice(0, 30) || null,
      hashPassword(password)
    ]);
    await db.query('INSERT INTO seller_stores(user_id,store_id) VALUES($1,$2)', [
      u.rows[0].id,
      storeId
    ]);
    await db.query("INSERT INTO audit_log(actor_id,action,object_type,object_id) VALUES($1,'create','seller',$2)", [
      req.user.id,
      u.rows[0].id
    ]);
    return u.rows[0].id;
  });
  res.status(201).json({
    id
  });
});
router.get('/admin/users', roles('admin'), async (req, res) => {
  const r = await pool.query('SELECT id,full_name,email,phone,role,is_active,created_at FROM users ORDER BY created_at DESC LIMIT 500');
  res.json(r.rows);
});
router.patch('/admin/users/:id', roles('admin'), async (req, res) => {
  const target = Number(req.params.id),
  active = Boolean(req.body.isActive);
  if (target === Number(req.user.id) && !active) fail(400, 'Нельзя заблокировать собственную учётную запись.');
  const r = await pool.query('UPDATE users SET is_active=$2,updated_at=now() WHERE id=$1 RETURNING id', [
    target,
    active
  ]);
  if (!r.rowCount) fail(404, 'Пользователь не найден.');
  await pool.query("INSERT INTO audit_log(actor_id,action,object_type,object_id,details) VALUES($1,'set_active','user',$2,$3::jsonb)", [
    req.user.id,
    target,
    JSON.stringify({
      isActive: active
    })
  ]);
  res.json({
    ok: true
  });
});
router.get('/admin/categories', roles('admin'), async (req, res) => {
  const r = await pool.query('SELECT * FROM categories ORDER BY parent_id NULLS FIRST,name');
  res.json(r.rows);
});
router.post('/admin/categories', roles('admin'), async (req, res) => {
  const name = validateText(req.body.name, 120, 'название'),
  slug = String(req.body.slug || name.toLowerCase().replace(/[^a-zа-я0-9]+/gi, '-')).slice(0, 120);
  const r = await pool.query('INSERT INTO categories(parent_id,name,slug,description) VALUES($1,$2,$3,$4) RETURNING id', [
    req.body.parentId || null,
    name,
    slug,
    String(req.body.description || '').slice(0, 1000)
  ]);
  res.status(201).json({
    id: r.rows[0].id
  });
});
router.patch('/admin/categories/:id', roles('admin'), async (req, res) => {
  const r = await pool.query('UPDATE categories SET name=coalesce($2,name),is_active=coalesce($3,is_active) WHERE id=$1 RETURNING id', [
    Number(req.params.id),
    req.body.name ? validateText(req.body.name, 120, 'название'): null,
    typeof req.body.isActive === 'boolean' ? req.body.isActive: null
  ]);
  if (!r.rowCount) fail(404, 'Категория не найдена.');
  res.json({
    ok: true
  });
});
router.get('/admin/products', roles('admin'), async (req, res) => {
  const r = await pool.query('SELECT p.id,p.sku,p.name,p.price,p.stock,p.is_active,s.name store_name,c.name category_name,u.short_name unit_name FROM products p JOIN stores s ON s.id=p.store_id JOIN categories c ON c.id=p.category_id JOIN units u ON u.id=p.unit_id ORDER BY s.name,p.name LIMIT 1000');
  res.json(r.rows);
});
router.get('/admin/orders', roles('admin'), async (req, res) => {
  const r = await pool.query('SELECT o.*,u.full_name customer_name FROM orders o JOIN users u ON u.id=o.customer_id ORDER BY o.created_at DESC LIMIT 300');
  res.json(r.rows);
});
router.post('/admin/orders/:id/delivery', roles('admin'), async (req, res) => {
  const type = String(req.body.eventType || ''),
  allowed = {
    received_at_hub: [
      'awaiting_hub',
      'awaiting_payment'
    ],
    shipped: [
      'at_hub'
    ],
    delivered: [
      'shipped'
    ],
    cash_received: [
      'shipped',
      'delivered'
    ],
    admin_completed: [
      'delivered'
    ]
  };
  if (!allowed[type]) fail(400, 'Недопустимое событие доставки.');
  await tx(async db => {
    const q = await db.query('SELECT * FROM orders WHERE id=$1 FOR UPDATE', [
      Number(req.params.id)
    ]);
    if (!q.rowCount) fail(404, 'Заказ не найден.');
    const o = q.rows[0];
    if (!allowed[type].includes(o.status)) fail(409, 'Событие невозможно для текущего статуса заказа.');
    if (type === 'cash_received' && o.payment_method !== 'cash_on_delivery') fail(409, 'Для заказа выбрана онлайн-оплата.');
    if (type === 'cash_received' && o.payment_status === 'paid') fail(409, 'Оплата уже зафиксирована.');
    if (type === 'received_at_hub') {
      if (o.payment_method === 'online_demo' && o.payment_status !== 'paid') fail(409, 'Сначала зафиксируйте онлайн-оплату.');
      const ready = await db.query("SELECT count(*) FILTER(WHERE status NOT IN ('ready','cancelled')) not_ready,count(*) FILTER(WHERE status='ready') ready FROM order_parts WHERE order_id=$1", [
        o.id
      ]);
      if (Number(ready.rows[0].not_ready) > 0 || Number(ready.rows[0].ready) === 0) fail(409, 'Дождитесь готовности всех подтверждённых частей заказа.');
    }
    if (type === 'admin_completed') await db.query("UPDATE orders SET status='completed',updated_at=now() WHERE id=$1", [
      o.id
    ]);
    else if (type === 'cash_received') {
      await db.query("UPDATE orders SET status='delivered',payment_status='paid',updated_at=now() WHERE id=$1", [
        o.id
      ]);
      await db.query("INSERT INTO payments(order_id,operation,method,status,amount) VALUES($1,'payment','cash_on_delivery','received',$2)", [
        o.id,
        o.total
      ]);
    } else {
      const status = {
        received_at_hub: 'at_hub',
        shipped: 'shipped',
        delivered: 'delivered'
      }
      [type];
      await db.query('UPDATE orders SET status=$2,updated_at=now() WHERE id=$1', [
        o.id,
        status
      ]);
    }
    await db.query('INSERT INTO delivery_events(order_id,event_type,comment,created_by) VALUES($1,$2,$3,$4)', [
      o.id,
      type,
      String(req.body.comment || '').slice(0, 1000),
      req.user.id
    ]);
    if (type === 'received_at_hub') await db.query("UPDATE order_parts SET status='received_at_hub',updated_at=now() WHERE order_id=$1 AND status IN ('ready','confirmed','preparing')", [
      o.id
    ]);
    await db.query('INSERT INTO order_status_history(order_id,new_status,changed_by,comment) VALUES($1,$2,$3,$4)', [
      o.id,
      type,
      req.user.id,
      String(req.body.comment || '')
    ]);
    await notify(db, o.customer_id, 'Обновлена доставка', `Статус заказа ${o.number}: ${type}.`);
  });
  res.json({
    ok: true
  });
});
router.get('/admin/returns', roles('admin'), async (req, res) => {
  const r = await pool.query('SELECT rr.*,oi.product_name,o.number,o.payment_method,u.full_name customer_name FROM return_requests rr JOIN order_items oi ON oi.id=rr.order_item_id JOIN order_parts op ON op.id=oi.part_id JOIN orders o ON o.id=op.order_id JOIN users u ON u.id=rr.customer_id ORDER BY rr.created_at DESC');
  res.json(r.rows);
});
router.patch('/admin/returns/:id', roles('admin'), async (req, res) => {
  const status = String(req.body.status || '');
  if (! [
    'approved',
    'rejected'
  ].includes(status)) fail(400, 'Укажите решение по заявке.');
  await tx(async db => {
    const q = await db.query('SELECT rr.*,o.payment_method,o.id order_id,o.customer_id FROM return_requests rr JOIN order_items oi ON oi.id=rr.order_item_id JOIN order_parts op ON op.id=oi.part_id JOIN orders o ON o.id=op.order_id WHERE rr.id=$1 FOR UPDATE OF rr', [
      Number(req.params.id)
    ]);
    if (!q.rowCount) fail(404, 'Заявка не найдена.');
    const x = q.rows[0];
    if (x.status !== 'pending') fail(409, 'Заявка уже рассмотрена.');
    await db.query('UPDATE return_requests SET status=$2,admin_comment=$3,updated_at=now() WHERE id=$1', [
      x.id,
      status,
      String(req.body.comment || '').slice(0, 1000)
    ]);
    if (status === 'approved' && x.payment_method === 'online_demo' && !x.refund_recorded) {
      const amount = (await db.query('SELECT line_total FROM order_items WHERE id=$1', [
        x.order_item_id
      ])).rows[0].line_total;
      await db.query("INSERT INTO payments(order_id,operation,method,status,amount) VALUES($1,'refund','online_demo','succeeded',$2)", [
        x.order_id,
        amount
      ]);
      await db.query('UPDATE return_requests SET refund_recorded=TRUE WHERE id=$1', [
        x.id
      ]);
    }
    await notify(db, x.customer_id, 'Заявка на возврат рассмотрена', `Заявка №${x.id}: ${status}.`);
    await db.query("INSERT INTO audit_log(actor_id,action,object_type,object_id,details) VALUES($1,'review','return_request',$2,$3::jsonb)", [
      req.user.id,
      x.id,
      JSON.stringify({
        status
      })
    ]);
  });
  res.json({
    ok: true
  });
});
router.patch('/admin/shipping', roles('admin'), async (req, res) => {
  const baseFee = numeric(req.body.baseFee, 'базовый тариф'),
  perKg = numeric(req.body.perKg, 'тариф за кг'),
  maxWeightKg = numeric(req.body.maxWeightKg, 'ограничение веса', 1, 100000),
  cityZoneFee = numeric(req.body.cityZoneFee, 'тариф по городу'),
  regionZoneFee = numeric(req.body.regionZoneFee, 'тариф по области'),
  maxDimensionCm = numeric(req.body.maxDimensionCm, 'ограничение габарита', 1, 100000),
  maxVolumeM3 = numeric(req.body.maxVolumeM3, 'ограничение объёма', 0.001, 100000);
  await pool.query("INSERT INTO app_settings(key,value) VALUES('shipping',$1::jsonb) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [
    JSON.stringify({
      base_fee: baseFee,
      per_kg: perKg,
      max_weight_kg: maxWeightKg,
      zones: {
        city: cityZoneFee,
        region: regionZoneFee
      },
      max_dimension_cm: maxDimensionCm,
      max_volume_m3: maxVolumeM3
    })
  ]);
  res.json({
    ok: true
  });
});
router.post('/admin/returns/:id/refund', roles('admin'), async (req, res) => {
  await tx(async db => {
    const q = await db.query('SELECT rr.id,rr.status,rr.refund_recorded,oi.line_total,o.payment_method,o.customer_id,o.id order_id FROM return_requests rr JOIN order_items oi ON oi.id=rr.order_item_id JOIN order_parts op ON op.id=oi.part_id JOIN orders o ON o.id=op.order_id WHERE rr.id=$1 FOR UPDATE OF rr', [
      Number(req.params.id)
    ]);
    if (!q.rowCount) fail(404, 'Заявка не найдена.');
    const r = q.rows[0];
    if (r.status !== 'approved' || r.payment_method !== 'cash_on_delivery' || r.refund_recorded) fail(409, 'Нельзя зафиксировать этот возврат.');
    await db.query("INSERT INTO payments(order_id,operation,method,status,amount) VALUES($1,'refund','cash_on_delivery','recorded',$2)", [
      r.order_id,
      r.line_total
    ]);
    await db.query('UPDATE return_requests SET refund_recorded=TRUE,updated_at=now() WHERE id=$1', [
      r.id
    ]);
    await db.query("INSERT INTO audit_log(actor_id,action,object_type,object_id) VALUES($1,'cash_refund','return_request',$2)", [
      req.user.id,
      r.id
    ]);
    await notify(db, r.customer_id, 'Возврат денег зафиксирован', `Администратор подтвердил возврат по заявке ${r.id}.`);
  });
  res.json({
    ok: true
  });
});
module.exports = router;
