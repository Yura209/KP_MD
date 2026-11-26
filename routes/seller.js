const express = require('express');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const pool = require('../db');
const {
  roles,
  fail,
  numeric,
  validateText,
  tx,
  notify,
  sellerStore,
  releaseReservations,
  recomputeOrder
} = require('../lib/http');
const router = express.Router();
const maxImageBytes = 2 * 1024 * 1024;
const imageTypes = {
  'image/png': {
    extension: 'png',
    valid: buffer => buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  },
  'image/jpeg': {
    extension: 'jpg',
    valid: buffer => buffer.length >= 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255
  },
  'image/webp': {
    extension: 'webp',
    valid: buffer => buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP'
  }
};

function productImageUrl(value) {
  const imageUrl = String(value || '').trim();
  if (!imageUrl) return null;
  if (imageUrl.length > 1000) fail(400, 'Ссылка на изображение слишком длинная.');
  if (/^\/uploads\/[a-f0-9-]+\.(png|jpg|webp)$/i.test(imageUrl)) return imageUrl;

  let parsed;
  try {
    parsed = new URL(imageUrl);
  } catch {
    fail(400, 'Укажите ссылку на изображение по протоколу HTTP или HTTPS.');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    fail(400, 'Укажите ссылку на изображение по протоколу HTTP или HTTPS.');
  }

  return imageUrl;
}

router.post('/seller/uploads', roles('seller'), async (req, res) => {
  const contentType = String(req.body.contentType || '').toLowerCase();
  const imageType = imageTypes[contentType];
  const data = String(req.body.data || '');

  if (!imageType || !data || data.length > Math.ceil(maxImageBytes / 3) * 4 + 4) {
    fail(400, 'Поддерживаются PNG, JPEG и WebP размером не более 2 МБ.');
  }

  const buffer = Buffer.from(data, 'base64');
  if (buffer.length > maxImageBytes || buffer.toString('base64') !== data || !imageType.valid(buffer)) {
    fail(400, 'Файл не похож на изображение выбранного типа или превышает лимит 2 МБ.');
  }

  const fileName = `${crypto.randomUUID()}.${imageType.extension}`;
  const uploadDirectory = path.join(__dirname, '..', 'public', 'uploads');
  await fs.mkdir(uploadDirectory, {
    recursive: true
  });
  await fs.writeFile(path.join(uploadDirectory, fileName), buffer, {
    flag: 'wx'
  });

  res.status(201).json({
    imageUrl: `/uploads/${fileName}`
  });
});

