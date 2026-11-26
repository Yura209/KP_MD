const express = require('express');
const pool = require('../db');
const {
  numeric,
  fail
} = require('../lib/http');
const router = express.Router();
const select = `SELECT p.id,p.store_id,p.category_id,c.name category_name,p.sku,p.name,p.description,p.brand,p.price,p.stock,u.short_name unit_name,p.image_url,p.characteristics,p.coverage_per_package,p.waste_factor,p.weight_kg,p.length_cm,p.width_cm,p.height_cm,s.name store_name,coalesce((SELECT round(avg(r.rating)::numeric,1) FROM reviews r WHERE r.product_id=p.id),0) rating,(SELECT count(*) FROM order_items oi JOIN order_parts op ON op.id=oi.part_id WHERE oi.product_id=p.id AND op.status<>'cancelled') sales FROM products p JOIN stores s ON s.id=p.store_id JOIN categories c ON c.id=p.category_id JOIN units u ON u.id=p.unit_id`;
function parts(req, sid) {
  const args = [],
  where = [
    'p.is_active=TRUE',
    's.is_active=TRUE'
  ];
  if (sid) {
    args.push(sid);
    where.push(`p.store_id=$${args.length}`);
  }
  const q = String(req.query.q || '').trim().slice(0, 100);
  if (q) {
    args.push(`%${q}%`);
    where.push(`(p.name ILIKE $${args.length} OR p.sku ILIKE $${args.length} OR coalesce(p.brand,'') ILIKE $${args.length} OR c.name ILIKE $${args.length})`);
  }
  if (req.query.category) {
    args.push(Number(req.query.category));
    where.push(`p.category_id=$${args.length}`);
  }
  if (req.query.minPrice !== undefined && req.query.minPrice !== '') {
    args.push(numeric(req.query.minPrice, 'минимальная цена'));
    where.push(`p.price >= $${args.length}`);
  }
  if (req.query.maxPrice !== undefined && req.query.maxPrice !== '') {
    args.push(numeric(req.query.maxPrice, 'максимальная цена'));
    where.push(`p.price <= $${args.length}`);
  }
  if (req.query.characteristics) {
    let characteristics;
    try {
      characteristics = JSON.parse(String(req.query.characteristics));
    } catch {
      fail(400, 'Некорректный фильтр характеристик.');
    }
    if (!characteristics || Array.isArray(characteristics) || typeof characteristics !== 'object' || String(req.query.characteristics).length > 1000) fail(400, 'Фильтр характеристик должен быть объектом JSON до 1000 символов.');
    args.push(JSON.stringify(characteristics));
    where.push(`p.characteristics @> $${args.length}::jsonb`);
  }
  if (req.query.inStock === 'true') where.push('p.stock>0');
  const sorts = {
    price_asc: 'p.price ASC,p.id',
    price_desc: 'p.price DESC,p.id',
    name: 'p.name ASC',
    rating: 'rating DESC,p.name',
    popular: 'sales DESC,p.name'
  };
  return {
    args,
    where: where.join(' AND '),
    order: sorts[String(req.query.sort || '')] || 'p.name ASC'
  };
}
async function products(req, sid) {
  const x = parts(req, sid),
  limit = Math.max(1, Math.min(100, Number(req.query.limit) || 60));
  return(await pool.query(`${select} WHERE ${x.where} ORDER BY ${x.order} LIMIT ${limit}`, x.args)).rows;
}
router.get('/stores', async (req, res) => res.json((await pool.query('SELECT id,slug,name,description,logo_url,address,phone FROM stores WHERE is_active=TRUE ORDER BY name')).rows));
router.get('/categories', async (req, res) => res.json((await pool.query('SELECT id,parent_id,name,slug FROM categories WHERE is_active=TRUE ORDER BY name')).rows));
router.get('/units', async (req, res) => res.json((await pool.query('SELECT id,name,short_name FROM units ORDER BY name')).rows));
router.get('/products', async (req, res) => res.json(await products(req, null)));
router.get('/stores/:id/products', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) fail(400, 'Некорректный магазин.');
  if (!(await pool.query('SELECT id FROM stores WHERE id=$1 AND is_active=TRUE', [
    id
  ])).rowCount) fail(404, 'Магазин не найден.');
  res.json(await products(req, id));
});
router.get('/products/:id', async (req, res) => {
  const r = await pool.query(`${select} WHERE p.id=$1 AND p.is_active=TRUE AND s.is_active=TRUE`, [
    Number(req.params.id)
  ]);
  if (!r.rowCount) fail(404, 'Товар не найден.');
  res.json(r.rows[0]);
});
router.get('/products/:id/reviews', async (req, res) => res.json((await pool.query('SELECT r.id,r.rating,r.body,r.seller_reply,r.created_at,u.full_name FROM reviews r JOIN users u ON u.id=r.customer_id WHERE r.product_id=$1 ORDER BY r.created_at DESC LIMIT 50', [
  Number(req.params.id)
])).rows));
router.get('/shipping/estimate', async (req, res) => {
  const weight = numeric(req.query.weightKg || 0, 'масса'),
  volume = numeric(req.query.volumeM3 || 0, 'объём'),
  maxSide = numeric(req.query.maxSideCm || 0, 'габарит'),
  zone = String(req.query.zone || 'city');
  if (! [
    'city',
    'region'
  ].includes(zone)) fail(400, 'Некорректная зона доставки.');
  const cfg = (await pool.query("SELECT value FROM app_settings WHERE key='shipping'")).rows[0]?.value || {
    base_fee: 450,
    per_kg: 15,
    max_weight_kg: 200,
    zones: {
      city: 0,
      region: 350
    },
    max_dimension_cm: 300,
    max_volume_m3: 2
  };
  if (weight > Number(cfg.max_weight_kg || 200) || volume > Number(cfg.max_volume_m3 || 2) || maxSide > Number(cfg.max_dimension_cm || 300)) return res.json({
    available: false,
    warning: 'Вес или габариты требуют согласования администратора.',
    weightKg: weight,
    volumeM3: volume,
    maxSideCm: maxSide
  });
  const zoneFee = Number((cfg.zones || {
    city: 0,
    region: 350
  })[zone] || 0);
  res.json({
    available: true,
    zone,
    weightKg: weight,
    volumeM3: volume,
    maxSideCm: maxSide,
    cost: Number(cfg.base_fee || 0) + zoneFee + weight * Number(cfg.per_kg || 0)
  });
});
module.exports = router;