router.get('/seller/products', roles('seller'), async (req, res) => {
  const sid = await sellerStore(pool, req.user.id),
  args = [
    sid
  ],
  where = [
    'store_id=$1'
  ];
  if (req.query.q) {
    args.push(`%${String(req.query.q).trim().slice(0,100)}%`);
    where.push(`(name ILIKE $${args.length} OR sku ILIKE $${args.length})`);
  }
  const r = await pool.query(`SELECT p.*,c.name category_name,u.short_name unit_name FROM products p JOIN categories c ON c.id=p.category_id JOIN units u ON u.id=p.unit_id WHERE ${where.join(' AND ')} ORDER BY p.name`, args);
  res.json(r.rows);
});
router.post('/seller/products', roles('seller'), async (req, res) => {
  const sid = await sellerStore(pool, req.user.id),
  name = validateText(req.body.name, 200, 'название'),
  sku = validateText(req.body.sku, 80, 'артикул'),
  price = numeric(req.body.price, 'цена'),
  stock = numeric(req.body.stock, 'остаток'),
  cat = numeric(req.body.categoryId, 'категория', 1),
  unit = numeric(req.body.unitId, 'единица измерения', 1);
  const r = await pool.query(`INSERT INTO products(store_id,category_id,unit_id,sku,name,description,brand,price,stock,image_url,characteristics,coverage_per_package,waste_factor,weight_kg,length_cm,width_cm,height_cm)
 SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13,$14,$15,$16,$17
 WHERE EXISTS(SELECT 1 FROM categories WHERE id=$2 AND is_active=TRUE) AND EXISTS(SELECT 1 FROM units WHERE id=$3) RETURNING id`, [
    sid,
    cat,
    unit,
    sku,
    name,
    String(req.body.description || ''),
    String(req.body.brand || '') || null,
    price,
    stock,
    productImageUrl(req.body.imageUrl),
    JSON.stringify(req.body.characteristics || {}),
    req.body.coverage || null,
    req.body.wasteFactor || 1,
    req.body.weightKg || null,
    req.body.lengthCm || null,
    req.body.widthCm || null,
    req.body.heightCm || null
  ]);
  if (!r.rowCount) fail(400, 'Проверьте категорию и единицу измерения.');
  res.status(201).json({
    id: r.rows[0].id
  });
});
router.patch('/seller/products/:id', roles('seller'), async (req, res) => {
  const sid = await sellerStore(pool, req.user.id),
  b = req.body;
  const r = await pool.query(`UPDATE products SET name=coalesce($3,name),description=coalesce($4,description),brand=coalesce($5,brand),price=coalesce($6,price),stock=coalesce($7,stock),category_id=coalesce($8,category_id),image_url=coalesce($9,image_url),characteristics=coalesce($10::jsonb,characteristics),is_active=coalesce($11,is_active),updated_at=now() WHERE id=$1 AND store_id=$2 RETURNING id`, [
    Number(req.params.id),
    sid,
    b.name ? validateText(b.name, 200, 'название'): null,
    b.description === undefined ? null: String(b.description).slice(0, 5000),
    b.brand === undefined ? null: String(b.brand).slice(0, 120),
    b.price === undefined ? null: numeric(b.price, 'цена'),
    b.stock === undefined ? null: numeric(b.stock, 'остаток'),
    b.categoryId === undefined ? null: numeric(b.categoryId, 'категория', 1),
    b.imageUrl === undefined ? null : productImageUrl(b.imageUrl),
    b.characteristics === undefined ? null: JSON.stringify(b.characteristics),
    typeof b.isActive === 'boolean' ? b.isActive: null
  ]);
  if (!r.rowCount) fail(404, 'Товар магазина не найден.');
  res.json({
    ok: true
  });
});
router.get('/seller/orders', roles('seller'), async (req, res) => {
  const sid = await sellerStore(pool, req.user.id);
  const r = await pool.query(`SELECT op.*,o.number,o.created_at,o.payment_method,o.payment_status,u.full_name customer_name,json_agg(json_build_object('id',oi.id,'productId',oi.product_id,'name',oi.product_name,'sku',oi.sku,'quantity',oi.quantity,'unit',oi.unit_name,'price',oi.unit_price,'lineTotal',oi.line_total)) items FROM order_parts op JOIN orders o ON o.id=op.order_id JOIN users u ON u.id=o.customer_id JOIN order_items oi ON oi.part_id=op.id WHERE op.store_id=$1 GROUP BY op.id,o.id,u.id ORDER BY o.created_at DESC`, [
    sid
  ]);
  res.json(r.rows);
});
router.patch('/seller/parts/:id', roles('seller'), async (req, res) => {
  const sid = await sellerStore(pool, req.user.id),
  next = String(req.body.status || '');
  if (! [
    'confirmed',
    'preparing',
    'ready',
    'cancelled'
  ].includes(next)) fail(400, 'Недопустимый статус.');
  await tx(async db => {
    const q = await db.query('SELECT * FROM order_parts WHERE id=$1 AND store_id=$2 FOR UPDATE', [
      Number(req.params.id),
      sid
    ]);
    if (!q.rowCount) fail(404, 'Часть заказа не найдена.');
    const p = q.rows[0],
    allowed = {
      pending_seller: [
        'confirmed',
        'cancelled'
      ],
      confirmed: [
        'preparing',
        'ready',
        'cancelled'
      ],
      preparing: [
        'ready',
        'cancelled'
      ],
      ready: [],
      received_at_hub: [],
      handed_to_delivery: [],
      cancelled: []
    };
    if (!(allowed[p.status] || []).includes(next)) fail(409, 'Недопустимый переход статуса.');
    if (next === 'confirmed') {
      const items = await db.query('SELECT oi.id,oi.product_id,oi.quantity,pr.stock FROM order_items oi JOIN products pr ON pr.id=oi.product_id WHERE oi.part_id=$1 ORDER BY pr.id FOR UPDATE OF pr', [
        p.id
      ]);
      for (const i of items.rows) if (Number(i.quantity) > Number(i.stock)) fail(409, 'На складе недостаточно одного из товаров.');
      for (const i of items.rows) {
        await db.query('UPDATE products SET stock=stock-$2,updated_at=now() WHERE id=$1', [
          i.product_id,
          i.quantity
        ]);
        await db.query('UPDATE order_items SET reserved=TRUE WHERE id=$1', [
          i.id
        ]);
      }
    }
    if (next === 'cancelled') await releaseReservations(db, p.id);
    await db.query('UPDATE order_parts SET status=$2,updated_at=now() WHERE id=$1', [
      p.id,
      next
    ]);
    const o = (await db.query('SELECT order_id FROM order_parts WHERE id=$1', [
      p.id
    ])).rows[0];
    await recomputeOrder(db, o.order_id);
    await db.query('INSERT INTO order_status_history(order_id,part_id,new_status,changed_by) VALUES($1,$2,$3,$4)', [
      o.order_id,
      p.id,
      next,
      req.user.id
    ]);
    const buyer = (await db.query('SELECT customer_id,number,total FROM orders WHERE id=$1', [
      o.order_id
    ])).rows[0];
    await notify(db, buyer.customer_id, 'Обновлён заказ', `Статус части заказа ${buyer.number}: ${next}.`);
    if (next === 'cancelled') await notify(db, buyer.customer_id, 'Изменена сумма заказа', `После отмены части заказа ${buyer.number} сумма пересчитана: ${buyer.total} ₽.`);
  });
  res.json({
    ok: true
  });
});
router.get('/seller/stats', roles('seller'), async (req, res) => {
  const sid = await sellerStore(pool, req.user.id);
  const summary = await pool.query(`SELECT count(DISTINCT op.order_id) orders,coalesce(sum(oi.quantity) FILTER(WHERE op.status<>'cancelled'),0) units_sold,coalesce(sum(oi.line_total) FILTER(WHERE op.status<>'cancelled'),0) sales FROM order_parts op LEFT JOIN order_items oi ON oi.part_id=op.id WHERE op.store_id=$1`, [
    sid
  ]);
  const low = await pool.query('SELECT id,name,stock FROM products WHERE store_id=$1 AND is_active=TRUE AND stock<=5 ORDER BY stock,name LIMIT 10', [
    sid
  ]);
  res.json({
    summary: summary.rows[0],
    lowStock: low.rows
  });
});
router.post('/seller/reviews/:id/reply', roles('seller'), async (req, res) => {
  const sid = await sellerStore(pool, req.user.id),
  body = validateText(req.body.body, 2000, 'ответ'),
  r = await pool.query('UPDATE reviews r SET seller_reply=$3,replied_at=now() FROM products p WHERE r.product_id=p.id AND r.id=$1 AND p.store_id=$2 AND r.seller_reply IS NULL RETURNING r.id', [
    Number(req.params.id),
    sid,
    body
  ]);
  if (!r.rowCount) fail(404, 'Отзыв не найден или ответ уже добавлен.');
  res.json({
    ok: true
  });
});
router.get('/seller/reviews', roles('seller'), async (req, res) => {
  const sid = await sellerStore(pool, req.user.id);
  const r = await pool.query('SELECT r.id,r.rating,r.body,r.seller_reply,r.created_at,p.name product_name,u.full_name customer_name FROM reviews r JOIN products p ON p.id=r.product_id JOIN users u ON u.id=r.customer_id WHERE p.store_id=$1 ORDER BY r.created_at DESC', [
    sid
  ]);
  res.json(r.rows);
});
module.exports = router;
